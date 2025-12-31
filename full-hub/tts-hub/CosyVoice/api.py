import requests
import os
from pydub import AudioSegment
import io
import shutil
import tempfile
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
import uvicorn
import argparse
import subprocess
import time
import sys
import signal
from multiprocessing import Process
import atexit


"""
CosyVoice整合适配程序
参数只有一个 -r，参考音频路径
"""


current_path = os.path.dirname(os.path.realpath(__file__))
print("当前路径:", current_path)

app = FastAPI()

# 存储子进程对象
port_process = None


def start_port_server(port_args=None):
    """启动CosyVoice服务器"""
    global port_process

    port_script = os.path.join(current_path, "port.py")

    if not os.path.exists(port_script):
        print(f"错误: 未找到 port.py 文件: {port_script}")
        return None

    # 构建命令行参数
    cmd = [sys.executable, port_script]

    # 添加额外的参数
    if port_args:
        cmd.extend(port_args)

    print(f"启动CosyVoice服务器: {' '.join(cmd)}")

    # 启动子进程
    port_process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    # 启动一个线程来读取输出
    def read_output(proc, label):
        for line in proc.stdout:
            print(f"[port.py {label}] {line}", end='')
        for line in proc.stderr:
            print(f"[port.py {label} ERROR] {line}", end='')

    # 启动输出读取线程
    import threading
    stdout_thread = threading.Thread(target=read_output, args=(port_process, "stdout"))
    stderr_thread = threading.Thread(target=read_output, args=(port_process, "stderr"))
    stdout_thread.daemon = True
    stderr_thread.daemon = True
    stdout_thread.start()
    stderr_thread.start()

    # 等待服务器启动
    time.sleep(5)

    # 检查进程是否还在运行
    if port_process.poll() is not None:
        print("错误: CosyVoice服务器启动失败")
        return None

    print("CosyVoice服务器启动成功")
    return port_process


def stop_port_server():
    """停止CosyVoice服务器"""
    global port_process

    if port_process:
        print("停止CosyVoice服务器...")
        try:
            # 发送 SIGTERM 信号
            port_process.terminate()

            # 等待进程结束
            try:
                port_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # 如果进程没有正常结束，强制终止
                print("进程未正常结束，强制终止...")
                port_process.kill()
                port_process.wait()

            print("CosyVoice服务器已停止")
        except Exception as e:
            print(f"停止CosyVoice服务器时出错: {e}")
        finally:
            port_process = None


def clear_folder_contents(folder_path):
    """清空文件夹内容"""
    try:
        if not os.path.exists(folder_path):
            os.makedirs(folder_path, exist_ok=True)
            print(f"文件夹不存在，已创建: {folder_path}")
            return

        for filename in os.listdir(folder_path):
            file_path = os.path.join(folder_path, filename)
            try:
                if os.path.isfile(file_path) or os.path.islink(file_path):
                    os.unlink(file_path)
                elif os.path.isdir(file_path):
                    shutil.rmtree(file_path)
            except Exception as e:
                if "另一个程序正在使用此文件" not in str(e):
                    print(f"删除 {file_path} 时出错: {e}")
    except Exception as e:
        print(f"清空文件夹时出错: {e}")


def get_audio(path):
    """获取文件夹中的第一个 .wav 文件"""
    for filename in os.listdir(path):
        if filename.endswith(".wav"):
            return os.path.join(path, filename)
    return None


@app.post("/")
async def tts_endpoint(request: dict):
    text = request.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="请求中必须包含 'text' 字段")


    # 清空临时文件夹
    tmp_folder = os.path.join(current_path, "tmp")
    clear_folder_contents(tmp_folder)

    # 构建发送到 TTS 服务的参数
    data = {
        "text": text,
        "reference_audio": args.reference_audio
    }

    try:
        # 调用本地 TTS 服务
        response = requests.post(
            'http://127.0.0.1:9233/clone',
            data=data,
            timeout=3600
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"调用 TTS 服务失败: {e}")

    # 获取生成的音频文件
    audio_path = get_audio(tmp_folder)
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=500, detail="音频生成失败或未找到")

    try:
        # 读取音频文件并转换为二进制
        audio = AudioSegment.from_file(audio_path)
        audio_bytes = io.BytesIO()
        audio.export(audio_bytes, format="wav")
        audio_bytes.seek(0)

        # 返回音频数据
        return Response(
            content=audio_bytes.read(),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=output.wav"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"音频处理失败: {e}")


@app.on_event("startup")
async def startup_event():
    """应用启动时运行"""
    print("应用启动，检查并启动CosyVoice服务器...")

    # 检查是否已经有一个CosyVoice在运行
    try:
        response = requests.get('http://127.0.0.1:9233/tts', params={'text': 'test'}, timeout=2)
        if response.status_code < 500:
            print("检测到Cosyvoice服务器已在运行")
            return
    except:
        pass

    # 启动新的CosyVoice服务器
    start_port_server()


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时运行"""
    print("应用关闭，停止CosyVoice服务器...")
    stop_port_server()


def signal_handler(signum, frame):
    """信号处理函数"""
    print(f"接收到信号 {signum}，正在关闭...")
    stop_port_server()
    sys.exit(0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("-r", "--reference_audio", required=True, help="参考音频文件路径")
    parser.add_argument("--port-args", nargs="*",
                        help="传递给 port.py 的额外参数，例如：--port-args --host 0.0.0.0 --port 9233")
    args = parser.parse_args()

    if not os.path.exists(args.reference_audio):
        print(f"错误: 参考音频文件不存在: {args.reference_audio}")
        exit(1)

    print(f"使用参考音频: {args.reference_audio}")

    # 注册信号处理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # 注册退出时的清理函数
    atexit.register(stop_port_server)

    print("启动 CosyVoice TTS 服务")
    print(f"转发器服务地址: http://0.0.0.0:5000")
    print(f"CosyVoice服务地址: http://127.0.0.1:9233")

    uvicorn.run(app, host="0.0.0.0", port=5000)