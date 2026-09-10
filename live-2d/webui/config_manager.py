#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 配置管理模块
负责配置文件的读写和所有配置相关的 API
"""

import copy
import json
import os
import shutil
import tempfile
import threading
import urllib.request
import urllib.error
from flask import Blueprint, request, jsonify

from .state_io import atomic_write_json
from .utils import PROJECT_ROOT, logger

# 创建配置管理蓝图
config_bp = Blueprint('config', __name__)

AVATAR_MOTION_MODES = {'blend', 'legacy', 'director'}
PTT_DEFAULT_KEY = 'v'
PTT_NAMED_KEYS = {
    'backspace',
    'tab',
    'enter',
    'capslock',
    'escape',
    'space',
    'pageup',
    'pagedown',
    'end',
    'home',
    'arrowleft',
    'arrowup',
    'arrowright',
    'arrowdown',
    'insert',
    'delete',
    'numpadmultiply',
    'numpadadd',
    'numpadsubtract',
    'numpaddecimal',
    'numpaddivide',
    'numpadenter',
    'semicolon',
    'equal',
    'comma',
    'minus',
    'period',
    'slash',
    'backquote',
    'bracketleft',
    'backslash',
    'bracketright',
    'quote',
    'ctrl',
    'ctrlright',
    'alt',
    'altright',
    'shift',
    'shiftright',
    'meta',
    'metaright',
    'numlock',
    'scrolllock',
    'printscreen',
}
PTT_SUPPORTED_KEYS = (
    set('abcdefghijklmnopqrstuvwxyz0123456789')
    | {f'f{index}' for index in range(1, 25)}
    | {f'numpad{index}' for index in range(10)}
    | PTT_NAMED_KEYS
)
PTT_KEY_ALIASES = {
    ' ': 'space',
    'spacebar': 'space',
    'return': 'enter',
    'esc': 'escape',
    'control': 'ctrl',
    'controlleft': 'ctrl',
    'controlright': 'ctrlright',
    'ctrlleft': 'ctrl',
    'altleft': 'alt',
    'shiftleft': 'shift',
    'metaleft': 'meta',
    'osleft': 'meta',
    'osright': 'metaright',
    'command': 'meta',
    'cmd': 'meta',
    'win': 'meta',
    'windows': 'meta',
    'option': 'alt',
    'left': 'arrowleft',
    'up': 'arrowup',
    'right': 'arrowright',
    'down': 'arrowdown',
    ';': 'semicolon',
    ':': 'semicolon',
    '=': 'equal',
    '+': 'equal',
    ',': 'comma',
    '<': 'comma',
    '-': 'minus',
    '_': 'minus',
    '.': 'period',
    '>': 'period',
    '/': 'slash',
    '?': 'slash',
    '`': 'backquote',
    '~': 'backquote',
    '[': 'bracketleft',
    '{': 'bracketleft',
    '\\': 'backslash',
    '|': 'backslash',
    ']': 'bracketright',
    '}': 'bracketright',
    "'": 'quote',
    '"': 'quote',
}
_CONFIG_LOCK = threading.RLock()
_MISSING = object()
CONFIG_PATH = PROJECT_ROOT / 'config.json'
CONFIG_TEMPLATE_PATH = PROJECT_ROOT / 'config.example.json'


class ConfigDocument(dict):
    """Config mapping with the disk snapshot used for conflict-aware saves."""

    def __init__(self, data=None, *, load_error=None):
        initial = data if isinstance(data, dict) else {}
        super().__init__(initial)
        self._source_snapshot = copy.deepcopy(initial)
        self._load_error = load_error


def normalize_avatar_motion_mode(value):
    mode = str(value or '').strip().lower()
    return mode if mode in AVATAR_MOTION_MODES else 'blend'


def _nonempty_id(value):
    text = str(value or '').strip()
    if not text or text.lower() in ('none', 'null', 'undefined'):
        return ''
    return text


def has_paired_choreography_provider(block):
    if not isinstance(block, dict):
        return False
    return bool(_nonempty_id(block.get('provider_id')) and _nonempty_id(block.get('model_id')))


def motion_director_uses_dialogue(config):
    """未成对填写编舞专用 provider/model 时，编舞复用主对话模型。"""
    md = config.get('motion_director') if isinstance(config.get('motion_director'), dict) else {}
    if has_paired_choreography_provider(md):
        return False
    body = md.get('body') if isinstance(md.get('body'), dict) else {}
    face = md.get('face') if isinstance(md.get('face'), dict) else {}
    return not (
        has_paired_choreography_provider(body) or has_paired_choreography_provider(face)
    )


def sync_motion_director_enabled(config, mode):
    """动作模式与编舞总闸一起写，避免只改下拉框、enabled 仍为 false。"""
    if not isinstance(config.get('motion_director'), dict):
        config['motion_director'] = {}
    config['motion_director']['enabled'] = mode != 'legacy'
    return config['motion_director']['enabled']


# 动作风格预设（soullink 对齐更新 P1）：仅「仅 AI 编舞」档消费，空字符串 = 不使用预设
CHOREO_MOTION_STYLES = {'natural', 'lively', 'calm', 'shy'}


def normalize_choreo_motion_style(value):
    style = str(value or '').strip().lower()
    return style if style in CHOREO_MOTION_STYLES else ''


def normalize_ptt_key(value):
    original = '' if value is None else str(value)
    raw = original if original == ' ' else original.strip().lower()
    if not raw:
        raise ValueError('PTT 按键不能为空')

    if (
        len(raw) == 4
        and raw.startswith('key')
        and raw[3] in 'abcdefghijklmnopqrstuvwxyz'
    ):
        raw = raw[3]
    elif (
        len(raw) == 6
        and raw.startswith('digit')
        and raw[5] in '0123456789'
    ):
        raw = raw[5]

    normalized = PTT_KEY_ALIASES.get(raw, raw)
    if normalized not in PTT_SUPPORTED_KEYS:
        raise ValueError(f'暂不支持这个 PTT 按键：{original}')
    return normalized


def get_configured_ptt_key(asr_config):
    try:
        return normalize_ptt_key(asr_config.get('ptt_key', PTT_DEFAULT_KEY))
    except (AttributeError, ValueError):
        return PTT_DEFAULT_KEY


def _read_config_file(config_path):
    with open(config_path, 'r', encoding='utf-8') as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError('config.json 顶层必须是 JSON 对象')
    return data


def _ensure_local_config():
    if CONFIG_PATH.exists():
        return False

    template = _read_config_file(CONFIG_TEMPLATE_PATH)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            newline='\n',
            dir=CONFIG_PATH.parent,
            prefix=f'.{CONFIG_PATH.name}.',
            suffix='.tmp',
            delete=False,
        ) as file:
            temp_path = file.name
            json.dump(template, file, ensure_ascii=False, indent=2)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())

        try:
            os.link(temp_path, CONFIG_PATH)
            return True
        except FileExistsError:
            return False
        except OSError:
            try:
                target_fd = os.open(
                    CONFIG_PATH,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
            except FileExistsError:
                return False
            try:
                with open(temp_path, 'rb') as source, os.fdopen(
                    target_fd,
                    'wb',
                ) as target:
                    shutil.copyfileobj(source, target)
                    target.flush()
                    os.fsync(target.fileno())
                return True
            except Exception:
                try:
                    os.unlink(CONFIG_PATH)
                except OSError:
                    pass
                raise
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def _merge_changed_values(current, original, desired):
    if original is not _MISSING and desired == original:
        return _MISSING if current is _MISSING else copy.deepcopy(current)

    if isinstance(original, dict) and isinstance(desired, dict):
        current_dict = current if isinstance(current, dict) else {}
        merged = copy.deepcopy(current_dict)
        for key in set(original) | set(desired):
            original_value = original.get(key, _MISSING)
            desired_value = desired.get(key, _MISSING)
            current_value = current_dict.get(key, _MISSING)

            if desired_value is _MISSING:
                if original_value is not _MISSING:
                    merged.pop(key, None)
                continue
            if original_value is _MISSING:
                merged[key] = copy.deepcopy(desired_value)
                continue

            merged_value = _merge_changed_values(
                current_value,
                original_value,
                desired_value,
            )
            if merged_value is _MISSING:
                merged.pop(key, None)
            else:
                merged[key] = merged_value
        return merged

    return copy.deepcopy(desired)


def load_config():
    """加载配置文件，并保留本次读取快照供并发保存时合并。"""
    try:
        with _CONFIG_LOCK:
            _ensure_local_config()
            return ConfigDocument(_read_config_file(CONFIG_PATH))
    except Exception as e:
        logger.warning(f'加载配置文件失败：{str(e)}')
        return ConfigDocument(load_error=str(e))


def save_config(config):
    """在锁内合并本次改动，并通过同目录临时文件原子保存。"""
    temp_path = None

    if isinstance(config, ConfigDocument) and config._load_error:
        logger.error(
            f'拒绝覆盖无法读取的 config.json：{config._load_error}'
        )
        return False

    try:
        if not isinstance(config, dict):
            raise ValueError('待保存配置必须是 JSON 对象')

        with _CONFIG_LOCK:
            _ensure_local_config()
            latest = _read_config_file(CONFIG_PATH)
            if isinstance(config, ConfigDocument):
                content = _merge_changed_values(
                    latest,
                    config._source_snapshot,
                    dict(config),
                )
            else:
                content = copy.deepcopy(config)

            if not isinstance(content, dict):
                raise ValueError('待保存配置必须是 JSON 对象')

            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                newline='\n',
                dir=CONFIG_PATH.parent,
                prefix=f'.{CONFIG_PATH.name}.',
                suffix='.tmp',
                delete=False,
            ) as file:
                temp_path = file.name
                json.dump(content, file, ensure_ascii=False, indent=2)
                file.write('\n')
                file.flush()
                os.fsync(file.fileno())

            os.replace(temp_path, CONFIG_PATH)
            temp_path = None

            if isinstance(config, ConfigDocument):
                config.clear()
                config.update(copy.deepcopy(content))
                config._source_snapshot = copy.deepcopy(content)
            return True
    except Exception as e:
        logger.error(f'保存配置文件失败：{str(e)}')
        return False
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def notify_runtime_config_reload():
    try:
        req = urllib.request.Request('http://localhost:3002/reload-config', data=b'{}', method='POST')
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=1.5) as response:
            return response.status == 200
    except Exception as e:
        logger.info(f'Live2D runtime config reload skipped: {e}')
        return False


# ============ LLM 提供商存储层 ============
# 与 js/core/llm-provider-store.js 行为保持一致：
#   - 模型 ID 一律原样保存，不做 provider 前缀剥离
#   - temperature_* / reasoning_* 为模型级参数，挂在模型条目上
#   - 迁移时凭据相同（api_key + api_url）的对话/视觉配置合并为一个 provider

PROVIDER_STORE_PATH = PROJECT_ROOT / 'llm_providers.json'

# 模型条目上允许携带的「模型级生成参数」
MODEL_PARAM_KEYS = ('temperature_enabled', 'temperature', 'reasoning_enabled', 'reasoning_effort')


def normalize_model_entry(model):
    """规范化单个模型条目；非法时返回 None"""
    if isinstance(model, str):
        model_id = model.strip()
        if not model_id:
            return None
        return {'model_id': model_id, 'name': model_id, 'enabled': True}
    if not isinstance(model, dict):
        return None
    model_id = str(model.get('model_id') or model.get('id') or model.get('name') or '').strip()
    if not model_id:
        return None
    entry = dict(model)
    entry.pop('id', None)
    entry['model_id'] = model_id
    name = model.get('name')
    entry['name'] = name.strip() if isinstance(name, str) and name.strip() else model_id
    entry['enabled'] = model.get('enabled', True) is not False
    return entry


def normalize_provider(provider):
    """规范化单个 provider；非法时返回 None"""
    if not isinstance(provider, dict):
        return None
    provider_id = str(provider.get('id') or '').strip()
    if not provider_id:
        return None

    raw_models = provider.get('models')
    if not isinstance(raw_models, list):
        legacy_model = provider.get('model')
        raw_models = [legacy_model] if isinstance(legacy_model, str) and legacy_model.strip() else []

    models = []
    seen = set()
    for model in raw_models:
        entry = normalize_model_entry(model)
        if entry and entry['model_id'] not in seen:
            seen.add(entry['model_id'])
            models.append(entry)

    name = provider.get('name')
    return {
        'id': provider_id,
        'name': name.strip() if isinstance(name, str) and name.strip() else provider_id,
        'api_key': provider.get('api_key') if isinstance(provider.get('api_key'), str) else '',
        'api_url': provider.get('api_url') if isinstance(provider.get('api_url'), str) else '',
        'enabled': provider.get('enabled', True) is not False,
        'models': models
    }


def normalize_providers_data(raw_value):
    if isinstance(raw_value, dict):
        raw_list = raw_value.get('providers', [])
    elif isinstance(raw_value, list):
        raw_list = raw_value
    else:
        raw_list = []
    normalized = []
    seen = set()
    for provider in raw_list:
        entry = normalize_provider(provider)
        if entry and entry['id'] not in seen:
            seen.add(entry['id'])
            normalized.append(entry)
    return normalized


def load_provider_store():
    """读取 llm_providers.json。返回 (providers, load_failed)"""
    if not PROVIDER_STORE_PATH.exists():
        return [], False
    try:
        with open(PROVIDER_STORE_PATH, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        return normalize_providers_data(raw), False
    except Exception as e:
        logger.warning(f'读取 llm_providers.json 失败：{str(e)}')
        # 文件损坏时绝不能写回覆盖用户文件
        return [], True


def save_provider_store(providers):
    try:
        atomic_write_json(
            PROVIDER_STORE_PATH,
            {'providers': normalize_providers_data(providers)},
        )
        return True
    except Exception as e:
        logger.error(f'保存 llm_providers.json 失败：{str(e)}')
        return False


def has_legacy_credentials(source):
    if not isinstance(source, dict):
        return False
    return any(isinstance(source.get(key), str) and source.get(key).strip() for key in ('api_key', 'api_url'))


def same_credentials(a, b):
    def key_of(s):
        return str((s or {}).get('api_key') or '').strip()

    def url_of(s):
        return str((s or {}).get('api_url') or '').strip().rstrip('/')

    return key_of(a) == key_of(b) and url_of(a) == url_of(b)


def build_legacy_providers(config):
    """从旧版 config 构建 provider 列表（仅 store 为空时执行一次迁移）"""
    llm_config = config.get('llm') or {}
    vision_config = (config.get('vision') or {}).get('vision_model') or {}
    providers = []
    llm_selection = None
    vision_selection = None

    has_llm = has_legacy_credentials(llm_config)
    has_vision = has_legacy_credentials(vision_config)
    vision_model_id = str(vision_config.get('model_id') or vision_config.get('model') or '').strip()

    if has_llm:
        main_provider = {
            'id': 'main',
            'name': '主模型',
            'api_key': llm_config.get('api_key', ''),
            'api_url': llm_config.get('api_url', ''),
            'enabled': True,
            'models': []
        }
        llm_model_id = str(llm_config.get('model_id') or llm_config.get('model') or '').strip()
        if llm_model_id:
            entry = {'model_id': llm_model_id, 'name': llm_model_id, 'enabled': True}
            for key in MODEL_PARAM_KEYS:
                if key in llm_config:
                    entry[key] = llm_config[key]
            main_provider['models'].append(entry)
            llm_selection = {'provider_id': 'main', 'model_id': llm_model_id}
        providers.append(main_provider)

        # 凭据相同：视觉模型并入同一 provider
        if has_vision and same_credentials(llm_config, vision_config):
            if vision_model_id:
                if not any(m['model_id'] == vision_model_id for m in main_provider['models']):
                    main_provider['models'].append({'model_id': vision_model_id, 'name': vision_model_id, 'enabled': True})
                vision_selection = {'provider_id': 'main', 'model_id': vision_model_id}
            return providers, llm_selection, vision_selection

    if has_vision:
        providers.append({
            'id': 'vision',
            'name': '视觉模型',
            'api_key': vision_config.get('api_key', ''),
            'api_url': vision_config.get('api_url', ''),
            'enabled': True,
            'models': [{'model_id': vision_model_id, 'name': vision_model_id, 'enabled': True}] if vision_model_id else []
        })
        if vision_model_id:
            vision_selection = {'provider_id': 'vision', 'model_id': vision_model_id}

    return providers, llm_selection, vision_selection


def find_provider(providers, provider_id):
    if not provider_id:
        return None
    for provider in providers:
        if provider.get('id') == provider_id:
            return provider
    return None


def ensure_selected_model_present(provider, model_id):
    """确保 provider.models 中存在指定模型（缺失则补，禁用则启用）。返回是否发生修改。"""
    if not isinstance(provider, dict) or not model_id:
        return False
    models = provider.setdefault('models', [])
    for model in models:
        if isinstance(model, dict) and model.get('model_id') == model_id:
            if model.get('enabled', True) is False:
                model['enabled'] = True
                return True
            return False
    models.append({'model_id': model_id, 'name': model_id, 'enabled': True})
    return True


def first_enabled_selection(providers):
    for provider in providers:
        if not isinstance(provider, dict) or provider.get('enabled', True) is False:
            continue
        models = provider.get('models') or []
        model = next((m for m in models if m.get('enabled', True) is not False), models[0] if models else None)
        if model:
            return {'provider_id': provider['id'], 'model_id': model['model_id']}
    return None


def apply_selections_and_scrub(config, providers, llm_selection=None, vision_selection=None):
    """应用选择、修正失效引用、清洗旧版敏感字段。返回 (config_changed, providers_changed)"""
    config_changed = False
    providers_changed = False

    llm_config = config.setdefault('llm', {})
    vision_config = config.setdefault('vision', {})

    # ---- 对话模型选择 ----
    if not llm_config.get('provider_id') and llm_selection:
        llm_config['provider_id'] = llm_selection['provider_id']
        llm_config['model_id'] = llm_selection['model_id']
        config_changed = True
    llm_provider = find_provider(providers, llm_config.get('provider_id'))
    if llm_provider:
        model_id = str(llm_config.get('model_id') or '').strip()
        if model_id:
            if ensure_selected_model_present(llm_provider, model_id):
                providers_changed = True
        else:
            fallback = first_enabled_selection([llm_provider])
            if fallback:
                llm_config['model_id'] = fallback['model_id']
                config_changed = True
    elif llm_config.get('provider_id'):
        fallback = first_enabled_selection(providers)
        llm_config['provider_id'] = fallback['provider_id'] if fallback else ''
        llm_config['model_id'] = fallback['model_id'] if fallback else ''
        config_changed = True
    elif providers:
        fallback = first_enabled_selection(providers)
        if fallback:
            llm_config['provider_id'] = fallback['provider_id']
            llm_config['model_id'] = fallback['model_id']
            config_changed = True

    # ---- 视觉模型选择 ----
    if not vision_config.get('provider_id') and vision_selection:
        vision_config['provider_id'] = vision_selection['provider_id']
        vision_config['model_id'] = vision_selection['model_id']
        config_changed = True
    vision_provider = find_provider(providers, vision_config.get('provider_id'))
    if vision_provider:
        model_id = str(vision_config.get('model_id') or '').strip()
        if model_id and ensure_selected_model_present(vision_provider, model_id):
            providers_changed = True
    elif vision_config.get('provider_id'):
        vision_config['provider_id'] = ''
        vision_config['model_id'] = ''
        config_changed = True

    # ---- 清洗 config.llm 旧字段（仅当通讯录已有条目，避免只擦不迁）----
    if providers:
        if llm_config.get('api_key'):
            llm_config['api_key'] = ''
            config_changed = True
        if llm_config.get('api_url'):
            llm_config['api_url'] = ''
            config_changed = True
        for key in ('model',) + MODEL_PARAM_KEYS:
            if key in llm_config:
                llm_config.pop(key)
                config_changed = True

    # 双契约：不要清空 vision.vision_model。旧「功能配置」页仍读写这三个格子。

    return config_changed, providers_changed


def apply_legacy_vision_model_to_providers(config, providers, vm):
    """把旧版视觉三格同步进通讯录。返回是否修改了 providers。"""
    if not isinstance(vm, dict) or not isinstance(providers, list):
        return False

    vision_config = config.setdefault('vision', {})
    target_id = str(vision_config.get('provider_id') or '').strip() or 'vision'
    target = find_provider(providers, target_id)
    if target is None:
        target = {
            'id': target_id,
            'name': target_id,
            'api_key': '',
            'api_url': '',
            'enabled': True,
            'models': [],
        }
        providers.append(target)

    changed = False
    if 'api_key' in vm:
        target['api_key'] = vm.get('api_key', '')
        changed = True
    if 'api_url' in vm:
        target['api_url'] = vm.get('api_url', '')
        changed = True
    if 'model' in vm:
        model_name = str(vm.get('model') or '').strip()
        if model_name:
            ensure_selected_model_present(target, model_name)
            vision_config['provider_id'] = target_id
            vision_config['model_id'] = model_name
            changed = True
    elif not vision_config.get('provider_id'):
        vision_config['provider_id'] = target_id
        changed = True
    return changed


def apply_legacy_temperature_to_model(provider, model_id, data):
    """把旧版 LLM POST 的 temperature 写进当前选中模型条目。"""
    if not isinstance(provider, dict) or not model_id:
        return
    if 'temperature' not in data and 'temperature_enabled' not in data:
        return
    ensure_selected_model_present(provider, model_id)
    for model in provider.setdefault('models', []):
        if not isinstance(model, dict) or model.get('model_id') != model_id:
            continue
        if 'temperature' in data:
            try:
                model['temperature'] = float(data.get('temperature'))
            except (TypeError, ValueError):
                pass
        if 'temperature_enabled' in data:
            model['temperature_enabled'] = bool(data.get('temperature_enabled'))
        break


def ensure_provider_store(config, persist=True):
    """
    完整的「读取 → 迁移 → 清洗 → 持久化」流程（Python 端入口）。
    返回 providers 列表；config 被原地修改（清洗 + 选择修正）。
    """
    providers, load_failed = load_provider_store()
    if load_failed:
        # 文件损坏：本次只读不写
        apply_selections_and_scrub(config, providers)
        return providers

    store_changed = False
    migrated = False
    llm_selection = None
    vision_selection = None

    if not providers:
        providers, llm_selection, vision_selection = build_legacy_providers(config)
        providers = normalize_providers_data(providers)
        if providers:
            store_changed = True
            migrated = True

    config_changed, providers_changed = apply_selections_and_scrub(
        config, providers, llm_selection, vision_selection
    )

    if persist:
        # 首次迁移前备份 config.json（仅一次）
        if migrated:
            config_path = CONFIG_PATH
            backup_path = CONFIG_PATH.parent / 'config.json.pre-provider.bak'
            if config_path.exists() and not backup_path.exists():
                try:
                    shutil.copyfile(config_path, backup_path)
                    logger.info(f'已备份迁移前配置: {backup_path}')
                except Exception as e:
                    logger.warning(f'备份迁移前配置失败：{str(e)}')
        if store_changed or providers_changed:
            if not save_provider_store(providers):
                # 通讯录没写成，禁止把擦掉旧三格的 config 落盘
                return providers
        if config_changed:
            save_config(config)

    return providers


def iter_enabled_models(providers):
    for provider in providers:
        if not isinstance(provider, dict) or provider.get('enabled', True) is False:
            continue
        for model in provider.get('models') or []:
            if isinstance(model, dict) and model.get('enabled', True) is not False and model.get('model_id'):
                yield provider, model


def get_enabled_model_choices(providers, include_empty=False):
    """生成模型下拉选项，value 为 'provider_id|model_id' 复合值"""
    choices = []
    if include_empty:
        choices.append({'value': '', 'provider_id': '', 'model_id': '', 'label': '（不使用）'})
    for provider, model in iter_enabled_models(providers):
        provider_id = provider.get('id', '')
        model_id = model.get('model_id', '')
        provider_name = provider.get('name') or provider_id
        choices.append({
            'value': f'{provider_id}|{model_id}',
            'provider_id': provider_id,
            'model_id': model_id,
            'label': f'{provider_name} / {model_id}'
        })
    return choices


def parse_model_ref(value):
    """解析 'provider_id|model_id' 复合值"""
    raw = str(value or '').strip()
    if not raw or '|' not in raw:
        return '', ''
    provider_id, model_id = raw.split('|', 1)
    return provider_id.strip(), model_id.strip()


# ============ LLM 配置 ============

@config_bp.route('/api/config/llm', methods=['GET', 'POST'])
def handle_llm_config():
    """LLM 提供商管理：GET 返回完整 providers + 当前选择；POST 保存"""
    config = load_config()
    if request.method == 'GET':
        providers = ensure_provider_store(config)
        llm_config = config.get('llm', {})
        retry_config = llm_config.get('retry') if isinstance(llm_config.get('retry'), dict) else {}
        fallback_provider_id = str(retry_config.get('fallback_provider_id') or '').strip()
        fallback_model_id = str(retry_config.get('fallback_model_id') or '').strip()
        fallback_model_ref = f'{fallback_provider_id}|{fallback_model_id}' if fallback_provider_id and fallback_model_id else ''

        # 双契约：旧三格从「当前选中的 provider」回填，供旧版 LLM 页读写。
        # 不读已清空的 config.llm.api_key。
        current_provider_id = llm_config.get('provider_id', '')
        current_provider = find_provider(providers, current_provider_id) or (providers[0] if providers else {})
        legacy_model = llm_config.get('model_id', '') or ''
        # 旧 temperature 已迁到模型级：从当前选中模型的条目回填（旧前端只读展示）
        legacy_temperature = llm_config.get('temperature', 0.9)
        legacy_temperature_enabled = llm_config.get('temperature_enabled', False)
        for _m in (current_provider.get('models') or []):
            if _m.get('model_id') == legacy_model:
                legacy_temperature = _m.get('temperature', legacy_temperature)
                legacy_temperature_enabled = _m.get('temperature_enabled', legacy_temperature_enabled)
                break
        return jsonify({
            # 旧字段（旧前端三格）
            'api_key': current_provider.get('api_key', ''),
            'api_url': current_provider.get('api_url', ''),
            'model': legacy_model,
            'temperature': legacy_temperature,
            'temperature_enabled': legacy_temperature_enabled,
            # 新字段（通讯录）
            'providers': providers,
            'provider_id': current_provider_id,
            'model_id': llm_config.get('model_id', ''),
            'system_prompt': llm_config.get('system_prompt', ''),
            'fallback_model_ref': fallback_model_ref,
            'fallback_provider_id': fallback_provider_id,
            'fallback_model_id': fallback_model_id
        })
    elif request.method == 'POST':
        try:
            data = request.get_json() or {}
            current_providers = ensure_provider_store(config, persist=False)

            if isinstance(data.get('providers'), list):
                # 新前端：直接提交完整 providers
                providers = normalize_providers_data(data['providers'])
                if not providers and current_providers:
                    return jsonify({'error': '不能用空通讯录覆盖已有提供商数据'}), 400
            elif any(k in data for k in ('api_key', 'api_url', 'model', 'temperature', 'temperature_enabled')):
                # 旧前端三格：写进当前 provider（没有则创建 main），并更新选中 model
                providers = current_providers
                llm_sel = config.setdefault('llm', {})
                target_id = llm_sel.get('provider_id') or (providers[0]['id'] if providers else 'main')
                target = find_provider(providers, target_id)
                if target is None:
                    target = {'id': target_id, 'name': target_id, 'api_key': '', 'api_url': '', 'enabled': True, 'models': []}
                    providers.append(target)
                if 'api_key' in data:
                    target['api_key'] = data.get('api_key', '')
                if 'api_url' in data:
                    target['api_url'] = data.get('api_url', '')
                if 'model' in data:
                    model_name = str(data.get('model') or '').strip()
                    if model_name and not any(m.get('model_id') == model_name for m in target.setdefault('models', [])):
                        target['models'].append({'model_id': model_name, 'name': model_name, 'enabled': True})
                    llm_sel['provider_id'] = target_id
                    if model_name:
                        llm_sel['model_id'] = model_name
                selected_model_id = str(llm_sel.get('model_id') or '').strip()
                apply_legacy_temperature_to_model(target, selected_model_id, data)
            else:
                providers = current_providers

            llm_config = config.setdefault('llm', {})
            if 'provider_id' in data:
                llm_config['provider_id'] = str(data.get('provider_id') or '').strip()
            if 'model_id' in data:
                llm_config['model_id'] = str(data.get('model_id') or '').strip()
            if 'system_prompt' in data:
                llm_config['system_prompt'] = data.get('system_prompt', '')
            if 'fallback_model_ref' in data:
                provider_id, model_id = parse_model_ref(data.get('fallback_model_ref'))
                retry_config = llm_config.setdefault('retry', {})
                if provider_id and model_id:
                    retry_config['fallback_provider_id'] = provider_id
                    retry_config['fallback_model_id'] = model_id
                else:
                    retry_config.pop('fallback_provider_id', None)
                    retry_config.pop('fallback_model_id', None)

            apply_selections_and_scrub(config, providers)

            if not save_provider_store(providers):
                return jsonify({'error': '保存提供商数据失败'}), 500
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


@config_bp.route('/api/config/llm/providers/models/fetch', methods=['POST'])
def fetch_llm_provider_models():
    """从提供商的 /models 接口拉取模型列表"""
    try:
        data = request.get_json() or {}
        api_url = str(data.get('api_url') or '').strip().rstrip('/')
        api_key = str(data.get('api_key') or '').strip()
        if not api_url or not api_key:
            return jsonify({'success': False, 'error': '请先填写 API URL 和 API Key'}), 400

        req = urllib.request.Request(
            f'{api_url}/models',
            headers={'Authorization': f'Bearer {api_key}'}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            payload = json.loads(response.read().decode('utf-8'))

        model_ids = sorted(
            {str(item.get('id')) for item in payload.get('data', []) if isinstance(item, dict) and item.get('id')},
            key=lambda item: item.lower()
        )
        return jsonify({'success': True, 'models': model_ids})
    except urllib.error.HTTPError as e:
        return jsonify({'success': False, 'error': f'获取模型列表失败：HTTP {e.code}'}), 502
    except urllib.error.URLError as e:
        return jsonify({'success': False, 'error': f'获取模型列表失败：{getattr(e, "reason", e)}'}), 502
    except Exception as e:
        logger.error(f'获取 provider 模型列表失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


@config_bp.route('/api/config/llm/providers/models/test', methods=['POST'])
def test_llm_provider_model():
    """对提供商模型发送最小请求测活"""
    try:
        data = request.get_json() or {}
        api_url = str(data.get('api_url') or '').strip().rstrip('/')
        api_key = str(data.get('api_key') or '').strip()
        model_id = str(data.get('model_id') or '').strip()
        if not api_url or not api_key or not model_id:
            return jsonify({'success': False, 'error': '请先填写 API URL、API Key 和模型 ID'}), 400

        payload = json.dumps({
            'model': model_id,
            'messages': [{'role': 'user', 'content': 'ping'}],
            'max_tokens': 1,
            'stream': False
        }).encode('utf-8')

        req = urllib.request.Request(
            f'{api_url}/chat/completions',
            data=payload,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            response.read()

        return jsonify({
            'success': True,
            'summary': '测活成功',
            'detail': f'{model_id} 已正常响应',
            'model_id': model_id
        })
    except urllib.error.HTTPError as e:
        detail = f'HTTP {e.code}'
        try:
            body = e.read().decode('utf-8', errors='replace')[:300]
            if body:
                detail = f'HTTP {e.code}: {body}'
        except Exception:
            pass
        return jsonify({'success': False, 'summary': '测活失败', 'error': detail, 'detail': detail}), 502
    except urllib.error.URLError as e:
        reason = str(getattr(e, 'reason', e))
        return jsonify({'success': False, 'summary': '测活失败', 'error': reason, 'detail': reason}), 502
    except Exception as e:
        logger.error(f'provider 模型测活失败：{str(e)}')
        return jsonify({'success': False, 'summary': '测活失败', 'error': str(e), 'detail': str(e)}), 500


# ============ 人格设置 ============

@config_bp.route('/api/settings/persona', methods=['GET', 'POST'])
def handle_persona_settings():
    """处理人格设置（system_prompt）"""
    config = load_config()
    llm_config = config.setdefault('llm', {})
    if request.method == 'GET':
        return jsonify({'system_prompt': llm_config.get('system_prompt', '')})
    try:
        data = request.get_json() or {}
        llm_config['system_prompt'] = data.get('system_prompt', '')
        if save_config(config):
            return jsonify({'success': True})
        return jsonify({'error': '保存失败'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ 对话设置 ============

@config_bp.route('/api/settings/chat', methods=['GET', 'POST'])
def handle_chat_settings():
    """处理对话设置"""
    config = load_config()
    if request.method == 'GET':
        ui_config = config.get('ui', {})
        context_config = config.get('context', {})
        return jsonify({
            'intro_text': ui_config.get('intro_text', '你好啊'),
            'max_messages': context_config.get('max_messages', 30),
            'enable_limit': context_config.get('enable_limit', True),
            'persistent_history': context_config.get('persistent_history', False),
            'history_file': context_config.get('history_file', '')
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'context' not in config:
                config['context'] = {}
            config['ui']['intro_text'] = data.get('intro_text', '')
            config['context']['max_messages'] = data.get('max_messages', 30)
            config['context']['enable_limit'] = data.get('enable_limit', True)
            config['context']['persistent_history'] = data.get('persistent_history', False)
            config['context']['history_file'] = data.get('history_file', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 声音设置 ============

@config_bp.route('/api/settings/voice', methods=['GET', 'POST'])
def handle_voice_settings():
    """处理声音设置"""
    config = load_config()
    if request.method == 'GET':
        cloud_config = config.get('cloud', {})
        return jsonify({
            'provider': cloud_config.get('provider', 'siliconflow'),
            'api_key': cloud_config.get('api_key', ''),
            'cloud_tts': cloud_config.get('tts', {}),
            'aliyun_tts': cloud_config.get('aliyun_tts', {}),
            'volcengine_tts': cloud_config.get('volcengine_tts', {}),
            'baidu_asr': cloud_config.get('baidu_asr', {}),
            'api_gateway': config.get('api_gateway', {})
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            # 更新 cloud 配置
            if 'cloud' not in config:
                config['cloud'] = {}
            if 'provider' in data:
                config['cloud']['provider'] = data['provider']
            if 'api_key' in data:
                config['cloud']['api_key'] = data['api_key']
            if 'cloud_tts' in data:
                config['cloud']['tts'] = {
                    'enabled': data['cloud_tts'].get('enabled', False),
                    'url': data['cloud_tts'].get('url', 'https://api.siliconflow.cn/v1/audio/speech'),
                    'model': data['cloud_tts'].get('model', 'FunAudioLLM/CosyVoice2-0.5B'),
                    'voice': data['cloud_tts'].get('voice', ''),
                    'response_format': data['cloud_tts'].get('response_format', 'wav'),
                    'speed': data['cloud_tts'].get('speed', 1.0)
                }
            if 'aliyun_tts' in data:
                config['cloud']['aliyun_tts'] = {
                    'enabled': data['aliyun_tts'].get('enabled', False),
                    'api_key': data['aliyun_tts'].get('api_key', ''),
                    'workspace_id': str(data['aliyun_tts'].get(
                        'workspace_id',
                        config['cloud'].get('aliyun_tts', {}).get('workspace_id', ''),
                    )).strip(),
                    'model': data['aliyun_tts'].get('model', 'cosyvoice-v3-flash'),
                    'voice': data['aliyun_tts'].get('voice', ''),
                    'sample_rate': data['aliyun_tts'].get('sample_rate', 48000),
                    'volume': data['aliyun_tts'].get('volume', 50),
                    'rate': data['aliyun_tts'].get('rate', 1),
                    'pitch': data['aliyun_tts'].get('pitch', 1)
                }
            if 'volcengine_tts' in data:
                config['cloud']['volcengine_tts'] = {
                    'enabled': data['volcengine_tts'].get('enabled', False),
                    'appid': data['volcengine_tts'].get('appid', ''),
                    'access_token': data['volcengine_tts'].get('access_token', ''),
                    'voice_type': data['volcengine_tts'].get('voice_type', 'saturn_zh_female_tiaopigongzhu_tob'),
                    'resource_id': data['volcengine_tts'].get('resource_id', 'seed-tts-2.0')
                }
            if 'baidu_asr' in data:
                config['cloud']['baidu_asr'] = {
                    'enabled': data['baidu_asr'].get('enabled', False),
                    'url': data['baidu_asr'].get('url', 'ws://vop.baidu.com/realtime_asr'),
                    'appid': data['baidu_asr'].get('appid', 0),
                    'appkey': data['baidu_asr'].get('appkey', ''),
                    'dev_pid': data['baidu_asr'].get('dev_pid', 0)
                }
            # 更新 api_gateway 配置（独立顶层配置）
            if 'api_gateway' in data:
                if 'api_gateway' not in config:
                    config['api_gateway'] = {}
                config['api_gateway']['use_gateway'] = data['api_gateway'].get('use_gateway', False)
                config['api_gateway']['base_url'] = data['api_gateway'].get('base_url', '')
                config['api_gateway']['api_key'] = data['api_gateway'].get('api_key', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ B站直播设置 ============

@config_bp.route('/api/settings/bilibili', methods=['GET', 'POST'])
def handle_bilibili_settings():
    """处理 B 站直播设置"""
    config = load_config()
    if request.method == 'GET':
        bilibili_config = config.get('bilibili', {})
        return jsonify({
            'enabled': bilibili_config.get('enabled', False),
            'roomId': bilibili_config.get('roomId', ''),
            'checkInterval': bilibili_config.get('checkInterval', 5000),
            'maxMessages': bilibili_config.get('maxMessages', 50)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'bilibili' not in config:
                config['bilibili'] = {}
            config['bilibili'].update({
                'enabled': data.get('enabled', False),
                'roomId': data.get('roomId', ''),
                'checkInterval': data.get('checkInterval', 5000),
                'maxMessages': data.get('maxMessages', 50),
                'apiUrl': 'http://api.live.bilibili.com/ajax/msg'
            })
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ UI 设置 ============

@config_bp.route('/api/settings/ui', methods=['GET', 'POST'])
def handle_ui_settings():
    """处理 UI 设置"""
    config = load_config()
    if request.method == 'GET':
        ui_config = config.get('ui', {})
        subtitle_config = config.get('subtitle_labels', {})
        motion_mode = normalize_avatar_motion_mode(ui_config.get('avatar_motion_mode', 'blend'))
        return jsonify({
            'show_chat_box': ui_config.get('show_chat_box', True),
            'show_model': ui_config.get('show_model', True),
            'model_scale': ui_config.get('model_scale', 2.3),
            'avatar_motion_mode': motion_mode,
            'motion_style': normalize_choreo_motion_style((config.get('motion_director') or {}).get('style', '')),
            'motion_director_enabled': motion_mode != 'legacy',
            'motion_director_uses_dialogue': motion_director_uses_dialogue(config),
            'subtitle_user': subtitle_config.get('user', '用户'),
            'subtitle_ai': subtitle_config.get('ai', 'AI'),
            'subtitle_enabled': subtitle_config.get('enabled', False)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'subtitle_labels' not in config:
                config['subtitle_labels'] = {}
            config['ui']['show_chat_box'] = data.get('show_chat_box', True)
            config['ui']['show_model'] = data.get('show_model', True)
            config['ui']['model_scale'] = data.get('model_scale', 2.3)
            motion_mode = normalize_avatar_motion_mode(data.get('avatar_motion_mode', 'blend'))
            config['ui']['avatar_motion_mode'] = motion_mode
            sync_motion_director_enabled(config, motion_mode)
            # 动作风格预设：写进 motion_director.style（仅 director 档消费）；未选预设时移除该键
            if 'motion_style' in data:
                if not isinstance(config.get('motion_director'), dict):
                    config['motion_director'] = {}
                style = normalize_choreo_motion_style(data.get('motion_style', ''))
                if style:
                    config['motion_director']['style'] = style
                else:
                    config['motion_director'].pop('style', None)
            config['subtitle_labels']['user'] = data.get('subtitle_user', '用户')
            config['subtitle_labels']['ai'] = data.get('subtitle_ai', 'AI')
            config['subtitle_labels']['enabled'] = data.get('subtitle_enabled', False)
            if save_config(config):
                return jsonify({
                    'success': True,
                    'runtime_reloaded': notify_runtime_config_reload(),
                    'motion_director_enabled': config['motion_director']['enabled'],
                    'motion_director_uses_dialogue': motion_director_uses_dialogue(config),
                })
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ WebUI 版面切换（双版面 flavor）============

def normalize_webui_flavor(value):
    """归一化版面。仅认 new/old；空/非法/历史值一律回退到新版（产品默认新版）。

    历史实验值兼容：classic→old；cyber（误入 flavor 槽）→ new。
    新用户 config 无此键 → 默认 new。
    """
    v = str(value or '').strip().lower()
    if v == 'new':
        return 'new'
    if v in ('old', 'classic'):
        return 'old'
    return 'new'


@config_bp.route('/api/webui/flavor', methods=['GET', 'POST'])
def handle_webui_flavor():
    """读写 WebUI 版面（config.ui.webui_flavor）。GET 缺省返回 new。"""
    if request.method == 'GET':
        config = load_config()
        flavor = normalize_webui_flavor((config.get('ui') or {}).get('webui_flavor'))
        return jsonify({'flavor': flavor})

    try:
        data = request.get_json(force=True) or {}
    except Exception:
        return jsonify({'error': '请求体需为 JSON'}), 400
    flavor = str(data.get('flavor') or '').strip().lower()
    if flavor not in ('new', 'old'):
        return jsonify({'error': "flavor 必须是 'new' 或 'old'"}), 400
    config = load_config()
    if 'ui' not in config or not isinstance(config['ui'], dict):
        config['ui'] = {}
    config['ui']['webui_flavor'] = flavor
    if save_config(config):
        return jsonify({'success': True, 'flavor': flavor})
    return jsonify({'error': '保存失败'}), 500


# ============ 主动对话设置 ============

@config_bp.route('/api/settings/autochat', methods=['GET', 'POST'])
def handle_auto_chat_settings():
    """处理主动对话设置"""
    config = load_config()
    if request.method == 'GET':
        auto_chat_config = config.get('auto_chat', {})
        mood_chat_config = config.get('mood_chat', {})
        ai_diary_config = config.get('ai_diary', {})
        return jsonify({
            'enabled': auto_chat_config.get('enabled', False),
            'idle_time': auto_chat_config.get('idle_time', 30),
            'prompt': auto_chat_config.get('prompt', ''),
            'mood_chat_enabled': mood_chat_config.get('enabled', False),
            'ai_diary_enabled': ai_diary_config.get('enabled', False)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'auto_chat' not in config:
                config['auto_chat'] = {}
            if 'mood_chat' not in config:
                config['mood_chat'] = {}
            if 'ai_diary' not in config:
                config['ai_diary'] = {}
            config['auto_chat']['enabled'] = data.get('enabled', False)
            config['auto_chat']['idle_time'] = data.get('idle_time', 30)
            config['auto_chat']['prompt'] = data.get('prompt', '')
            config['mood_chat']['enabled'] = data.get('mood_chat_enabled', False)
            config['ai_diary']['enabled'] = data.get('ai_diary_enabled', False)
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 高级设置 ============

@config_bp.route('/api/settings/advanced', methods=['GET', 'POST'])
def handle_advanced_settings():
    """处理基础配置（视觉、UI、工具开关等）"""
    config = load_config()
    if request.method == 'GET':
        providers = ensure_provider_store(config)
        vision_config = config.get('vision', {})
        auto_close_config = config.get('auto_close_services', {})
        ui_config = config.get('ui', {})
        tools_config = config.get('tools', {})
        mcp_config = config.get('mcp', {})
        asr_config = config.get('asr', {})

        vision_provider_id = vision_config.get('provider_id', '')
        vision_model_id = vision_config.get('model_id', '')
        vision_model_ref = f'{vision_provider_id}|{vision_model_id}' if vision_provider_id and vision_model_id else ''

        # 旧版前端契约字段（双契约：旧「功能配置」页仍读这些）
        bert_config = config.get('bert', {})
        legacy_vision_model = vision_config.get('vision_model', {}) or {}
        vision_provider = find_provider(providers, vision_provider_id) or {}
        vision_model_payload = {
            'api_key': vision_provider.get('api_key') or legacy_vision_model.get('api_key', ''),
            'api_url': vision_provider.get('api_url') or legacy_vision_model.get('api_url', ''),
            'model': vision_model_id or legacy_vision_model.get('model', ''),
        }

        return jsonify({
            # vision_enabled 已移除，不再使用
            'auto_screenshot': vision_config.get('auto_screenshot', False),
            'use_vision_model': vision_config.get('use_vision_model', False),
            'vision_model_ref': vision_model_ref,
            'vision_model_options': get_enabled_model_choices(providers, include_empty=True),
            'auto_close_services': auto_close_config.get('enabled', False),
            'show_chat_box': ui_config.get('show_chat_box', True),
            'show_model': ui_config.get('show_model', True),
            'voice_barge_in': asr_config.get('voice_barge_in', True),
            'ptt_enabled': asr_config.get('ptt_enabled', False),
            'ptt_key': get_configured_ptt_key(asr_config),
            'tools_enabled': tools_config.get('enabled', True),
            'mcp_enabled': mcp_config.get('enabled', True),
            # 旧字段回显：BERT 开关 + 视觉三格（旧前端读写）
            'bert_enabled': bert_config.get('enabled', False),
            'vision_model': vision_model_payload,
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'vision' not in config:
                config['vision'] = {}
            if 'auto_close_services' not in config:
                config['auto_close_services'] = {}
            if 'ui' not in config:
                config['ui'] = {}
            if 'tools' not in config:
                config['tools'] = {}
            if 'mcp' not in config:
                config['mcp'] = {}
            if 'asr' not in config:
                config['asr'] = {}
            if 'bert' not in config:
                config['bert'] = {}

            # 双契约：仅当请求体显式携带某键才更新，避免旧前端 POST（无 ptt/mcp 等键）
            # 把用户已配置的新字段重置回默认值。
            if 'auto_screenshot' in data:
                config['vision']['auto_screenshot'] = data.get('auto_screenshot', False)
            if 'use_vision_model' in data:
                config['vision']['use_vision_model'] = data.get('use_vision_model', False)
            if 'auto_close_services' in data:
                config['auto_close_services']['enabled'] = data.get('auto_close_services', False)
            if 'show_chat_box' in data:
                config['ui']['show_chat_box'] = data.get('show_chat_box', True)
            if 'show_model' in data:
                config['ui']['show_model'] = data.get('show_model', True)
            if 'voice_barge_in' in data:
                config['asr']['voice_barge_in'] = data.get('voice_barge_in', True)
            if 'ptt_enabled' in data:
                config['asr']['ptt_enabled'] = bool(data.get('ptt_enabled', False))
            if 'ptt_key' in data:
                config['asr']['ptt_key'] = normalize_ptt_key(
                    data.get('ptt_key', config['asr'].get('ptt_key', PTT_DEFAULT_KEY))
                )
            if 'tools_enabled' in data:
                config['tools']['enabled'] = data.get('tools_enabled', True)
            if 'mcp_enabled' in data:
                config['mcp']['enabled'] = data.get('mcp_enabled', True)

            # 旧字段：BERT 开关
            if 'bert_enabled' in data:
                config['bert']['enabled'] = data.get('bert_enabled', False)

            # 旧字段：视觉三格（旧前端写 vision.vision_model.{api_key,api_url,model}）
            providers = ensure_provider_store(config, persist=False)
            providers_changed = False
            if 'vision_model' in data and isinstance(data['vision_model'], dict):
                vm = data['vision_model']
                legacy_vm = config['vision'].setdefault('vision_model', {})
                if 'api_key' in vm:
                    legacy_vm['api_key'] = vm.get('api_key', '')
                if 'api_url' in vm:
                    legacy_vm['api_url'] = vm.get('api_url', '')
                if 'model' in vm:
                    legacy_vm['model'] = vm.get('model', '')
                providers_changed = apply_legacy_vision_model_to_providers(config, providers, vm)

            # 新字段：视觉模型引用（'provider_id|model_id' 复合值，空字符串表示不使用）
            if 'vision_model_ref' in data:
                provider_id, model_id = parse_model_ref(data.get('vision_model_ref'))
                config['vision']['provider_id'] = provider_id
                config['vision']['model_id'] = model_id

            if providers_changed:
                apply_selections_and_scrub(config, providers)
                if not save_provider_store(providers):
                    return jsonify({'error': '保存提供商数据失败'}), 500

            if save_config(config):
                return jsonify({
                    'success': True,
                    'ptt_key': get_configured_ptt_key(config['asr']),
                    'runtime_reloaded': notify_runtime_config_reload(),
                })
            return jsonify({'error': '保存失败'}), 500
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 对话配置 ============

@config_bp.route('/api/settings/dialog', methods=['GET', 'POST'])
def handle_dialog_settings():
    """处理对话配置"""
    config = load_config()
    if request.method == 'GET':
        providers = ensure_provider_store(config)
        ui_config = config.get('ui', {})
        context_config = config.get('context', {})
        tts_config = config.get('tts', {})
        asr_config = config.get('asr', {})
        llm_config = config.get('llm', {})

        dialog_provider_id = llm_config.get('provider_id', '')
        dialog_model_id = llm_config.get('model_id', '')
        dialog_model_ref = f'{dialog_provider_id}|{dialog_model_id}' if dialog_provider_id and dialog_model_id else ''

        return jsonify({
            'intro_text': ui_config.get('intro_text', '你好啊'),
            'max_messages': context_config.get('max_messages', 30),
            'enable_limit': context_config.get('enable_limit', True),
            'persistent_history': context_config.get('persistent_history', False),
            'dialog_model_ref': dialog_model_ref,
            'dialog_model_options': get_enabled_model_choices(providers),
            'tts_enabled': tts_config.get('enabled', True),
            'asr_enabled': asr_config.get('enabled', True),
            'voice_barge_in': asr_config.get('voice_barge_in', True),
            'ptt_enabled': asr_config.get('ptt_enabled', False),
            'ptt_key': get_configured_ptt_key(asr_config),
            'show_chat_box': ui_config.get('show_chat_box', True)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'ui' not in config:
                config['ui'] = {}
            if 'context' not in config:
                config['context'] = {}
            if 'tts' not in config:
                config['tts'] = {}
            if 'asr' not in config:
                config['asr'] = {}
            if 'llm' not in config:
                config['llm'] = {}

            config['ui']['intro_text'] = data.get('intro_text', '你好啊')
            config['context']['max_messages'] = data.get('max_messages', 30)
            config['context']['enable_limit'] = data.get('enable_limit', True)
            config['context']['persistent_history'] = data.get('persistent_history', False)
            config['tts']['enabled'] = data.get('tts_enabled', True)
            config['asr']['enabled'] = data.get('asr_enabled', True)
            config['asr']['voice_barge_in'] = data.get('voice_barge_in', True)
            if 'ptt_enabled' in data:
                config['asr']['ptt_enabled'] = bool(data.get('ptt_enabled', False))
            if 'ptt_key' in data:
                config['asr']['ptt_key'] = normalize_ptt_key(
                    data.get('ptt_key', config['asr'].get('ptt_key', PTT_DEFAULT_KEY))
                )
            config['ui']['show_chat_box'] = data.get('show_chat_box', True)

            # 对话模型引用（'provider_id|model_id' 复合值）
            if 'dialog_model_ref' in data:
                provider_id, model_id = parse_model_ref(data.get('dialog_model_ref'))
                if provider_id and model_id:
                    config['llm']['provider_id'] = provider_id
                    config['llm']['model_id'] = model_id

            if save_config(config):
                return jsonify({
                    'success': True,
                    'ptt_key': get_configured_ptt_key(config['asr']),
                    'runtime_reloaded': notify_runtime_config_reload(),
                })
            return jsonify({'error': '保存失败'}), 500
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 工具设置 ============

@config_bp.route('/api/settings/tools', methods=['GET', 'POST'])
def handle_tools_settings():
    """处理工具设置"""
    config = load_config()
    if request.method == 'GET':
        tools_config = config.get('tools', {})
        mcp_config = config.get('mcp', {})
        return jsonify({
            'enabled': tools_config.get('enabled', True),
            'mcp_enabled': mcp_config.get('enabled', True)
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'tools' not in config:
                config['tools'] = {}
            if 'mcp' not in config:
                config['mcp'] = {}
            config['tools']['enabled'] = data.get('enabled', True)
            config['mcp']['enabled'] = data.get('mcp_enabled', True)
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 心情聊天设置 ============

@config_bp.route('/api/settings/mood-chat', methods=['GET', 'POST'])
def handle_mood_chat_settings():
    """处理动态主动对话（心情聊天）设置"""
    config = load_config()
    if request.method == 'GET':
        mood_chat_config = config.get('mood_chat', {})
        return jsonify({
            'enabled': mood_chat_config.get('enabled', True),
            'prompt': mood_chat_config.get('prompt', '')
        })
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if 'mood_chat' not in config:
                config['mood_chat'] = {}
            config['mood_chat']['enabled'] = data.get('enabled', True)
            config['mood_chat']['prompt'] = data.get('prompt', '')
            if save_config(config):
                return jsonify({'success': True})
            return jsonify({'error': '保存失败'}), 500
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# ============ 当前模型切换 ============

@config_bp.route('/api/settings/current-model', methods=['GET', 'POST'])
def handle_current_model():
    """处理当前 Live2D 模型切换（v2：config.ui.live2d_model 驱动，不再改写 main.js）"""
    try:
        # GET 请求：读取当前模型
        if request.method == 'GET':
            config = load_config()
            name = (config.get('ui') or {}).get('live2d_model')
            if name:
                return jsonify({'success': True, 'model': name})
            return jsonify({'success': True, 'model': '肥牛'})

        # POST 请求：设置模型
        data = request.get_json()
        model_name = data.get('model', '')

        if not model_name:
            return jsonify({'success': False, 'error': '未提供模型名称'})

        # 优先通知运行中的桌宠热切换（会同时持久化到 config.ui.live2d_model）
        try:
            import urllib.request as _ur
            payload = json.dumps({'model_name': model_name, 'model_type': 'live2d'}).encode('utf-8')
            req = _ur.Request('http://localhost:3002/switch-model', data=payload, method='POST')
            req.add_header('Content-Type', 'application/json')
            with _ur.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode('utf-8'))
            if result.get('success'):
                logger.info(f'已热切换当前模型为：{model_name}')
                return jsonify({'success': True, 'model': model_name})
            logger.warning(f'桌宠热切换返回失败：{result}')
        except Exception as e:
            logger.info(f'桌宠未运行或热切换失败（{e}），直接写入 config')

        # 桌宠未运行：直接写 config，下次启动生效
        config = load_config()
        if 'ui' not in config:
            config['ui'] = {}
        config['ui']['live2d_model'] = model_name
        if save_config(config):
            logger.info(f'已保存模型选择：{model_name}')
            return jsonify({'success': True, 'model': model_name})
        return jsonify({'success': False, 'error': '保存配置失败'}), 500
    except Exception as e:
        logger.error(f'设置模型失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 工具设置 ============
