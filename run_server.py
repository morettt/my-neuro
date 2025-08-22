"""
参数填写说明
-a 需要开启的服务端，字符串形式的0~3，对应关系如下：
    '0':ASR
    '1':TTS
    '2':bert
    '3':RAG
可以填写一个或多个，如：'0'为开启ASR服务端，'02'为开启ASR和bert服务端
"""
import subprocess
import sys
from pathlib import Path
import threading
import time
import os
import argparse
import logging
import signal
import atexit

# Fixed: 添加日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/server.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def parse_arguments():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="run server")
    parser.add_argument("--api", "-a", help="需要启动的服务端", default="012")
    return parser.parse_args()

# 参考音频文本
tts_default_text = "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday."
tts_Language = 'en' #默认英语（en）中文（zh）日语（ja）

# 服务端配置列表
servers = [
    {
        "name": "ASR服务端",
        "command": "call conda activate my-neuro && python asr_api.py",
        "log_file": "logs/asr.log",
        "port": 1000
    },
    {
        "name": "TTS服务端",
        "command": f'call conda activate my-neuro && cd tts-studio && python move_nltk.py && python tts_api.py -p 5000 -s tts-model/merge.pth -dr tts-model/neuro/01.wav -dt "{tts_default_text}" -dl "{tts_Language}"',
        "log_file": "logs/tts.log",
        "port": 5000
    },
    {
        "name": "bert服务端",
        "command": "call conda activate my-neuro && python omni_bert_api.py",
        "log_file": "logs/bert.log",
        "port": 6007
    },
    {
        "name":"RAG服务端",
        "command": "call conda activate my-neuro && python run_rag.py",
        "log_file": "logs/rag.log",
        "port": 8002
    }
]

def get_server_chosen(api_string):
    """根据API字符串选择要启动的服务"""
    server_chosen = []
    try:
        for i in range(4):
            if str(i) in api_string:
                server_chosen.append(servers[i])
        logger.info(f"选择启动的服务: {[s['name'] for s in server_chosen]}")
        return server_chosen
    except Exception as e:
        logger.error(f"解析服务选择参数失败: {e}")
        return []

def clear_log_file(log_path):
    '''清空日志文件'''
    try:
        log_path = Path(log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write('')
        logger.info(f"已清空日志文件: {log_path}")
        return True
    except Exception as e:
        logger.error(f"清空日志文件 {log_path} 时出错: {str(e)}")
        return False

def tail_file(log_path, name):
    '''实时读取日志文件内容并输出到终端'''
    log_path = Path(log_path)
    
    while True:
        try:
            if not log_path.exists():
                time.sleep(0.1)
                continue
                
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
            logger.error(f"读取日志文件 {log_path} 时出错: {str(e)}")
            time.sleep(1)

def check_port_available(port):
    """检查端口是否可用"""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('localhost', port))
            return True
    except OSError:
        return False

def wait_for_service_start(port, service_name, timeout=30):
    """等待服务启动"""
    import socket
    import time
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(('localhost', port))
                if result == 0:
                    logger.info(f"{service_name} 启动成功，端口 {port} 可用")
                    return True
        except Exception:
            pass
        time.sleep(1)
    
    logger.warning(f"{service_name} 启动超时，端口 {port} 可能不可用")
    return False

def start_servers():
    '''启动服务端'''
    processes = []
    
    # 注册清理函数
    def cleanup_on_exit():
        cleanup(processes)
    
    atexit.register(cleanup_on_exit)
    
    # 设置信号处理
    def signal_handler(signum, frame):
        logger.info(f"收到信号 {signum}，正在停止所有服务...")
        cleanup(processes)
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    for server in server_chosen:
        # 确保日志目录存在
        log_path = Path(server["log_file"])
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # 清空日志文件
        if not clear_log_file(log_path):
            cleanup(processes)
            sys.exit(1)

        logger.info(f"正在启动 {server['name']}...")

        try:
            # 检查端口是否被占用
            if not check_port_available(server["port"]):
                logger.warning(f"端口 {server['port']} 已被占用，{server['name']} 可能无法正常启动")

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
                        logger.error(f"错误: {server['name']} 启动失败，返回码: {return_code}")
                        logger.error(f"请检查日志文件: {log_path}")
                        cleanup(processes)
                        sys.exit(1)
                except subprocess.TimeoutExpired:
                    # 如果运行正常
                    processes.append((server["name"], process, server["port"]))
                    logger.info(f"{server['name']} 启动成功，日志输出到: {log_path}")
                    
                    # 启动线程实时读取日志文件
                    threading.Thread(target=tail_file, args=(log_path, server["name"]), daemon=True).start()
                    
                    # 等待服务启动
                    if not wait_for_service_start(server["port"], server["name"]):
                        logger.warning(f"{server['name']} 可能未完全启动")

        except Exception as e:
            logger.error(f"启动 {server['name']} 时发生异常: {str(e)}")
            cleanup(processes)
            sys.exit(1)

    logger.info("\n所有服务端已启动，按Ctrl+C停止...")

    try:
        # 主线程等待，直到被中断
        while True:
            time.sleep(1)
            # 检查所有进程是否还在运行
            for name, process, port in processes:
                if process.poll() is not None:
                    logger.error(f"{name} 进程意外退出，返回码: {process.returncode}")
                    cleanup(processes)
                    sys.exit(1)
    except KeyboardInterrupt:
        logger.info("\n正在停止所有服务端...")
        cleanup(processes)

def cleanup(processes):
    '''停止所有正在运行的服务端进程'''
    for name, process, port in processes:
        try:
            logger.info(f"正在停止 {name}...")
            process.terminate()
            
            # 等待进程结束
            try:
                process.wait(timeout=5)
                logger.info(f"{name} 已正常停止")
            except subprocess.TimeoutExpired:
                logger.warning(f"{name} 未在5秒内停止，强制终止")
                process.kill()
                process.wait()
        except Exception as e:
            logger.error(f"停止 {name} 时出错: {e}")

def main():
    """主函数"""
    try:
        logger.info("===== 服务端启动脚本 =====")
        
        # 解析参数
        args = parse_arguments()
        api_string = args.api
        
        if not api_string:
            logger.error("请指定要启动的服务，使用 -a 参数")
            sys.exit(1)
        
        # 获取要启动的服务
        global server_chosen
        server_chosen = get_server_chosen(api_string)
        
        if not server_chosen:
            logger.error("未选择任何服务启动")
            sys.exit(1)
        
        # 启动服务
        start_servers()
        
    except Exception as e:
        logger.error(f"启动脚本时发生错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
