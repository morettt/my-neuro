const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { HttpServer } = require('./js/services/http-server')
const {
    scanLive2DModels,
    resolveLive2DModel,
    scanVRMModels
} = require('./js/avatar/model-registry')
const { saveModelPrefs } = require('./js/avatar/preferences-store')
const {
    AvatarSwitchTransaction,
    normalizeAvatarType
} = require('./js/avatar/avatar-switch-transaction')
const { ShortcutManager } = require('./js/shortcut-manager')
const screenshot = require('screenshot-desktop');
const { logToTerminal } = require('./js/api-utils');

// 添加配置文件路径；隔离测试可通过环境变量指向临时副本。
const configPath = process.env.MY_NEURO_CONFIG_PATH
    ? path.resolve(process.env.MY_NEURO_CONFIG_PATH)
    : path.join(app.getAppPath(), 'config.json');
let shortcutManager = null;
let rendererRequestCounter = 0;
const pendingRendererRequests = new Map();
let avatarSwitchTransaction = null;
const SUPPORTED_AVATAR_TYPES = new Set(['live2d', 'vrm']);
const AVATAR_RESULT_PHASES = new Set([
    'ready',
    'busy',
    'failed',
    'rolled-back',
    'reload-required',
    'reload-scheduled',
    'rollback-reload-scheduled'
]);

function loadConfigData() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfigData(configData) {
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
}

function updateUiConfig(patch) {
    const configData = loadConfigData();
    if (!configData.ui) configData.ui = {};
    Object.assign(configData.ui, patch);
    saveConfigData(configData);
    return configData;
}

function nextRendererRequestId(prefix) {
    rendererRequestCounter += 1;
    return `${prefix}-${Date.now()}-${rendererRequestCounter}`;
}

function waitForRendererRequest(requestId, senderId, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingRendererRequests.delete(requestId);
            resolve({
                success: false,
                phase: 'failed',
                timedOut: true,
                reloadRequired: true,
                message: `渲染进程未在 ${timeoutMs}ms 内确认操作`
            });
        }, timeoutMs);
        pendingRendererRequests.set(requestId, { resolve, timer, senderId });
    });
}

function cancelRendererRequest(requestId) {
    const pending = pendingRendererRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRendererRequests.delete(requestId);
    pending.resolve({
        success: false,
        phase: 'failed',
        message: '渲染请求已取消'
    });
}

function completeRendererRequest(event, payload) {
    const requestId = String(payload?.requestId || '');
    const pending = pendingRendererRequests.get(requestId);
    if (!pending) {
        return { success: false, message: '找不到待确认的渲染请求' };
    }
    if (pending.senderId != null && event.sender?.id !== pending.senderId) {
        return { success: false, message: '渲染请求来源不匹配' };
    }

    clearTimeout(pending.timer);
    pendingRendererRequests.delete(requestId);
    pending.resolve({
        success: payload?.success === true,
        phase: AVATAR_RESULT_PHASES.has(payload?.phase) ? payload.phase : undefined,
        message: typeof payload?.message === 'string'
            ? payload.message
            : (payload?.success === true ? '操作成功' : '操作失败'),
        restored: payload?.restored === true,
        reloadRequired: payload?.reloadRequired === true,
        timedOut: payload?.timedOut === true,
        targetType: normalizeAvatarType(payload?.targetType),
        activeType: Object.prototype.hasOwnProperty.call(payload || {}, 'activeType')
            ? normalizeAvatarType(payload.activeType)
            : undefined
    });
    return { success: true };
}

function getRendererWindow(event) {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed?.()) {
        throw new Error('渲染窗口不可用');
    }
    const win = BrowserWindow.fromWebContents(sender);
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
        throw new Error('渲染窗口不可用');
    }
    return win;
}

async function requestRendererConfirmation(event, channel, payload, prefix, timeoutMs = 30000) {
    const requestId = nextRendererRequestId(prefix);
    const pending = waitForRendererRequest(requestId, event?.sender?.id, timeoutMs);
    try {
        const win = getRendererWindow(event);
        win.webContents.send(channel, { ...payload, requestId });
        return await pending;
    } catch (error) {
        cancelRendererRequest(requestId);
        throw error;
    } finally {
        cancelRendererRequest(requestId);
    }
}

