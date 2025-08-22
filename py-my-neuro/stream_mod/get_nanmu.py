import requests
import json
import time
import os
from typing import Optional

# Fixed: 使用环境变量或配置文件获取API密钥
def get_api_key() -> str:
    """获取API密钥，优先从环境变量获取，否则从配置文件获取"""
    # 首先尝试从环境变量获取
    api_key = os.environ.get('NANMU_API_KEY')
    if api_key:
        return api_key
    
    # 如果环境变量没有，尝试从配置文件获取
    try:
        from config_mod.load_config import load_config
        config = load_config()
        return config.get('nanmu_api', {}).get('api_key', '')
    except ImportError:
        return ''
    
    # 如果都没有，返回空字符串
    return ''

# 使用函数获取API密钥
API_KEY = get_api_key()

if not API_KEY:
    print("警告: 未设置NANMU_API_KEY环境变量或配置文件中没有API密钥")
    print("请设置环境变量 NANMU_API_KEY 或在配置文件中添加 nanmu_api.api_key")

class NanmuAPI:
    """南木API客户端"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or API_KEY
        if not self.api_key:
            raise ValueError("API密钥未设置")
        
        self.base_url = "https://api.nanmu.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def chat(self, message: str, model: str = "gpt-3.5-turbo") -> Optional[str]:
        """
        发送聊天请求
        
        Args:
            message: 用户消息
            model: 模型名称
            
        Returns:
            str: AI回复，失败时返回None
        """
        try:
            data = {
                "model": model,
                "messages": [
                    {"role": "user", "content": message}
                ],
                "max_tokens": 1000,
                "temperature": 0.7
            }
            
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=data,
                timeout=30
            )
            
            response.raise_for_status()
            result = response.json()
            
            return result['choices'][0]['message']['content']
            
        except requests.exceptions.RequestException as e:
            print(f"API请求失败: {e}")
            return None
        except (KeyError, ValueError) as e:
            print(f"解析响应失败: {e}")
            return None
        except Exception as e:
            print(f"未知错误: {e}")
            return None

def main():
    """主函数"""
    if not API_KEY:
        print("错误: 请先设置API密钥")
        return
    
    api = NanmuAPI()
    
    print("南木API测试")
    print("输入 'quit' 退出")
    
    while True:
        try:
            user_input = input("你: ").strip()
            if user_input.lower() == 'quit':
                break
                
            if not user_input:
                continue
                
            response = api.chat(user_input)
            if response:
                print(f"AI: {response}")
            else:
                print("AI: 抱歉，我无法回复，请检查API配置")
                
        except KeyboardInterrupt:
            print("\n再见!")
            break
        except Exception as e:
            print(f"错误: {e}")

if __name__ == "__main__":
    main()