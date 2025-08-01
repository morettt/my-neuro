import subprocess
import sys
from pathlib import Path
import threading
import time

# 服务端配置列表
servers = [
    {
        "name": "ASR服务端",
        "command": "call conda activate my-neuro && python asr_api.py",
        "log_file": "logs/asr.log"
    },
    {
        "name": "TTS服务端",
        "command": "call conda activate my-neuro && python tts_launcher.py",
        "log_file": "logs/tts.log"
    },
    {
        "name": "bert服务端",
        "command": "call conda activate my-neuro && python omni_bert_api.py",
        "log_file": "logs/bert.log"
    }
]

def clear_log_file(log_path):
    '''清空日志文件'''
    try:
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write('')
        print(f"已清空日志文件: {log_path}")
    except Exception as e:
        print(f"清空日志文件 {log_path} 时出错: {str(e)}")
        return False
    return True

def tail_file(log_path, name):
    '''实时读取日志文件内容并输出到终端'''
    while True:
        try:
            with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                f.seek(0, 2)  # 移到文件末尾
                while True:
                    line = f.readline()
                    if not line:
                        time.sleep(0.1)  # 短暂休眠以降低 CPU 使用
                        continue
                    print(f"[{name}]: {line.strip()}")
        except FileNotFoundError:
            time.sleep(0.1)  # 文件可能尚未创建，等待重试
        except Exception as e:
            print(f"读取日志文件 {log_path} 时出错: {str(e)}")
            time.sleep(1)

def start_servers():
    '''启动服务端'''
    processes = []

    for server in servers:
        # 确保日志目录存在
        log_path = Path(server["log_file"])
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # 清空日志文件
        if not clear_log_file(log_path):
            cleanup(processes)
            sys.exit(1)

        print(f"正在启动 {server['name']}...")

        try:
            # 打开日志文件(追加模式)
            with open(log_path, 'a', encoding='utf-8') as log_file:
                # 启动进程，重定向输出到日志文件
                process = subprocess.Popen(
                    server["command"],
                    shell=True,
                    stdout=log_file,
                    stderr=subprocess.STDOUT,  # 将错误输出也重定向到日志
                    text=True,
                    bufsize=1
                )

                # 等待一会检查进程是否仍在运行
                try:
                    return_code = process.wait(timeout=5)
                    if return_code != 0:
                        print(f"错误: {server['name']} 启动失败，返回码: {return_code}")
                        print(f"请检查日志文件: {log_path}")
                        cleanup(processes)
                        sys.exit(1)
                except subprocess.TimeoutExpired:
                    # 如果运行正常
                    processes.append((server["name"], process))
                    print(f"{server['name']} 启动成功，日志输出到: {log_path}")
                    # 启动线程实时读取日志文件
                    threading.Thread(target=tail_file, args=(log_path, server["name"]), daemon=True).start()

        except Exception as e:
            print(f"启动 {server['name']} 时发生异常: {str(e)}")
            cleanup(processes)
            sys.exit(1)

    print("\n所有服务端已启动，按Ctrl+C停止...")

    try:
        # 主线程等待，直到被中断
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在停止所有服务端...")
        cleanup(processes)

def cleanup(processes):
    '''停止所有正在运行的服务端进程'''
    for name, process in processes:
        try:
            print(f"正在停止 {name}...")
            process.terminate()
            process.wait(timeout=5)
        except:
            try:
                process.kill()
            except:
                pass

if __name__ == "__main__":
    print("===== 服务端启动脚本 =====")
    start_servers()
