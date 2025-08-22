"""
情绪颜色叠加系统 - 根据模型心情改变屏幕颜色
"""
import sys
import time
import random
from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QPropertyAnimation, QEasingCurve, pyqtProperty
from PyQt5.QtGui import QColor, QPainter, QBrush
from PyQt5.QtWidgets import QWidget, QApplication, QGraphicsOpacityEffect

# 导入事件总线
try:
    from UI.simple_event_bus import event_bus, Events
    HAS_EVENT_BUS = True
except ImportError:
    HAS_EVENT_BUS = False


class MoodColorOverlay(QWidget):
    """心情颜色叠加窗口"""
    
    # 情绪颜色映射
    EMOTION_COLORS = {
        "开心": QColor(255, 255, 0, 30),      # 淡黄色
        "生气": QColor(255, 0, 0, 50),        # 淡红色
        "难过": QColor(0, 0, 255, 40),        # 淡蓝色
        "惊讶": QColor(255, 165, 0, 35),      # 淡橙色
        "害羞": QColor(255, 192, 203, 30),    # 淡粉色
        "俏皮": QColor(128, 0, 128, 35),      # 淡紫色
        "默认": QColor(128, 128, 128, 20)     # 淡灰色
    }
    
    def __init__(self, config=None):
        super().__init__()
        self.config = config or {}
        
        # 当前情绪和颜色
        self.current_emotion = "默认"
        self.current_color = self.EMOTION_COLORS["默认"]
        self.target_opacity = 0.0
        self.current_opacity = 0.0
        
        # 设置窗口属性
        self.setup_window()
        
        # 动画设置
        self.setup_animations()
        
        # 自动变化定时器
        self.auto_change_timer = QTimer()
        self.auto_change_timer.timeout.connect(self.random_mood_change)
        
        # 订阅情绪事件
        if HAS_EVENT_BUS:
            event_bus.subscribe("emotion_triggered", self.on_emotion_triggered)
            event_bus.subscribe("mood_color_toggle", self.toggle_overlay)
        
        # 默认隐藏
        self.hide()
    
    def setup_window(self):
        """设置窗口属性"""
        try:
            # 无边框，置顶，透明背景
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.Tool |
                Qt.WindowType.WindowStaysOnTopHint
            )
            self.setAttribute(Qt.WA_TranslucentBackground, True)
            
            # 设置为全屏大小
            screen = QApplication.primaryScreen()
            if screen:
                screen_geometry = screen.geometry()
                self.setGeometry(screen_geometry)
            else:
                # 回退到默认大小
                self.setGeometry(0, 0, 1920, 1080)
            
            # 设置穿透属性（不影响鼠标操作）
            self.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        except Exception as e:
            print(f"⚠️ 心情颜色窗口设置失败: {e}")
    
    def setup_animations(self):
        """设置动画效果"""
        self.fade_animation = QPropertyAnimation(self, b"opacity")
        self.fade_animation.setDuration(1000)  # 1秒渐变
        self.fade_animation.setEasingCurve(QEasingCurve.InOutQuad)
    
    @pyqtProperty(float)
    def opacity(self):
        return self.current_opacity
    
    @opacity.setter
    def opacity(self, value):
        self.current_opacity = value
        self.update()
    
    def paintEvent(self, event):
        """绘制颜色叠加"""
        if self.current_opacity <= 0:
            return
            
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 设置叠加颜色和透明度
        color = QColor(self.current_color)
        color.setAlpha(int(255 * self.current_opacity))
        
        painter.fillRect(self.rect(), color)
    
    def on_emotion_triggered(self, data):
        """响应情绪触发事件"""
        emotion = data.get("emotion", "默认")
        self.change_mood_color(emotion)
    
    def change_mood_color(self, emotion):
        """改变心情颜色"""
        if emotion not in self.EMOTION_COLORS:
            emotion = "默认"
        
        self.current_emotion = emotion
        self.current_color = self.EMOTION_COLORS[emotion]
        
        # 显示颜色叠加
        self.show_overlay()
        
        print(f"💫 心情颜色改变: {emotion}")
    
    def show_overlay(self):
        """显示颜色叠加"""
        if not self.isVisible():
            self.show()
        
        # 动画到目标透明度
        self.fade_animation.stop()
        self.fade_animation.setStartValue(self.current_opacity)
        
        # 根据情绪强度设置透明度
        if self.current_emotion == "生气":
            target_opacity = 0.3
        elif self.current_emotion in ["开心", "俏皮"]:
            target_opacity = 0.2
        else:
            target_opacity = 0.15
            
        self.fade_animation.setEndValue(target_opacity)
        self.fade_animation.start()
        
        # 设置自动消失定时器
        QTimer.singleShot(3000, self.hide_overlay)  # 3秒后消失
    
    def hide_overlay(self):
        """隐藏颜色叠加"""
        self.fade_animation.stop()
        self.fade_animation.setStartValue(self.current_opacity)
        self.fade_animation.setEndValue(0.0)
        self.fade_animation.finished.connect(self.hide)
        self.fade_animation.start()
    
    def toggle_overlay(self, data=None):
        """切换叠加显示"""
        if self.isVisible() and self.current_opacity > 0:
            self.hide_overlay()
        else:
            self.random_mood_change()
    
    def random_mood_change(self):
        """随机改变心情（用于测试或自主变化）"""
        emotions = list(self.EMOTION_COLORS.keys())
        emotions.remove("默认")  # 移除默认情绪
        
        random_emotion = random.choice(emotions)
        self.change_mood_color(random_emotion)
    
    def start_auto_mood_changes(self, interval_seconds=30):
        """开始自动心情变化"""
        self.auto_change_timer.start(interval_seconds * 1000)
        print(f"🎭 启动自动心情变化，间隔: {interval_seconds}秒")
    
    def stop_auto_mood_changes(self):
        """停止自动心情变化"""
        self.auto_change_timer.stop()
        print("🎭 停止自动心情变化")


def test_mood_overlay():
    """测试心情颜色叠加功能"""
    app = QApplication(sys.argv)
    
    overlay = MoodColorOverlay()
    
    # 测试不同情绪
    emotions = ["开心", "生气", "难过", "惊讶", "害羞", "俏皮"]
    
    def test_emotion_cycle():
        for i, emotion in enumerate(emotions):
            QTimer.singleShot(i * 4000, lambda e=emotion: overlay.change_mood_color(e))
    
    # 开始测试
    QTimer.singleShot(1000, test_emotion_cycle)
    
    # 启动自动变化（测试用）
    QTimer.singleShot(len(emotions) * 4000 + 2000, lambda: overlay.start_auto_mood_changes(5))
    
    # 退出程序
    QTimer.singleShot(40000, app.quit)
    
    app.exec_()


if __name__ == "__main__":
    test_mood_overlay()