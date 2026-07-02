#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lightweight Supabase-backed stats for the plugin marketplace."""

import json
import os
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from .utils import PROJECT_ROOT, logger

try:
    import requests
except ImportError:  # pragma: no cover - exercised only when requests is absent
    requests = None


DEFAULT_SUPABASE_URL = 'https://rwlgilizuhdnulguytta.supabase.co'
DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_D204Eas7z6amn-YbXpCiyQ_wkTUOXYr'

SUPABASE_URL = os.environ.get('MYNEURO_STATS_URL', DEFAULT_SUPABASE_URL).strip().rstrip('/')
SUPABASE_ANON_KEY = os.environ.get('MYNEURO_STATS_KEY', DEFAULT_SUPABASE_ANON_KEY).strip()
STATS_ENABLED = bool(SUPABASE_URL and SUPABASE_ANON_KEY)

_CACHE_TTL_SECONDS = 60
_REQUEST_TIMEOUT_SECONDS = 3
_CLIENT_ID_PATH = PROJECT_ROOT / 'plugins' / '.stats_client_id'

_machine_id_cache = None
_stats_cache = {
    'expires_at': 0,
    'data': {},
}


def _valid_name(name):
    return isinstance(name, str) and 0 < len(name) <= 160


def _rpc_url(function_name):
    return f'{SUPABASE_URL}/rest/v1/rpc/{function_name}'


def _rpc(function_name, payload):
    headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
        'Content-Type': 'application/json',
    }
    body = json.dumps(payload).encode('utf-8')

    if requests is not None:
        response = requests.post(
            _rpc_url(function_name),
            headers=headers,
            data=body,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        if not response.content:
            return None
        return response.json()

    request = urllib.request.Request(
        _rpc_url(function_name),
        data=body,
        headers=headers,
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT_SECONDS) as response:
        content = response.read()
    return json.loads(content.decode('utf-8')) if content else None


def _get_machine_id():
    global _machine_id_cache
    if _machine_id_cache:
        return _machine_id_cache

    try:
        if _CLIENT_ID_PATH.exists():
            value = _CLIENT_ID_PATH.read_text(encoding='utf-8').strip()
            if value:
                _machine_id_cache = value
                return value

        _CLIENT_ID_PATH.parent.mkdir(parents=True, exist_ok=True)
        value = str(uuid.uuid4())
        _CLIENT_ID_PATH.write_text(value, encoding='utf-8')
        _machine_id_cache = value
        return value
    except OSError as exc:
        logger.warning('Plugin marketplace stats client id unavailable: %s', exc)
        value = str(uuid.uuid4())
        _machine_id_cache = value
        return value


def _normalize_stats_rows(rows):
    if not isinstance(rows, list):
        return {}

    stats = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get('plugin_name')
        if not _valid_name(name):
            continue
        stats[name] = {
            'downloads': max(0, int(row.get('downloads') or 0)),
            'stars': max(0, int(row.get('stars') or 0)),
            'starred': bool(row.get('starred')),
        }
    return stats


def fetch_stats_map(force=False):
    """Return {plugin_name: {downloads, stars, starred}} or {} when disabled/unavailable."""
    if not STATS_ENABLED:
        return {}

    now = time.time()
    if not force and _stats_cache['expires_at'] > now:
        return dict(_stats_cache['data'])

    try:
        rows = _rpc('get_all_stats', {'p_device': _get_machine_id()})
        stats = _normalize_stats_rows(rows)
        _stats_cache['data'] = stats
        _stats_cache['expires_at'] = now + _CACHE_TTL_SECONDS
        return dict(stats)
    except (ValueError, urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        logger.warning('Plugin marketplace stats fetch failed: %s', exc)
    except Exception as exc:
        logger.warning('Plugin marketplace stats fetch failed: %s', exc)
    return {}


def increment_download(plugin_name):
    """Best-effort download counter increment after a successful install."""
    if not STATS_ENABLED or not _valid_name(plugin_name):
        return None

    try:
        result = _rpc('increment_download', {'p_name': plugin_name})
        _stats_cache['expires_at'] = 0
        return result
    except Exception as exc:
        logger.warning('Plugin marketplace download increment failed: %s', exc)
    return None


def toggle_star(plugin_name):
    if not STATS_ENABLED:
        return {
            'success': False,
            'error': 'stats_disabled',
            'starred': False,
            'stars': 0,
        }
    if not _valid_name(plugin_name):
        return {
            'success': False,
            'error': 'invalid_plugin_name',
            'starred': False,
            'stars': 0,
        }

    try:
        result = _rpc('toggle_star', {
            'p_name': plugin_name,
            'p_device': _get_machine_id(),
        })
        if not isinstance(result, dict):
            raise ValueError('Unexpected toggle_star response')

        stars = max(0, int(result.get('stars') or 0))
        starred = bool(result.get('starred'))
        _stats_cache['expires_at'] = 0
        return {
            'success': True,
            'starred': starred,
            'stars': stars,
        }
    except Exception as exc:
        logger.warning('Plugin marketplace star toggle failed: %s', exc)
        return {
            'success': False,
            'error': 'stats_unavailable',
            'starred': False,
            'stars': 0,
        }
