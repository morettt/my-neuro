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
                    jsCode = 'global.musicPlayer && global.musicPlayer.playRandomMusic(); "播放随机音乐"';
                    break;
                case 'stop':
                    jsCode = 'global.musicPlayer && global.musicPlayer.stop(); "音乐已停止"';
                    break;
                case 'play_specific':
                    jsCode = `global.musicPlayer && global.musicPlayer.playSpecificSong('${filename}'); "播放${filename}"`;
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

        // 模型位置重置接口
        this.emotionApp.post('/reset-model-position', (req, res) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            // 调用前端的模型位置重置函数
            const jsCode = `
                (async () => {
                    try {
                        // 重新加载配置
                        const { ipcRenderer } = require('electron');
                        const result = await ipcRenderer.invoke('get-config');

                        if (result.success && result.config) {
                            const config = result.config;
                            const defaultX = config.ui?.model_position?.x || 1.35;
                            const defaultY = config.ui?.model_position?.y || 0.8;

                            // 重新设置模型位置
                            if (global.modelController && global.modelController.model) {
                                global.modelController.model.x = defaultX * window.innerWidth;
                                global.modelController.model.y = defaultY * window.innerHeight;
                                global.modelController.updateInteractionArea();
                                return "模型位置已重置";
                            } else {
                                return "模型控制器未初始化";
                            }
                        } else {
                            return "获取配置失败";
                        }
                    } catch (error) {
                        return "重置失败: " + error.message;
                    }
                })()
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });

        // 模型切换接口
        this.emotionApp.post('/switch-model', (req, res) => {
            const { model_name } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            if (!model_name) {
                return res.json({ success: false, message: '缺少model_name参数' });
            }

            // 调用IPC更新模型
            const jsCode = `
                (async () => {
                    try {
                        const { ipcRenderer } = require('electron');
                        // 发送切换模型请求
                        const result = await ipcRenderer.invoke('switch-live2d-model', '${model_name}');
                        return result.message || "模型切换成功";
                    } catch (error) {
                        return "切换失败: " + error.message;
                    }
                })()
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
