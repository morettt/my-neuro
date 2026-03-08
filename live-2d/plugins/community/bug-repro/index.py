from plugin_sdk import Plugin, run

class BugReproPlugin(Plugin):

    async def on_init(self):
        self.context.log('info', '=== bug-repro 插件已初始化 ===')

    async def on_user_input(self, event):
        # 第1步：先打一条"进入钩子"的日志，确认钩子被触发
        self.context.log('info', '[bug-repro] on_user_input 被触发')

        # 第2步：用带 default 参数的方式调用 storage.get（这里会 TypeError）
        self.context.log('info', '[bug-repro] 准备调用 storage.get 带 default 参数...')
        val = self.context.storage.get('skills_prompt', '')   # ← 复现点

        # 第3步：如果没崩，打印取到的值
        self.context.log('info', f'[bug-repro] storage.get 返回: {repr(val)}')
        event.add_context(f'[bug-repro注入] {val}')

if __name__ == '__main__':
    run(BugReproPlugin)
