const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

// 添加配置文件路径
const configPath = path.join(app.getAppPath(), 'config.json');
const defaultConfigPath = path.join(app.getAppPath(), 'default_config.json');

// 更新Live2D模型路径的函数
function updateLive2DModelPath() {
    console.log('开始更新Live2D模型路径...')
    const appDir = app.getAppPath()
    const modelDir = path.join(appDir, '2D') // 指定模型所在的"2D"文件夹
    
    // 检查2D文件夹是否存在
    if (!fs.existsSync(modelDir)) {
        console.log('2D文件夹不存在，不进行更新')
        return
    }
    
    // 查找2D文件夹中的所有.model3.json文件（包括子文件夹）
    let modelFiles = []
    try {
        const scanForModels = (dir, basePath = '') => {
            const items = fs.readdirSync(dir)
            for (const item of items) {
                const fullPath = path.join(dir, item)
                const relativePath = basePath ? path.join(basePath, item) : item

                if (fs.statSync(fullPath).isDirectory()) {
                    // 如果是文件夹，递归扫描
                    scanForModels(fullPath, relativePath)
                } else if (item.endsWith('.model3.json')) {
                    // 找到模型文件
                    const modelPath = path.join('2D', relativePath).replace(/\\/g, '/')
                    modelFiles.push(modelPath)
                }
            }
        }

        scanForModels(modelDir)

        if (modelFiles.length === 0) {
            console.log('2D文件夹中没有找到.model3.json文件，不进行更新')
            return
        }

        // 设置优先级：先找Hiyouri，然后Default，最后其他
        const priorityFolders = ['肥牛', 'Hiyouri', 'Default', 'Main']
        let selectedModelFile = null

        // 先在优先文件夹中找
        for (const priority of priorityFolders) {
            const priorityModel = modelFiles.find(file => file.includes(`2D/${priority}/`))
            if (priorityModel) {
                selectedModelFile = priorityModel
                console.log(`找到优先模型: ${selectedModelFile}`)
                break
            }
        }

        // 如果优先文件夹没找到，就按字母排序取第一个
        if (!selectedModelFile) {
            modelFiles.sort()
            selectedModelFile = modelFiles[0]
            console.log(`使用默认模型: ${selectedModelFile}`)
        }

        console.log(`所有找到的模型: ${modelFiles.join(', ')}`)
        console.log(`最终选择模型: ${selectedModelFile}`)

        // 读取并更新app.js文件
        const appJsPath = path.join(appDir, 'app.js')
        let jsContent = fs.readFileSync(appJsPath, 'utf8')

        // 查找并替换模型路径
        const pattern = /const model = await PIXI\.live2d\.Live2DModel\.from\("([^"]*)"\);/
        const replacement = `const model = await PIXI.live2d.Live2DModel.from("${selectedModelFile}");`

        if (pattern.test(jsContent)) {
            // 替换匹配到的内容
            jsContent = jsContent.replace(pattern, replacement)

            // 写回文件
            fs.writeFileSync(appJsPath, jsContent, 'utf8')
            console.log(`成功更新app.js文件中的模型路径为: ${selectedModelFile}`)
        } else {
            console.log('在app.js中没有找到匹配的模型加载代码行')
        }
    } catch (err) {
        console.error('更新Live2D模型路径时出错:', err)
    }
}

// 修改后的函数，不再检查配置文件是否存在
function ensureConfigExists() {
    // 假设配置文件一定存在，只记录一条日志
    console.log('使用现有配置文件');
}

function ensureTopMost(win) {
    if (!win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, 'screen-saver')
    }
}

function createWindow () {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
    const win = new BrowserWindow({
        width: screenWidth,
        height: screenHeight,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        focusable: true,
        type: 'desktop',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            zoomFactor: 1.0,
            enableWebSQL: true
        },
        resizable: true,
        movable: true,
        skipTaskbar: true,
        maximizable: false,
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setMenu(null)
    win.setPosition(0, 0)
    win.loadFile('index.html')
    win.on('minimize', (event) => {
        event.preventDefault()
        win.restore()
    })
    win.on('will-move', (event, newBounds) => {
        const { width, height } = primaryDisplay.workAreaSize
        if (newBounds.x < 0 || newBounds.y < 0 || 
            newBounds.x + newBounds.width > width || 
            newBounds.y + newBounds.height > height) {
            event.preventDefault()
        }
    })
    win.on('blur', () => {
        ensureTopMost(win)
    })
    setInterval(() => {
        ensureTopMost(win)
    }, 1000)
    
    // 为调试添加开发者工具快捷键
    globalShortcut.register('F12', () => {
        win.webContents.openDevTools();
    });
    
    return win
}

// 在主进程启动时调用
app.whenReady().then(() => {
    // 确保配置文件存在（已修改，现在只打印日志）
    ensureConfigExists();
    
    // 在创建窗口前先更新Live2D模型路径
    updateLive2DModelPath();
    
    const mainWindow = createWindow();
    
    // 添加配置相关的快捷键
    globalShortcut.register('CommandOrControl+,', () => {
        openConfigEditor(mainWindow);
    });
    
    globalShortcut.register('CommandOrControl+Q', () => {
        app.quit();
    });


    // 添加打断功能的全局快捷键
    globalShortcut.register('CommandOrControl+G', () => {
        // 发送中断消息到渲染进程
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
            mainWindow.webContents.send('interrupt-tts');
        }
    });


    globalShortcut.register('CommandOrControl+T', () => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
            win.setAlwaysOnTop(true, 'screen-saver');
        });
    });

    // 注册动作触发快捷键
    for (let i = 1; i <= 9; i++) {
        if (i === 6) {
            // Ctrl+Shift+6 改为音乐播放功能
            globalShortcut.register(`CommandOrControl+Shift+${i}`, () => {
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow) {
                    mainWindow.webContents.send('trigger-music-play');
                }
            });
        } else if (i === 8) {
            // Ctrl+Shift+8 改为停止音乐+赌气动作
            globalShortcut.register(`CommandOrControl+Shift+${i}`, () => {
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow) {
                    mainWindow.webContents.send('trigger-music-stop-with-motion');
                }
            });
        } else {
            globalShortcut.register(`CommandOrControl+Shift+${i}`, () => {
                const motionIndex = i - 1;
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow) {
                    mainWindow.webContents.send('trigger-motion-hotkey', motionIndex);
                }
            });
        }
    }

    globalShortcut.register('CommandOrControl+Shift+0', () => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
            mainWindow.webContents.send('stop-all-motions');
        }
    });
});

