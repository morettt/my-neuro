/**
 * PC屏幕控制相关工具函数
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Python脚本模板
const PYTHON_SCRIPT_TEMPLATE = `# -*- coding: utf-8 -*-
import json
import base64
import io
import sys

try:
    import pyautogui
    from openai import OpenAI
    from PIL import ImageGrab, Image, ImageDraw
except ImportError as e:
    print(json.dumps({"error": f"缺少必需的Python包: {str(e)}. 请在my-neuro环境中安装: pip install pyautogui openai pillow"}))
    sys.exit(1)


class PcAgent:
    def __init__(self):
        api_key = 'sk-ftjfiwuwacsbnimczzjxuknuzdfedcqrrwrjifpzwcreqaot'
        api_url = "https://api.siliconflow.cn/v1"
        self.model = "Qwen/Qwen2.5-VL-72B-Instruct"
        self.client = OpenAI(api_key=api_key, base_url=api_url)

    def get_image_base64(self):
        scr = ImageGrab.grab()
        buffer = io.BytesIO()
        scr.save(buffer, format='JPEG')
        image_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return image_data, scr

    def jieshou(self, response):
        full_assistant_response = ''
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                ai_chunk = chunk.choices[0].delta.content
                full_assistant_response += ai_chunk
        return full_assistant_response

    def draw_bbox(self, img, bbox):
        draw = ImageDraw.Draw(img)
        draw.rectangle(bbox, outline='red', width=3)

    def shubiao(self, rect):
        center_x = (rect[0] + rect[2]) // 2
        center_y = (rect[1] + rect[3]) // 2
        pyautogui.moveTo(center_x, center_y, duration=0.25)
        pyautogui.doubleClick()

    def click_element(self, content):
        try:
            image_data, img = self.get_image_base64()

            messages = [
                {
                    'role': 'system',
                    'content': '你是一个PC屏幕视觉分析助手。你的任务是根据用户的文字描述，在提供的截图中定位目标元素，并以JSON格式返回该元素的2D边界框（bounding box）。JSON格式必须为 \`{"bbox_2d": [x1, y1, x2, y2]}\`。不要输出任何其他文字或代码标记。'
                },
                {
                    'role': 'user',
                    'content': [
                        {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{image_data}'}},
                        {'type': 'text', 'text': content}
                    ]
                }
            ]

            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True
            )

            ai_response_str = self.jieshou(response)
            bbox_data = json.loads(ai_response_str)
            image_bbox = bbox_data['bbox_2d']
            self.draw_bbox(img, image_bbox)
            self.shubiao(image_bbox)

            return f"成功点击了: {content}"
        except Exception as e:
            return f"点击失败: {str(e)}"


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({"error": "需要提供元素描述参数"}))
        sys.exit(1)
    
    element_description = sys.argv[1]
    pc_agent = PcAgent()
    result = pc_agent.click_element(element_description)
    print(json.dumps({"result": result}, ensure_ascii=False))
`;

/**
 * 分析当前屏幕截图并点击指定元素。输入描述后，AI会找到对应元素并自动点击
 * @param {string} element_description - 要点击的元素描述，例如：'确定按钮'、'搜索框'、'关闭按钮'等
 */
async function pcScreenClick({element_description}) {
    if (!element_description) {
        throw new Error('缺少元素描述参数');
    }

    return new Promise((resolve, reject) => {
        // 创建临时Python脚本文件
        const tempScriptPath = path.join(__dirname, 'temp_pc_control.py');

        try {
            // 写入Python脚本
            fs.writeFileSync(tempScriptPath, PYTHON_SCRIPT_TEMPLATE);

            // 执行Python脚本 - 支持conda环境
            const isWindows = process.platform === 'win32';
            let command;

            if (isWindows) {
                // Windows系统，使用call命令确保conda正确激活
                command = `call conda activate my-neuro && python "${tempScriptPath}" "${element_description}"`;
            } else {
                // 非Windows系统
                command = `source activate my-neuro && python "${tempScriptPath}" "${element_description}"`;
            }

            const execOptions = {
                timeout: 30000,
                shell: isWindows ? 'cmd.exe' : '/bin/bash',
                env: { ...process.env, CONDA_DLL_SEARCH_MODIFICATION_ENABLE: '1' }
            };

            exec(command, execOptions, (error, stdout, stderr) => {
                // 清理临时文件
                try {
                    fs.unlinkSync(tempScriptPath);
                } catch (cleanupError) {
                    console.warn('清理临时文件失败:', cleanupError.message);
                }

                if (error) {
                    reject(new Error(`执行失败: ${error.message}`));
                    return;
                }

                if (stderr) {
                    console.warn('Python警告:', stderr);
                }

                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result.result);
                    }
                } catch (parseError) {
                    // 如果JSON解析失败，返回原始输出
                    resolve(stdout || '操作完成');
                }
            });

        } catch (writeError) {
            reject(new Error(`创建脚本失败: ${writeError.message}`));
        }
    });
}

// Function Call兼容接口
function getToolDefinitions() {
    return [
        {
            name: "pc_screen_click",
            description: "基于屏幕截图和AI视觉识别，点击指定的屏幕元素",
            parameters: {
                type: "object",
                properties: {
                    element_description: {
                        type: "string",
                        description: "要点击的屏幕元素的描述"
                    }
                },
                required: ["element_description"]
            }
        }
    ];
}

// Function Call兼容接口 - 执行函数
async function executeFunction(name, parameters) {
    switch (name) {
        case 'pc_screen_click':
            return await pcScreenClick(parameters);
        default:
            throw new Error(`不支持的函数: ${name}`);
    }
}

module.exports = {
    pcScreenClick,
    getToolDefinitions,
    executeFunction
};
