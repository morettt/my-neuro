import subprocess
import sys
from threading import Thread
import time


def start_npm():
    subprocess.run('npm start', shell=True)  # 改用 npm start


if __name__ == "__main__":
    # 启动 npm
    start_npm()