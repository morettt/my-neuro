#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 插件管理模块
负责插件的扫描、启用/禁用和配置管理
"""

import os
import json
from flask import Blueprint, request, jsonify

from .utils import PROJECT_ROOT, logger

# 创建插件管理蓝图
plugin_bp = Blueprint('plugin', __name__)


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


@plugin_bp.route('/api/plugins/<plugin_name>/toggle', methods=['POST'])
def toggle_plugin(plugin_name):
    """切换插件启用状态（使用 enabled_plugins.json）"""
    enabled_plugins = load_enabled_plugins()

    # 查找插件的完整路径（built-in/xxx 或 community/xxx）
    # 使用目录名作为插件路径（与 live-2d 保持一致）
    plugin_path = None
    for category in ['built-in', 'community']:
        plugins_base = PROJECT_ROOT / 'plugins'
        # 尝试两种目录名格式（下划线和连字符）
        for dir_name in [plugin_name.replace('_', '-'), plugin_name]:
            category_path = plugins_base / category / dir_name
            if category_path.exists():
                plugin_path = f"{category}/{dir_name}"
                break
        if plugin_path:
            break

    if not plugin_path:
        logger.error(f'插件不存在：{plugin_name}')
        return jsonify({'success': False, 'error': f'插件不存在：{plugin_name}'}), 404
    
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
            'plugin_name': plugin_name,
            'plugin_path': plugin_path
        })
    return jsonify({'success': False, 'error': '保存失败'}), 500


@plugin_bp.route('/api/plugins/<plugin_name>/open-config', methods=['POST'])
def open_plugin_config(plugin_name):
    """打开插件配置文件或目录"""
    plugins_base = PROJECT_ROOT / 'plugins'
    plugin_config_key = plugin_name.replace('-', '_')
    
    # 查找插件目录
    plugin_dir = None
    for category in ['built-in', 'community']:
        test_path = plugins_base / category / plugin_name.replace('_', '-')
        if test_path.exists():
            plugin_dir = test_path
            break
        
        # 也尝试下划线格式
        test_path = plugins_base / category / plugin_name
        if test_path.exists():
            plugin_dir = test_path
            break
    
    if not plugin_dir:
        return jsonify({
            'success': False,
            'error': f'插件目录不存在：{plugin_name}'
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
    """获取插件的配置数据"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'error': '无效的插件名称'}), 400
        
        plugins_base = PROJECT_ROOT / 'plugins'
        config_file = None
        
        # 在built-in和community目录中查找插件配置文件
        for category in ['built-in', 'community']:
            test_path = plugins_base / category / plugin_name.replace('_', '-')
            config_path = test_path / 'plugin_config.json'
            if config_path.exists():
                config_file = config_path
                break
            
            # 也尝试下划线格式
            test_path = plugins_base / category / plugin_name
            config_path = test_path / 'plugin_config.json'
            if config_path.exists():
                config_file = config_path
                break
        
        if not config_file:
            return jsonify({'error': f'插件 {plugin_name} 没有配置文件'}), 404
        
        # 读取配置文件
        with open(config_file, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
        
        return jsonify({
            'success': True,
            'config': config_data,
            'config_file': str(config_file)
        })
    
    except json.JSONDecodeError as e:
        return jsonify({'error': f'配置文件格式错误: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@plugin_bp.route('/api/plugins/<plugin_name>/config', methods=['POST'])
def save_plugin_config(plugin_name):
    """保存插件的配置数据"""
    try:
        # 安全检查：防止路径遍历攻击
        if '..' in plugin_name or '/' in plugin_name or '\\' in plugin_name:
            return jsonify({'error': '无效的插件名称'}), 400
        
        # 获取请求数据
        config_data = request.get_json()
        if not config_data:
            return jsonify({'error': '没有配置数据'}), 400
        
        plugins_base = PROJECT_ROOT / 'plugins'
        config_file = None
        
        # 在built-in和community目录中查找插件配置文件
        for category in ['built-in', 'community']:
            test_path = plugins_base / category / plugin_name.replace('_', '-')
            config_path = test_path / 'plugin_config.json'
            if config_path.exists():
                config_file = config_path
                break
            
            # 也尝试下划线格式
            test_path = plugins_base / category / plugin_name
            config_path = test_path / 'plugin_config.json'
            if config_path.exists():
                config_file = config_path
                break
        
        if not config_file:
            return jsonify({'error': f'插件 {plugin_name} 没有配置文件'}), 404
        
        # 备份原配置文件
        backup_file = config_file.with_suffix('.json.backup')
        if config_file.exists():
            import shutil
            shutil.copy2(config_file, backup_file)
        
        # 保存新配置
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, ensure_ascii=False, indent=4)
        
        return jsonify({
            'success': True,
            'message': '配置保存成功',
            'backup_file': str(backup_file)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
