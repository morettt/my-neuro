#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebUI 模块化重构 - 服务控制模块
负责服务的启动、停止和状态管理
"""

import sys
import subprocess
import time
import os
import socket
import threading
import webbrowser
from flask import Blueprint, jsonify

from .utils import (
    PROJECT_ROOT,
    SERVICE_PORTS,
    logger,
    service_log_files,
    service_processes,
    service_pids,
)
from .state_io import (
    delete_resource_state,
    read_resource_state,
    resource_lock,
    write_resource_state,
)

# Windows 下隐藏窗口的标志
CREATE_NO_WINDOW = 0x08000000 if sys.platform.startswith('win') else 0

# 启动 GUI/长期运行子进程时不要用 PIPE：无人读取时管道写满会导致子进程卡死（表现为 WebUI 点击启动一直无响应）
_DEVNULL = subprocess.DEVNULL

MEMOS_WEBUI_PORT = 8004
MEMOS_WEBUI_URL = f'http://127.0.0.1:{MEMOS_WEBUI_PORT}'
MANAGED_SERVICES = ('live2d', 'asr', 'tts', 'bert', 'memos', 'rag')
SERVICE_OPERATION_LOCK_TIMEOUT = 20.0


def resolve_memos_dir():
    """解析 MemOS 根目录：本地布局 <root>/memos_system 优先，线上布局
    <root>/plugins-dlc/memos/memos_system 兜底。返回第一个已存在的目录。"""
    candidates = [
        PROJECT_ROOT.parent / 'memos_system',
        PROJECT_ROOT.parent / 'plugins-dlc' / 'memos' / 'memos_system',
    ]
    for path in candidates:
        if path.is_dir():
            return path
    return candidates[-1]  # 线上常见布局

# 创建服务控制蓝图
service_bp = Blueprint('service', __name__)

# 服务启动时间
import datetime
START_TIME = datetime.datetime.now()


def _close_service_log(service):
    """Close a saved service log file handle if one exists."""
    log_fh = service_log_files.pop(service, None)
    if log_fh:
        try:
            log_fh.close()
        except Exception as e:
            logger.debug(f'关闭 {service} 日志句柄失败：{e}')


def _service_resource(service):
    return f'service:{PROJECT_ROOT.resolve()}:{service}'


def _read_service_owner(service):
    return read_resource_state(_service_resource(service))


def _write_service_owner(service, proc):
    write_resource_state(
        _service_resource(service),
        {
            'service': service,
            'service_pid': int(proc.pid),
            'webui_pid': os.getpid(),
            'project_root': str(PROJECT_ROOT.resolve()),
            'updated_at': time.time(),
        },
    )


def _clear_service_owner(service):
    delete_resource_state(_service_resource(service))


def _reset_service_state(service, clear_owner=False):
    """Reset tracked process, status and log handle for a service."""
    service_pids[service] = False
    service_processes.pop(service, None)
    _close_service_log(service)
    if clear_owner:
        _clear_service_owner(service)


def _probe_port(port, timeout=0.3):
    """Return True when localhost:port accepts TCP connections."""
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout):
            return True
    except OSError:
        return False


def _get_service_script_path(service):
    script_paths = {
        'live2d': PROJECT_ROOT / 'go.bat',
        'asr': PROJECT_ROOT.parent / '1.ASR.bat',
        'tts': PROJECT_ROOT.parent / '2.TTS.bat',
        'bert': PROJECT_ROOT.parent / '3.bert.bat',
        'memos': resolve_memos_dir() / 'start_memos.bat',
        'rag': PROJECT_ROOT.parent / 'RAG.bat',
    }
    return script_paths.get(service)


def _batch_command(script_path):
    if not sys.platform.startswith('win'):
        return [str(script_path)]
    command = os.environ.get('COMSPEC', 'cmd.exe')
    return [command, '/d', '/c', 'call', str(script_path)]


def _open_browser_later(url, delay=0.8):
    """Open a browser tab after a short delay without blocking the API response."""
    def _open():
        time.sleep(delay)
        webbrowser.open(url)

    threading.Thread(target=_open, daemon=True).start()


def _get_service_state(service):
    """Reconcile tracked process state with the service's listening port."""
    proc = service_processes.get(service)
    locally_tracked = bool(proc and proc.poll() is None)
    if proc and not locally_tracked:
        service_processes.pop(service, None)
        _close_service_log(service)

    owner = _read_service_owner(service)
    owner_pid = owner.get('service_pid') if isinstance(owner, dict) else None
    shared_tracked = bool(
        isinstance(owner_pid, int) and _pid_is_running(owner_pid)
    )
    port = SERVICE_PORTS.get(service)
    ready = _probe_port(port) if port else False
    if owner and not shared_tracked and not ready:
        _clear_service_owner(service)
        owner = None
        owner_pid = None

    tracked = locally_tracked or shared_tracked
    started = tracked or ready
    service_pids[service] = started
    return {
        'started': started,
        'ready': ready,
        'tracked': tracked,
        'locally_tracked': locally_tracked,
        'shared_tracked': shared_tracked,
        'owner_pid': owner_pid,
        'port': port,
    }


