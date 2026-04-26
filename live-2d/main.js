const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { HttpServer } = require('./js/services/http-server')
const { ModelPathUpdater } = require('./js/model/model-path-updater')
const { ShortcutManager } = require('./js/shortcut-manager')
const screenshot = require('screenshot-desktop');

// 添加配置文件路径
const configPath = path.join(app.getAppPath(), 'config.json');

// Live2D模型优先级配置（Python程序会修改这个列表来切换模型）
const priorityFolders = ['肥牛v2.3', 'Hiyouri', 'Default', 'Main'];


function ensureTopMost(win) {
    if (!win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, 'screen-saver')
    }
}

function createWindow () {
    // 读取配置
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.error('读取配置失败:', e);
    }

    const screenExtend = config.ui?.screen_extend || { extend: false, left: false, right: true };
    
    // 获取所有显示器信息
    const displays = screen.getAllDisplays()
    const primaryDisplay = screen.getPrimaryDisplay();
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    if (screenExtend.extend) {
        if (screenExtend.right && !screenExtend.left) {
            // 保持当前不变 (包含所有屏幕)
            displays.forEach((display, index) => {
                const { x, y, width, height } = display.bounds
                console.log(`显示器 ${index}: x=${x}, y=${y}, width=${width}, height=${height}`)
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x + width)
                maxY = Math.max(maxY, y + height)
            })
        } else if (screenExtend.left) {
            // 包含主屏和主屏左侧的屏幕
            displays.forEach((display, index) => {
                const { x, y, width, height } = display.bounds;
                if (x <= primaryDisplay.bounds.x) {
                    console.log(`显示器 ${index} (左侧/主屏): x=${x}, y=${y}, width=${width}, height=${height}`);
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + width);
                    maxY = Math.max(maxY, y + height);
                }
            });
        } else {
            // 默认仅主屏
            minX = primaryDisplay.bounds.x;
            minY = primaryDisplay.bounds.y;
            maxX = primaryDisplay.bounds.x + primaryDisplay.bounds.width;
            maxY = primaryDisplay.bounds.y + primaryDisplay.bounds.height;
        }
    } else {
        // 非扩展模式：仅使用主屏
        minX = primaryDisplay.bounds.x;
        minY = primaryDisplay.bounds.y;
        maxX = primaryDisplay.bounds.x + primaryDisplay.bounds.width;
        maxY = primaryDisplay.bounds.y + primaryDisplay.bounds.height;
    }
    
    const totalWidth = maxX - minX
    const totalHeight = maxY - minY
    
    console.log(`=== 窗口创建信息 ===`)
    console.log(`总边界: minX=${minX}, minY=${minY}, maxX=${maxX}, maxY=${maxY}`)
    console.log(`计算的窗口尺寸: ${totalWidth}x${totalHeight}`)
    console.log(`窗口位置: (${minX}, ${minY})`)
    
    const win = new BrowserWindow({
        x: minX,
        y: minY,
        width: totalWidth,
        height: totalHeight,
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
    
    // 立即验证窗口尺寸
    const immediateBounds = win.getBounds()
    console.log(`窗口创建后立即尺寸: ${immediateBounds.width}x${immediateBounds.height}`)
    console.log(`窗口创建后立即位置: (${immediateBounds.x}, ${immediateBounds.y})`)
    
    // 延迟验证窗口实际尺寸
    setTimeout(() => {
        const actualBounds = win.getBounds()
        console.log(`窗口实际尺寸: ${actualBounds.width}x${actualBounds.height}`)
        console.log(`窗口实际位置: (${actualBounds.x}, ${actualBounds.y})`)
        
        // 如果尺寸不匹配，尝试强制设置
        if (actualBounds.width !== totalWidth || actualBounds.height !== totalHeight) {
            console.log(`⚠️ 窗口尺寸不匹配！尝试强制设置为 ${totalWidth}x${totalHeight}`)
            win.setBounds({
                x: minX,
                y: minY,
                width: totalWidth,
                height: totalHeight
            })
            
            setTimeout(() => {
                const finalBounds = win.getBounds()
                console.log(`强制设置后尺寸: ${finalBounds.width}x${finalBounds.height}`)
            }, 100)
        }
        console.log(`======================`)
    }, 100)
    
    win.loadFile('index.html')
    win.on('minimize', (event) => {
        event.preventDefault()
        win.restore()
    })
    // 移除 will-move 限制,允许跨屏幕移动
    win.on('blur', () => {
        ensureTopMost(win)
    })
    setInterval(() => {
        ensureTopMost(win)
    }, 1000)
    
    
    return win
}

// 在主进程启动时调用
app.whenReady().then(() => {
    // 读取配置判断模型类型
    let modelType = 'live2d';
    try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        modelType = configData.ui?.model_type || 'live2d';
    } catch (e) {
        console.log('读取配置失败，使用默认Live2D模式');
    }

    // 仅在Live2D模式下更新模型路径
    if (modelType === 'live2d') {
        const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
        modelPathUpdater.update();
    } else {
        console.log('VRM模式，跳过Live2D模型路径更新');
    }

    const mainWindow = createWindow();

    // 启动 HTTP API 服务器
    const httpServer = new HttpServer();
    httpServer.start();

    // 注册全局快捷键
    const shortcutManager = new ShortcutManager();
    shortcutManager.registerAll();
});


