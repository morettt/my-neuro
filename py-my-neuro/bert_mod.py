import requests
import logging
import time
from typing import Optional

# Fixed: 添加日志配置
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Bert_panduan:
    """BERT情感判断类"""
    
    def __init__(self, max_retries: int = 3, timeout: int = 10):
        self.url = 'http://127.0.0.1:6007/classify'
        self.max_retries = max_retries
        self.timeout = timeout
        self.session = requests.Session()
        
        # 设置请求头
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'MyNeuro-BERT-Client/1.0'
        })

    def vl_bert(self, content: str) -> Optional[str]:
        """
        判断输入是否需要启动视觉
        
        Args:
            content: 输入文本内容
            
        Returns:
            str: 判断结果 ("是" 或 "否")，失败时返回 None
        """
        if not content or not content.strip():
            logger.warning("输入内容为空")
            return None
            
        para = {"text": content.strip()}
        
        for attempt in range(self.max_retries):
            try:
                logger.debug(f"发送BERT请求 (尝试 {attempt + 1}/{self.max_retries}): {content[:50]}...")
                
                response = self.session.post(
                    self.url, 
                    json=para, 
                    timeout=self.timeout
                )
                response.raise_for_status()
                
                dict_data = response.json()
                bert_output = dict_data.get('Vision', '否')
                
                logger.debug(f"BERT响应: {bert_output}")
                return bert_output
                
            except requests.exceptions.ConnectionError as e:
                logger.error(f"连接BERT服务失败 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)  # 等待1秒后重试
                continue
                
            except requests.exceptions.Timeout as e:
                logger.error(f"BERT请求超时 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                continue
                
            except requests.exceptions.RequestException as e:
                logger.error(f"BERT请求失败 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                continue
                
            except (KeyError, ValueError, TypeError) as e:
                logger.error(f"解析BERT响应失败: {e}")
                return None
                
            except Exception as e:
                logger.error(f"BERT处理未知错误: {e}")
                return None
        
        logger.error(f"BERT请求失败，已重试 {self.max_retries} 次")
        return None

    def check_service_health(self) -> bool:
        """
        检查BERT服务是否健康
        
        Returns:
            bool: 服务是否健康
        """
        try:
            health_url = 'http://127.0.0.1:6007/health'
            response = self.session.get(health_url, timeout=5)
            response.raise_for_status()
            
            health_data = response.json()
            is_healthy = health_data.get('status') == 'healthy'
            
            if is_healthy:
                logger.info("BERT服务健康检查通过")
            else:
                logger.warning("BERT服务健康检查失败")
                
            return is_healthy
            
        except Exception as e:
            logger.error(f"BERT服务健康检查失败: {e}")
            return False

    def close(self):
        """关闭会话"""
        if self.session:
            self.session.close()

if __name__ == '__main__':
    # 测试代码
    bert = Bert_panduan()
    
    # 检查服务健康状态
    if bert.check_service_health():
        # 测试情感判断
        test_texts = [
            "我好无聊啊",
            "今天天气真不错",
            "我想看看外面的风景",
            "帮我打开浏览器"
        ]
        
        for text in test_texts:
            result = bert.vl_bert(text)
            print(f"输入: {text}")
            print(f"结果: {result}")
            print("-" * 30)
    else:
        print("BERT服务不可用，请检查服务是否启动")
    
    bert.close()