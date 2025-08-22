"""
My-Neuro 错误处理工具
统一处理项目中的各种错误和异常
"""

import logging
import traceback
import sys
import os
from datetime import datetime
from typing import Optional, Callable, Any
from pathlib import Path

class MyNeuroError(Exception):
    """My-Neuro 自定义异常基类"""
    def __init__(self, message: str, error_code: str = None, details: dict = None):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        self.timestamp = datetime.now()

class ModelLoadError(MyNeuroError):
    """模型加载错误"""
    pass

class ServiceStartError(MyNeuroError):
    """服务启动错误"""
    pass

class ConfigError(MyNeuroError):
    """配置错误"""
    pass

class NetworkError(MyNeuroError):
    """网络错误"""
    pass

class FileError(MyNeuroError):
    """文件操作错误"""
    pass

class ErrorHandler:
    """错误处理器"""
    
    def __init__(self, log_file: str = "logs/errors.log"):
        self.log_file = log_file
        self.setup_logging()
        
    def setup_logging(self):
        """设置日志"""
        log_path = Path(self.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        logging.basicConfig(
            level=logging.ERROR,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_path, encoding='utf-8'),
                logging.StreamHandler(sys.stderr)
            ]
        )
        self.logger = logging.getLogger('MyNeuroError')
    
    def handle_exception(self, exception: Exception, context: str = "", 
                        recover_func: Optional[Callable] = None) -> bool:
        """
        处理异常
        
        Args:
            exception: 异常对象
            context: 异常发生的上下文
            recover_func: 恢复函数
            
        Returns:
            bool: 是否成功恢复
        """
        try:
            # 记录异常信息
            error_info = {
                'type': type(exception).__name__,
                'message': str(exception),
                'context': context,
                'timestamp': datetime.now().isoformat(),
                'traceback': traceback.format_exc()
            }
            
            self.logger.error(f"异常发生: {error_info}")
            
            # 尝试恢复
            if recover_func:
                try:
                    result = recover_func()
                    if result:
                        self.logger.info(f"异常已恢复: {context}")
                        return True
                except Exception as recover_error:
                    self.logger.error(f"恢复失败: {recover_error}")
            
            return False
            
        except Exception as e:
            self.logger.error(f"错误处理过程中发生异常: {e}")
            return False
    
    def safe_execute(self, func: Callable, *args, **kwargs) -> tuple[Any, bool]:
        """
        安全执行函数
        
        Args:
            func: 要执行的函数
            *args: 函数参数
            **kwargs: 函数关键字参数
            
        Returns:
            tuple: (结果, 是否成功)
        """
        try:
            result = func(*args, **kwargs)
            return result, True
        except Exception as e:
            self.handle_exception(e, f"执行函数 {func.__name__}")
            return None, False
    
    def check_system_requirements(self) -> dict:
        """
        检查系统要求
        
        Returns:
            dict: 检查结果
        """
        results = {
            'python_version': False,
            'cuda_available': False,
            'gpu_memory': 0,
            'disk_space': 0,
            'ram': 0
        }
        
        try:
            # 检查Python版本
            if sys.version_info >= (3, 11):
                results['python_version'] = True
            
            # 检查CUDA
            try:
                import torch
                results['cuda_available'] = torch.cuda.is_available()
                if results['cuda_available']:
                    results['gpu_memory'] = torch.cuda.get_device_properties(0).total_memory / 1024**3
            except ImportError:
                pass
            
            # 检查磁盘空间
            try:
                import shutil
                total, used, free = shutil.disk_usage('.')
                results['disk_space'] = free / 1024**3
            except:
                pass
            
            # 检查内存
            try:
                import psutil
                results['ram'] = psutil.virtual_memory().total / 1024**3
            except ImportError:
                pass
                
        except Exception as e:
            self.handle_exception(e, "系统要求检查")
        
        return results
    
    def validate_config(self, config: dict) -> list:
        """
        验证配置
        
        Args:
            config: 配置字典
            
        Returns:
            list: 错误列表
        """
        errors = []
        
        try:
            # 检查必需的配置项
            required_keys = ['api', 'ui', 'context', 'inputs', 'features']
            for key in required_keys:
                if key not in config:
                    errors.append(f"缺少必需的配置项: {key}")
            
            # 检查API配置
            if 'api' in config:
                api_config = config['api']
                if 'api_key' not in api_config or not api_config['api_key']:
                    errors.append("API密钥未配置")
                if 'api_url' not in api_config or not api_config['api_url']:
                    errors.append("API地址未配置")
            
            # 检查端口配置
            ports = [1000, 5000, 6007, 8002]
            for port in ports:
                if not self.is_port_available(port):
                    errors.append(f"端口 {port} 已被占用")
                    
        except Exception as e:
            self.handle_exception(e, "配置验证")
            errors.append(f"配置验证失败: {e}")
        
        return errors
    
    def is_port_available(self, port: int) -> bool:
        """
        检查端口是否可用
        
        Args:
            port: 端口号
            
        Returns:
            bool: 端口是否可用
        """
        try:
            import socket
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return True
        except OSError:
            return False
    
    def cleanup_resources(self):
        """清理资源"""
        try:
            # 清理临时文件
            temp_files = [
                'temp_audio.wav',
                'temp_image.png',
                'temp_log.txt'
            ]
            
            for file in temp_files:
                if os.path.exists(file):
                    os.remove(file)
                    
            self.logger.info("资源清理完成")
            
        except Exception as e:
            self.handle_exception(e, "资源清理")

# 全局错误处理器实例
error_handler = ErrorHandler()

def handle_error(func: Callable) -> Callable:
    """
    错误处理装饰器
    
    Args:
        func: 要装饰的函数
        
    Returns:
        Callable: 装饰后的函数
    """
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            error_handler.handle_exception(e, f"函数 {func.__name__}")
            raise
    return wrapper

def safe_import(module_name: str, package_name: str = None) -> Optional[Any]:
    """
    安全导入模块
    
    Args:
        module_name: 模块名
        package_name: 包名
        
    Returns:
        Optional[Any]: 导入的模块或None
    """
    try:
        if package_name:
            return __import__(package_name, fromlist=[module_name])
        else:
            return __import__(module_name)
    except ImportError as e:
        error_handler.handle_exception(e, f"导入模块 {module_name}")
        return None

if __name__ == "__main__":
    # 测试错误处理器
    handler = ErrorHandler()
    
    # 测试系统要求检查
    print("系统要求检查:")
    requirements = handler.check_system_requirements()
    for key, value in requirements.items():
        print(f"  {key}: {value}")
    
    # 测试配置验证
    print("\n配置验证:")
    test_config = {
        'api': {
            'api_key': 'test_key',
            'api_url': 'http://test.com'
        }
    }
    errors = handler.validate_config(test_config)
    if errors:
        for error in errors:
            print(f"  {error}")
    else:
        print("  配置验证通过")
    
    # 测试端口检查
    print("\n端口检查:")
    ports = [1000, 5000, 6007, 8002]
    for port in ports:
        available = handler.is_port_available(port)
        print(f"  端口 {port}: {'可用' if available else '被占用'}")