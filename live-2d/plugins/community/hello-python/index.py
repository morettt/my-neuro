from plugin_sdk import Plugin, run


class HelloPythonPlugin(Plugin):

    async def on_start(self):
        self.context.log('info', 'Python 插件已启动！')

    async def on_user_input(self, event):
        # 在用户消息里注入当前时间（示例）
        from datetime import datetime
        now = datetime.now().strftime('%H:%M')
        event.add_context(f'（Python插件注入：当前时间 {now}）')

    async def on_tts_end(self):
        self.context.log('info', 'TTS 播放结束（Python 感知到了）')


if __name__ == '__main__':
    run(HelloPythonPlugin)
