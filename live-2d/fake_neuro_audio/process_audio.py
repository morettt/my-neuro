import requests
import urllib3
import os

# 个人API KEY 和url 这些后面再搞。先搞一个这种代码用着先。


class Audio:
    def __init__(self):
        self.files = os.listdir('./Reference_audio')


    def get_audio_id(self,role_name,reference_text,role_wav):
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        url = "https://api.siliconflow.cn/v1/uploads/audio/voice"
        headers = {
            "Authorization": 'Bearer sk-ygfgglbawrcgwriteqrqtvymyavuvllfvadaziovizhigruo'
        }
        files = {
            "file": open(role_wav, "rb")
        }

        data = {
            "model": "FunAudioLLM/CosyVoice2-0.5B",
            "customName": role_name,
            "text": reference_text
        }

        response = requests.post(url, headers=headers, files=files, data=data, verify=False, timeout=60)
        audio_id = response.json()
        real = audio_id['uri']
        return real


    def get_audio_file(self):
        print('检索到文件夹中有这几个音频文件。请问想上传哪一个?')

        for index,file in enumerate(self.files,start=1):
            print(f'{index}.{file}')

        choice = int(input('请输入数字：'))


        return self.files[choice-1]



    def process(self):

        print('请将想要上传的音频文件放入：Reference_audio 文件夹中')
        print('当前Reference_audio文件夹中已经有了一个示例音频文件：肥牛.wav\n')

        audio_file = self.get_audio_file()

        role_name = input('请给你的声音模型取一个名字(必须用英语)：')
        reference_audio = os.path.join('Reference_audio',audio_file)


        reference_text = input('请输入你参考音频里面的文本内容：')
        audio_id = self.get_audio_id(role_name,reference_text,reference_audio)
        print(f'你的{role_name}声音模型ID为：{audio_id}')

if __name__ == '__main__':
    audio = Audio()
    audio.process()