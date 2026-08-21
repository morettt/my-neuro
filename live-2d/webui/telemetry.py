#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
遥测聚合 API(蓝图)。
读取 Electron 侧落盘的 .runtime/telemetry.jsonl,聚合出总览所需的
运行状态、最近动态、LLM 耗时/token 序列、错误分桶,并合并进程采样。
只读尾读,不整文件入内存;文件不存在时返回空聚合,不报错。
"""

import json
import os
import time
import datetime
from flask import Blueprint, jsonify, request

from .utils import PROJECT_ROOT, WEBUI_VERSION, logger
from .log_monitor import _read_last_lines
from . import process_metrics

telemetry_bp = Blueprint('telemetry', __name__)

TELEMETRY_FILE = os.path.join(PROJECT_ROOT, '.runtime', 'telemetry.jsonl')

# 聚合只读最近 1500 条或 24 小时,取更严
MAX_EVENTS = 1500
MAX_AGE_MS = 24 * 3600 * 1000

# 错误趋势分桶宽度(5 分钟)
ERROR_BUCKET_MS = 5 * 60 * 1000

_service_controller_imports_done = False


def _read_events():
    """尾读 JSONL,返回最近且未过期的事件列表(按时间升序)。文件缺失/坏行跳过。"""
    if not os.path.exists(TELEMETRY_FILE):
        return []
    try:
        lines = _read_last_lines(TELEMETRY_FILE, MAX_EVENTS * 2)  # 多读一些,坏行过滤后够用
    except Exception as e:
        logger.warning(f'读取遥测文件失败: {e}')
        return []

    now_ms = int(time.time() * 1000)
    events = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue  # 坏行跳过
        if not isinstance(ev, dict) or 'ts' not in ev:
            continue
        if now_ms - ev['ts'] > MAX_AGE_MS:
            continue
        events.append(ev)
    return events[-MAX_EVENTS:]


def _aggregate(events):
    """把事件聚合成总览结构。"""
    recent = events[-12:][::-1]  # 最近 12 条,新的在前

    # 当前管道阶段:最近一条带 pipeline_stage 的事件
    pipeline_stage = 'idle'
    for ev in reversed(events):
        if ev.get('pipeline_stage'):
            pipeline_stage = ev['pipeline_stage']
            break

    # LLM 最近 40 次完成:耗时 + token
    llm_runs = []
    for ev in events:
        if ev.get('type') == 'llm.complete' and isinstance(ev.get('metrics'), dict):
            m = ev['metrics']
            run = {'ts': ev['ts'], 'duration_ms': m.get('duration_ms')}
            if 'input_tokens' in m:
                run['input_tokens'] = m['input_tokens']
            if 'output_tokens' in m:
                run['output_tokens'] = m['output_tokens']
            llm_runs.append(run)
    llm_runs = llm_runs[-40:]

    # 错误/警告按 5 分钟分桶
    error_buckets = {}
    for ev in events:
        if ev.get('level') in ('warn', 'error'):
            b = ev['ts'] // ERROR_BUCKET_MS * ERROR_BUCKET_MS
            error_buckets.setdefault(b, {'ts': b, 'warn': 0, 'error': 0})
            error_buckets[b][ev['level']] += 1
    error_series = [error_buckets[k] for k in sorted(error_buckets)]

    return {
        'recent_events': recent,
        'pipeline_stage': pipeline_stage,
        'llm_runs': llm_runs,
        'error_series': error_series,
        'event_count': len(events)
    }


def _get_services_status():
    """复用 service_controller 的服务状态。"""
    try:
        from .service_controller import _get_service_state, MANAGED_SERVICES
        from .utils import service_pids, service_processes
        status = {}
        services = set(MANAGED_SERVICES) | set(service_pids) | set(service_processes)
        for service in services:
            status[service] = 'running' if _get_service_state(service)['started'] else 'stopped'
        return status
    except Exception as e:
        logger.warning(f'获取服务状态失败: {e}')
        return {}


def _scan_plugins_summary():
    """复用 plugin_manager 的扫描与启用清单,返回全部插件(含启用状态)+ 统计。"""
    try:
        from .plugin_manager import scan_plugins_directory, load_enabled_plugins
        enabled_paths = set(load_enabled_plugins())
        plugins = scan_plugins_directory()
        all_plugins = []
        enabled_count = 0
        for p in plugins:
            path = p.get('plugin_path') or p.get('name') or ''
            enabled = path in enabled_paths
            if enabled:
                enabled_count += 1
            all_plugins.append({
                'name': p.get('display_name') or p.get('name') or path,
                'enabled': enabled
            })
        return {'all_plugins': all_plugins, 'total': len(all_plugins), 'enabled_count': enabled_count}
    except Exception as e:
        logger.warning(f'获取插件摘要失败: {e}')
        return {'all_plugins': [], 'total': 0, 'enabled_count': 0}


@telemetry_bp.route('/api/overview')
def api_overview():
    """一次请求给齐总览所需全部数据。"""
    events = _read_events()
    agg = _aggregate(events)
    metrics = process_metrics.get_latest()
    # 运行时间:main_app 模块级 START_TIME(延迟导入避免循环依赖)
    uptime_seconds = None
    try:
        from . import main_app
        uptime_seconds = int((datetime.datetime.now() - main_app.START_TIME).total_seconds())
    except Exception:
        pass
    return jsonify({
        'ok': True,
        'version': WEBUI_VERSION,
        'uptime_seconds': uptime_seconds,
        'services': _get_services_status(),
        'plugins': _scan_plugins_summary(),
        'metrics': metrics,
        **agg
    })


@telemetry_bp.route('/api/telemetry')
def api_telemetry():
    """增量动态:since_ts 之后的事件。"""
    since = request.args.get('since_ts', type=int) or 0
    events = [e for e in _read_events() if e['ts'] > since]
    return jsonify({'ok': True, 'events': events, 'now': int(time.time() * 1000)})


@telemetry_bp.route('/api/system/metrics')
def api_system_metrics():
    """CPU/内存环形缓冲序列(供折线图)。"""
    return jsonify({'ok': True, 'series': process_metrics.get_series()})
