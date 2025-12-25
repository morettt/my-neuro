const express = require('express');
const { BrowserWindow } = require('electron');

/**
 * HTTP API 服务器
 * 提供音乐控制和情绪控制的 HTTP 接口
 */
class HttpServer {
    constructor() {
        this.musicApp = null;
        this.emotionApp = null;
    }

    /**
     * 启动所有 HTTP 服务
     */
    start() {
        this.startMusicServer();
        this.startEmotionServer();
    }

    /**
     * 启动音乐控制服务器 (端口 3001)
     */
    startMusicServer() {
        this.musicApp = express();
        this.musicApp.use(express.json());

        // 音乐控制接口
        this.musicApp.post('/control-music', (req, res) => {
            const { action, filename } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            let jsCode = '';
            switch (action) {
                case 'play_random':
                    // 直接返回 playRandomMusic 的结果 (Promise)
                    jsCode = 'global.musicPlayer ? global.musicPlayer.playRandomMusic() : { message: "播放器未初始化", metadata: null }';
                    break;
                case 'stop':
                    jsCode = 'global.musicPlayer ? global.musicPlayer.stop() : null; "音乐已停止"';
                    break;
                case 'play_specific':
                    // 直接返回 playSpecificSong 的结果 (Promise)
                    jsCode = `global.musicPlayer ? global.musicPlayer.playSpecificSong('${filename}') : { message: "播放器未初始化", metadata: null }`;
                    break;
                default:
                    return res.json({ success: false, message: '不支持的操作' });
            }

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        this.musicApp.listen(3001, () => {
            console.log('音乐控制服务启动在端口3001');
        });
    }

    /**
     * 启动情绪控制服务器 (端口 3002)
     */
    startEmotionServer() {
        this.emotionApp = express();
        this.emotionApp.use(express.json());

        // 情绪控制接口
        this.emotionApp.post('/control-motion', (req, res) => {
            const { action, emotion_name, motion_index } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            let jsCode = '';

            if (action === 'trigger_emotion') {
                // 调用情绪映射器播放情绪动作
                jsCode = `
                    if (global.emotionMapper && global.emotionMapper.playConfiguredEmotion) {
                        global.emotionMapper.playConfiguredEmotion('${emotion_name}');
                        "触发情绪: ${emotion_name}";
                    } else {
                        "情绪映射器未初始化";
                    }
                `;
            } else if (action === 'trigger_motion') {
                // 保留原有的索引方式（兼容性）
                jsCode = `
                    if (global.emotionMapper && global.emotionMapper.playMotion) {
                        global.emotionMapper.playMotion(${motion_index});
                        "触发动作索引: ${motion_index}";
                    } else {
                        "情绪映射器未初始化";
                    }
                `;
            } else if (action === 'stop_all_motions') {
                // 停止所有动作
                jsCode = `
                    if (currentModel && currentModel.internalModel && currentModel.internalModel.motionManager) {
                        currentModel.internalModel.motionManager.stopAllMotions();
                        if (global.emotionMapper) {
                            global.emotionMapper.playDefaultMotion();
                        }
                        "已停止所有动作";
                    } else {
                        "模型未初始化";
                    }
                `;
            } else {
                return res.json({ success: false, message: '不支持的操作' });
            }

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        // 配置重新加载接口
        this.emotionApp.post('/reload-config', (req, res) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            // 调用前端的配置重新加载函数
            const jsCode = `
                if (global.reloadConfig) {
                    global.reloadConfig();
                    "配置已重新加载";
                } else {
                    "配置重新加载函数未找到";
                }
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        this.emotionApp.listen(3002, () => {
            console.log('情绪控制服务启动在端口3002');
        });
    }
}

module.exports = { HttpServer };
