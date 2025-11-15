from openai import OpenAI
from datetime import datetime
import json
import inspect
import requests
import base64
from PIL import ImageGrab
import io

API_KEY = 'sk-zk231afdd49ac82b15607ce790bb887264a68d1b3698612a'
API_URL = 'https://api.zhizengzeng.com/v1'
model = 'gemini-2.0-flash'
messages = [
    {'role': 'system', 'content': '你是一个可爱聪明的AI'}
]

client = OpenAI(api_key=API_KEY, base_url=API_URL)


# 定义工具函数
def get_current_time():
    """获取当前时间"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_acg_pic(device="wap"):
    """
    获取随机ACG图片
    device: "pc" 或 "wap"
    """
    url = f"https://v2.xxapi.cn/api/randomAcgPic?type={device}"
    try:
        response = requests.get(url).json()
        return response['data']
    except Exception as e:
        return f"获取图片失败: {str(e)}"


def take_screenshot():
    """截取当前屏幕并返回图片用于AI分析"""
    try:
        screenshot = ImageGrab.grab()
        buffered = io.BytesIO()
        screenshot.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode()
        return img_base64
    except Exception as e:
        return f"截图失败: {str(e)}"


FUNCTIONS = {
    'get_current_time': get_current_time,
    'get_acg_pic': get_acg_pic,
    'take_screenshot': take_screenshot
}

tools = []

for name, func in FUNCTIONS.items():
    sig = inspect.signature(func)
    properties = {}
    required = []

    for param_name, param in sig.parameters.items():
        properties[param_name] = {
            "type": "string",
            "description": param_name
        }
        if param.default == inspect.Parameter.empty:
            required.append(param_name)

    tool = {
        "type": "function",
        "function": {
            "name": name,
            "description": func.__doc__ or "无描述",
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required
            }
        }
    }
    tools.append(tool)


def get_requests():
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools
    )
    return response


def accept_chat(response):
    message = response.choices[0].message

    if message.tool_calls:
        messages.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": message.tool_calls
        })

        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            print(f'ai想要用：{function_name}')

            if tool_call.function.arguments:
                argus = json.loads(tool_call.function.arguments)
                print(f'参数：{argus}')
                result = FUNCTIONS[function_name](**argus)
            else:
                result = FUNCTIONS[function_name]()

            # 特殊处理截图结果 - 将图片发送给AI识别
            if function_name == 'take_screenshot' and not result.startswith("截图失败"):
                print(f'截图成功，正在让AI分析图片内容...')

                # 1. 先返回tool结果(必须是字符串)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": function_name,
                    "content": "截图已完成"
                })

                # 2. 再作为user发送图片给AI分析
                messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "当前电脑屏幕内容:"
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{result}"
                            }
                        }
                    ]
                })
            else:
                # 普通工具调用结果
                print(f'结果：{result}')
                messages.append({
                    "role": "tool",
                    "content": f'结果：{result}',
                    "tool_call_id": tool_call.id,
                    "name": function_name
                })

        # 让AI继续处理工具调用的结果
        ai_response = get_requests()
        ai_tool_content = ai_response.choices[0].message.content
        print(f'AI：{ai_tool_content}')
        return ai_tool_content

    content = message.content
    print(f'AI：{content}')
    return content


def add_message(role, content):
    messages.append({
        'role': role,
        'content': content
    })


def chat():
    user = input('你：')
    add_message('user', user)
    response = get_requests()
    ai_content = accept_chat(response)
    add_message('assistant', ai_content)


def main():
    while True:
        chat()


if __name__ == '__main__':
    main()