function sendUiConfigPatch(win, patch) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('avatar-config-updated', { ui: patch });
}

function scheduleWindowReload(win, reason) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
        throw new Error('渲染窗口不可用，无法安排重载');
    }
    setImmediate(() => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
        console.log(`[Avatar] 安排窗口重载: ${reason || '状态同步'}`);
        win.webContents.reload();
    });
}

function resolveAvatarModelSelection(type, requestedName) {
    const scanners = {
        live2d: scanLive2DModels,
        vrm: scanVRMModels
    };
    const scan = scanners[type];
    const all = scan ? scan() : [];
    const requested = String(requestedName || '').trim();
    const entry = all.find(model => model.modelPath === requested)
        || all.find(model => model.name === requested)
        || (type === 'vrm'
            ? all.find(model => path.basename(model.modelPath) === requested)
            : null);

    return {
        entry: entry || null,
        all,
        configValue: entry
            ? (type === 'vrm' ? entry.modelPath : entry.name)
            : null
    };
}

function avatarModelCount(type) {
    if (!SUPPORTED_AVATAR_TYPES.has(type)) return 0;
    if (type === 'live2d') return scanLive2DModels().length;
    if (type === 'vrm') return scanVRMModels().length;
    return 0;
}

function hasAvatarModel(type) {
    return avatarModelCount(type) > 0;
}

function normalizeConfiguredAvatarType(configData) {
    if (!configData || typeof configData !== 'object') return null;
    if (!configData.ui || typeof configData.ui !== 'object') configData.ui = {};

    const requested = normalizeAvatarType(configData.ui.model_type) || 'live2d';
    const usable = SUPPORTED_AVATAR_TYPES.has(requested) && hasAvatarModel(requested)
        ? requested
        : ['live2d', 'vrm'].find(hasAvatarModel);
    if (!usable || usable === requested) return usable;

    configData.ui.model_type = usable;
    saveConfigData(configData);
    console.warn(`[Avatar] ${requested} 当前没有可用 driver 或模型，已回退到 ${usable}`);
    return usable;
}

function getAvatarSwitchTransaction() {
    if (avatarSwitchTransaction) return avatarSwitchTransaction;
    avatarSwitchTransaction = new AvatarSwitchTransaction({
        readModelType() {
            return loadConfigData().ui?.model_type || 'live2d';
        },
        updateModelType(type) {
            updateUiConfig({ model_type: type });
        },
        hasAvatarModel(type) {
            return hasAvatarModel(type);
        },
        requestRendererSwitch(type, context) {
            return requestRendererConfirmation(
                context.event,
                'avatar-switch-type',
                { type },
                'avatar-type-switch'
            );
        },
        publishModelType(type, context) {
            sendUiConfigPatch(context.win, { model_type: type });
        },
        scheduleReload({ context, reason }) {
            scheduleWindowReload(context.win, reason);
        },
        log(level, message) {
            console[level === 'error' ? 'error' : 'log'](`[Avatar] ${message}`);
        }
    });
    return avatarSwitchTransaction;
}

function finalizeRendererFailure(win, result, reason) {
    if (result?.success !== true && result?.reloadRequired === true) {
        try {
            scheduleWindowReload(win, reason || result.message);
            return {
                ...result,
                phase: 'reload-scheduled'
            };
        } catch (error) {
            return {
                ...result,
                phase: 'failed',
                message: `${result.message || '渲染操作失败'}；安排恢复重载失败: ${error.message}`
            };
        }
    }
    return result;
}


function ensureTopMost(win) {
    if (!win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, 'screen-saver')
    }
}

// ===== 跨屏方案辅助函数 =====
// 单显示器全屏边界：左/上各内缩 1px，破坏“起点贴齐 + size 等于 display”的完美全屏判定，
// 规避 DWM/Chromium borderless-fullscreen / 遮挡优化带来的副作用（后台视频暂停、播放器卡顿等）。
// 用于把窗口尺寸定为单个显示器的全屏填充范围。
function getFullscreenDisplayBounds(display) {
    const b = display && display.bounds ? display.bounds : { x: 0, y: 0, width: 1280, height: 720 };
    return {
        x: b.x + 1,
        y: b.y + 1,
        width: Math.max(1, b.width - 1),
        height: Math.max(1, b.height - 1),
    };
}