app.on('window-all-closed', () => {
    if (global.pluginManager) {
        global.pluginManager.stopWatching();
    }
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
    // 不限制窗口移动范围,允许自由移动到任何位置(包括副屏)
    let newX = currentX + mouseX
    let newY = currentY + mouseY

    win.setPosition(newX, newY)

    // 动态调整窗口大小以覆盖当前位置所在的所有屏幕
    const displays = screen.getAllDisplays()
    const winBounds = win.getBounds()
    
    // 找出窗口覆盖的所有显示器
    let minX = winBounds.x
    let minY = winBounds.y
    let maxX = winBounds.x + winBounds.width
    let maxY = winBounds.y + winBounds.height
    
    displays.forEach(display => {
        const { x, y, width, height } = display.bounds
        // 检查窗口是否与这个显示器有交集
        if (!(winBounds.x + winBounds.width < x || winBounds.x > x + width ||
              winBounds.y + winBounds.height < y || winBounds.y > y + height)) {
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x + width)
            maxY = Math.max(maxY, y + height)
        }
    })
    
    const newWidth = maxX - minX
    const newHeight = maxY - minY
    
    // 如果需要调整窗口大小
    if (newWidth !== winBounds.width || newHeight !== winBounds.height || minX !== winBounds.x || minY !== winBounds.y) {
        win.setBounds({
            x: minX,
            y: minY,
            width: newWidth,
            height: newHeight
        })
        console.log(`窗口调整: ${newWidth}x${newHeight} at (${minX}, ${minY})`)
    }
})

ipcMain.on('set-ignore-mouse-events', (event, { ignore, options }) => {
    BrowserWindow.fromWebContents(event.sender).setIgnoreMouseEvents(ignore, options)
})

ipcMain.on('set-window-opacity', (event, opacity) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setOpacity(Math.max(0, Math.min(1, opacity)));
})

