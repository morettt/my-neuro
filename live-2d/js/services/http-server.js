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

        

        // 表情控制接口
        this.emotionApp.post('/control-expression', (req, res) => {
            const { expression_name } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            const jsCode = `
                if (global.expressionMapper && global.expressionMapper.triggerExpression) {
                    global.expressionMapper.triggerExpression('${expression_name}');
                    "触发表情: ${expression_name}";
                } else {
                    "表情映射器未初始化";
                }
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });
        
        // 表情绑定接口
        this.emotionApp.post('/bind-expression', (req, res) => {
            const { expression_name, emotion_name } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            const jsCode = `
                if (global.expressionMapper && global.expressionMapper.bindExpressionToEmotion) {
                    const result = global.expressionMapper.bindExpressionToEmotion('${emotion_name}', '${expression_name}');
                    result ? "绑定成功" : "表情已绑定";
                } else {
                    "表情映射器未初始化";
                }
            `;

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

        // 模型切换接口（供QT前端调用）
        this.emotionApp.post('/switch-model', (req, res) => {
            const { model_name, model_type } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            if (model_type === 'vrm') {
                // VRM模型切换：通过IPC触发
                mainWindow.webContents.executeJavaScript(
                    `require('electron').ipcRenderer.invoke('switch-vrm-model', '${model_name}')`
                ).then(() => {
                    res.json({ success: true, message: `VRM模型切换到 ${model_name}` });
                }).catch(error => {
                    res.json({ success: false, message: error.toString() });
                });
            } else {
                // Live2D模型切换
                mainWindow.webContents.executeJavaScript(
                    `require('electron').ipcRenderer.invoke('switch-live2d-model', '${model_name}')`
                ).then(() => {
                    res.json({ success: true, message: `模型切换到 ${model_name}` });
                }).catch(error => {
                    res.json({ success: false, message: error.toString() });
                });
            }
        });

        // VMC控制端点
        this._setupVMCEndpoint();

        // ===== 插件管理接口 =====

        this.emotionApp.get('/plugins', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            res.json({ success: true, plugins: pm.getPluginList() });
        });

        this.emotionApp.post('/plugins/reload', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            const { name } = req.body || {};
            if (!name) return res.json({ success: false, message: '缺少 name 参数' });
            pm.reload(name)
                .then(() => res.json({ success: true, message: `插件 ${name} 已重载` }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.post('/plugins/reload-all', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            pm.reloadAll()
                .then(() => res.json({ success: true, message: '所有插件已重载' }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.post('/plugins/sync', (req, res) => {
            const pm = global.pluginManager;
            if (!pm) return res.json({ success: false, message: '插件管理器未初始化' });
            pm.syncEnabledPlugins()
                .then(() => res.json({ success: true, message: '插件列表已同步' }))
                .catch(e => res.json({ success: false, message: e.message }));
        });

        this.emotionApp.listen(3002, () => {
            console.log('情绪控制服务启动在端口3002');
        });
    }

    /**
     * 启动VMC控制端点（挂载到情绪控制服务器）
     * 供QT前端实时控制VMC发送器
     */
    _setupVMCEndpoint() {
        if (!this.emotionApp) return;

        this.emotionApp.post('/control-vmc', (req, res) => {
            const { enabled, host, port } = req.body;
            const mainWindow = BrowserWindow.getAllWindows()[0];

            if (!mainWindow) {
                return res.json({ success: false, message: '应用窗口未找到' });
            }

            // 净化输入
            const safeHost = String(host || '127.0.0.1').replace(/[^a-zA-Z0-9.\-:]/g, '');
            const safePort = parseInt(port) || 39539;
            const hasEnabled = typeof enabled === 'boolean';

            const jsCode = `
                (function() {
                    if (!global.currentVRMAdapter) return '当前未使用VRM模型';
                    const sender = global.currentVRMAdapter.getVMCSender();
                    if (!sender) return 'VMC发送器未初始化';

                    sender.setTarget('${safeHost}', ${safePort});

                    ${hasEnabled ? `
                    sender.enabled = ${!!enabled};
                    if (${!!enabled}) {
                        if (!sender.socket) sender.start();
                        return 'VMC已启用 → ${safeHost}:${safePort}';
                    } else {
                        sender.stop();
                        return 'VMC已关闭';
                    }
                    ` : `
                    return 'VMC目标已更新 → ${safeHost}:${safePort}';
                    `}
                })();
            `;

            mainWindow.webContents.executeJavaScript(jsCode)
                .then(result => res.json({ success: true, message: result }))
                .catch(error => res.json({ success: false, message: error.toString() }));
        });
    }
}

module.exports = { HttpServer };
