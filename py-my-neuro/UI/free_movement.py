"""
自由移动控制器 - 让Live2D模型在屏幕上自由移动
"""
import random
import time
import math
from PyQt5.QtCore import QTimer, QPropertyAnimation, QEasingCurve, pyqtSignal, pyqtProperty
from PyQt5.QtWidgets import QApplication


class FreeMovementController:
    """自由移动控制器"""
    
    def __init__(self, live_model, config=None):
        self.live_model = live_model
        self.config = config or {}
        
        # 移动参数
        self.movement_enabled = False
        self.movement_speed = self.config.get("movement_speed", 1.0)
        self.movement_interval = self.config.get("movement_interval", 5000)  # 5秒
        self.boundary_margin = 100  # 边界边距
        
        # 屏幕信息
        self.screen = QApplication.primaryScreen().geometry()
        
        # 当前位置和目标位置
        self.current_x = self.live_model.model_offset_x
        self.current_y = self.live_model.model_offset_y
        self.target_x = self.current_x
        self.target_y = self.current_y
        
        # 移动模式
        self.movement_patterns = [
            "random_walk",      # 随机漫步
            "circular",         # 圆形移动
            "figure_eight",     # 8字形移动
            "bounce",           # 弹跳移动
            "patrol"            # 巡逻移动
        ]
        self.current_pattern = "random_walk"
        
        # 定时器设置
        self.movement_timer = QTimer()
        self.movement_timer.timeout.connect(self.plan_next_movement)
        
        # 动画设置
        self.setup_animations()
        
        # 模式特定的状态
        self.pattern_state = {}
        self.reset_pattern_state()
    
    def setup_animations(self):
        """设置移动动画"""
        # 创建位置动画（这里我们手动处理，因为需要同时控制X和Y）
        self.animation_timer = QTimer()
        self.animation_timer.timeout.connect(self.update_position)
        
        # 动画参数
        self.animation_duration = 3000  # 3秒移动时间
        self.animation_start_time = 0
        self.start_x = 0
        self.start_y = 0
        self.is_animating = False
    
    def start_free_movement(self):
        """开始自由移动"""
        if self.movement_enabled:
            return
            
        self.movement_enabled = True
        self.reset_pattern_state()
        
        # 开始移动计划
        self.movement_timer.start(self.movement_interval)
        print("🚶 开始自由移动")
    
    def stop_free_movement(self):
        """停止自由移动"""
        self.movement_enabled = False
        self.movement_timer.stop()
        self.animation_timer.stop()
        self.is_animating = False
        print("🛑 停止自由移动")
    
    def reset_pattern_state(self):
        """重置移动模式状态"""
        self.pattern_state = {
            "circular": {
                "center_x": self.screen.width() // 2,
                "center_y": self.screen.height() // 2,
                "radius": 200,
                "angle": 0
            },
            "figure_eight": {
                "center_x": self.screen.width() // 2,
                "center_y": self.screen.height() // 2,
                "size": 150,
                "t": 0
            },
            "bounce": {
                "direction_x": 1,
                "direction_y": 1,
                "speed": 50
            },
            "patrol": {
                "waypoints": [
                    (200, 200),
                    (self.screen.width() - 200, 200),
                    (self.screen.width() - 200, self.screen.height() - 200),
                    (200, self.screen.height() - 200)
                ],
                "current_waypoint": 0
            }
        }
    
    def plan_next_movement(self):
        """规划下一次移动"""
        if not self.movement_enabled or self.is_animating:
            return
        
        # 随机选择移动模式（或使用配置指定的模式）
        if random.random() < 0.3:  # 30%概率改变移动模式
            self.current_pattern = random.choice(self.movement_patterns)
        
        # 根据当前模式计算下一个位置
        next_pos = self.calculate_next_position()
        
        if next_pos:
            self.move_to_position(next_pos[0], next_pos[1])
    
    def calculate_next_position(self):
        """根据当前移动模式计算下一个位置"""
        pattern = self.current_pattern
        
        if pattern == "random_walk":
            return self.random_walk()
        elif pattern == "circular":
            return self.circular_movement()
        elif pattern == "figure_eight":
            return self.figure_eight_movement()
        elif pattern == "bounce":
            return self.bounce_movement()
        elif pattern == "patrol":
            return self.patrol_movement()
        
        return None
    
    def random_walk(self):
        """随机漫步移动"""
        max_distance = 300
        angle = random.uniform(0, 2 * math.pi)
        distance = random.uniform(100, max_distance)
        
        new_x = self.current_x + distance * math.cos(angle)
        new_y = self.current_y + distance * math.sin(angle)
        
        # 边界检查
        new_x = max(self.boundary_margin, min(self.screen.width() - self.boundary_margin, new_x))
        new_y = max(self.boundary_margin, min(self.screen.height() - self.boundary_margin, new_y))
        
        return (new_x, new_y)
    
    def circular_movement(self):
        """圆形移动"""
        state = self.pattern_state["circular"]
        state["angle"] += 0.3  # 角度增量
        
        new_x = state["center_x"] + state["radius"] * math.cos(state["angle"])
        new_y = state["center_y"] + state["radius"] * math.sin(state["angle"])
        
        return (new_x, new_y)
    
    def figure_eight_movement(self):
        """8字形移动"""
        state = self.pattern_state["figure_eight"]
        state["t"] += 0.2
        
        # 8字形的数学公式
        new_x = state["center_x"] + state["size"] * math.sin(state["t"])
        new_y = state["center_y"] + state["size"] * math.sin(state["t"]) * math.cos(state["t"])
        
        return (new_x, new_y)
    
    def bounce_movement(self):
        """弹跳移动"""
        state = self.pattern_state["bounce"]
        
        new_x = self.current_x + state["speed"] * state["direction_x"]
        new_y = self.current_y + state["speed"] * state["direction_y"]
        
        # 边界碰撞检测
        if new_x <= self.boundary_margin or new_x >= self.screen.width() - self.boundary_margin:
            state["direction_x"] *= -1
        if new_y <= self.boundary_margin or new_y >= self.screen.height() - self.boundary_margin:
            state["direction_y"] *= -1
        
        new_x = max(self.boundary_margin, min(self.screen.width() - self.boundary_margin, new_x))
        new_y = max(self.boundary_margin, min(self.screen.height() - self.boundary_margin, new_y))
        
        return (new_x, new_y)
    
    def patrol_movement(self):
        """巡逻移动"""
        state = self.pattern_state["patrol"]
        waypoints = state["waypoints"]
        
        # 移动到下一个路点
        state["current_waypoint"] = (state["current_waypoint"] + 1) % len(waypoints)
        return waypoints[state["current_waypoint"]]
    
    def move_to_position(self, x, y):
        """移动到指定位置"""
        if self.is_animating:
            return
        
        self.start_x = self.current_x
        self.start_y = self.current_y
        self.target_x = x
        self.target_y = y
        
        # 开始动画
        self.animation_start_time = time.time() * 1000
        self.is_animating = True
        self.animation_timer.start(50)  # 20 FPS更新
        
        print(f"🎯 移动到: ({x:.0f}, {y:.0f})")
    
    def update_position(self):
        """更新位置动画"""
        if not self.is_animating:
            return
        
        try:
            current_time = time.time() * 1000
            elapsed = current_time - self.animation_start_time
            progress = min(elapsed / self.animation_duration, 1.0)
            
            # 使用缓动函数
            eased_progress = self.ease_in_out_quad(progress)
            
            # 计算当前位置
            self.current_x = self.start_x + (self.target_x - self.start_x) * eased_progress
            self.current_y = self.start_y + (self.target_y - self.start_y) * eased_progress
            
            # 应用到Live2D模型
            if self.live_model and hasattr(self.live_model, 'model') and self.live_model.model:
                self.live_model.model_offset_x = self.current_x
                self.live_model.model_offset_y = self.current_y
                
                try:
                    canvas_w, canvas_h = self.live_model.model.GetCanvasSize()
                    self.live_model.model.SetOffset(
                        (self.current_x - canvas_w/2) / (self.live_model.screen_size.height()/2),
                        (-self.current_y + canvas_h/2) / (self.live_model.screen_size.height()/2)
                    )
                except Exception as e:
                    print(f"⚠️ 模型偏移设置失败: {e}")
            
            # 检查动画是否完成
            if progress >= 1.0:
                self.is_animating = False
                self.animation_timer.stop()
                print(f"✨ 移动完成: ({self.current_x:.0f}, {self.current_y:.0f})")
                
        except Exception as e:
            print(f"⚠️ 位置更新失败: {e}")
            self.is_animating = False
            self.animation_timer.stop()
    
    def ease_in_out_quad(self, t):
        """二次缓动函数"""
        if t < 0.5:
            return 2 * t * t
        else:
            return -1 + (4 - 2 * t) * t
    
    def set_movement_pattern(self, pattern):
        """设置移动模式"""
        if pattern in self.movement_patterns:
            self.current_pattern = pattern
            self.reset_pattern_state()
            print(f"🎭 切换移动模式: {pattern}")
    
    def set_movement_speed(self, speed):
        """设置移动速度"""
        self.movement_speed = max(0.1, min(3.0, speed))
        self.movement_interval = int(5000 / self.movement_speed)
        
        if self.movement_enabled:
            self.movement_timer.setInterval(self.movement_interval)
    
    def toggle_movement(self):
        """切换移动状态"""
        if self.movement_enabled:
            self.stop_free_movement()
        else:
            self.start_free_movement()
    
    def get_status(self):
        """获取移动状态信息"""
        return {
            "enabled": self.movement_enabled,
            "pattern": self.current_pattern,
            "speed": self.movement_speed,
            "current_pos": (self.current_x, self.current_y),
            "target_pos": (self.target_x, self.target_y),
            "is_animating": self.is_animating
        }