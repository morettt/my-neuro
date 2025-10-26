// main.js
const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { HttpServer } = require('./js/services/http-server.js')
const { ModelPathUpdater } = require('./js/model/model-path-updater.js')
const { ShortcutManager } = require('./js/shortcut-manager.js')

// 添加配置文件路径
const configPath = path.join(app.getAppPath(), 'config.json');
// 新增：布局配置文件路径
const layoutConfigPath = path.join(app.getAppPath(), 'layout.json');

// 核心修复：禁用背景窗口渲染节流，防止其他应用的视频等内容在桌宠获得焦点时黑屏
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
// 核心修复：进一步禁用渲染器后台管理，强制后台窗口（如浏览器）保持渲染活动
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'true');
// 核心修复：防止后台计时器被节流，确保动画等持续运行
app.commandLine.appendSwitch('disable-background-timer-throttling', 'true');

// Live2D模型优先级配置（Python程序会修改这个列表来切换模型）
const priorityFolders = ['肥牛', 'Hiyouri', 'Default', 'Main'];


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
        type: 'toolbar', // 核心修复：将窗口类型设置为工具栏，使其不会抢占其他应用的焦点
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
    // 核心修复：将窗口的初始状态设置为可穿透
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

    // 核心修复：监听窗口失去焦点事件
    win.on('blur', () => {
        ensureTopMost(win);
        // 向渲染进程发送消息，通知其隐藏对话框
        win.webContents.send('window-blurred');
    })

    setInterval(() => {
        ensureTopMost(win)
    }, 1000)
    
    
    return win
}

// 在主进程启动时调用
app.whenReady().then(() => {
    // 在创建窗口前先更新Live2D模型路径
    const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
    modelPathUpdater.update();

    const mainWindow = createWindow();

    // 启动 HTTP API 服务器
    const httpServer = new HttpServer();
    httpServer.start();

    // 注册全局快捷键
    const shortcutManager = new ShortcutManager();
    shortcutManager.registerAll();
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

// 新增：获取布局配置的IPC处理器
ipcMain.handle('get-layout-config', async (event) => {
    try {
        if (fs.existsSync(layoutConfigPath)) {
            const layoutData = fs.readFileSync(layoutConfigPath, 'utf8');
            return { success: true, config: JSON.parse(layoutData) };
        }
        // 如果文件不存在，返回一个默认结构
        return { success: true, config: { chatbox_position: { left: null, top: null }, subtitle_position: null, subtitle_size: null } };
    } catch (error) {
        console.error('获取布局配置失败:', error);
        // 出错时也返回默认结构，防止程序崩溃
        return { success: false, error: error.message, config: { chatbox_position: { left: null, top: null }, subtitle_position: null, subtitle_size: null } };
    }
});


// 修改后的截图功能：不再隐藏窗口
ipcMain.handle('take-screenshot', async (event) => {
    try {
        // 添加短暂延迟确保获取最新屏幕内容
        await new Promise(resolve => setTimeout(resolve, 100));

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: screen.getPrimaryDisplay().workAreaSize,
            fetchWindowIcons: false  // 禁用缓存，强制获取新截图
        })

        const primaryScreen = sources[0]

        // 直接转换为base64，不保存文件
        const jpegBuffer = primaryScreen.thumbnail.toJPEG(75);
        const base64Image = jpegBuffer.toString('base64');

        console.log('截图已完成，时间戳:', new Date().toISOString());

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
        const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
        modelPathUpdater.update();

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

// 新增：添加保存聊天框位置的IPC处理器 (写入到 layout.json)
ipcMain.on('save-chatbox-position', (event, position) => {
    try {
        let layoutConfig = {};
        // 读取现有的布局文件，如果存在的话
        if (fs.existsSync(layoutConfigPath)) {
            layoutConfig = JSON.parse(fs.readFileSync(layoutConfigPath, 'utf8'));
        }

        // 更新聊天框位置
        layoutConfig.chatbox_position = {
            left: position.left,
            top: position.top
        };

        // 保存到 layout.json 文件
        fs.writeFileSync(layoutConfigPath, JSON.stringify(layoutConfig, null, 2), 'utf8');
        console.log('聊天框位置已保存到 layout.json:', position);
    } catch (error) {
        console.error('保存聊天框位置到 layout.json 失败:', error);
    }
});

// 修改：保存字幕的绝对位置
ipcMain.on('save-subtitle-position', (event, position) => {
    try {
        let layoutConfig = {};
        if (fs.existsSync(layoutConfigPath)) {
            try {
                const content = fs.readFileSync(layoutConfigPath, 'utf8');
                if (content) {
                    layoutConfig = JSON.parse(content);
                }
            } catch (e) {
                console.error('解析 layout.json 失败，将创建新文件:', e);
                layoutConfig = {};
            }
        }
        layoutConfig.subtitle_position = position;
        if (layoutConfig.subtitle_offset) {
            delete layoutConfig.subtitle_offset;
        }
        fs.writeFileSync(layoutConfigPath, JSON.stringify(layoutConfig, null, 2), 'utf8');
        console.log('字幕位置已保存到 layout.json:', position);
    } catch (error) {
        console.error('保存字幕位置到 layout.json 失败:', error);
    }
});

// 新增：保存字幕尺寸的IPC处理器
ipcMain.on('save-subtitle-size', (event, size) => {
    try {
        let layoutConfig = {};
        if (fs.existsSync(layoutConfigPath)) {
            try {
                const content = fs.readFileSync(layoutConfigPath, 'utf8');
                if (content) {
                    layoutConfig = JSON.parse(content);
                }
            } catch (e) {
                console.error('解析 layout.json 失败，将创建新文件:', e);
                layoutConfig = {};
            }
        }
        layoutConfig.subtitle_size = size;
        fs.writeFileSync(layoutConfigPath, JSON.stringify(layoutConfig, null, 2), 'utf8');
        console.log('字幕尺寸已保存到 layout.json:', size);
    } catch (error) {
        console.error('保存字幕尺寸到 layout.json 失败:', error);
    }
});


// 新增：从渲染进程接收指令，恢复鼠标穿透
ipcMain.on('set-mouse-forwarding', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.setIgnoreMouseEvents(true, { forward: true });
});