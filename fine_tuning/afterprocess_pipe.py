import os
import shutil
import argparse
import glob

script_dir = os.path.dirname(os.path.realpath(__file__))
parser = argparse.ArgumentParser(description="asr pipeline")
parser.add_argument("--name","-n",help="模型名称")

def move_latest_file(source_folder, destination_folder, name):

    if not os.path.exists(destination_folder):
        os.makedirs(destination_folder)

    files = [os.path.join(source_folder, f) for f in os.listdir(source_folder)
             if os.path.isfile(os.path.join(source_folder, f))]

    if not files:
        print(f"文件夹中没有文件: {source_folder}")
        return

    files.sort(key=lambda x: os.path.getctime(x))

    # 获取最新的文件
    latest_file = files[-1]
    destination_path = os.path.join(destination_folder, os.path.basename(latest_file))

    try:
        shutil.move(latest_file, destination_path)
        print(f"已移动文件: {latest_file} -> {destination_path}")
    except Exception as e:
        print(f"移动文件时出错: {e}")

    os.rename(destination_path, os.path.join(destination_folder, f"{name}.pth"))

name = vars(parser.parse_args())["name"]

def file_process(current_dir, name):
    parent_dir = os.path.dirname(current_dir)
    target_dir = os.path.join(parent_dir, "tts-studio", "tts-model", name)
    os.makedirs(target_dir, exist_ok=True)

    script_file = os.path.join(target_dir, "台本.txt")
    open(script_file, 'a').close()  # 创建空文件

    # 读取sliced.list的第一行并提取文本内容
    sliced_list_path = os.path.join(current_dir, "output", "asr", "sliced.list")
    with open(sliced_list_path, 'r', encoding='utf-8') as f:
        first_line = f.readline().strip()

    # 提取最后一部分文本内容
    text_content = first_line.split('|')[-1].strip()

    # 将文本写入台本.txt
    with open(script_file, 'w', encoding='utf-8') as f:
        f.write(text_content)

    # 移动参考音频
    sliced_dir = os.path.join(current_dir, "output", "sliced")
    wav_files = glob.glob(os.path.join(sliced_dir, '*.wav'))
    wav_files.sort(key=os.path.getctime)

    if wav_files:
        first_wav = wav_files[0]
        target_wav = os.path.join(target_dir, "01.wav")
        shutil.copy2(first_wav, target_wav)
        print(f"已复制文件: {first_wav} -> {target_wav}")
    else:
        print("在output/sliced目录中未找到.wav文件")

if __name__ == "__main__":
    source_dir = os.path.join(script_dir, "SoVITS_weights_v2")
    dest_dir = os.path.join(os.path.dirname(script_dir), "tts-studio/tts-model")

    move_latest_file(source_dir, dest_dir, name)
    file_process(script_dir, name)
