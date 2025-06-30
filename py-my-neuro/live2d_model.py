"""
Live2D模型控制器 - 负责显示和控制Live2D模型
"""

import os
import sys
import time
import win32gui
import win32con
import OpenGL.GL as gl
import logging
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QCursor, QSurfaceFormat
from PyQt5.QtWidgets import QOpenGLWidget, QApplication
from PyQt5.QtGui import QGuiApplication

import live2d.v3 as live2d
from live2d.v3 import StandardParams
from live2d.utils.lipsync import WavHandler
import numpy as np

logger = logging.getLogger("live2d_model")

class Live2DModel(QOpenGLWidget):
    """Live2D模型控制器类，继承自QOpenGLWidget"""

    def __init__(self, config=None, event_bus=None):
        """初始化Live2D模型控制器
        
        Args:
            config: 配置信息
            event_bus: 事件总线
        """
        super().__init__()
        
        # 保存配置和事件总线
        self.config = config or {}
        self.event_bus = event_bus
        
        # 从配置获取模型路径和设置
        self.model_path = self.config.get("model_path", "")
        self.model_scale = self.config.get("ui", {}).get("model_scale", 1.0)
        
        # 窗口初始化设置
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint | 
            Qt.WindowType.Tool | 
            Qt.WindowType.WindowStaysOnTopHint
        )  # 无边框窗口，任务栏不显示图标，永远置顶
        self.setAttribute(Qt.WA_TranslucentBackground, True)  # 透明背景
        
        # 设置分层窗口和初始穿透属性
        self.hwnd = int(self.winId())
        win32gui.SetWindowLong(
            self.hwnd,
            win32con.GWL_EXSTYLE,
            win32gui.GetWindowLong(self.hwnd, win32con.GWL_EXSTYLE) | 
            win32con.WS_EX_LAYERED | 
            win32con.WS_EX_TRANSPARENT
        )
        win32gui.SetLayeredWindowAttributes(self.hwnd, 0, 255, win32con.LWA_ALPHA)
        
        # 模型位置偏移量
        self.model_offset_x = 0
        self.model_offset_y = 0
        self.drag_mode = 0  # 0为移动窗口模型，1为移动模型模式
        
        # 窗口状态
        self.isInModelArea = False  # 鼠标是否在模型区域内
        self.isClickingModel = False  # 是否正在点击模型
        self.screen_size = QGuiApplication.primaryScreen().geometry()
        self.window_size = (1000, 1000)
        
        # 根据拖拽模式不同设置窗口大小和位置
        if self.drag_mode:
            self.resize(self.screen_size.width()+1, self.screen_size.height())
            # 将窗口移动到中心位置
            self.move(
                (self.screen_size.width()-self.frameGeometry().width())//2, 
                (self.screen_size.height()-self.frameGeometry().height())//2
            )
        else:
            self.resize(self.window_size[0], self.window_size[1])  # 窗口大小
            self.move(
                (self.screen_size.width()-self.frameGeometry().width())//2, 
                (self.screen_size.height()-self.frameGeometry().height())//2
            )
        
        # 鼠标和缩放相关
        self.is_pressed = False
        self.scale = self.model_scale  # 使用配置中的缩放比例
        self.clickX = -1
        self.clickY = -1
        self.drag_start_offset_x = 0
        self.drag_start_offset_y = 0
        
        # 显示系统缩放比例
        self.systemScale = QGuiApplication.primaryScreen().devicePixelRatio()
        
        # Live2D模型相关
        self.model = None  # 存储Live2D模型实例
        self.wav_handler = None # 口型匹配
        self.is_talking = False  # 是否正在说话
        self.is_listening = False  # 是否正在聆听
        self.current_expression = ""  # 当前表情
        
        logger.info("Live2D模型控制器初始化完成")
    
    def initializeGL(self):
        """初始化OpenGL和加载Live2D模型"""
        try:
            # 将当前窗口作为OpenGL上下文
            self.makeCurrent()
            
            # 初始化Live2D
            if hasattr(live2d, 'LIVE2D_VERSION') and live2d.LIVE2D_VERSION == 3:
                try:
                    live2d.glInit()  # 初始化OpenGL(仅限Live2D v3)
                    logger.info("Live2D glInit 成功")
                except Exception as e:
                    logger.error(f"Live2D glInit 失败: {e}")
            
            # 创建模型实例
            try:
                self.model = live2d.LAppModel()
                self.wav_handler = WavHandler()
                logger.info("Live2D 模型实例创建成功")
            except Exception as e:
                logger.error(f"Live2D 模型实例创建失败: {e}")
                raise

            # 加载模型
            model_loaded = False
            # 加载模型
            if self.model_path and os.path.exists(self.model_path):
                try:
                    self.model.LoadModelJson(self.model_path)
                    logger.info(f"从配置路径加载模型成功: {self.model_path}")
                    model_loaded = True
                except Exception as e:
                    logger.error(f"从配置路径加载模型失败: {self.model_path}, 错误: {e}")

            if not model_loaded and hasattr(live2d, 'LIVE2D_VERSION') and live2d.LIVE2D_VERSION == 3:
                # 尝试加载默认模型
                default_paths = [
                    # 尝试多个可能的位置
                    "models/2D/Hiyori.model3-2025.json",
                    "2D/Hiyori.model3-2025.json",
                    "model_assets/Hiyori.model3-2025.json",
                    "../models/2D/Hiyori.model3-2025.json"
                ]
                
                for default_path in default_paths:
                    if os.path.exists(default_path):
                        try:
                            self.model.LoadModelJson(default_path)
                            logger.info(f"从默认路径加载模型成功: {default_path}")
                            model_loaded = True
                            break
                        except Exception as e:
                            logger.error(f"从默认路径加载模型失败: {default_path}, 错误: {e}")
                
                if not model_loaded:
                    logger.warning("未能加载任何模型")
            
            # 设置模型缩放
            if self.model:
                self.model.SetScale(self.scale)
            
            # 启动高帧率定时器
            self.startTimer(int(1000 / 60))  # 启动60FPS定时器
            
            logger.info("Live2D模型初始化完成")
        
        except Exception as e:
            logger.error(f"初始化Live2D模型失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
    
    def resizeGL(self, width, height):
        """窗口大小改变时调整模型参数"""
        if self.model:
            self.model.Resize(width, height)
    
    def paintGL(self):
        """每帧渲染模型"""
        try:
            # 清空OpenGL缓冲区
            live2d.clearBuffer()
            
            if self.model:
                # 更新模型参数(物理、动作等)
                self.model.Update()

                if self.wav_handler.Update():
                    # 利用 wav 响度更新 嘴部张合
                    self.model.SetParameterValue(
                        StandardParams.ParamMouthOpenY, self.wav_handler.GetRms() * 3.0
                    )
                
                # # 如果模型动作结束，根据当前状态触发不同动作
                # if self.model.IsMotionFinished():
                #     if self.is_talking:
                #         # 如果正在说话，播放说话动作
                #         self.model.StartMotion("Talk", 0, 2)
                #     elif self.is_listening:
                #         # 如果正在聆听，播放聆听动作
                #         self.model.StartMotion("Listen", 0, 2)
                #     else:
                #         # 否则播放随机动作
                #         # self.model.StartRandomMotion()
                #         pass
                
                # 绘制模型
                self.model.Draw()
        
        except Exception as e:
            logger.error(f"渲染模型失败: {e}")
    
    def timerEvent(self, event):
        """定时器事件，用于更新模型状态和窗口交互"""
        if not self.isVisible():
            return
        
        try:
            # 获取当前窗口样式
            current_style = win32gui.GetWindowLong(self.hwnd, win32con.GWL_EXSTYLE)
            
            # 获取鼠标相对于窗口的位置
            local_x, local_y = QCursor.pos().x() - self.x(), QCursor.pos().y() - self.y()
            
            # 如果不是拖拽模式，将鼠标位置传递给模型
            if not self.drag_mode and self.model:
                self.model.Drag(local_x, local_y)
            
            # 检查鼠标是否在模型区域内 - 修改方法名以避免与属性冲突
            in_model_area = self.check_in_model_area(local_x, local_y)
            
            # 更新窗口穿透属性
            if in_model_area:
                # 鼠标在模型区域内，禁用穿透
                new_style = current_style & ~win32con.WS_EX_TRANSPARENT
                self.isInModelArea = True
            else:
                # 鼠标不在模型区域内，启用穿透
                new_style = current_style | win32con.WS_EX_TRANSPARENT
                self.isInModelArea = False
            
            # 如果样式发生变化，更新窗口属性
            if new_style != current_style:
                win32gui.SetWindowLong(self.hwnd, win32con.GWL_EXSTYLE, new_style)
                win32gui.SetLayeredWindowAttributes(self.hwnd, 0, 255, win32con.LWA_ALPHA)
            
            # 请求重绘
            self.update()
        
        except Exception as e:
            logger.error(f"定时器事件处理失败: {e}")

    def check_in_model_area(self, x, y):
        """判断坐标是否在模型区域内
        
        Args:
            x: 相对于窗口的X坐标
            y: 相对于窗口的Y坐标
                
        Returns:
            是否在模型区域内
        """
        try:
            # 计算OpenGL坐标
            gl_x = int(x * self.systemScale)
            gl_y = int((self.height() - y) * self.systemScale)
            
            # 检查坐标是否在窗口范围内
            if (gl_x < 0 or gl_y < 0 or 
                gl_x >= self.width() * self.systemScale or 
                gl_y >= self.height() * self.systemScale):
                return False
            
            # 读取像素的Alpha通道值
            alpha = gl.glReadPixels(gl_x, gl_y, 1, 1, gl.GL_RGBA, gl.GL_UNSIGNED_BYTE)[3]
            
            # 如果Alpha值大于阈值，则认为在模型区域内
            return alpha > 50
        
        except Exception as e:
            logger.error(f"判断模型区域失败: {e}")
            return False
    
    def mousePressEvent(self, event):
        """鼠标按下事件
        
        Args:
            event: 鼠标事件
        """
        x, y = event.localPos().x(), event.localPos().y()
        
        # 判断点击是否在模型区域
        if self.check_in_model_area(x, y):
            self.isClickingModel = True
            self.clickX, self.clickY = x, y  # 记录点击位置
            self.is_pressed = True
            
            # 记录按下时的初始偏移量
            self.drag_start_offset_x = self.model_offset_x
            self.drag_start_offset_y = self.model_offset_y
            
            logger.debug("模型被点击")
    
    def mouseReleaseEvent(self, event):
        """鼠标释放事件
        
        Args:
            event: 鼠标事件
        """
        if self.drag_mode:
            # 拖拽模式下，结束拖拽
            self.isClickingModel = False
            self.is_pressed = False
        else:
            # 非拖拽模式下，处理点击
            x, y = event.localPos().x(), event.localPos().y()
            if self.is_pressed or self.isInModelArea:
                if self.model:
                    self.model.Drag(x, y)
                self.isClickingModel = False
                self.is_pressed = False
        
        logger.debug("鼠标释放")
    
    def mouseMoveEvent(self, event):
        """鼠标移动事件
        
        Args:
            event: 鼠标事件
        """
        x, y = event.localPos().x(), event.localPos().y()
        
        # 只有当点击了模型区域时才处理移动
        if self.isClickingModel:
            if self.drag_mode:
                # 拖拽模式：移动模型
                # 计算鼠标移动的增量（考虑系统缩放比例）
                dx = (x - self.clickX) / self.systemScale
                dy = (y - self.clickY) / self.systemScale
                
                # 更新模型偏移量
                self.model_offset_x = self.drag_start_offset_x + dx
                self.model_offset_y = self.drag_start_offset_y + dy
                
                # 设置模型偏移
                if self.model:
                    canvas_w, canvas_h = self.model.GetCanvasSize()
                    # 设置模型偏移（Y轴方向可能需要取反，根据实际效果调整）
                    self.model.SetOffset(
                        (self.model_offset_x - canvas_w/2)/(self.screen_size.height()/2),
                        (-self.model_offset_y + canvas_h/2)/(self.screen_size.height()/2)
                    )
            else:
                # 非拖拽模式：移动窗口
                self.move(int(self.x() + x - self.clickX), int(self.y() + y - self.clickY))
    
    def wheelEvent(self, event):
        """鼠标滚轮事件，用于缩放模型
        
        Args:
            event: 滚轮事件
        """
        delta = event.angleDelta().y()
        
        # 根据滚轮方向缩放模型
        new_scale = self.scale * (1.07 if delta > 0 else 0.93)
        
        # 应用新的缩放比例
        if new_scale != self.scale:
            self.scale = new_scale
            if self.model:
                self.model.SetScale(self.scale)
            
            logger.debug(f"模型缩放比例: {self.scale}")

    def wav_handler_start(self, data:dict):
        self.wav_handler.ReleasePcmData()
        try:
            self.wav_handler.numFrames = data.get('num_frames')
            self.wav_handler.sampleRate = data.get('framerate')
            self.wav_handler.sampleWidth = data.get('sample_width')
            self.wav_handler.numChannels = data.get('channels')
            # 双声道 / 单声道
            self.wav_handler.pcmData = data.get('pcm_data')
            # 标准化
            self.wav_handler.pcmData = self.wav_handler.pcmData / np.max(np.abs(self.wav_handler.pcmData))
            # 拆分通道
            self.wav_handler.pcmData = self.wav_handler.pcmData.reshape(-1, self.wav_handler.numChannels).T

            self.wav_handler.startTime = time.time()
            self.wav_handler.lastOffset = 0

        except Exception as e:
            self.wav_handler.ReleasePcmData()

    def mouth_match_motion(self, on_start_motion_callback):
        # 播放一个不存在的动作
        self.model.StartMotion(
            "",
            0,
            live2d.MotionPriority.FORCE,
            on_start_motion_callback,
            self.on_finish_motion_callback,
        )

    def on_finish_motion_callback(self):
        logger.debug("motion finished")

    def set_talking(self, is_talking):
        """设置说话状态
        
        Args:
            is_talking: 是否正在说话
        """
        self.is_talking = is_talking
        logger.debug(f"设置说话状态: {is_talking}")
        
        # if self.model:
        #     try:
        #         if is_talking:
        #             # 可以触发说话相关动作
        #             self.model.StartMotion("Talk", 0, 2)  # 假设有一个名为"Talk"的动作组
        #         else:
        #             # 当不说话时，如果在聆听则播放聆听动作，否则播放随机动作
        #             if self.is_listening:
        #                 self.model.StartMotion("Listen", 0, 2)
        #             else:
        #                 # self.model.StartRandomMotion()
        #                 pass
                
        #         logger.debug(f"设置说话状态: {is_talking}")
        #     except Exception as e:
        #         logger.error(f"设置说话状态失败: {e}")
    
    def set_listening(self, is_listening):
        """设置聆听状态
        
        Args:
            is_listening: 是否正在聆听
        """
        self.is_listening = is_listening
        logger.debug(f"设置聆听状态: {is_listening}")
        
        # if self.model:
        #     try:
        #         if is_listening and not self.is_talking:
        #             # 如果不在说话，触发聆听相关动作
        #             self.model.StartMotion("Listen", 0, 2)  # 假设有一个名为"Listen"的动作组
        #         elif not is_listening and not self.is_talking:
        #             # 如果既不聆听也不说话，播放随机动作
        #             # self.model.StartRandomMotion()
        #             pass
                
        #         logger.debug(f"设置聆听状态: {is_listening}")
        #     except Exception as e:
        #         logger.error(f"设置聆听状态失败: {e}")
    
    def set_expression(self, expression):
        """设置表情
        
        Args:
            expression: 表情名称
        """
        if self.model:
            try:
                # 设置表情
                self.model.SetExpression(expression)
                self.current_expression = expression
                
                logger.debug(f"设置表情: {expression}")
            except Exception as e:
                logger.error(f"设置表情失败: {e}")
    
    def set_random_expression(self):
        """设置随机表情"""
        if self.model:
            try:
                # 设置随机表情
                expression = self.model.SetRandomExpression()
                self.current_expression = expression
                
                logger.debug(f"设置随机表情: {expression}")
                return expression
            except Exception as e:
                logger.error(f"设置随机表情失败: {e}")
                return None
    
    def reset_expression(self):
        """重置为默认表情"""
        if self.model:
            try:
                # 重置表情
                self.model.ResetExpression()
                self.current_expression = ""
                
                logger.debug("重置为默认表情")
            except Exception as e:
                logger.error(f"重置表情失败: {e}")
    
    def get_available_expressions(self):
        """获取可用的表情列表
        
        Returns:
            表情ID列表
        """
        if self.model:
            try:
                # 获取表情列表
                expressions = self.model.GetExpressionIds()
                return expressions
            except Exception as e:
                logger.error(f"获取表情列表失败: {e}")
        
        return []
    
    def get_available_motions(self):
        """获取可用的动作组和数量
        
        Returns:
            动作组字典 {组名: 动作数量}
        """
        if self.model:
            try:
                # 获取动作组字典
                motions = self.model.GetMotionGroups()
                return motions
            except Exception as e:
                logger.error(f"获取动作组失败: {e}")
        
        return {}
    
    def toggle_auto_breath(self, enable=True):
        """切换自动呼吸功能
        
        Args:
            enable: 是否启用
        """
        if self.model:
            try:
                # 设置自动呼吸
                self.model.SetAutoBreathEnable(enable)
                
                logger.debug(f"设置自动呼吸: {enable}")
            except Exception as e:
                logger.error(f"设置自动呼吸失败: {e}")
    
    def toggle_auto_blink(self, enable=True):
        """切换自动眨眼功能
        
        Args:
            enable: 是否启用
        """
        if self.model:
            try:
                # 设置自动眨眼
                self.model.SetAutoBlinkEnable(enable)
                
                logger.debug(f"设置自动眨眼: {enable}")
            except Exception as e:
                logger.error(f"设置自动眨眼失败: {e}")

# 初始化和清理Live2D
def init_live2d():
    """初始化Live2D引擎"""
    try:
        live2d.init()
        logger.info("Live2D引擎初始化完成")
        return True
    except Exception as e:
        logger.error(f"初始化Live2D引擎失败: {e}")
        return False

def dispose_live2d():
    """清理Live2D引擎"""
    try:
        live2d.dispose()
        logger.info("Live2D引擎清理完成")
        return True
    except Exception as e:
        logger.error(f"清理Live2D引擎失败: {e}")
        return False

# 示例用法
if __name__ == "__main__":
    # 设置日志
    logging.basicConfig(level=logging.DEBUG)
    
    # 初始化Live2D引擎
    init_live2d()
    
    # 初始化QT应用
    app = QApplication(sys.argv)
    
    # 设置垂直同步
    format = QSurfaceFormat.defaultFormat()
    format.setSwapInterval(0)  # 0禁用垂直同步，1启用
    QSurfaceFormat.setDefaultFormat(format)
    
    # 创建Live2D模型窗口
    model = Live2DModel()
    model.show()
    
    # 运行应用
    exit_code = app.exec()
    
    # 清理Live2D引擎
    dispose_live2d()
    
    # 退出应用
    sys.exit(exit_code)