#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
进程 CPU/内存采样(Windows ctypes,无 psutil 依赖)。
采样对象:WebUI 自身 + Live2D 桌宠进程(若在运行)。
Flask 进程内保留约 30 分钟环形缓冲(每 3 秒一次)。
采样失败不抛异常,仅标记 available=False,不影响服务启停。
"""

import ctypes
import os
import threading
import time
from collections import deque
from ctypes import wintypes

# 环形缓冲:3s 一次,600 点 ≈ 30 分钟
BUFFER_MAXLEN = 600
SAMPLE_INTERVAL_SEC = 3.0

_buffer = deque(maxlen=BUFFER_MAXLEN)
_lock = threading.Lock()
_started = False

# 上一次采样值(用于 CPU 差分):{pid: (kernel+user 100ns 计数, 采样时刻)}
_last_cpu = {}


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD),
                ("dwHighDateTime", wintypes.DWORD)]


def _filetime_to_int(ft):
    return (ft.dwHighDateTime << 32) | ft.dwLowDateTime


def _pid_alive(pid):
    if not pid or pid <= 0:
        return False
    try:
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    except Exception:
        return False


def _sample_pid(pid):
    """返回 {'cpu_percent': float, 'rss_mb': float},失败返回 None。"""
    if not _pid_alive(pid):
        return None
    try:
        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not handle:
            return None
        try:
            # 内存(WorkingSet)
            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD),
                            ("PageFaultCount", wintypes.DWORD),
                            ("PeakWorkingSetSize", ctypes.c_size_t),
                            ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t),
                            ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PROCESS_MEMORY_COUNTERS()
            pmc.cb = ctypes.sizeof(pmc)
            rss_mb = None
            if ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb):
                rss_mb = round(pmc.WorkingSetSize / (1024 * 1024), 1)

            # CPU:两次 GetProcessTimes 差分
            creation = _FILETIME(); exit_ = _FILETIME(); kernel = _FILETIME(); user = _FILETIME()
            cpu_percent = None
            if ctypes.windll.kernel32.GetProcessTimes(
                    handle, ctypes.byref(creation), ctypes.byref(exit_),
                    ctypes.byref(kernel), ctypes.byref(user)):
                proc_time = _filetime_to_int(kernel) + _filetime_to_int(user)  # 100ns 单位
                now = time.time()
                last = _last_cpu.get(pid)
                if last:
                    dproc = (proc_time - last[0]) / 10_000_000.0  # 秒
                    dt = now - last[1]
                    if dt > 0:
                        cores = os.cpu_count() or 1
                        cpu_percent = round(min(100.0, max(0.0, (dproc / dt) / cores * 100)), 1)
                _last_cpu[pid] = (proc_time, now)

            return {'cpu_percent': cpu_percent, 'rss_mb': rss_mb}
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    except Exception:
        return None


def _sample_loop():
    global _started
    while True:
        try:
            point = {'ts': int(time.time() * 1000)}

            # WebUI 自身
            webui = _sample_pid(os.getpid())
            if webui:
                point['webui'] = webui

            # Live2D 桌宠
            live2d = None
            try:
                from .utils import service_pids
                pid = service_pids.get('live2d')
                if isinstance(pid, int) and pid > 0:
                    live2d = _sample_pid(pid)
            except Exception:
                live2d = None
            point['live2d'] = live2d  # None = 桌宠未启动或采样失败

            with _lock:
                _buffer.append(point)
        except Exception:
            pass
        time.sleep(SAMPLE_INTERVAL_SEC)


def start_sampler():
    """启动后台采样线程(幂等)。"""
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_sample_loop, daemon=True, name='process-metrics-sampler')
    t.start()


def get_latest():
    """最新一个采样点;未采样到时返回 {'available': False}。"""
    with _lock:
        if not _buffer:
            return {'available': False}
        p = dict(_buffer[-1])
        p['available'] = True
        return p


def get_series(limit=200):
    """环形缓冲的时间序列(供 CPU/内存折线图)。"""
    with _lock:
        return list(_buffer)[-limit:]
