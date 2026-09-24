#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 广场与资源模块
负责提示词广场、插件广场、工具广场的下载功能
"""

import functools
import json
import os
import zipfile
import subprocess
import sys
import threading
import shutil
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, request, jsonify

from . import market_settings
from . import marketplace_stats
from .utils import PROJECT_ROOT, logger
from .marketplace_updater import (
    ArchiveTooLargeError,
    DependencyInstallError,
    DownloadError,
    MAX_PLUGIN_ARCHIVE_BYTES,
    PluginValidationError,
    apply_mirror,
    check_framework_compatibility,
    check_updates_for_plugins,
    download_archive,
    fetch_remote_metadata,
    fetch_remote_metadata_with_source,
    get_local_metadata,
    github_source_plan,
    inspect_plugin_archive_bytes,
    install_dependencies,
    install_plugin_from_archive,
    normalize_repo_url,
    npm_command_prefix,
    resolve_plugin_python,
    source_label,
    update_plugin_safe,
    validate_plugin_metadata,
)
from .plugin_manager import PLUGIN_FRAMEWORK_VERSION, enable_plugin_path
from .state_io import (
    delete_resource_state,
    read_resource_state,
    resource_lock,
    write_resource_state,
)

# 尝试导入 requests 库，如果不可用则使用 urllib
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning('requests 库未安装，将使用 urllib.request 进行下载（功能受限）')

# 创建广场模块蓝图
market_bp = Blueprint('market', __name__)

# 存储正在进行的安装任务
installing_tasks = {}
_installing_tasks_lock = threading.RLock()
INSTALL_TASK_RETENTION_SECONDS = 10 * 60
INSTALL_TASK_ACTIVE_STALE_SECONDS = 15 * 60
TERMINAL_INSTALL_STATUSES = {'completed', 'failed'}

PLUGIN_UPDATE_CONCURRENCY = 3

# 上游插件目录索引
PLUGIN_HUB_RAW_URL = (
    'https://raw.githubusercontent.com/morettt/my-neuro/main/'
    'live-2d/plugins/plugin-house/plugin_hub.json'
)
PLUGIN_HUB_TIMEOUT = 15
UPLOAD_DIR_NAME = '.uploads'
INSTALL_STAGE_PROGRESS = {
    'queued': 0,
    'downloading': 15,
    'validating': 40,
    'extracting': 50,
    'installing_deps': 70,
    'installing_node_deps': 80,
    'enabling': 95,
    'completed': 100,
}


def _community_root():
    return PROJECT_ROOT / 'plugins' / 'community'


def _builtin_root():
    return PROJECT_ROOT / 'plugins' / 'built-in'


def _live2d_running():
    """桌宠是否正在由 WebUI 托管运行；无法判断时返回 None。"""
    try:
        from .service_controller import _get_service_state
        return bool(_get_service_state('live2d').get('started'))
    except Exception:
        return None


def _task_is_active(task):
    return bool(task) and task.get('status') not in TERMINAL_INSTALL_STATUSES


def _install_task_resource(plugin_name):
    return f'plugin-task:{PROJECT_ROOT.resolve()}:{plugin_name}'


def _task_is_expired(task, now):
    if not task:
        return False
    if task.get('status') in TERMINAL_INSTALL_STATUSES:
        return (
            now - task.get('finished_at', now)
            >= INSTALL_TASK_RETENTION_SECONDS
        )
    return (
        now - task.get('updated_at', task.get('created_at', now))
        >= INSTALL_TASK_ACTIVE_STALE_SECONDS
    )


def _get_install_task(plugin_name):
    now = time.time()
    resource = _install_task_resource(plugin_name)
    with resource_lock(resource):
        shared_task = read_resource_state(resource)
        with _installing_tasks_lock:
            local_task = installing_tasks.get(plugin_name)
            task = shared_task or local_task
            if _task_is_expired(task, now):
                installing_tasks.pop(plugin_name, None)
                delete_resource_state(resource)
                return None
            if shared_task:
                installing_tasks[plugin_name] = dict(shared_task)
            return dict(task) if task else None


def _reserve_install_task(plugin_name, status, progress, operation):
    now = time.time()
    resource = _install_task_resource(plugin_name)
    with resource_lock(resource):
        shared_task = read_resource_state(resource)
        with _installing_tasks_lock:
            existing = shared_task or installing_tasks.get(plugin_name)
        if _task_is_active(existing) and not _task_is_expired(existing, now):
            return False

        task = {
            'status': status,
            'progress': progress,
            'operation': operation,
            'created_at': now,
            'updated_at': now,
            'error': '',
            'warnings': [],
            'enabled': False,
            'source_used': '',
            'webui_pid': os.getpid(),
        }
        write_resource_state(resource, task)
        with _installing_tasks_lock:
            installing_tasks[plugin_name] = dict(task)
        return True


def _update_install_task(plugin_name, **changes):
    now = time.time()
    resource = _install_task_resource(plugin_name)
    with resource_lock(resource):
        shared_task = read_resource_state(resource)
        with _installing_tasks_lock:
            local_task = installing_tasks.get(plugin_name)
        task = dict(
            shared_task
            or local_task
            or {
                'status': 'queued',
                'progress': 0,
                'operation': 'install',
                'created_at': now,
                'error': '',
                'warnings': [],
                'enabled': False,
                'source_used': '',
                'webui_pid': os.getpid(),
            }
        )
        task.update(changes)
        task['updated_at'] = now
        if task.get('status') in TERMINAL_INSTALL_STATUSES:
            task['finished_at'] = now
        write_resource_state(resource, task)
        with _installing_tasks_lock:
            installing_tasks[plugin_name] = dict(task)
        return dict(task)


def _append_task_warnings(plugin_name, warnings):
    warnings = [str(item) for item in (warnings or []) if item]
    if not warnings:
        return
    task = _get_install_task(plugin_name) or {}
    merged = list(task.get('warnings') or [])
    for item in warnings:
        if item not in merged:
            merged.append(item)
    _update_install_task(plugin_name, warnings=merged)


def _set_task_stage(plugin_name, stage):
    progress = INSTALL_STAGE_PROGRESS.get(stage)
    if progress is None:
        _update_install_task(plugin_name, status=stage)
    else:
        _update_install_task(plugin_name, status=stage, progress=progress)


def _validate_hub_catalog(data, source_desc):
    """plugin_hub.json 的格式：{ key: {display_name, desc, author, repo} }。"""
    if not isinstance(data, dict) or not data:
        raise ValueError(f'{source_desc} 不是插件索引对象')
    for key, value in data.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            raise ValueError(f'{source_desc} 中条目 {key!r} 格式不正确')
        if not isinstance(value.get('repo', ''), str):
            raise ValueError(f'{source_desc} 中条目 {key!r} 的 repo 不是字符串')
    return data


def _fetch_hub_catalog(hub_url, settings):
    """按来源计划抓取索引 JSON，非 GitHub 域名的地址只会直连一次。"""
    last_error = None
    for mirror in github_source_plan(settings):
        url = apply_mirror(hub_url, mirror)
        if mirror and url == hub_url:
            continue
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'my-neuro-plugin-market/2.0'})
            with urllib.request.urlopen(req, timeout=PLUGIN_HUB_TIMEOUT) as response:
                data = json.loads(response.read().decode('utf-8-sig'))
            return _validate_hub_catalog(data, hub_url), source_label(mirror)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f'索引 {hub_url} 不可用：{last_error}')


def load_plugin_hub_catalog(settings=None):
    """优先拉取远程 plugin_hub.json（自定义源 → 默认源，均可走镜像），失败则读取本地副本。"""
    settings = settings or market_settings.load_settings()
    plugin_hub_path = PROJECT_ROOT / 'plugins' / 'plugin-house' / 'plugin_hub.json'
    errors = []

    hub_urls = []
    custom_url = settings.get('hub_url', '')
    if custom_url:
        hub_urls.append(custom_url)
    hub_urls.append(PLUGIN_HUB_RAW_URL)

    for hub_url in hub_urls:
        try:
            catalog, _source = _fetch_hub_catalog(hub_url, settings)
            return catalog
        except ValueError as exc:
            errors.append(f'自定义源格式不正确：{exc}' if hub_url == custom_url else str(exc))
            logger.warning('插件索引格式不正确，将尝试下一来源：%s', exc)
        except Exception as exc:
            errors.append(str(exc))
            logger.warning('远程插件索引拉取失败，将尝试下一来源：%s', exc)

    if plugin_hub_path.exists():
        with open(plugin_hub_path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)

    raise FileNotFoundError(
        f'无法加载插件商店：远程不可用 ({"; ".join(errors)})，且本地不存在 {plugin_hub_path}'
    )


def _get_market_plugin_dir(plugin_name):
    """插件广场只安装到 community 目录。"""
    return _community_root() / plugin_name


def _build_market_plugin_items(check_updates=True, settings=None):
    """读取插件广场列表，并补充本地安装状态与版本更新信息。"""
    settings = settings or market_settings.load_settings()
    plugins_data = load_plugin_hub_catalog(settings)
    plugins = []

    for key, value in plugins_data.items():
        plugin_dir = _get_market_plugin_dir(key)
        is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
        task = _get_install_task(key)
        local_metadata = get_local_metadata(plugin_dir) if is_installed else {}
        repo_url = value.get('repo', '') or local_metadata.get('repo', '')
        local_version = local_metadata.get('version', '')
        catalog_version = value.get('version', '')

        plugins.append({
            'name': key,
            'display_name': value.get('display_name', value.get('displayName', key)),
            'description': value.get('desc', value.get('description', '无描述')),
            'author': value.get('author', '未知'),
            'repo': repo_url,
            # 兼容旧前端字段；这里传 repo，真正 archive URL 由后端动态解析。
            'download_url': repo_url,
            'version': local_version or catalog_version,
            'local_version': local_version,
            'latest_version': catalog_version,
            'has_update': False,
            'update_error': '',
            'installed': is_installed,
            'installing': _task_is_active(task),
            'status': task.get('status', '') if task else '',
            'progress': task.get('progress', 0) if task else 0,
            'install_error': task.get('error', '') if task else '',
        })

    if check_updates and plugins:
        update_info = check_updates_for_plugins(
            plugins,
            fetch_metadata=functools.partial(fetch_remote_metadata, settings=settings),
        )
        for plugin in plugins:
            info = update_info.get(plugin['name'])
            if not info:
                continue
            plugin['latest_version'] = info.get('latest_version') or plugin.get('latest_version', '')
            plugin['has_update'] = bool(plugin.get('installed') and info.get('has_update'))
            plugin['update_error'] = info.get('update_error', '')
            plugin['remote_metadata'] = info.get('remote_metadata')

    try:
        stats_map = marketplace_stats.fetch_stats_map()
        for plugin in plugins:
            stats = stats_map.get(plugin['name'], {})
            plugin['downloads'] = stats.get('downloads', 0)
            plugin['stars'] = stats.get('stars', 0)
            plugin['starred'] = stats.get('starred', False)
    except Exception as e:
        logger.warning('Plugin marketplace stats merge failed: %s', e)
        for plugin in plugins:
            plugin['downloads'] = 0
            plugin['stars'] = 0
            plugin['starred'] = False

    return plugins


def _find_market_plugin(plugin_name):
    for plugin in _build_market_plugin_items(check_updates=False):
        if plugin.get('name') == plugin_name:
            return plugin
    return None


def _dependency_installer_for_task(plugin_name, settings):
    """把 pip/npm 安装进度写进任务状态；返回的警告由调用方收集。"""
    def _report(stage, detail=None):
        if stage in INSTALL_STAGE_PROGRESS:
            _set_task_stage(plugin_name, stage)

    def _installer(plugin_dir):
        return install_dependencies(plugin_dir, settings=settings, report=_report)
    return _installer


def _archive_downloader_for_task(plugin_name, settings):
    """按设置下载 zip，并把实际使用的来源（直连/镜像）记进任务。"""
    def _downloader(repo_url):
        data, source_used = download_archive(repo_url, settings=settings)
        _update_install_task(plugin_name, source_used=source_used)
        return data, source_used
    return _downloader


def _stage_reporter(plugin_name):
    def _on_stage(stage):
        _set_task_stage(plugin_name, stage)
    return _on_stage


def _plugin_dir_conflict(dir_name):
    """URL/zip 安装的目录名不能撞上已有的 community 或 built-in 目录。"""
    community_dir = _community_root() / dir_name
    if community_dir.exists() and any(community_dir.iterdir()):
        return f'插件 {dir_name} 已安装，请使用更新'
    if (_builtin_root() / dir_name).exists():
        return f'目录名 {dir_name} 与内置插件冲突，无法安装'
    return ''


def _compatibility_of(metadata):
    framework_version = metadata.get('framework_version', '') if isinstance(metadata, dict) else ''
    compatible, message = check_framework_compatibility(framework_version, PLUGIN_FRAMEWORK_VERSION)
    return framework_version, compatible, message


def _describe_remote_plugin(repo_url, settings):
    """预览远程插件：拉 metadata.json、校验、给出目录名与兼容性。"""
    normalized_url = normalize_repo_url(repo_url)
    metadata, source_used = fetch_remote_metadata_with_source(normalized_url, settings=settings)
    info = validate_plugin_metadata(metadata)
    framework_version, compatible, compatibility_message = _compatibility_of(metadata)
    dir_name = info['name']
    return {
        'repo': normalized_url,
        'metadata': {
            'name': info['name'],
            'displayName': metadata.get('displayName') or metadata.get('display_name') or info['name'],
            'version': info['version'],
            'author': metadata.get('author', ''),
            'description': metadata.get('description') or metadata.get('desc') or '',
            'lang': info['lang'],
            'framework_version': framework_version,
            'repo': metadata.get('repo') or normalized_url,
        },
        'dir_name': dir_name,
        'already_installed': (_community_root() / dir_name).exists()
        and any((_community_root() / dir_name).iterdir()),
        'conflict': _plugin_dir_conflict(dir_name),
        'compatible': compatible,
        'compatibility_message': compatibility_message,
        'source_used': source_used,
    }


def _start_install_task(plugin_name, plugin_url, plugin_dir, settings, archive_downloader=None,
                        expected_name=None, cleanup_path=None):
    """占位 + 启动后台安装线程。返回 (ok, error_message, http_status)。"""
    _community_root().mkdir(parents=True, exist_ok=True)
    if not _reserve_install_task(plugin_name, status='queued', progress=0, operation='install'):
        return False, '该插件正在安装中', 409

    thread = threading.Thread(
        target=_install_plugin_worker,
        args=(plugin_name, plugin_url, plugin_dir),
        kwargs={
            'settings': settings,
            'archive_downloader': archive_downloader,
            'expected_name': expected_name,
            'cleanup_path': cleanup_path,
        },
        daemon=True,
    )
    try:
        thread.start()
    except Exception as exc:
        _update_install_task(plugin_name, status='failed', progress=0, error=str(exc))
        return False, str(exc), 500
    return True, '', 200


# ============ 提示词广场 ============

@market_bp.route('/api/market/prompts', methods=['GET'])
def get_prompt_market():
    """获取提示词广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-prompts')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('success'):
            return jsonify({
                'success': True,
                'prompts': data.get('prompts', [])
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取提示词列表失败'
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/prompts/apply', methods=['POST'])
def apply_prompt():
    """应用提示词到 AI 人设（仅返回内容，由前端设置到输入框）"""
    try:
        data = request.get_json()
        prompt_content = data.get('content', '')

        # 返回提示词内容，由前端设置到输入框
        # 不再直接修改 config.json，让用户在 LLM 配置中手动保存
        return jsonify({'success': True, 'content': prompt_content})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 插件广场 ============

@market_bp.route('/api/market/plugins', methods=['GET'])
def get_plugin_market():
    """获取插件广场列表（优先远程 Raw，与桌面版一致；失败则用本地 plugin_hub.json）"""
    try:
        check_updates = request.args.get('check_updates', 'true').lower() != 'false'
        plugins = _build_market_plugin_items(check_updates=check_updates)

        return jsonify({
            'success': True,
            'plugins': plugins
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'加载插件商店数据失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/plugins/download', methods=['POST'])
def download_plugin():
    """从插件广场安装插件（异步：下载、校验、解压、装依赖、自动启用）"""
    try:
        data = request.get_json() or {}
        plugin_name = data.get('plugin_name', '')
        plugin_url = data.get('repo') or data.get('download_url', '')

        if not plugin_url and plugin_name:
            plugin_info = _find_market_plugin(plugin_name)
            plugin_url = plugin_info.get('repo', '') if plugin_info else ''

        if not plugin_name or not plugin_url:
            return jsonify({'success': False, 'error': '缺少参数'}), 400
        if '/' in plugin_name or '\\' in plugin_name or '..' in plugin_name:
            return jsonify({'success': False, 'error': '无效的插件名称'}), 400

        plugin_dir = _get_market_plugin_dir(plugin_name)
        if plugin_dir.exists() and any(plugin_dir.iterdir()):
            return jsonify({'success': False, 'error': '插件已安装'}), 400

        settings = market_settings.load_settings()
        ok, error, status = _start_install_task(
            plugin_name, plugin_url, plugin_dir, settings, expected_name=plugin_name
        )
        if not ok:
            return jsonify({'success': False, 'error': error}), status

        return jsonify({
            'success': True,
            'plugin_name': plugin_name,
            'message': f'插件 {plugin_name} 开始安装，请稍候...'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _install_plugin_worker(plugin_name, plugin_url, plugin_dir, settings=None,
                           archive_downloader=None, expected_name=None, cleanup_path=None):
    """后台安装插件的工作线程（市场 / 仓库地址 / 上传 zip 三条路径共用）"""
    settings = settings or market_settings.load_settings()
    plugin_dir = Path(plugin_dir)
    try:
        _update_install_task(plugin_name, status='downloading', progress=0, operation='install', error='')
        logger.info(f'开始安装插件：{plugin_name}')

        result = install_plugin_from_archive(
            plugin_dir,
            plugin_url,
            archive_downloader=archive_downloader or _archive_downloader_for_task(plugin_name, settings),
            dependency_installer=_dependency_installer_for_task(plugin_name, settings),
            expected_name=expected_name,
            on_stage=_stage_reporter(plugin_name),
        )
        _append_task_warnings(plugin_name, result.get('warnings'))
        if result.get('source_used'):
            _update_install_task(plugin_name, source_used=result['source_used'])

        # 安装即启用：写入 enabled_plugins.json，Electron 侧 fs.watch 会随即热加载。
        _set_task_stage(plugin_name, 'enabling')
        enabled = False
        try:
            enable_plugin_path(f'community/{plugin_dir.name}')
            enabled = True
        except Exception as exc:
            logger.warning('插件 %s 已安装但自动启用失败：%s', plugin_name, exc)
            _append_task_warnings(
                plugin_name,
                [f'插件已安装但自动启用失败：{exc}，请到「插件管理」手动开启'],
            )

        _update_install_task(plugin_name, status='completed', progress=100, error='', enabled=enabled)
        marketplace_stats.increment_download(plugin_name)
        logger.info(f'插件安装完成：{plugin_name}（自动启用：{enabled}）')

    except (DownloadError, PluginValidationError, DependencyInstallError) as e:
        logger.error(f'插件安装失败：{plugin_name}, {str(e)}')
        _update_install_task(plugin_name, status='failed', error=str(e))
    except Exception as e:
        logger.error(f'插件安装失败：{plugin_name}, {str(e)}', exc_info=True)
        _update_install_task(plugin_name, status='failed', error=str(e))
    finally:
        if cleanup_path:
            try:
                Path(cleanup_path).unlink(missing_ok=True)
            except OSError:
                pass


# ============ 下载设置 / 仓库地址安装 / 上传安装 ============

@market_bp.route('/api/market/settings', methods=['GET'])
def get_market_settings():
    """读取插件广场的下载与依赖设置，并附带本机工具探测结果。"""
    try:
        npm_prefix = npm_command_prefix()
        return jsonify({
            'success': True,
            'settings': market_settings.load_settings(),
            'builtin_mirrors': list(market_settings.BUILTIN_GITHUB_MIRRORS),
            'mirror_modes': list(market_settings.MIRROR_MODES),
            'tools': {
                'npm': bool(npm_prefix),
                'npm_path': npm_prefix[0] if npm_prefix else '',
                'python_path': resolve_plugin_python(),
            },
            'max_archive_bytes': MAX_PLUGIN_ARCHIVE_BYTES,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/api/market/settings', methods=['POST'])
def save_market_settings():
    """保存设置；校验失败返回 400 并说明字段。"""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': '无效的请求数据'}), 400
    try:
        saved = market_settings.save_settings(data)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': f'保存失败：{exc}'}), 500
    return jsonify({'success': True, 'settings': saved})


@market_bp.route('/api/market/plugins/inspect', methods=['POST'])
def inspect_plugin_repository():
    """安装前预览仓库里的 metadata.json。"""
    data = request.get_json(silent=True) or {}
    repo_url = (data.get('repo') or '').strip()
    if not repo_url:
        return jsonify({'success': False, 'error': '请填写 GitHub 仓库地址'}), 400
    try:
        settings = market_settings.load_settings()
        described = _describe_remote_plugin(repo_url, settings)
        return jsonify({'success': True, **described})
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': f'读取仓库信息失败：{exc}'}), 502


@market_bp.route('/api/market/plugins/install-from-url', methods=['POST'])
def install_plugin_from_url():
    """从任意公开 GitHub 仓库安装插件（目录名取 metadata.name）。"""
    data = request.get_json(silent=True) or {}
    repo_url = (data.get('repo') or '').strip()
    ignore_compat = bool(data.get('ignore_compat'))
    if not repo_url:
        return jsonify({'success': False, 'error': '请填写 GitHub 仓库地址'}), 400
    try:
        settings = market_settings.load_settings()
        described = _describe_remote_plugin(repo_url, settings)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': f'读取仓库信息失败：{exc}'}), 502

    if described['conflict']:
        return jsonify({'success': False, 'error': described['conflict']}), 409
    if not described['compatible'] and not ignore_compat:
        return jsonify({
            'success': False,
            'error': described['compatibility_message'] or '插件与当前框架版本不兼容',
            'compatibility_error': True,
        }), 409

    dir_name = described['dir_name']
    ok, error, status = _start_install_task(
        dir_name,
        described['repo'],
        _community_root() / dir_name,
        settings,
        expected_name=dir_name,
    )
    if not ok:
        return jsonify({'success': False, 'error': error}), status
    return jsonify({
        'success': True,
        'plugin_name': dir_name,
        'display_name': described['metadata']['displayName'],
        'message': f'插件 {dir_name} 开始安装，请稍候...',
    })


@market_bp.route('/api/market/plugins/install-upload', methods=['POST'])
def install_plugin_upload():
    """上传本地 zip 安装插件：同步校验 zip，通过后转后台任务。"""
    uploaded = request.files.get('file')
    if uploaded is None or not uploaded.filename:
        return jsonify({'success': False, 'error': '请选择要上传的 zip 文件'}), 400
    ignore_compat = str(request.form.get('ignore_compat', '')).lower() in ('1', 'true', 'yes', 'on')

    upload_dir = _community_root() / UPLOAD_DIR_NAME
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / f'{uuid.uuid4().hex}.zip'
    try:
        uploaded.save(str(upload_path))
        archive_bytes = upload_path.read_bytes()
        inspection = inspect_plugin_archive_bytes(archive_bytes)
    except ArchiveTooLargeError as exc:
        upload_path.unlink(missing_ok=True)
        return jsonify({'success': False, 'error': str(exc)}), 413
    except PluginValidationError as exc:
        upload_path.unlink(missing_ok=True)
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        upload_path.unlink(missing_ok=True)
        return jsonify({'success': False, 'error': f'读取上传文件失败：{exc}'}), 500

    metadata = inspection['metadata']
    dir_name = inspection['info']['name']
    conflict = _plugin_dir_conflict(dir_name)
    if conflict:
        upload_path.unlink(missing_ok=True)
        return jsonify({'success': False, 'error': conflict}), 409
    _framework_version, compatible, compatibility_message = _compatibility_of(metadata)
    if not compatible and not ignore_compat:
        upload_path.unlink(missing_ok=True)
        return jsonify({
            'success': False,
            'error': compatibility_message or '插件与当前框架版本不兼容',
            'compatibility_error': True,
        }), 409

    settings = market_settings.load_settings()
    ok, error, status = _start_install_task(
        dir_name,
        f'upload:{uploaded.filename}',
        _community_root() / dir_name,
        settings,
        archive_downloader=lambda *_args, _data=archive_bytes: (_data, 'upload'),
        expected_name=dir_name,
        cleanup_path=upload_path,
    )
    if not ok:
        upload_path.unlink(missing_ok=True)
        return jsonify({'success': False, 'error': error}), status
    return jsonify({
        'success': True,
        'plugin_name': dir_name,
        'display_name': metadata.get('displayName') or dir_name,
        'version': inspection['info']['version'],
        'message': f'插件 {dir_name} 开始安装，请稍候...',
    })


@market_bp.route('/api/market/plugins/update', methods=['POST'])
def update_market_plugin():
    """更新单个已安装插件。"""
    try:
        data = request.get_json() or {}
        plugin_name = data.get('plugin_name') or data.get('name') or ''
        repo_url = data.get('repo') or ''

        if not plugin_name:
            return jsonify({'success': False, 'error': '缺少 plugin_name 参数'}), 400
        if _task_is_active(_get_install_task(plugin_name)):
            return jsonify({'success': False, 'error': '该插件正在安装或更新中'}), 400

        plugin_info = _find_market_plugin(plugin_name)
        repo_url = repo_url or (plugin_info.get('repo', '') if plugin_info else '')
        if not repo_url:
            return jsonify({'success': False, 'error': '插件未配置 repo，无法更新'}), 400

        plugin_dir = _get_market_plugin_dir(plugin_name)
        if not plugin_dir.exists() or not any(plugin_dir.iterdir()):
            return jsonify({'success': False, 'error': '插件尚未安装'}), 404

        if not _reserve_install_task(
            plugin_name,
            status='updating',
            progress=10,
            operation='update',
        ):
            return jsonify({'success': False, 'error': '该插件正在安装或更新中'}), 409
        settings = market_settings.load_settings()
        result = update_plugin_safe(
            plugin_dir,
            plugin_name,
            repo_url,
            archive_downloader=_archive_downloader_for_task(plugin_name, settings),
            dependency_installer=_dependency_installer_for_task(plugin_name, settings),
        )
        _append_task_warnings(plugin_name, result.get('warnings'))
        _update_install_task(
            plugin_name,
            status='completed',
            progress=100,
            error='',
        )
        return jsonify({
            'success': True,
            'message': '插件更新完成',
            'result': result,
            'warnings': result.get('warnings', []),
        })
    except Exception as e:
        logger.error(f'插件更新失败：{str(e)}', exc_info=True)
        if (
            'plugin_name' in locals()
            and plugin_name
            and _get_install_task(plugin_name)
        ):
            _update_install_task(
                plugin_name,
                status='failed',
                error=str(e),
            )
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/api/market/plugins/update-all', methods=['POST'])
def update_all_market_plugins():
    """批量更新已安装插件，最多 3 个并发。"""
    try:
        data = request.get_json() or {}
        plugin_names = data.get('plugin_names') or data.get('names') or []
        if not isinstance(plugin_names, list) or not plugin_names:
            return jsonify({'success': False, 'error': '插件列表不能为空'}), 400

        settings = market_settings.load_settings()
        market_plugins = {
            plugin['name']: plugin
            for plugin in _build_market_plugin_items(check_updates=False, settings=settings)
        }

        def _update_one(name):
            plugin = market_plugins.get(name)
            if not plugin:
                return {'name': name, 'success': False, 'error': '插件不在插件广场中'}
            if not plugin.get('installed'):
                return {'name': name, 'success': False, 'error': '插件尚未安装'}
            repo_url = plugin.get('repo', '')
            if not repo_url:
                return {'name': name, 'success': False, 'error': '插件未配置 repo'}
            if not _reserve_install_task(
                name,
                status='updating',
                progress=10,
                operation='update',
            ):
                return {'name': name, 'success': False, 'error': '插件正在安装或更新中'}
            try:
                result = update_plugin_safe(
                    _get_market_plugin_dir(name),
                    name,
                    repo_url,
                    archive_downloader=_archive_downloader_for_task(name, settings),
                    dependency_installer=_dependency_installer_for_task(name, settings),
                )
                _append_task_warnings(name, result.get('warnings'))
                _update_install_task(
                    name,
                    status='completed',
                    progress=100,
                    error='',
                )
                return {'name': name, 'success': True, 'result': result, 'warnings': result.get('warnings', [])}
            except Exception as exc:
                logger.error(f'批量更新插件失败 {name}: {exc}', exc_info=True)
                _update_install_task(name, status='failed', error=str(exc))
                return {'name': name, 'success': False, 'error': str(exc)}

        results = []
        workers = min(PLUGIN_UPDATE_CONCURRENCY, len(plugin_names))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_map = {executor.submit(_update_one, name): name for name in plugin_names}
            for future in as_completed(future_map):
                results.append(future.result())

        failed = [item for item in results if not item.get('success')]
        return jsonify({
            'success': len(failed) == 0,
            'message': (
                '全部插件更新完成'
                if not failed
                else f'批量更新完成，其中 {len(failed)}/{len(results)} 个失败'
            ),
            'results': results,
        })
    except Exception as e:
        logger.error(f'批量更新插件失败：{str(e)}', exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/api/market/plugins/check-updates', methods=['GET'])
def check_market_plugin_updates():
    """检查插件广场中已安装插件的更新状态。"""
    try:
        plugins = _build_market_plugin_items(check_updates=True)
        installed_plugins = [plugin for plugin in plugins if plugin.get('installed')]
        return jsonify({
            'success': True,
            'plugins': installed_plugins,
            'updates': {
                plugin['name']: {
                    'has_update': plugin.get('has_update', False),
                    'version': plugin.get('version', ''),
                    'latest_version': plugin.get('latest_version', ''),
                    'update_error': plugin.get('update_error', ''),
                }
                for plugin in installed_plugins
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@market_bp.route('/api/market/plugins/install-status/<plugin_name>', methods=['GET'])
def get_install_status(plugin_name):
    """获取插件安装状态"""
    if '/' in plugin_name or '\\' in plugin_name or '..' in plugin_name:
        return jsonify({'success': False, 'error': '无效的插件名称'}), 400

    plugin_dir = _get_market_plugin_dir(plugin_name)
    is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
    task = _get_install_task(plugin_name)
    if task:
        status = task.get('status', 'unknown')
        terminal = status in TERMINAL_INSTALL_STATUSES
        return jsonify({
            'success': True,
            'installing': not terminal,
            'terminal': terminal,
            'installed': is_installed,
            'status': status,
            'operation': task.get('operation', 'install'),
            'progress': task.get('progress', 0),
            'error': task.get('error', ''),
            'warnings': list(task.get('warnings') or []),
            'enabled': bool(task.get('enabled')),
            'source_used': task.get('source_used', ''),
            'live2d_running': _live2d_running() if terminal else None,
        })

    return jsonify({
        'success': True,
        'installing': False,
        'installed': is_installed,
        'warnings': [],
        'enabled': False,
        'live2d_running': None,
    })


@market_bp.route('/api/market/plugins/check-installed/<plugin_name>', methods=['GET'])
def check_plugin_installed(plugin_name):
    """检查插件是否已安装（直接检测目录）"""
    community_path = PROJECT_ROOT / 'plugins' / 'community'
    plugin_dir = community_path / plugin_name
    
    is_installed = plugin_dir.exists() and any(plugin_dir.iterdir())
    
    return jsonify({
        'success': True,
        'installed': is_installed
    })


@market_bp.route('/api/market/plugins/star', methods=['POST'])
def toggle_plugin_star():
    """Toggle an anonymous per-device star for a marketplace plugin."""
    try:
        data = request.get_json() or {}
        plugin_name = data.get('plugin_name') or data.get('name') or ''
        result = marketplace_stats.toggle_star(plugin_name)
        status = 200 if result.get('success') else 400
        return jsonify(result), status
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'starred': False, 'stars': 0}), 500


# ============ 工具广场 ============

@market_bp.route('/api/market/tools', methods=['GET'])
def get_tool_market():
    """获取工具广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('success'):
            # 处理工具数据，确保每个工具都有download_url
            tools = data.get('tools', [])
            processed_tools = []
            for tool in tools:
                # 如果没有download_url或为空，尝试使用数字ID构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    # 服务器API期望 tool_id 是整数，只能使用数字ID构建URL
                    tool_id = tool.get('id')
                    
                    # 允许 id = 0，只要是整数类型就有效
                    if tool_id is not None and isinstance(tool_id, int):
                        tool['download_url'] = f"http://mynewbot.com/api/download-tool/{tool_id}"
                        logger.info(f'使用 id 构建下载URL: {tool["download_url"]}')
                    else:
                        logger.warning(f'工具缺少有效的数字 id，无法构建下载URL: {tool.get("tool_name", "未知")}')
                
                processed_tools.append(tool)
            
            return jsonify({
                'success': True,
                'tools': processed_tools
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取工具列表失败'
            }), 500
    except Exception as e:
        logger.error(f'获取工具列表失败: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/tools/download', methods=['POST'])
def download_tool():
    """下载工具到 mcp/tools 目录。"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '') or data.get('tool_url', '')
        file_name = data.get('file_name', '')  # 保存的文件名

        logger.info(f'收到工具下载请求: tool_name={tool_name}, tool_url={tool_url}, file_name={file_name}')

        if not tool_url:
            logger.error(f'下载工具失败：缺少 download_url')
            return jsonify({'success': False, 'error': '缺少下载URL'}), 400

        # 使用 file_name 作为保存文件名，如果没有则使用 tool_name
        save_filename = file_name if file_name else f'{tool_name}.js'
        
        # 下载工具文件到 mcp/tools 目录
        mcp_tools_path = PROJECT_ROOT / 'mcp' / 'tools'
        mcp_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = mcp_tools_path / save_filename
        logger.info(f'准备下载到: {file_path}')

        # 使用 requests 或 urllib 下载
        if HAS_REQUESTS:
            response = requests.get(tool_url, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '')
            content = response.content
        else:
            # 回退到 urllib
            req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = resp.headers.get('Content-Type', '')
                content = resp.read()

        logger.info(f'远程服务器响应 Content-Type: {content_type}')

        # 检查是否为 HTML 内容
        if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
            logger.error(f'下载内容为 HTML 格式，URL: {tool_url}')
            return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f'工具 {save_filename} 已成功保存到 {file_path}')
        return jsonify({'success': True, 'message': f'工具 {save_filename} 已下载到 mcp/tools 目录'})

    except urllib.error.HTTPError as e:
        logger.error(f'HTTP 错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code}'}), 500
    except urllib.error.URLError as e:
        logger.error(f'网络错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500
    except Exception as e:
        logger.error(f'下载工具时发生未捕获异常: {str(e)}', exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ FC 工具广场 ============

@market_bp.route('/api/market/fc-tools', methods=['GET'])
def get_fc_market():
    """获取 FC 广场列表（从远程服务器）"""
    try:
        req = urllib.request.Request('http://mynewbot.com/api/get-fc-tools')
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if data.get('success'):
            # 处理FC工具数据，确保每个工具都有download_url
            fc_tools = data.get('fc_tools', [])
            processed_tools = []
            for tool in fc_tools:
                # 如果没有download_url或为空，尝试使用数字ID构建
                download_url = tool.get('download_url')
                if not download_url:  # 处理 None、空字符串、undefined
                    # 服务器API期望 tool_id 是整数，只能使用数字ID构建URL
                    tool_id = tool.get('id')
                    
                    # 允许 id = 0，只要是整数类型就有效
                    if tool_id is not None and isinstance(tool_id, int):
                        tool['download_url'] = f"http://mynewbot.com/api/download-fc-tool/{tool_id}"
                        logger.info(f'FC工具使用 id 构建下载URL: {tool["download_url"]}')
                    else:
                        logger.warning(f'FC工具缺少有效的数字 id，无法构建下载URL: {tool.get("tool_name", "未知")}')
                
                processed_tools.append(tool)
            
            return jsonify({
                'success': True,
                'fc_tools': processed_tools
            })
        else:
            return jsonify({
                'success': False,
                'error': '获取 FC 工具列表失败'
            }), 500
    except Exception as e:
        logger.error(f'获取 FC 工具列表失败: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'网络请求失败：{str(e)}'
        }), 500


@market_bp.route('/api/market/fc-tools/download', methods=['POST'])
def download_fc_tool():
    """下载 FC 工具。"""
    try:
        data = request.get_json()
        tool_name = data.get('tool_name', '')
        tool_url = data.get('download_url', '')
        file_name = data.get('file_name', '')  # 保存的文件名

        logger.info(f'收到FC工具下载请求: tool_name={tool_name}, tool_url={tool_url}, file_name={file_name}')

        if not tool_url:
            logger.error(f'FC工具下载失败：缺少 download_url')
            return jsonify({'success': False, 'error': '缺少下载URL'}), 400

        # 使用 file_name 作为保存文件名，如果没有则使用 tool_name
        save_filename = file_name if file_name else f'{tool_name}.js'
        
        # 下载工具文件到 server-tools 目录
        server_tools_path = PROJECT_ROOT / 'server-tools'
        server_tools_path.mkdir(parents=True, exist_ok=True)

        file_path = server_tools_path / save_filename
        logger.info(f'准备下载FC工具到: {file_path}')

        # 使用 requests 或 urllib 下载
        if HAS_REQUESTS:
            response = requests.get(tool_url, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '')
            content = response.content
        else:
            # 回退到 urllib
            req = urllib.request.Request(tool_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = resp.headers.get('Content-Type', '')
                content = resp.read()

        logger.info(f'FC工具远程服务器响应 Content-Type: {content_type}')

        # 检查是否为 HTML 内容
        if content.startswith(b'<!DOCTYPE') or content.startswith(b'<!doctype') or content.startswith(b'<html'):
            logger.error(f'FC工具下载内容为 HTML 格式，URL: {tool_url}')
            return jsonify({'success': False, 'error': '下载内容为 HTML 格式，请检查 URL 是否正确'}), 500

        with open(file_path, 'wb') as f:
            f.write(content)
        
        logger.info(f'FC工具 {save_filename} 已成功保存到 {file_path}')
        return jsonify({'success': True, 'message': f'FC 工具 {save_filename} 已下载到 server-tools 目录'})

    except urllib.error.HTTPError as e:
        logger.error(f'FC工具HTTP错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：HTTP {e.code}'}), 500
    except urllib.error.URLError as e:
        logger.error(f'FC工具网络错误: {e}, URL: {tool_url}')
        return jsonify({'success': False, 'error': f'下载失败：网络错误 - {e.reason}'}), 500
    except Exception as e:
        logger.error(f'下载FC工具时发生未捕获异常: {str(e)}', exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