def _get_service_started(service):
    return _get_service_state(service)['started']


def _find_service_pids(service):
    script_path = _get_service_script_path(service)
    if not script_path:
        return []

    env = dict(os.environ)
    env['MY_NEURO_TARGET_SCRIPT'] = str(script_path.resolve())
    ps_script = r"""
    $ErrorActionPreference = 'Stop'
    $target = [IO.Path]::GetFullPath($env:MY_NEURO_TARGET_SCRIPT)
    $selfPid = $PID
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.ProcessId -ne $selfPid -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf(
                $target,
                [StringComparison]::OrdinalIgnoreCase
            ) -ge 0
        } |
        ForEach-Object { Write-Output $_.ProcessId }
    """
    result = subprocess.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'PowerShell 进程查询失败')
    return [
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip().isdigit()
    ]


def _pid_is_running(pid):
    try:
        process_id = int(pid)
    except (TypeError, ValueError):
        return False
    if process_id <= 0:
        return False

    if sys.platform.startswith('win'):
        import ctypes

        process_query_limited_information = 0x1000
        still_active = 259
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information,
            False,
            process_id,
        )
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            return bool(
                ctypes.windll.kernel32.GetExitCodeProcess(
                    handle,
                    ctypes.byref(exit_code),
                )
                and exit_code.value == still_active
            )
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)

    try:
        os.kill(process_id, 0)
        return True
    except OSError:
        return False


