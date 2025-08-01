import config
import subprocess
import sys
from pathlib import Path


def main():
    try:
        print("正在准备TTS模型配置...\n")

        # 1. 从config.py读取配置
        print("正在从config.py读取配置...")
        tts = config.tts_model
        model_path = tts["path"]
        ref_audio = tts["ref_audio"]
        ref_text = tts["ref_text"]
        ref_language = tts["ref_language"]

        # 2. 检查配置有效性
        if not all([model_path, ref_audio, ref_text, ref_language]):
            raise ValueError("无法从config.py读取完整的tts_model配置")

        # 3. 读取参考文本内容
        try:
            with open(ref_text, 'r', encoding='utf-8') as f:
                dt_param = f.read().strip()
        except Exception as e:
            raise ValueError(f"无法读取参考文本文件 {ref_text}: {str(e)}")

        # 4. 显示配置信息
        print("配置读取成功：")
        print(f"模型路径: {model_path}")
        print(f"参考音频: {ref_audio}")
        print(f"参考文本: {dt_param}")
        print(f"参考语言: {ref_language}\n")

        # 5. 运行TTS API
        print("正在启动TTS API...")
        cmd = [
            "python", "tts_api.py",
            "-s", model_path,
            "-dr", ref_audio,
            "-dt", dt_param,
            "-dl", ref_language,
            "-p", "5000"
        ]

        subprocess.run(cmd, check=True)

    except Exception as e:
        print(f"错误: {str(e)}")
        input("按任意键退出...")
        sys.exit(1)


if __name__ == "__main__":
    main()