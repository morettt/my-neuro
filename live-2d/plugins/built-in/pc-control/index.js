const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class PcControlPlugin extends Plugin {

    async onInit() {
        const cfg = this.context.getPluginFileConfig();
        this._apiKey = cfg.api_key?.value || cfg.api_key || '';
        this._apiUrl = cfg.api_url?.value || cfg.api_url || 'https://api.siliconflow.cn/v1';
        this._model  = cfg.model?.value   || cfg.model   || 'Qwen/Qwen2.5-VL-72B-Instruct';
    }

    getTools() {
        if (!this._apiKey) return [];
        return [{
            type: 'function',
            function: {
                name: 'pc_screen_click',
                description: '基于屏幕截图和AI视觉识别，点击指定的屏幕元素',
                parameters: {
                    type: 'object',
                    properties: {
                        element_description: { type: 'string', description: "要点击的屏幕元素的描述，如'确定按钮'、'搜索框'" }
                    },
                    required: ['element_description']
                }
            }
        }];
    }

    async executeTool(name, params) {
        if (name === 'pc_screen_click') return await this._pcScreenClick(params);
        throw new Error(`[pc-control] 不支持的工具: ${name}`);
    }

    async _pcScreenClick({ element_description }) {
        if (!element_description) throw new Error('缺少元素描述参数');

        const pythonScript = `# -*- coding: utf-8 -*-
import json, base64, io, sys
try:
    import pyautogui
    from openai import OpenAI
    from PIL import ImageGrab, ImageDraw
except ImportError as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

api_key = '${this._apiKey}'
api_url = '${this._apiUrl}'
model = '${this._model}'
client = OpenAI(api_key=api_key, base_url=api_url)

scr = ImageGrab.grab()
buf = io.BytesIO()
scr.save(buf, format='JPEG')
image_data = base64.b64encode(buf.getvalue()).decode('utf-8')

messages = [
    {'role': 'system', 'content': '你是PC屏幕视觉分析助手。根据描述在截图中定位目标元素，以JSON格式返回 {"bbox_2d": [x1, y1, x2, y2]}。不要输出其他文字。'},
    {'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{image_data}'}}, {'type': 'text', 'text': '${element_description}'}]}
]

try:
    response = client.chat.completions.create(model=model, messages=messages, stream=True)
    content = ''.join(c.choices[0].delta.content or '' for c in response if c.choices)
    bbox = json.loads(content)['bbox_2d']
    cx, cy = (bbox[0]+bbox[2])//2, (bbox[1]+bbox[3])//2
    pyautogui.moveTo(cx, cy, duration=0.25)
    pyautogui.doubleClick()
    print(json.dumps({"result": f"成功点击了: ${element_description}"}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"result": f"点击失败: {str(e)}"}, ensure_ascii=False))
`;

        return new Promise((resolve, reject) => {
            const tempScriptPath = path.join(__dirname, 'temp_pc_control.py');
            fs.writeFileSync(tempScriptPath, pythonScript);

            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `call conda activate my-neuro && python "${tempScriptPath}"`
                : `source activate my-neuro && python "${tempScriptPath}"`;

            exec(command, { timeout: 30000, shell: isWindows ? 'cmd.exe' : '/bin/bash', env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' } }, (error, stdout) => {
                try { fs.unlinkSync(tempScriptPath); } catch (e) {}
                if (error) return reject(new Error(`执行失败: ${error.message}`));
                try {
                    const result = JSON.parse(stdout);
                    resolve(result.result || result.error);
                } catch { resolve(stdout || '操作完成'); }
            });
        });
    }
}

module.exports = PcControlPlugin;
