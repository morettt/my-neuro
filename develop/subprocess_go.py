import subprocess
import time
import os
from threading import Thread


def tail_log_file():
    """实时读取日志文件"""
    log_file = "runtime.log"

    # 如果文件存在，先清空
    if os.path.exists(log_file):
        open(log_file, 'w').close()

    # 等待文件创建
    while not os.path.exists(log_file):
        time.sleep(0.1)

    with open(log_file, 'r', encoding='utf-8') as f:
        f.seek(0, 2)  # 移到文件末尾
        while True:
            line = f.readline()
            if line:
                print(line.strip())
            else:
                time.sleep(0.1)


# 启动日志监控
log_thread = Thread(target=tail_log_file, daemon=True)
log_thread.start()

# 启动应用
subprocess.run('go.bat', shell=True)