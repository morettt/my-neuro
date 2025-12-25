import os
import json
from openai import OpenAI


class SetLive:

    def __init__(self):
        self.get_path = '2D'

    def load_config(self, file):
        """
        获取皮套里面的json数据
        """
        with open(file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data

    def get_file(self, path):
        """
        获取文件夹下面的所有文件
        """
        print('检索到这些文件：')
        for item in os.listdir(path):
            print(item)

    def get_model3_file(self, role_path):
        """获取.model3.json文件"""
        for item in os.listdir(role_path):
            if item.endswith('.model3.json'):
                print(f'找到模型文件：{item}')
                return item
        print('当前皮套文件中没有.model3.json文件')
        return None

    def get_motions_folder(self, role_path):
        """获取motions文件夹下的文件"""
        motions_path = os.path.join(role_path, 'motions')
        if os.path.exists(motions_path):
            print('\n检索motions文件夹：')
            self.get_file(motions_path)
        else:
            print('当前皮套文件中没有motions文件夹')

    def get_live2d_name(self):
        """
        输入皮套名字获取新内容
        """
        role_name = input('请输入你想加载的皮套名字：')
        return role_name

    def get_model3_data(self):
        """
        获取皮套的核心配置文件内容
        """
        # 获取2D文件夹下面的所有文件信息
        self.get_file(self.get_path)
        # 输入2D文件夹下检索到的具体皮套名字
        role_name = self.get_live2d_name()

        data = os.path.join(self.get_path, role_name)
        model3_data = self.get_model3_file(data)  # 获取.model3.json文件

        # 拼接完整路径
        model3_full_path = os.path.join(data, model3_data)
        live2d_data = self.load_config(model3_full_path)
        print(live2d_data)
        return live2d_data


class ProcessAI(SetLive):

    def __init__(self):
        super().__init__()  # 调用父类的__init__
        API_URL = 'https://api.zhizengzeng.com/v1'
        API_KEY = 'sk-zk2674bb5f711d1a4662fc39a7cbc667f7f68589244066da'
        self.model = 'gemini-2.0-flash'

        self.client = OpenAI(api_key=API_KEY, base_url=API_URL)

        self.messages = [{
            'role': 'system',
            'content': '你需要评估当前的json文件里面的Motions标签下是否有Idle和TapBody子标签。如果没有你需要添加上这两个标签。然后给我修改后的完整的json文件。不要说如何多余的内容。如果已经有了就请回复：已有。'
        }]

    def get_requests(self):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=self.messages,
            stream=True
        )
        return response

    def add_message(self, role, content):
        self.messages.append({
            'role': role,
            'content': content
        })

    def accept_chat(self, response):
        print('AI：', end='')
        full_assistant = ''

        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content is not None:
                ai_response = chunk.choices[0].delta.content
                print(ai_response, end='')

                full_assistant += ai_response

        print()
        return full_assistant

    def star_chat(self, live2d_data):
        self.add_message('user', live2d_data)
        response = self.get_requests()
        ai_response = self.accept_chat(response)
        self.add_message('assistant', ai_response)

    def start_process(self):
        # 直接调用父类的方法获取数据
        live2d_data = self.get_model3_data()
        # 然后开始AI处理
        self.star_chat(str(live2d_data))

# 使用
process_ai = ProcessAI()
process_ai.start_process()