ipcMain.on('get-screen-info-sync', (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        event.returnValue = {
            primaryDisplay: screen.getPrimaryDisplay(),
            allDisplays: screen.getAllDisplays(),
            windowBounds: win ? win.getBounds() : null
        };
    } catch (e) {
        console.error('获取屏幕信息失败:', e);
        event.returnValue = null;
    }
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

ipcMain.handle('take-screenshot', async (event) => {
    try {
        await new Promise(resolve => setTimeout(resolve, 100));

        const displays = await screenshot.listDisplays();

        const cursorPoint = screen.getCursorScreenPoint();
        const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

        const electronDisplays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);
        const targetIndex = electronDisplays.findIndex(d => d.id === currentDisplay.id);

        const nativeDisplays = displays.sort((a, b) => (a.left || 0) - (b.left || 0));

        if (targetIndex >= nativeDisplays.length) {
            throw new Error(`屏幕索引越界：鼠标在 Index ${targetIndex}，但原生只检测到 ${nativeDisplays.length} 个屏幕`);
        }

        const targetNativeDisplay = nativeDisplays[targetIndex];

        const imgBuffer = await screenshot({
            screen: targetNativeDisplay.id,
            format: 'jpg'
        });

        return imgBuffer.toString('base64');
    } catch (error) {
        console.error('截图错误:', error)
        throw error;
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

// 添加切换Live2D模型的IPC处理器
ipcMain.handle('switch-live2d-model', async (event, modelName) => {
    try {
        console.log(`切换模型到: ${modelName}`);

        // 更新priorityFolders，将选中的模型放在第一位
        const index = priorityFolders.indexOf(modelName);
        if (index > 0) {
            // 如果模型已存在，移到第一位
            priorityFolders.splice(index, 1);
            priorityFolders.unshift(modelName);
        } else if (index === -1) {
            // 如果模型不在列表中，添加到第一位
            priorityFolders.unshift(modelName);
        }
        // 如果已经在第一位(index === 0)，不需要操作

        console.log(`更新后的优先级列表: ${priorityFolders.join(', ')}`);

        // 保存priorityFolders到main.js文件
        try {
            const mainJsPath = path.join(app.getAppPath(), 'main.js');
            let mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

            // 构建新的priorityFolders数组字符串
            const newPriorityString = `['${priorityFolders.join("', '")}']`;

            // 替换main.js中的priorityFolders定义
            mainJsContent = mainJsContent.replace(
                /const priorityFolders = \[.*?\];/,
                `const priorityFolders = ${newPriorityString};`
            );

            // 写回文件
            fs.writeFileSync(mainJsPath, mainJsContent, 'utf8');
            console.log('已保存模型优先级到main.js');
        } catch (saveError) {
            console.error('保存优先级到main.js失败:', saveError);
            // 不影响继续执行
        }

        // 调用更新模型的函数
        const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
        modelPathUpdater.update();

        // 通知渲染进程需要重新加载以应用新模型
        const win = BrowserWindow.fromWebContents(event.sender)
        win.reload()

        return { success: true, message: `模型已切换到 ${modelName}，页面将重新加载` }
    } catch (error) {
        console.error('切换模型时出错:', error)
        return { success: false, message: `切换失败: ${error.message}` }
    }
})


// 添加获取窗口实际尺寸的IPC处理器
ipcMain.handle('get-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const bounds = win.getBounds();
    return {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
    };
});

// 添加获取所有显示器信息的IPC处理器
ipcMain.handle('get-all-displays', (event) => {
    const displays = screen.getAllDisplays();
    return displays.map(display => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation
    }));
});


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
        configData.ui.model_scale = position.scale;

        // 保存到文件
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

    } catch (error) {
        console.error('保存模型位置失败:', error);
    }
})

// 切换到VRM模型的IPC处理器
ipcMain.handle('switch-vrm-model', async (event, vrmFileName) => {
    try {
        console.log(`切换VRM模型到: ${vrmFileName}`);

        // 更新config.json
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!configData.ui) configData.ui = {};
        configData.ui.model_type = 'vrm';
        configData.ui.vrm_model = vrmFileName;
        configData.ui.vrm_model_path = `3D/${vrmFileName}`;
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

        // 重新加载窗口
        const win = BrowserWindow.fromWebContents(event.sender);
        win.reload();

        return { success: true, message: `VRM模型已切换到 ${vrmFileName}，页面将重新加载` };
    } catch (error) {
        console.error('切换VRM模型时出错:', error);
        return { success: false, message: `切换失败: ${error.message}` };
    }
})