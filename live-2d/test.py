# -*- coding: utf-8 -*-
"""肥牛桌宠 PyQt 控制窗口 —— 程序入口。

窗口实现已拆分至 qt_ui 包：
    qt_ui/main_window.py        主窗口类 set_pyqt（组合各功能 Mixin）
    qt_ui/mixins/               按功能划分的 Mixin（语音、动作表情、插件、市场、教程等）
    qt_ui/workers.py            后台线程（日志、下载安装、模型拉取）
    qt_ui/widgets/              自定义控件（Toast、标题栏）
    qt_ui/paths.py              路径工具（含 TEST_PY_DIR 锚点）
    qt_ui/tool_descriptions.py  MCP 工具描述加载
"""
import sys

from PyQt5.QtCore import QCoreApplication, Qt
from PyQt5.QtWidgets import QApplication

from qt_ui.main_window import set_pyqt


if __name__ == '__main__':
    # # 分辨率自适应 - 暂时禁用，可能导致UI尺寸异常
    # QCoreApplication.setAttribute(Qt.AA_EnableHighDpiScaling)

    # 为了支持QWebEngineView，必须在创建QApplication之前设置（如果可用的话）
    try:
        QCoreApplication.setAttribute(Qt.AA_ShareOpenGLContexts)
    except:
        pass  # 如果设置失败（比如打包后没有WebEngine），忽略即可

    app = QApplication(sys.argv)
    w = set_pyqt()
    w.show()
    sys.exit(app.exec_())
