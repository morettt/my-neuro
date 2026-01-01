from audio_separator.separator import Separator
import os

music = ('wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac')

file_dir = r'待处理音频'

# 初始化分离器
separator = Separator(
    output_dir='./output',
    output_format='WAV',
    model_file_dir='./models'
)
print("正在加载人声分离模型...")
separator.load_model(model_filename='Kim_Vocal_1.onnx')

for file in os.listdir(file_dir):
    if file.endswith(music):
        # 跳过已经处理过的文件（带有-已分离标识）
        if '-已分离' in file:
            print(f'跳过已处理文件：{file}')
            continue

        # 检查文件是否存在
        filename = os.path.join(file_dir, file)
        print(f'音频文件有：{file}')
        print("正在分离音频...")

        # 动态生成文件名
        base_name = os.path.splitext(file)[0]

        custom_names = {
            "Vocals": f"{base_name}-Vocal",
            "Instrumental": f"{base_name}-Acc"
        }

        try:
            output_files = separator.separate(filename, custom_names)

            print("分离完成！")
            for output_file in output_files:
                print(f"输出文件: {output_file}")

            # 分离成功后，重命名原文件
            file_extension = os.path.splitext(file)[1]  # 获取文件扩展名
            new_filename = f"{base_name}-已分离{file_extension}"
            old_path = os.path.join(file_dir, file)
            new_path = os.path.join(file_dir, new_filename)

            os.rename(old_path, new_path)
            print(f"原文件已重命名为：{new_filename}")

        except Exception as e:
            print(f"处理文件 {file} 时出错：{str(e)}")
            print("跳过此文件，继续处理下一个...")

print("所有音频文件处理完成！")