// 启动时选择窗口所在显示器：优先上次保存的显示器（config.ui.model_position.display），否则主屏。
function findStartupDisplay(config) {
    const displays = screen.getAllDisplays();
    const saved = config && config.ui && config.ui.model_position && config.ui.model_position.display;
    if (saved && Number.isFinite(saved.screenX) && Number.isFinite(saved.screenY)) {
        const px = saved.screenX + 10;
        const py = saved.screenY + 10;
        const found = displays.find(d =>
            px >= d.bounds.x && px < d.bounds.x + d.bounds.width &&
            py >= d.bounds.y && py < d.bounds.y + d.bounds.height
        );
        if (found) return found;
        try {
            const near = screen.getDisplayNearestPoint({ x: saved.screenX, y: saved.screenY });
            if (near) return near;
        } catch (e) { /* ignore */ }
    }
    return screen.getPrimaryDisplay();
}

// 创建/跨屏后多次重申窗口边界：抵消创建期被夹到 workArea，以及跨不同 DPI 屏时 Electron 单次
// setBounds 把尺寸算错。
//
// 关键：每次调用先取消该窗口上一轮“尚未触发”的重申计时器。否则快速来回切屏时，上一次切到 A 屏
// 排的 500/1500ms 延迟重申，会在已经切到 B 屏后触发、把窗口拽回 A 屏的尺寸/位置，两边互相打架
// 导致窗口尺寸错乱、模型与光标错位。
function schedulePetBoundsRepair(win, targetBounds) {
    if (!win || !targetBounds) return;
    if (win._petBoundsRepairTimers) {
        for (const t of win._petBoundsRepairTimers) clearTimeout(t);
    }
    win._petBoundsRepairTimers = [];
    // 容差 2px：off-by-one + DPI 取整会让 getBounds 比目标大 1~2px，足够接近就不再重申，避免无谓抖动。
    const near = (a, b) => Math.abs(a - b) <= 2;
    [0, 50, 300, 800].forEach((delay) => {
        const id = setTimeout(() => {
            if (!win || win.isDestroyed()) return;
            const b = win.getBounds();
            if (near(b.x, targetBounds.x) && near(b.y, targetBounds.y) &&
                near(b.width, targetBounds.width) && near(b.height, targetBounds.height)) return;
            try {
                win.setBounds(targetBounds);
            } catch (e) {
                console.error('[PetBoundsRepair] setBounds 失败:', e.message);
            }
        }, delay);
        win._petBoundsRepairTimers.push(id);
    });
}

// 跨屏切换时，Electron 首次 setBounds 会用错误缩放因子把尺寸算错（副屏→主屏常“过冲”到比目标更大），
// 随后由 schedulePetBoundsRepair 修正，中间一两帧会“闪跳”。切屏期间把窗口透明度降到 0
// 遮住过渡，待 getBounds 收敛到目标尺寸后再恢复原透明度。
function hidePetForMove(win) {
    if (!win || win.isDestroyed()) return;
    if (win._petHidden) return; // 已在切屏过渡中，不重复记录原透明度
    try {
        win._petPrevOpacity = win.getOpacity();
        win._petHidden = true;
        win.setOpacity(0);
    } catch (e) { /* ignore */ }
}

function revealPetAfterMove(win, targetBounds) {
    if (!win || win.isDestroyed()) return;
    if (win._petRevealPoll) { clearInterval(win._petRevealPoll); win._petRevealPoll = null; }
    const near = (a, b) => Math.abs(a - b) <= 2;
    const start = Date.now();
    let settledAt = null;
    win._petRevealPoll = setInterval(() => {
        if (!win || win.isDestroyed()) { clearInterval(win._petRevealPoll); win._petRevealPoll = null; return; }
        const b = win.getBounds();
        const settled = near(b.x, targetBounds.x) && near(b.y, targetBounds.y) &&
            near(b.width, targetBounds.width) && near(b.height, targetBounds.height);
        if (settled && settledAt === null) settledAt = Date.now();
        // 关键：尺寸“稳定”仅代表窗口边界到位，渲染端此时可能还没以新屏尺寸重排/重绘完成。
        // 再多等 ~120ms 宽限期让渲染端画好，再恢复显示，避免恢复瞬间露出未重绘的过渡帧（闪一下）。
        // 800ms 硬兜底，任何情况下都不会永久隐藏。
        if ((settledAt !== null && Date.now() - settledAt >= 120) || Date.now() - start > 800) {
            try { win.setOpacity(win._petPrevOpacity != null ? win._petPrevOpacity : 1); } catch (e) { /* ignore */ }
            win._petHidden = false;
            clearInterval(win._petRevealPoll);
            win._petRevealPoll = null;
        }
    }, 16);
}

