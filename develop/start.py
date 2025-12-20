import subprocess
import sys
from threading import Thread
import time


def start_flask():
    subprocess.run([sys.executable, 'app.py'])


def start_npm():
    subprocess.run('npm start', shell=True)  # 改用 npm start


if __name__ == "__main__":
    # 启动 Flask
    flask_thread = Thread(target=start_flask)
    flask_thread.daemon = True
    flask_thread.start()

    # 等待 Flask 启动
    time.sleep(2)

    # 启动 npm
    start_npm()