def _wait_for_service_stopped(service, pids, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        proc = service_processes.get(service)
        tracked_alive = bool(proc and proc.poll() is None)
        port = SERVICE_PORTS.get(service)
        port_alive = _probe_port(port) if port else False
        fallback_alive = any(_pid_is_running(pid) for pid in pids)
        if not tracked_alive and not port_alive and not fallback_alive:
            return True
        time.sleep(0.1)
    return False


@service_bp.route('/api/status')
def get_status():
    """获取所有服务的状态"""
    status = {}
    services = set(MANAGED_SERVICES) | set(service_pids) | set(service_processes)
    for service in services:
        status[service] = (
            'running' if _get_service_state(service)['started'] else 'stopped'
        )
    return jsonify(status)


@service_bp.route('/api/services/readiness')
def get_services_readiness():
    """获取本地 ASR/TTS/记忆系统的进程与端口就绪状态。"""
    readiness = {}
    for service, port in SERVICE_PORTS.items():
        state = _get_service_state(service)
        readiness[service] = {
            'started': state['started'],
            'ready': state['ready'],
            'tracked': state['tracked'],
            'owner_pid': state['owner_pid'],
            'port': port,
        }
    return jsonify(readiness)


@service_bp.route('/api/system/info')
def get_system_info():
    """获取系统信息（版本、运行时间等）"""
    uptime = datetime.datetime.now() - START_TIME
    # 格式化为人类可读的时间
    days = uptime.days
    hours, remainder = divmod(uptime.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    uptime_str = f"{days}天{hours}小时{minutes}分钟{seconds}秒" if days > 0 else f"{hours}小时{minutes}分钟{seconds}秒"

    from .utils import WEBUI_VERSION
    from .config_manager import CONFIG_PATH
    # 旧版前端读 config.json 的 version 字段（neuro_version）
    neuro_version = '未知'
    try:
        import json as _json
        if CONFIG_PATH.exists():
            neuro_version = _json.loads(CONFIG_PATH.read_text(encoding='utf-8')).get('version', '未知')
    except Exception:
        pass
    return jsonify({
        'version': WEBUI_VERSION,
        'neuro_version': neuro_version,
        'uptime': uptime_str,
        'start_time': START_TIME.strftime('%Y-%m-%d %H:%M:%S'),
        'start_timestamp': START_TIME.timestamp()  # 添加时间戳用于前端计算
    })


@service_bp.route('/api/memos/webui/start', methods=['POST'])
def start_memos_webui():
    """启动并打开 MemOS Cyberpunk WebUI。"""
    try:
        if _probe_port(MEMOS_WEBUI_PORT):
            _open_browser_later(MEMOS_WEBUI_URL, delay=0.1)
            return jsonify({
                'success': True,
                'already_running': True,
                'url': MEMOS_WEBUI_URL,
                'message': '记忆系统 WebUI 已在运行，已打开浏览器'
            })

        if not _probe_port(SERVICE_PORTS['memos']):
            return jsonify({
                'success': False,
                'error': '记忆系统后端未运行，请先点击记忆系统「启动」'
            })

        memos_dir = resolve_memos_dir()
        script_path = memos_dir / '启动WebUI_Cyberpunk.bat'
        if not script_path.exists():
            return jsonify({
                'success': False,
                'error': f'找不到启动脚本：{script_path}'
            })

        if sys.platform.startswith('win'):
            proc = subprocess.Popen(
                ['cmd', '/c', 'start', '', 'cmd', '/k', script_path.name],
                cwd=str(memos_dir),
                stdin=_DEVNULL,
                stdout=_DEVNULL,
                stderr=_DEVNULL,
                creationflags=0,
            )
        else:
            proc = subprocess.Popen(
                [str(script_path)],
                cwd=str(memos_dir),
                stdin=_DEVNULL,
                stdout=_DEVNULL,
                stderr=_DEVNULL,
            )

        _open_browser_later(MEMOS_WEBUI_URL, delay=2.0)
        logger.warning(f'MemOS Cyberpunk WebUI 启动请求已发送 (PID: {proc.pid})')
        return jsonify({
            'success': True,
            'pid': proc.pid,
            'url': MEMOS_WEBUI_URL,
            'message': '正在启动记忆系统 WebUI'
        })

    except Exception as e:
        logger.error(f'启动 MemOS WebUI 失败：{e}')
        return jsonify({'success': False, 'error': str(e)})


@service_bp.route('/api/start/<service>', methods=['POST'])
def start_service(service):
    try:
        with resource_lock(
            _service_resource(service),
            timeout=SERVICE_OPERATION_LOCK_TIMEOUT,
        ):
            return _start_service_locked(service)
    except TimeoutError:
        return jsonify({
            'success': False,
            'error': '服务启动操作正由另一个 WebUI 执行，请稍后重试',
        }), 409
    except Exception as error:
        logger.error(f'获取 {service} 服务启动锁失败：{error}')
        return jsonify({
            'success': False,
            'error': f'服务启动锁失败：{error}',
        }), 500


def _start_service_locked(service):
    """启动指定服务"""
    try:
        # 检查服务是否已在运行
        state = _get_service_state(service)
        if state['started']:
            return jsonify({
                'success': False,
                'already_running': True,
                'pid': state.get('owner_pid'),
                'error': '服务已在运行中',
            })

        # 根据服务类型启动对应的脚本
        # live2d 使用特殊方式启动（不显示控制台），其他服务保持原样
        # 注意：PROJECT_ROOT 现在指向 live-2d/，所以需要使用 PROJECT_ROOT.parent 访问 my-neuro-main/ 目录
        script_map = {
            'live2d': {
                'script': str(PROJECT_ROOT / 'go.bat'),
                'cwd': str(PROJECT_ROOT),
                'log_file': PROJECT_ROOT / 'runtime.log',
                'hide_window': True  # 特殊标记：不显示控制台
            },
            'asr': {
                'script': str(PROJECT_ROOT.parent / '1.ASR.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT.parent / '1.ASR.bat')],
                'cwd': str(PROJECT_ROOT.parent),
                'is_python': False,
                'log_file': PROJECT_ROOT.parent / 'logs' / 'asr.log',
                'embed_log': True
            },
            'tts': {
                'script': str(PROJECT_ROOT.parent / '2.TTS.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT.parent / '2.TTS.bat')],
                'cwd': str(PROJECT_ROOT.parent),
                'is_python': False,
                'log_file': PROJECT_ROOT.parent / 'logs' / 'tts.log',
                'embed_log': True
            },
            'bert': {
                'script': str(PROJECT_ROOT.parent / '3.bert.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT.parent / '3.bert.bat')],
                'cwd': str(PROJECT_ROOT.parent),
                'is_python': False,
                'log_file': PROJECT_ROOT.parent / 'logs' / 'bert.log'
            },
            'memos': {
                'script': str(resolve_memos_dir() / 'start_memos.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', 'cd /d ' + str(resolve_memos_dir()) + ' && start_memos.bat'],
                'cwd': str(resolve_memos_dir()),
                'is_python': False,
                'log_file': PROJECT_ROOT.parent / 'logs' / 'memos.log',
                'embed_log': True
            },
            'rag': {
                'script': str(PROJECT_ROOT.parent / 'RAG.bat'),
                'args': ['cmd', '/c', 'start', 'cmd', '/k', str(PROJECT_ROOT.parent / 'RAG.bat')],
                'cwd': str(PROJECT_ROOT.parent),
                'is_python': False,
                'log_file': PROJECT_ROOT.parent / 'logs' / 'rag.log'
            }
        }

        if service not in script_map:
            return jsonify({'success': False, 'error': f'未知服务：{service}'})

        config = script_map[service]
        script_path = _get_service_script_path(service)
        if not script_path or not script_path.is_file():
            return jsonify({
                'success': False,
                'error': f'找不到启动脚本：{script_path}',
            })

        # 对于 Live2D 服务，启动前清空日志文件
        if service == 'live2d' and config.get('log_file'):
            log_file = config['log_file']
            try:
                with open(log_file, 'w', encoding='utf-8') as f:
                    f.write('')  # 清空文件
                logger.warning(f'已清空日志文件：{log_file}')
            except Exception as e:
                logger.error(f'清空日志文件失败：{e}')
        
        # 启动服务
        if config.get('embed_log'):
            # ASR/TTS/记忆系统：隐藏控制台，输出重定向到 WebUI 日志文件。
            log_file = config['log_file']
            log_file.parent.mkdir(parents=True, exist_ok=True)
            _close_service_log(service)
            log_fh = open(log_file, 'w', encoding='utf-8', errors='ignore', buffering=1)
            env = dict(os.environ)
            env['PYTHONUNBUFFERED'] = '1'
            env['PYTHONIOENCODING'] = 'utf-8'

            try:
                proc = subprocess.Popen(
                    _batch_command(script_path),
                    cwd=config['cwd'],
                    stdin=_DEVNULL,
                    stdout=log_fh,
                    stderr=subprocess.STDOUT,
                    env=env,
                    creationflags=CREATE_NO_WINDOW if sys.platform.startswith('win') else 0,
                )
            except Exception:
                log_fh.close()
                raise

            service_log_files[service] = log_fh
            time.sleep(1)
            if proc.poll() is not None:
                exit_code = proc.returncode
                _close_service_log(service)
                service_processes.pop(service, None)
                service_pids[service] = False
                return jsonify({
                    'success': False,
                    'error': f'{service} 启动失败（退出码 {exit_code}），请查看「{service} 日志」',
                    'log': service
                })
        elif config.get('hide_window'):
            # Live2D 服务：不显示控制台窗口，直接运行 bat
            # stdin/stdout/stderr 一律丢弃，避免 PIPE 写满卡死 Electron/Node，也避免无控制台时 stdin 行为异常
            _kw = dict(
                cwd=config['cwd'],
                stdin=_DEVNULL,
                stdout=_DEVNULL,
                stderr=_DEVNULL,
                creationflags=CREATE_NO_WINDOW if sys.platform.startswith('win') else 0,
            )
            proc = subprocess.Popen(
                _batch_command(script_path),
                **_kw,
            )
            # 等待一下让进程启动
            time.sleep(1)
            # 检查进程是否真的在运行
            if proc.poll() is not None:
                # 进程已退出，尝试用 cmd /c 方式启动
                proc = subprocess.Popen(
                    _batch_command(script_path),
                    **_kw,
                )
                time.sleep(1)
                if proc.poll() is not None:
                    _reset_service_state(service, clear_owner=True)
                    return jsonify({
                        'success': False,
                        'error': 'Live2D 启动失败，启动脚本立即退出',
                    })
        else:
            # 其他服务：使用独立控制台，脚本结束后 cmd 也随之退出。
            proc = subprocess.Popen(
                _batch_command(script_path),
                cwd=config['cwd'],
                stdin=_DEVNULL,
                creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform.startswith('win') else 0
            )

        service_processes[service] = proc
        # 记录服务已启动（即使进程对象可能立即结束）
        service_pids[service] = True
        _write_service_owner(service, proc)
        logger.warning(f'{service} 服务已启动 (PID: {proc.pid})')

        return jsonify({'success': True, 'pid': proc.pid})
        
    except Exception as e:
        logger.error(f'启动 {service} 服务失败：{str(e)}')
        return jsonify({'success': False, 'error': str(e)})


@service_bp.route('/api/stop/<service>', methods=['POST'])
def stop_service(service):
    try:
        with resource_lock(
            _service_resource(service),
            timeout=SERVICE_OPERATION_LOCK_TIMEOUT,
        ):
            return _stop_service_locked(service)
    except TimeoutError:
        return jsonify({
            'success': False,
            'error': '服务停止操作正由另一个 WebUI 执行，请稍后重试',
        }), 409
    except Exception as error:
        logger.error(f'获取 {service} 服务停止锁失败：{error}')
        return jsonify({
            'success': False,
            'error': f'服务停止锁失败：{error}',
        }), 500


def _stop_service_locked(service):
    """停止指定服务"""
    if not sys.platform.startswith('win'):
        return jsonify({'success': False, 'error': '仅支持 Windows 系统'}), 400
    if service not in MANAGED_SERVICES:
        return jsonify({'success': False, 'error': f'未知服务：{service}'}), 404

    try:
        proc = service_processes.get(service)
        if proc and proc.poll() is None:
            pids = [str(proc.pid)]
            logger.debug(f'使用记录的 PID: {proc.pid}')
        else:
            owner = _read_service_owner(service)
            owner_pid = owner.get('service_pid') if isinstance(owner, dict) else None
            if isinstance(owner_pid, int) and _pid_is_running(owner_pid):
                pids = [str(owner_pid)]
            else:
                pids = _find_service_pids(service)

        state = _get_service_state(service)
        if not pids:
            if state['ready']:
                service_pids[service] = True
                return jsonify({
                    'success': False,
                    'error': '检测到服务端口仍在监听，但无法确认所属进程，未执行终止',
                }), 409
            _reset_service_state(service, clear_owner=True)
            return jsonify({'success': True, 'message': '服务已停止'})

        command_failures = []
        for pid in pids:
            kill_result = subprocess.run(
                ['taskkill', '/F', '/T', '/PID', pid],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if kill_result.returncode != 0:
                output = (kill_result.stdout + kill_result.stderr).strip()
                command_failures.append(
                    f'PID {pid}: {output or f"返回码={kill_result.returncode}"}'
                )

        if _wait_for_service_stopped(service, pids):
            _reset_service_state(service, clear_owner=True)
            logger.info(f'{service} 服务已停止（核验 {len(pids)} 个进程树）')
            return jsonify({
                'success': True,
                'message': f'成功终止 {len(pids)} 个进程树',
            })

        service_pids[service] = True
        detail = '；'.join(command_failures) if command_failures else '进程或端口仍然存活'
        logger.error(f'停止 {service} 服务后核验失败：{detail}')
        return jsonify({
            'success': False,
            'error': f'停止失败：{detail}',
        }), 500
    except subprocess.TimeoutExpired as error:
        logger.error(f'停止 {service} 服务超时')
        service_pids[service] = _get_service_state(service)['started']
        return jsonify({
            'success': False,
            'error': f'停止服务超时：{error}',
        }), 504
    except Exception as e:
        logger.error(f'停止 {service} 服务失败：{str(e)}')
        service_pids[service] = _get_service_state(service)['started']
        return jsonify({
            'success': False,
            'error': f'停止服务时出错：{str(e)}',
        }), 500
