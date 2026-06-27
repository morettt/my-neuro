#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 版本更新检查模块
负责从 GitHub API 获取 releases 信息
"""

import json
from flask import Blueprint, jsonify

from .utils import PROJECT_ROOT, logger

# 优先使用 requests，不可用时降级到 urllib.request
try:
    import requests as _requests
    _use_requests = True
except ImportError:
    import urllib.request
    import ssl
    _use_requests = False

# GitHub 仓库信息
GITHUB_OWNER = "morettt"
GITHUB_REPO = "my-neuro"

updater_bp = Blueprint('updater', __name__)

_HEADERS = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'my-neuro-webui',
}


def _http_get(url, timeout=10):
    """统一 HTTP GET，返回解析后的 JSON"""
    if _use_requests:
        resp = _requests.get(url, timeout=timeout, headers=_HEADERS)
        resp.raise_for_status()
        return resp.json()
    else:
        req = urllib.request.Request(url, headers=_HEADERS)
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return json.loads(resp.read().decode('utf-8'))


@updater_bp.route('/api/releases')
def get_releases():
    """获取 GitHub releases 列表和当前版本"""
    # 读取当前版本
    current_version = 'unknown'
    config_path = PROJECT_ROOT / 'config.json'
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            current_version = config.get('version', 'unknown')
    except Exception as e:
        logger.warning(f'读取版本信息失败：{e}')

    # 从 GitHub API 获取 releases
    releases = []
    try:
        for page in range(1, 6):
            url = (
                f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases"
                f"?per_page=30&page={page}"
            )
            data = _http_get(url)
            if not data:
                break
            for item in data:
                releases.append({
                    'tag_name': item.get('tag_name'),
                    'name': item.get('name'),
                    'body': item.get('body'),
                    'html_url': item.get('html_url'),
                    'published_at': item.get('published_at'),
                    'prerelease': item.get('prerelease', False),
                    'draft': item.get('draft', False),
                })
            if len(data) < 30:
                break
    except Exception as e:
        logger.error(f'获取 GitHub releases 失败：{e}')
        return jsonify({
            'error': str(e),
            'current_version': current_version,
            'releases': [],
        }), 502

    # 过滤掉 draft releases
    releases = [r for r in releases if not r.get('draft')]

    return jsonify({
        'current_version': current_version,
        'releases': releases,
    })
