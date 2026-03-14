"""
备忘录插件
AI 可以用工具帮用户记录、查看、删除备忘，数据持久化到 JSON 文件。
"""

import json
import os
from datetime import datetime
from plugin_sdk import Plugin, run


class NotesPlugin(Plugin):

    # ===== 文件读写 =====

    def _notes_path(self):
        cfg = self.context.get_plugin_config()
        return cfg.get('file', 'AI记录室/备忘录.json')

    def _load(self):
        path = self._notes_path()
        if not os.path.exists(path):
            return []
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []

    def _save(self, notes):
        path = self._notes_path()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(notes, f, ensure_ascii=False, indent=2)

    # ===== 生命周期 =====

    async def on_start(self):
        notes = self._load()
        self.context.storage.set('notes', notes)
        self.context.log('info', f'备忘录已加载，共 {len(notes)} 条')

    async def on_stop(self):
        notes = self.context.storage.get('notes') or []
        self._save(notes)

    # ===== 工具注册 =====

    def get_tools(self):
        return [
            {
                'type': 'function',
                'function': {
                    'name': 'save_note',
                    'description': '帮用户保存一条备忘录，当用户说"记一下""帮我记住""别忘了"等时使用',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'content': {
                                'type': 'string',
                                'description': '备忘内容'
                            }
                        },
                        'required': ['content']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'list_notes',
                    'description': '查看用户保存的备忘录，当用户问"我记了什么""有什么备忘"时使用',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'limit': {
                                'type': 'integer',
                                'description': '最多显示几条，默认显示全部'
                            }
                        },
                        'required': []
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'delete_note',
                    'description': '删除指定编号的备忘录',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'index': {
                                'type': 'integer',
                                'description': '备忘录编号（从1开始，可从 list_notes 获取）'
                            }
                        },
                        'required': ['index']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'clear_notes',
                    'description': '清空所有备忘录',
                    'parameters': {
                        'type': 'object',
                        'properties': {},
                        'required': []
                    }
                }
            }
        ]

    # ===== 工具执行 =====

    async def execute_tool(self, name, params):
        notes = self.context.storage.get('notes') or []

        if name == 'save_note':
            content = params.get('content', '').strip()
            if not content:
                return '备忘内容不能为空。'
            note = {
                'content': content,
                'time': datetime.now().strftime('%Y-%m-%d %H:%M')
            }
            notes.append(note)
            self.context.storage.set('notes', notes)
            self._save(notes)
            return f'已保存备忘（第{len(notes)}条）：{content}'

        elif name == 'list_notes':
            if not notes:
                return '备忘录是空的，还没有记录任何东西。'
            limit = params.get('limit', len(notes))
            shown = notes[-limit:]
            offset = len(notes) - len(shown)
            lines = [f'共 {len(notes)} 条备忘：']
            for i, note in enumerate(shown, start=offset + 1):
                lines.append(f'{i}. [{note["time"]}] {note["content"]}')
            return '\n'.join(lines)

        elif name == 'delete_note':
            idx = params.get('index', 0) - 1
            if idx < 0 or idx >= len(notes):
                return f'编号无效，当前共 {len(notes)} 条备忘。'
            removed = notes.pop(idx)
            self.context.storage.set('notes', notes)
            self._save(notes)
            return f'已删除：{removed["content"]}'

        elif name == 'clear_notes':
            count = len(notes)
            self.context.storage.set('notes', [])
            self._save([])
            return f'已清空全部 {count} 条备忘。'

        return '未知工具。'


if __name__ == '__main__':
    run(NotesPlugin)
