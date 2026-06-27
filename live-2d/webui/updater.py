#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 版本更新检查模块
负责从 GitHub API 获取 releases 信息
"""

import json
import re
import time
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
RELEASE_CACHE_TTL_SECONDS = 15 * 60

updater_bp = Blueprint('updater', __name__)

_HEADERS = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'my-neuro-webui',
}


_VERSION_RE = re.compile(r'^[vV]?(\d+(?:\.\d+){0,3})(?:[-_].*)?$')
_releases_cache = {
    'expires_at': 0,
    'releases': None,
}


def _version_key(value):
    """Return a comparable numeric version tuple, or None for non-version tags."""
    match = _VERSION_RE.match(str(value or '').strip())
    if not match:
        return None
    return tuple(int(part) for part in match.group(1).split('.'))


def _compare_version_keys(left, right):
    """Compare version tuples while treating missing components as zero."""
    max_len = max(len(left), len(right))
    left = left + (0,) * (max_len - len(left))
    right = right + (0,) * (max_len - len(right))
    return (left > right) - (left < right)


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


def _clone_releases(releases):
    return [dict(release) for release in releases]


def _fetch_releases():
    """Fetch recent releases from GitHub, with a short cache to avoid rate limits."""
    now = time.time()
    cached_releases = _releases_cache.get('releases')
    if cached_releases is not None and now < _releases_cache.get('expires_at', 0):
        return _clone_releases(cached_releases)

    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases?per_page=100"
    data = _http_get(url)
    releases = []
    for item in data:
        if item.get('draft'):
            continue
        releases.append({
            'tag_name': item.get('tag_name'),
            'name': item.get('name'),
            'body': item.get('body'),
            'html_url': item.get('html_url'),
            'published_at': item.get('published_at'),
            'prerelease': item.get('prerelease', False),
            'draft': item.get('draft', False),
        })

    _releases_cache['releases'] = _clone_releases(releases)
    _releases_cache['expires_at'] = now + RELEASE_CACHE_TTL_SECONDS
    return releases


def _apply_version_metadata(releases, current_version):
    current_key = _version_key(current_version)
    stable_releases = []
    for release in releases:
        version_key = _version_key(release.get('tag_name'))
        release['is_newer'] = (
            not release.get('prerelease')
            and current_key is not None
            and version_key is not None
            and _compare_version_keys(version_key, current_key) > 0
        )
        release['is_latest'] = False
        if not release.get('prerelease') and version_key is not None:
            stable_releases.append((version_key, release))

    latest_release = None
    if stable_releases:
        latest_release = max(stable_releases, key=lambda item: item[0])[1]
        latest_release['is_latest'] = True

    return latest_release


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

    try:
        releases = _fetch_releases()
    except Exception as e:
        logger.error(f'获取 GitHub releases 失败：{e}')
        cached_releases = _releases_cache.get('releases')
        if cached_releases is not None:
            releases = _clone_releases(cached_releases)
        else:
            return jsonify({
                'error': str(e),
                'current_version': current_version,
                'releases': [],
            }), 502

    latest_release = _apply_version_metadata(releases, current_version)

    return jsonify({
        'current_version': current_version,
        'latest_release': latest_release,
        'has_new_version': any(r.get('is_newer') for r in releases),
        'releases': releases,
    })
