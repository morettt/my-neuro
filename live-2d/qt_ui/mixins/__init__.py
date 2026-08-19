# -*- coding: utf-8 -*-
"""set_pyqt 主窗口的功能 Mixin 集合，每个模块对应一块独立功能。"""
from .voice_clone import VoiceCloneMixin
from .motion_expression import MotionExpressionMixin
from .live2d_control import Live2DControlMixin
from .logs import LogsMixin
from .window_behavior import WindowBehaviorMixin
from .config_tracking import ConfigTrackingMixin
from .settings import SettingsMixin
from .services import ServicesMixin
from .plugins import PluginsMixin
from .tutorial import TutorialMixin
from .mcp_tools import McpToolsMixin
from .market import MarketMixin
from .chat_history import ChatHistoryMixin

__all__ = [
    'VoiceCloneMixin',
    'MotionExpressionMixin',
    'Live2DControlMixin',
    'LogsMixin',
    'WindowBehaviorMixin',
    'ConfigTrackingMixin',
    'SettingsMixin',
    'ServicesMixin',
    'PluginsMixin',
    'TutorialMixin',
    'McpToolsMixin',
    'MarketMixin',
    'ChatHistoryMixin',
]