function createWindow () {
    // 读取配置
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.error('读取配置失败:', e);
    }

    // ===== 跨屏方案：窗口只覆盖“单个”显示器，跨屏靠整窗重定位（move-window-to-display）实现 =====
    // 不再把所有显示器并集成一块巨型窗口；启动时落在上次所在的显示器（否则主屏）。
    const startupDisplay = findStartupDisplay(config);
    const startupBounds = getFullscreenDisplayBounds(startupDisplay);
    const minX = startupBounds.x;
    const minY = startupBounds.y;
    const totalWidth = startupBounds.width;
    const totalHeight = startupBounds.height;

    console.log(`=== 窗口创建信息（单屏方案）===`)
    console.log(`目标显示器: id=${startupDisplay.id}, 缩放=${startupDisplay.scaleFactor}, bounds=${JSON.stringify(startupDisplay.bounds)}`)
    console.log(`窗口尺寸: ${totalWidth}x${totalHeight}`)
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
        resizable: false,
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
    
    // 创建后多次重申单屏边界（替代旧的一次性 100ms 自检），抵消创建期被夹到 workArea。
    schedulePetBoundsRepair(win, { x: minX, y: minY, width: totalWidth, height: totalHeight })
    
    win.loadFile('index.html')
    win.on('minimize', (event) => {
        event.preventDefault()
        win.restore()
    })
    // 移除 will-move 限制,允许跨屏幕移动
    win.on('blur', () => {
        ensureTopMost(win)
    })
    win.on('closed', () => {
        avatarSwitchTransaction?.clearWindow(win.id);
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
    let configData = {};
    try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        modelType = configData.ui?.model_type || 'live2d';
    } catch (e) {
        console.log('读取配置失败，使用默认Live2D模式');
    }

    normalizeConfiguredAvatarType(configData);

    const mainWindow = createWindow();

    // 启动 HTTP API 服务器
    const httpServer = new HttpServer();
    httpServer.start();

    // 注册全局快捷键
    shortcutManager = new ShortcutManager(configData);
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

app.on('will-quit', () => {
    avatarSwitchTransaction?.dispose();
    avatarSwitchTransaction = null;
    if (shortcutManager) {
        shortcutManager.unregisterAll();
        shortcutManager = null;
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// 旧的 'window-move'（巨窗跟随 + 动态并集 setBounds）方案已废弃。
// 跨屏改由 'move-window-to-display' 实现（见下方），渲染端拖动只移动模型精灵。

ipcMain.on('set-ignore-mouse-events', (event, { ignore, options }) => {
    BrowserWindow.fromWebContents(event.sender).setIgnoreMouseEvents(ignore, options)
})

ipcMain.on('set-window-opacity', (event, opacity) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setOpacity(Math.max(0, Math.min(1, opacity)));
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

// SiliconFlow ASR 通过主进程请求，避免渲染进程跨域限制并保护 API Key。
ipcMain.handle('siliconflow-asr-transcribe', async (event, audioBytes) => {
    try {
        const configData = loadConfigData();
        const asrConfig = configData.cloud?.siliconflow_asr || {};
        if (asrConfig.enabled !== true) {
            throw new Error('SiliconFlow ASR 未启用');
        }
        if (!asrConfig.key) {
            throw new Error('SiliconFlow ASR API Key 为空');
        }

        const audioSize = audioBytes?.byteLength || audioBytes?.length || 0;
        logToTerminal('info', `【SiliconFlow ASR】开始上传录音（${audioSize} bytes，模型: ${asrConfig.model || 'TeleAI/TeleSpeechASR'}）`);

        const formData = new FormData();
        formData.append('file', new Blob([audioBytes], { type: 'audio/wav' }), 'recording.wav');
        formData.append('model', asrConfig.model || 'TeleAI/TeleSpeechASR');

        const response = await fetch(
            asrConfig.api || 'https://api.siliconflow.cn/v1/audio/transcriptions',
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${asrConfig.key}` },
                body: formData,
            }
        );
        const bodyText = await response.text();
        let result;
        try { result = JSON.parse(bodyText); } catch (_) { result = { error: bodyText }; }
        if (!response.ok) {
            const detail = result?.message || result?.error?.message || result?.error || bodyText;
            throw new Error(`HTTP ${response.status}: ${detail || '识别请求失败'}`);
        }
        logToTerminal('info', `【SiliconFlow ASR】识别成功${result.text ? `：${result.text}` : '，但返回文本为空'}`);
        return { success: true, text: result.text || '' };
    } catch (error) {
        logToTerminal('error', `【SiliconFlow ASR】请求失败：${error.message}`);
        return { success: false, error: error.message };
    }
})

// 列出已扫描到的 Live2D 模型（供 WebUI、快捷面板和兼容接口使用）。
ipcMain.handle('get-live2d-models', async () => {
    try {
        return { success: true, models: scanLive2DModels() };
    } catch (error) {
        return { success: false, message: error.message, models: [] };
    }
});

// 渲染进程完成热切换后，通过 requestId 确认主进程正在等待的请求。
ipcMain.handle('live2d-switch-model-result', (event, payload) => {
    return completeRendererRequest(event, payload);
});

ipcMain.handle('avatar-switch-type-result', (event, payload) => {
    return completeRendererRequest(event, payload);
});

ipcMain.handle('avatar-reload-model-result', (event, payload) => {
    return completeRendererRequest(event, payload);
});

// 每次窗口启动并完成 Avatar 初始化后回报 ready，用于结束跨渲染引擎切换事务。
ipcMain.handle('avatar-runtime-ready', async (event, payload) => {
    try {
        const win = getRendererWindow(event);
        const result = await getAvatarSwitchTransaction().handleRuntimeReady({
            windowId: win.id,
            success: payload?.success === true,
            activeType: payload?.activeType,
            message: typeof payload?.message === 'string' ? payload.message : ''
        });
        console.log(
            `[Avatar] runtime ready: phase=${result.phase}, active=${result.activeType || 'none'}`
        );
        return result;
    } catch (error) {
        console.error('处理 Avatar runtime ready 失败:', error);
        return { success: false, phase: 'failed', message: error.message };
    }
});

// 重新扫描并热重载当前 Live2D 模型（保留旧接口名，不再改写源码、不再直接 reload 窗口）。
ipcMain.handle('update-live2d-model', async (event) => {
    try {
        let preferred = null;
        try {
            preferred = loadConfigData().ui?.live2d_model || null;
        } catch (_) {}

        const { modelPath, entry, all } = resolveLive2DModel(preferred);
        if (!modelPath || !entry) {
            return { success: false, message: '2D 目录下没有找到任何模型' };
        }

        const win = getRendererWindow(event);
        const result = await requestRendererConfirmation(
            event,
            'live2d-switch-model',
            { modelName: entry.name, modelPath },
            'live2d-refresh'
        );
        if (!result.success) {
            return finalizeRendererFailure(win, result, 'Live2D 模型恢复需要窗口重载');
        }
        return {
            success: true,
            phase: 'ready',
            targetType: 'live2d',
            activeType: 'live2d',
            message: `已重新扫描（共 ${all.length} 个模型），已加载 ${entry.name}`
        };
    } catch (error) {
        console.error('手动更新模型时出错:', error);
        return { success: false, message: `更新失败: ${error.message}` };
    }
});

// 切换 Live2D 模型：先让渲染进程成功加载，再持久化选择。
ipcMain.handle('switch-live2d-model', async (event, modelName) => {
    try {
        console.log(`切换模型到: ${modelName}`);
        const { entry, all } = resolveAvatarModelSelection('live2d', modelName);
        if (!entry) {
            return {
                success: false,
                message: `未找到模型 "${modelName}"（2D 目录下共 ${all.length} 个模型）`
            };
        }

        const win = getRendererWindow(event);
        const result = await requestRendererConfirmation(
            event,
            'live2d-switch-model',
            { modelName: entry.name, modelPath: entry.modelPath },
            'live2d-switch'
        );
        if (!result.success) {
            return finalizeRendererFailure(win, result, 'Live2D 模型恢复需要窗口重载');
        }

        updateUiConfig({ live2d_model: entry.name });
        sendUiConfigPatch(win, { live2d_model: entry.name });
        return {
            success: true,
            phase: 'ready',
            targetType: 'live2d',
            activeType: 'live2d',
            message: `模型已切换到 ${entry.name}`
        };
    } catch (error) {
        console.error('切换模型时出错:', error);
        return { success: false, message: `切换失败: ${error.message}` };
    }
});


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
// 返回跨屏所需的字段（screenX/screenY 为屏幕绝对坐标，x/y 为相对当前窗口左上角的坐标），
// 同时保留 bounds/workArea/rotation 以兼容旧调用（如 model-setup.js）。
ipcMain.handle('get-all-displays', (event) => {
    const displays = screen.getAllDisplays();
    const win = BrowserWindow.fromWebContents(event.sender);
    const windowBounds = win && !win.isDestroyed() ? win.getBounds() : { x: 0, y: 0 };
    return displays.map(display => ({
        id: display.id,
        x: display.bounds.x - windowBounds.x,
        y: display.bounds.y - windowBounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        screenX: display.bounds.x,
        screenY: display.bounds.y,
        scaleFactor: display.scaleFactor,
        // 兼容旧调用
        bounds: display.bounds,
        workArea: display.workArea,
        rotation: display.rotation
    }));
});

// 获取“当前窗口所在”的显示器信息（渲染端用 screenX/screenY 做窗口<->屏幕坐标换算）
ipcMain.handle('get-current-display', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const windowBounds = win.getBounds();
    const currentDisplay = screen.getDisplayMatching(windowBounds);
    return {
        id: currentDisplay.id,
        x: 0,
        y: 0,
        width: currentDisplay.bounds.width,
        height: currentDisplay.bounds.height,
        screenX: currentDisplay.bounds.x,
        screenY: currentDisplay.bounds.y,
        scaleFactor: currentDisplay.scaleFactor,
        workArea: currentDisplay.workArea
    };
});

// 获取主显示器信息
ipcMain.handle('get-primary-display-info', () => {
    const primary = screen.getPrimaryDisplay();
    return {
        id: primary.id,
        bounds: { ...primary.bounds },
        workArea: primary.workArea,
        scaleFactor: primary.scaleFactor
    };
});

// ===== 跨屏核心：把整个窗口重定位到“包含指定屏幕点”的显示器并填满它 =====
// 渲染端在松手时检测到模型中心越出当前窗口，换算成屏幕绝对坐标后调用本接口。
ipcMain.handle('move-window-to-display', async (event, screenX, screenY) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { success: false, error: 'Window not found' };
    try {
        const displays = screen.getAllDisplays();
        const currentBounds = win.getBounds();

        // 找到包含该屏幕点的目标显示器
        let targetDisplay = null;
        for (const display of displays) {
            const b = display.bounds;
            if (screenX >= b.x && screenX < b.x + b.width &&
                screenY >= b.y && screenY < b.y + b.height) {
                targetDisplay = display;
                break;
            }
        }
        if (!targetDisplay) {
            console.log('move-window-to-display: 未找到包含点的屏幕, screenX=', screenX, 'screenY=', screenY);
            return { success: false, error: 'No display found at the given point' };
        }

        const currentDisplay = screen.getDisplayMatching(currentBounds);
        if (currentDisplay.id === targetDisplay.id) {
            return { success: true, sameDisplay: true };
        }

        console.log('move-window-to-display: 从屏幕', currentDisplay.id, '切换到屏幕', targetDisplay.id);

        // 不同屏幕可能有不同缩放：广播 scaleRatio（渲染端目前保持模型原大小，仅调位置）
        const scaleRatio = targetDisplay.scaleFactor / currentDisplay.scaleFactor;
        const newBounds = getFullscreenDisplayBounds(targetDisplay);

        // 切屏期间隐藏窗口，遮住“尺寸过冲/修正”那一两帧的闪跳；尺寸稳定后由 revealPetAfterMove 恢复。
        hidePetForMove(win);
        win.setBounds(newBounds);

        // 关键修复：跨“不同缩放因子(DPI)”的显示器时，Electron 单次 setBounds 会用错误的缩放因子
        // 计算物理尺寸，使窗口尺寸不匹配目标屏。等窗口落到目标屏后多次重申边界，按目标屏缩放因子重算尺寸。
        schedulePetBoundsRepair(win, newBounds);
        revealPetAfterMove(win, newBounds);

        setTimeout(() => {
            if (!win.isDestroyed()) {
                win.webContents.send('display-changed', {
                    displayId: targetDisplay.id,
                    bounds: targetDisplay.bounds,
                    scaleFactor: targetDisplay.scaleFactor,
                    scaleRatio: scaleRatio,
                    previousScaleFactor: currentDisplay.scaleFactor
                });
            }
        }, 32);

        return {
            success: true,
            displayId: targetDisplay.id,
            bounds: targetDisplay.bounds,
            scaleFactor: targetDisplay.scaleFactor,
            scaleRatio: scaleRatio
        };
    } catch (err) {
        console.error('move-window-to-display 错误:', err.message);
        return { success: false, error: err.message };
    }
});


// 添加保存模型位置的IPC处理器
ipcMain.on('save-model-position', (event, position) => {
    try {
        const nextPosition = position && typeof position === 'object' ? position : {};
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

        // 跨屏方案：位置按“当前显示器内的相对位置（0~1）”保存，不再区分单/双屏 x_dual/y_dual。
        configData.ui.model_position.x = nextPosition.x;
        configData.ui.model_position.y = nextPosition.y;
        configData.ui.model_scale = nextPosition.scale;

        // 记录当前窗口所在显示器的屏幕原点，供下次启动把窗口落回同一块屏（findStartupDisplay 使用）。
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            try {
                const d = screen.getDisplayMatching(win.getBounds());
                configData.ui.model_position.display = { screenX: d.bounds.x, screenY: d.bounds.y };
            } catch (e) { /* ignore */ }
        }

        // 保存到文件
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

        // v2：如果渲染端提供模型名，同时保存该模型自己的位置/缩放偏好。
        if (nextPosition.modelName) {
            saveModelPrefs('live2d', nextPosition.modelName, {
                position: {
                    x: nextPosition.x,
                    y: nextPosition.y
                },
                scale: nextPosition.scale
            });
        }

    } catch (error) {
        console.error('保存模型位置失败:', error);
    }
});

// 形态切换：主进程负责配置提交、渲染侧确认、窗口重载和失败回滚。
ipcMain.handle('avatar:switch-type', async (event, type) => {
    try {
        const win = getRendererWindow(event);
        return await getAvatarSwitchTransaction().switchType(type, {
            event,
            win,
            windowId: win.id
        });
    } catch (error) {
        console.error('形态切换失败:', error);
        return { success: false, phase: 'failed', message: `形态切换失败: ${error.message}` };
    }
});

// 设置指定形态的模型：先确认当前渲染侧已应用，再持久化选择。
ipcMain.handle('avatar:set-model', async (event, payload) => {
    try {
        const type = String(payload?.type || '').trim().toLowerCase();
        if (!SUPPORTED_AVATAR_TYPES.has(type)) {
            return { success: false, message: `当前 PR 未接入形态: ${type || '未指定'}` };
        }

        const requestedName = String(payload?.model_name || payload?.name || '');
        if (!requestedName.trim()) {
            return { success: false, message: '未提供模型' };
        }

        const selection = resolveAvatarModelSelection(type, requestedName);
        if (!selection.entry) {
            return {
                success: false,
                message: `未找到 ${type} 模型 "${requestedName}"（当前共 ${selection.all.length} 个）`
            };
        }

        const configPatch = type === 'vrm'
            ? {
                vrm_model: selection.entry.name,
                vrm_model_path: selection.entry.modelPath
            }
            : { live2d_model: selection.entry.name };
        const configData = loadConfigData();
        const activeType = normalizeAvatarType(configData.ui?.model_type) || 'live2d';
        const win = getRendererWindow(event);

        if (activeType === type) {
            let result;
            if (type === 'live2d') {
                result = await requestRendererConfirmation(
                    event,
                    'live2d-switch-model',
                    {
                        modelName: selection.entry.name,
                        modelPath: selection.entry.modelPath
                    },
                    'live2d-set-model'
                );
            } else {
                result = await requestRendererConfirmation(
                    event,
                    'avatar-reload-model',
                    {
                        type,
                        configKey: 'vrm_model_path',
                        configValue: selection.entry.modelPath
                    },
                    'avatar-reload-model'
                );
            }
            if (!result.success) {
                return finalizeRendererFailure(
                    win,
                    result,
                    `${type} 模型恢复需要窗口重载`
                );
            }
        }

        updateUiConfig(configPatch);
        sendUiConfigPatch(win, configPatch);
        if (activeType === type) {
            return {
                success: true,
                phase: 'ready',
                targetType: type,
                activeType: type,
                message: `已应用模型：${selection.entry.name}`
            };
        }
        return {
            success: true,
            phase: 'ready',
            targetType: type,
            activeType,
            message: `已保存模型选择：${selection.entry.name}（切换到 ${type} 形态时生效）`
        };
    } catch (error) {
        console.error('设置形态模型失败:', error);
        return { success: false, message: `设置失败: ${error.message}` };
    }
});

// 形态模型列表：本 PR 只暴露已经接入的 Live2D 和 VRM。
ipcMain.handle('avatar:get-models', async (event, type) => {
    try {
        const normalized = String(type || 'live2d').trim().toLowerCase();
        const scanners = {
            live2d: scanLive2DModels,
            vrm: scanVRMModels
        };
        const scan = scanners[normalized];
        if (!scan) {
            return {
                success: false,
                message: `当前 PR 未接入形态: ${type}`,
                models: []
            };
        }
        return { success: true, models: scan() };
    } catch (error) {
        return { success: false, message: error.message, models: [] };
    }
});

// 切换到 VRM 模型：保留旧 IPC 名称，同时接入统一切换事务。
ipcMain.handle('switch-vrm-model', async (event, vrmFileName) => {
    try {
        console.log(`切换VRM模型到: ${vrmFileName}`);

        const selection = resolveAvatarModelSelection('vrm', vrmFileName);
        if (!selection.entry) {
            return {
                success: false,
                message: `未找到 VRM 模型 "${vrmFileName}"（当前共 ${selection.all.length} 个）`
            };
        }

        const configData = loadConfigData();
        const activeType = normalizeAvatarType(configData.ui?.model_type) || 'live2d';
        const win = getRendererWindow(event);
        const modelPatch = {
            vrm_model: selection.entry.name,
            vrm_model_path: selection.entry.modelPath
        };

        if (activeType === 'vrm') {
            const reloadResult = await requestRendererConfirmation(
                event,
                'avatar-reload-model',
                {
                    type: 'vrm',
                    configKey: 'vrm_model_path',
                    configValue: selection.entry.modelPath
                },
                'legacy-vrm-reload'
            );
            if (!reloadResult.success) {
                return finalizeRendererFailure(
                    win,
                    reloadResult,
                    'VRM 模型恢复需要窗口重载'
                );
            }
            updateUiConfig(modelPatch);
            sendUiConfigPatch(win, modelPatch);
            return {
                success: true,
                phase: 'ready',
                targetType: 'vrm',
                activeType: 'vrm',
                message: `VRM 模型已切换到 ${selection.entry.name}`
            };
        }

        // 先保存 VRM 选择，但不提前改 model_type，让事务仍能读取真实旧形态。
        updateUiConfig(modelPatch);
        sendUiConfigPatch(win, modelPatch);
        const switchResult = await getAvatarSwitchTransaction().switchType('vrm', {
            event,
            win,
            windowId: win.id
        });

        return {
            ...switchResult,
            message: switchResult.success
                ? `${switchResult.message}；VRM 模型：${selection.entry.name}`
                : switchResult.message
        };
    } catch (error) {
        console.error('切换VRM模型时出错:', error);
        return { success: false, message: `切换失败: ${error.message}` };
    }
});