// 添加音乐控制HTTP服务器
const express = require('express');
const musicApp = express();
musicApp.use(express.json());

// 音乐控制接口
musicApp.post('/control-music', (req, res) => {
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

musicApp.listen(3001, () => {
   console.log('音乐控制服务启动在端口3001');
});

// 新增：情绪控制HTTP服务器
const emotionApp = express();
emotionApp.use(express.json());

// 情绪控制接口
emotionApp.post('/control-motion', (req, res) => {
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

// 添加配置重新加载接口
emotionApp.post('/reload-config', (req, res) => {
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

emotionApp.listen(3002, () => {
    console.log('情绪控制服务启动在端口3002');
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// 修改打开配置编辑器的功能，假设配置文件总是存在
function openConfigEditor(parentWindow) {
    try {
        // 使用系统默认应用打开配置文件
        require('electron').shell.openPath(configPath);
    } catch (error) {
        console.error('打开配置文件失败:', error);
        dialog.showMessageBox(parentWindow, {
            type: 'error',
            title: '错误',
            message: '无法打开配置文件',
            detail: error.message,
            buttons: ['确定']
        });
    }
}

ipcMain.on('window-move', (event, { mouseX, mouseY }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const [currentX, currentY] = win.getPosition()
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    let newX = currentX + mouseX
    let newY = currentY + mouseY
    newX = Math.max(-win.getBounds().width + 100, Math.min(newX, screenWidth - 100))
    newY = Math.max(-win.getBounds().height + 100, Math.min(newY, screenHeight - 100))
    win.setPosition(newX, newY)
})

ipcMain.on('set-ignore-mouse-events', (event, { ignore, options }) => {
    BrowserWindow.fromWebContents(event.sender).setIgnoreMouseEvents(ignore, options)
})

ipcMain.on('request-top-most', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setAlwaysOnTop(true, 'screen-saver')
})

// 添加保存配置的IPC处理器
ipcMain.handle('save-config', async (event, configData) => {
    try {
        // 创建备份
        if (fs.existsSync(configPath)) {
            const backupPath = `${configPath}.bak`;
            fs.copyFileSync(configPath, backupPath);
        }

        // 保存新配置
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

        // 通知用户需要重启应用
        const result = await dialog.showMessageBox({
            type: 'info',
            title: '配置已保存',
            message: '配置已成功保存',
            detail: '需要重启应用以应用新配置。现在重启应用吗？',
            buttons: ['是', '否'],
            defaultId: 0
        });

        // 如果用户选择重启
        if (result.response === 0) {
            app.relaunch();
            app.exit();
        }

        return { success: true };
    } catch (error) {
        console.error('保存配置失败:', error);
        return { success: false, error: error.message };
    }
});

// 修改获取配置的IPC处理器，假设配置文件总是存在
ipcMain.handle('get-config', async (event) => {
    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        return { success: true, config: JSON.parse(configData) };
    } catch (error) {
        console.error('获取配置失败:', error);
        return { success: false, error: error.message };
    }
});

// 添加打开配置文件的IPC处理器
ipcMain.handle('open-config-editor', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    openConfigEditor(win);
    return { success: true };
});

// 修改后的截图功能：不再隐藏窗口
ipcMain.handle('take-screenshot', async (event) => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: screen.getPrimaryDisplay().workAreaSize
        })

        const primaryScreen = sources[0]

        // 直接转换为base64，不保存文件
        const jpegBuffer = primaryScreen.thumbnail.toJPEG(75);
        const base64Image = jpegBuffer.toString('base64');

        return base64Image
    } catch (error) {
        console.error('截图错误:', error)
        throw error
    }
})

// 添加IPC处理器，允许从渲染进程手动更新模型
ipcMain.handle('update-live2d-model', async (event) => {
    try {
        // 调用更新模型的函数
        updateLive2DModelPath()

        // 通知渲染进程需要重新加载以应用新模型
        const win = BrowserWindow.fromWebContents(event.sender)
        win.reload()

        return { success: true, message: '模型已更新，页面将重新加载' }
    } catch (error) {
        console.error('手动更新模型时出错:', error)
        return { success: false, message: `更新失败: ${error.message}` }
    }
})

// 添加保存模型位置的IPC处理器
ipcMain.on('save-model-position', (event, position) => {
    try {
        // 读取当前配置
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        // 更新位置信息
        if (!configData.ui) {
            configData.ui = {};
        }
        if (!configData.ui.model_position) {
            configData.ui.model_position = {
                x: null,
                y: null,
                remember_position: true
            };
        }

        configData.ui.model_position.x = position.x;
        configData.ui.model_position.y = position.y;

        // 保存到文件
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

        console.log('模型位置已保存到配置文件:', position);
    } catch (error) {
        console.error('保存模型位置失败:', error);
    }
})