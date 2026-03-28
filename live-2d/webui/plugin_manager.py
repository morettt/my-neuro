#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 插件管理模块
负责插件的扫描、启用/禁用和配置管理
"""

import os
import json
from collections import OrderedDict
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建插件管理蓝图
plugin_bp = Blueprint('plugin', __name__)


def apply_config_values_to_schema(schema_node, value):
    """Recursively write submitted values into schema config while preserving metadata."""
    if not isinstance(schema_node, dict) or 'type' not in schema_node:
        return value

    updated = OrderedDict(schema_node)
    field_type = updated.get('type')

    if field_type == 'object' and isinstance(updated.get('fields'), dict):
        submitted = value if isinstance(value, dict) else {}
        updated_fields = OrderedDict()
        for field_key, field_schema in updated['fields'].items():
            field_value = submitted.get(field_key) if isinstance(submitted, dict) else None
            updated_fields[field_key] = apply_config_values_to_schema(field_schema, field_value)
        updated['fields'] = updated_fields
        return updated

    if value is not None:
        updated['value'] = value
    return updated


def load_enabled_plugins():
    """从 enabled_plugins.json 加载已启用的插件列表"""
    enabled_path = PROJECT_ROOT / 'plugins' / 'enabled_plugins.json'
    if not enabled_path.exists():
        return []
    try:
        with open(enabled_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('plugins', [])
    except Exception as e:
        logger.error(f'加载 enabled_plugins.json 失败：{e}')
        return []


def save_enabled_plugins(enabled_list):
    """保存已启用的插件列表到 enabled_plugins.json"""
    enabled_path = PROJECT_ROOT / 'plugins' / 'enabled_plugins.json'
    try:
        with open(enabled_path, 'w', encoding='utf-8') as f:
            json.dump({'plugins': enabled_list}, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f'保存 enabled_plugins.json 失败：{e}')
        return False


def scan_plugins_directory():
    """自动扫描插件目录（built-in 和 community）"""
    plugins = []
    plugins_base = PROJECT_ROOT / 'plugins'
    enabled_plugins = load_enabled_plugins()

    for category in ['built-in', 'community']:
        category_path = plugins_base / category
        if not category_path.exists():
            continue

        for plugin_dir in category_path.iterdir():
            if not plugin_dir.is_dir():
                continue

            metadata_path = plugin_dir / 'metadata.json'
            if not metadata_path.exists():
                continue

            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)

                # 使用目录名作为插件路径（与 live-2d 保持一致）
                plugin_path = f"{category}/{plugin_dir.name}"
                plugin_enabled = plugin_path in enabled_plugins

                plugins.append({
                    'name': metadata.get('name', plugin_dir.name),
                    'display_name': metadata.get('displayName', metadata.get('name', plugin_dir.name)),
                    'description': metadata.get('description', '无描述'),
                    'version': metadata.get('version', '1.0.0'),
                    'author': metadata.get('author', 'unknown'),
                    'category': category,
                    'enabled': plugin_enabled,
                    'plugin_path': plugin_path,
                    'plugin_dir': str(plugin_dir),
                    'has_own_config': (plugin_dir / 'plugin_config.json').exists()
                })
            except Exception as e:
                logger.error(f'读取插件元数据失败 {plugin_dir.name}: {e}')

    return plugins


@plugin_bp.route('/api/plugins/list')
def list_plugins():
    """获取插件列表（自动扫描）"""
    try:
        plugins = scan_plugins_directory()
        return jsonify(plugins)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@plugin_bp.route('/api/plugins/toggle', methods=['POST'])
def toggle_plugin():
    """切换插件启用状态（使用 enabled_plugins.json）
    
    使用 POST body 传递 plugin_path，避免 URL 中/的问题
    """
    enabled_plugins = load_enabled_plugins()
    
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': '无效的请求数据'}), 400
    
    plugin_path = data.get('plugin_path')
    if not plugin_path:
        return jsonify({'success': False, 'error': '缺少 plugin_path 参数'}), 400
    
    # 验证 plugin_path 格式
    if '/' not in plugin_path:
        logger.error(f'无效的 plugin_path：{plugin_path}')
        return jsonify({'success': False, 'error': '无效的插件路径，应为 category/name 格式'}), 400
    
    # 验证插件目录是否存在
    category, dir_name = plugin_path.split('/', 1)
    if category not in ['built-in', 'community']:
        return jsonify({'success': False, 'error': '无效的插件类别'}), 400
    
    plugin_dir = PROJECT_ROOT / 'plugins' / category / dir_name
    if not plugin_dir.exists():
        return jsonify({'success': False, 'error': f'插件目录不存在：{plugin_path}'}), 404
    
    # 切换状态
    if plugin_path in enabled_plugins:
        enabled_plugins.remove(plugin_path)
        action = 'disabled'
    else:
        enabled_plugins.append(plugin_path)
        action = 'enabled'
    
    if save_enabled_plugins(enabled_plugins):
        return jsonify({
            'success': True,
            'action': action,
            'plugin_path': plugin_path
        })
    return jsonify({'success': False, 'error': '保存失败'}), 500


@plugin_bp.route('/api/plugins/open-config', methods=['POST'])
def open_plugin_config():
    """打开插件配置文件或目录
    
    使用 POST body 传递 plugin_path，避免 URL 中/的问题
    """
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': '无效的请求数据'}), 400
    
    plugin_path = data.get('plugin_path')
    if not plugin_path:
        return jsonify({'success': False, 'error': '缺少 plugin_path 参数'}), 400
    
    # 从 plugin_path 提取目录名
    if '/' not in plugin_path:
        return jsonify({'success': False, 'error': '无效的 plugin_path 格式'}), 400
    
    category, dir_name = plugin_path.split('/', 1)
    plugin_config_key = dir_name.replace('-', '_')
    
    # 查找插件目录
    plugins_base = PROJECT_ROOT / 'plugins'
    plugin_dir = plugins_base / category / dir_name
    
    if not plugin_dir.exists():
        return jsonify({
            'success': False,
            'error': f'插件目录不存在：{plugin_path}'
        }), 404
    
    # 检查插件是否有自己的配置文件
    plugin_config = plugin_dir / 'index.js'
    if plugin_config.exists():
        # 打开插件的 index.js 文件
        try:
            os.startfile(str(plugin_config))
            return jsonify({
                'success': True,
                'config_path': str(plugin_config),
                'message': f'已打开插件主文件：{plugin_config}\n请在 config.json 中配置该插件（plugins.{plugin_config_key}）'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'打开文件失败：{str(e)}',
                'config_path': str(plugin_config)
            })
    else:
        # 打开插件目录
        try:
            os.startfile(str(plugin_dir))
            return jsonify({
                'success': True,
                'config_path': str(plugin_dir),
                'message': f'已打开插件目录：{plugin_dir}\n请在 config.json 中配置该插件（plugins.{plugin_config_key}）'
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'打开目录失败：{str(e)}',
                'config_path': str(plugin_dir)
            })


@plugin_bp.route('/api/plugins/<plugin_name>/config', methods=['GET'])
def get_plugin_config(plugin_name):
    """获取插件的配置数据 - 使用 display_name 识别插件"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'error': '无效的插件名称'}), 400
        
        # 使用 display_name 查找插件目录
        plugins_base = PROJECT_ROOT / 'plugins'
        config_file = None
        
        # 在 built-in 和 community 目录中查找插件配置文件
        for category in ['built-in', 'community']:
            category_path = plugins_base / category
            if not category_path.exists():
                continue
            
            for plugin_dir in category_path.iterdir():
                if not plugin_dir.is_dir():
                    continue
                
                metadata_path = plugin_dir / 'metadata.json'
                if not metadata_path.exists():
                    continue
                
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                display_name = metadata.get('displayName', metadata.get('name', plugin_dir.name))
                
                # 使用 display_name 匹配（替换空格和特殊字符）
                if display_name == plugin_name or display_name.replace(' ', '-').lower() == plugin_name.lower():
                    config_path = plugin_dir / 'plugin_config.json'
                    if config_path.exists():
                        config_file = config_path
                        break
            
            if config_file:
                break
        
        if not config_file:
            return jsonify({'error': f'插件 {plugin_name} 没有配置文件'}), 404
        
        # 读取配置文件（保持顺序）
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = json.load(f, object_pairs_hook=OrderedDict)
        
        # 获取键顺序
        config_keys = list(config_data.keys())
        
        return jsonify({
            'success': True,
            'config': dict(config_data),
            'config_keys': config_keys,
            'config_file': str(config_file)
        })
    
    except json.JSONDecodeError as e:
        return jsonify({'error': f'配置文件格式错误：{str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@plugin_bp.route('/api/plugins/readme-exists', methods=['POST'])
def check_readme_exists_route():
    """检查插件是否有 README.md 文件 - 使用 display_name 识别插件"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'exists': False, 'error': '无效的请求数据'})
        
        display_name = data.get('display_name')
        if not display_name:
            return jsonify({'exists': False, 'error': '缺少 display_name 参数'})
        
        # 使用 display_name 查找插件目录
        plugins_base = PROJECT_ROOT / 'plugins'
        plugin_dir = None
        
        # 在 built-in 和 community 目录中查找插件
        for category in ['built-in', 'community']:
            category_path = plugins_base / category
            if not category_path.exists():
                continue
            
            for test_dir in category_path.iterdir():
                if not test_dir.is_dir():
                    continue
                
                metadata_path = test_dir / 'metadata.json'
                if not metadata_path.exists():
                    continue
                
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                plugin_display_name = metadata.get('displayName', metadata.get('name', test_dir.name))
                
                # 使用 display_name 匹配
                if plugin_display_name == display_name:
                    plugin_dir = test_dir
                    break
            
            if plugin_dir:
                break
        
        if not plugin_dir:
            return jsonify({'exists': False, 'error': f'插件 {display_name} 目录不存在'})
        
        # 查找 README.md 文件（支持多种命名）
        readme_exists = False
        for readme_name in ['README.md', 'readme.md', 'Readme.md', 'README.MD']:
            if (plugin_dir / readme_name).exists():
                readme_exists = True
                break
        
        return jsonify({'exists': readme_exists})
    
    except Exception as e:
        logger.error(f'检查 README 存在性失败：{e}')
        return jsonify({'exists': False, 'error': str(e)})


@plugin_bp.route('/api/plugins/<plugin_name>/config', methods=['POST'])
def save_plugin_config(plugin_name):
    """保存插件的配置数据 - 使用 display_name 识别插件，保持原始 JSON 顺序和元数据"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'error': '无效的插件名称'}), 400
        
        # 获取请求数据
        config_data = request.get_json()
        if not config_data:
            return jsonify({'error': '没有配置数据'}), 400
        
        # 使用 display_name 查找插件目录
        plugins_base = PROJECT_ROOT / 'plugins'
        config_file = None
        
        # 在 built-in 和 community 目录中查找插件配置文件
        for category in ['built-in', 'community']:
            category_path = plugins_base / category
            if not category_path.exists():
                continue
            
            for plugin_dir in category_path.iterdir():
                if not plugin_dir.is_dir():
                    continue
                
                metadata_path = plugin_dir / 'metadata.json'
                if not metadata_path.exists():
                    continue
                
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                display_name = metadata.get('displayName', metadata.get('name', plugin_dir.name))
                
                # 使用 display_name 匹配
                if display_name == plugin_name or display_name.replace(' ', '-').lower() == plugin_name.lower():
                    config_path = plugin_dir / 'plugin_config.json'
                    if config_path.exists():
                        config_file = config_path
                        break
            
            if config_file:
                break
        
        if not config_file:
            return jsonify({'error': f'插件 {plugin_name} 没有配置文件'}), 404
        
        # 读取原始配置文件以保持顺序和元数据
        with open(config_file, 'r', encoding='utf-8') as f:
            original_config = json.load(f, object_pairs_hook=OrderedDict)
        
        # 按照原始配置文件的键顺序重新排列新配置
        ordered_config = OrderedDict()
        for key in original_config.keys():
            original_item = original_config[key]
            
            # 检查是否是带元数据的配置项（有 title, type 等字段）
            if isinstance(original_item, dict) and 'type' in original_item:
                ordered_config[key] = apply_config_values_to_schema(
                    original_item,
                    config_data.get(key)
                )
            else:
                # 这是简单值配置，直接更新
                if key in config_data:
                    ordered_config[key] = config_data[key]
                else:
                    ordered_config[key] = original_item
        
        # 添加新配置中新增的键（如果有）
        for key in config_data.keys():
            if key not in ordered_config:
                ordered_config[key] = config_data[key]
        
        # 保存新配置（保持原始顺序和 2 空格缩进）
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(ordered_config, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'message': '配置保存成功'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@plugin_bp.route('/api/plugins/<plugin_name>/readme-exists', methods=['GET'])
def check_readme_exists_api(plugin_name):
    """检查插件是否有 README.md 文件 - 使用 display_name 识别插件，返回 JSON 结果"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'exists': False, 'error': '无效的插件名称'})
        
        # 使用 display_name 查找插件目录
        plugins_base = PROJECT_ROOT / 'plugins'
        plugin_dir = None
        
        # 在 built-in 和 community 目录中查找插件
        for category in ['built-in', 'community']:
            category_path = plugins_base / category
            if not category_path.exists():
                continue
            
            for test_dir in category_path.iterdir():
                if not test_dir.is_dir():
                    continue
                
                metadata_path = test_dir / 'metadata.json'
                if not metadata_path.exists():
                    continue
                
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                display_name = metadata.get('displayName', metadata.get('name', test_dir.name))
                
                # 使用 display_name 匹配
                if display_name == plugin_name or display_name.replace(' ', '-').lower() == plugin_name.lower():
                    plugin_dir = test_dir
                    break
            
            if plugin_dir:
                break
        
        if not plugin_dir:
            return jsonify({'exists': False, 'error': f'插件 {plugin_name} 目录不存在'})
        
        # 查找 README.md 文件（支持多种命名）
        readme_exists = False
        for readme_name in ['README.md', 'readme.md', 'Readme.md', 'README.MD']:
            if (plugin_dir / readme_name).exists():
                readme_exists = True
                break
        
        return jsonify({'exists': readme_exists})
    
    except Exception as e:
        return jsonify({'exists': False, 'error': str(e)})


@plugin_bp.route('/api/plugins/<plugin_name>/readme', methods=['POST'])
def open_plugin_readme(plugin_name):
    """打开插件目录下的 README.md 文件 - 使用 display_name 识别插件"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'error': '无效的插件名称'}), 400
        
        # 使用 display_name 查找插件目录
        plugins_base = PROJECT_ROOT / 'plugins'
        plugin_dir = None
        
        # 在 built-in 和 community 目录中查找插件
        for category in ['built-in', 'community']:
            category_path = plugins_base / category
            if not category_path.exists():
                continue
            
            for test_dir in category_path.iterdir():
                if not test_dir.is_dir():
                    continue
                
                metadata_path = test_dir / 'metadata.json'
                if not metadata_path.exists():
                    continue
                
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                display_name = metadata.get('displayName', metadata.get('name', test_dir.name))
                
                # 使用 display_name 匹配
                if display_name == plugin_name or display_name.replace(' ', '-').lower() == plugin_name.lower():
                    plugin_dir = test_dir
                    break
            
            if plugin_dir:
                break
        
        if not plugin_dir:
            return jsonify({'error': f'插件 {plugin_name} 目录不存在'}), 404
        
        # 查找 README.md 文件（支持多种命名）
        readme_file = None
        for readme_name in ['README.md', 'readme.md', 'Readme.md', 'README.MD']:
            test_readme = plugin_dir / readme_name
            if test_readme.exists():
                readme_file = test_readme
                break
        
        if not readme_file:
            return jsonify({
                'success': False,
                'error': '该插件没有 README.md 文件'
            }), 404
        
        # 打开 README.md 文件
        os.startfile(str(readme_file))
        return jsonify({
            'success': True,
            'message': f'已打开 README 文件：{readme_file}'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
