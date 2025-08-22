#!/usr/bin/env python3
"""
测试新增功能的简单脚本
"""
import sys
import os

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))

def test_text_filter():
    """测试文本过滤功能"""
    print("=== 测试文本过滤功能 ===")
    try:
        from utils.text_filter import filter_text_markers, clean_subtitle_text, filter_for_tts
        
        test_texts = [
            "你好（这是括号内容）世界！",
            "这是**强调内容**的测试",
            "<开心>正常文本（过滤内容）**也要过滤**<难过>",
        ]
        
        for text in test_texts:
            print(f"原文: {text}")
            print(f"基本过滤: {filter_text_markers(text)}")
            print(f"字幕过滤: {clean_subtitle_text(text)}")
            print(f"TTS过滤: {filter_for_tts(text)}")
            print()
        
        print("✅ 文本过滤功能测试通过")
        return True
    except Exception as e:
        print(f"❌ 文本过滤功能测试失败: {e}")
        return False

def test_mood_overlay():
    """测试心情颜色叠加功能"""
    print("=== 测试心情颜色叠加功能 ===")
    try:
        from PyQt5.QtWidgets import QApplication
        app = QApplication(sys.argv)
        
        from UI.mood_overlay import MoodColorOverlay
        overlay = MoodColorOverlay()
        
        # 测试基本功能
        overlay.change_mood_color("开心")
        overlay.change_mood_color("生气")
        
        print("✅ 心情颜色叠加功能测试通过")
        return True
    except Exception as e:
        print(f"❌ 心情颜色叠加功能测试失败: {e}")
        return False

def test_free_movement():
    """测试自由移动功能"""
    print("=== 测试自由移动功能 ===")
    try:
        from UI.free_movement import FreeMovementController
        
        # 创建一个模拟的Live2D模型
        class MockLive2DModel:
            def __init__(self):
                self.model_offset_x = 500
                self.model_offset_y = 400
                self.screen_size = type('obj', (object,), {'height': lambda: 1080})()
                self.model = type('obj', (object,), {
                    'GetCanvasSize': lambda: (800, 600),
                    'SetOffset': lambda x, y: None
                })()
        
        mock_model = MockLive2DModel()
        controller = FreeMovementController(mock_model)
        
        # 测试基本功能
        status = controller.get_status()
        print(f"移动控制器状态: {status}")
        
        controller.set_movement_pattern("circular")
        controller.set_movement_speed(1.5)
        
        print("✅ 自由移动功能测试通过")
        return True
    except Exception as e:
        print(f"❌ 自由移动功能测试失败: {e}")
        return False

def main():
    """主测试函数"""
    print("🧪 开始测试新增功能...")
    print()
    
    results = []
    
    # 测试各个功能
    results.append(test_text_filter())
    results.append(test_mood_overlay())
    results.append(test_free_movement())
    
    # 汇总结果
    print("\n=== 测试结果汇总 ===")
    passed = sum(results)
    total = len(results)
    
    print(f"通过: {passed}/{total}")
    
    if passed == total:
        print("🎉 所有测试通过！")
        return 0
    else:
        print("⚠️ 部分测试失败")
        return 1

if __name__ == "__main__":
    sys.exit(main())