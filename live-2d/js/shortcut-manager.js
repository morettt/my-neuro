const { globalShortcut, BrowserWindow, app } = require('electron');

/**
 * 全局快捷键管理器
 * 统一管理应用的所有全局快捷键
 */
class ShortcutManager {
    constructor() {
        this.shortcuts = [];
    }

    /**
     * 注册所有快捷键
     */
    registerAll() {
        // 应用控制类快捷键
        this._registerAppControls();

        // TTS 打断快捷键
        this._registerTTSInterrupt();

        // 窗口置顶快捷键
        this._registerWindowTopMost();

        // 动作和音乐控制快捷键
        this._registerMotionAndMusicControls();

        // 气泡框显示快捷键
        this._registerBubbleToggle();

        console.log(`已注册 ${this.shortcuts.length} 个全局快捷键！！！`);
    }

    /**
     * 注册应用控制快捷键
     */
    _registerAppControls() {
        this._register('CommandOrControl+Q', () => {
            app.quit();
        }, '退出应用');
    }

    /**
     * 注册 TTS 打断快捷键
     */
    _registerTTSInterrupt() {
        this._register('CommandOrControl+G', () => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
                mainWindow.webContents.send('interrupt-tts');
            }
        }, '打断 TTS 语音');
    }

    /**
     * 注册窗口置顶快捷键
     */
    _registerWindowTopMost() {
        this._register('CommandOrControl+T', () => {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
                win.setAlwaysOnTop(true, 'screen-saver');
            });
        }, '强制窗口置顶');
    }

    /**
     * 注册动作和音乐控制快捷键
     */
    _registerMotionAndMusicControls() {
        // Ctrl+Shift+1 到 Ctrl+Shift+9
        for (let i = 1; i <= 9; i++) {
            if (i === 6) {
                // Ctrl+Shift+6: 播放音乐
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    if (mainWindow) {
                        mainWindow.webContents.send('trigger-music-play');
                    }
                }, '播放随机音乐');
            } else if (i === 8) {
                // Ctrl+Shift+8: 停止音乐 + 赌气动作
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    if (mainWindow) {
                        mainWindow.webContents.send('trigger-music-stop-with-motion');
                    }
                }, '停止音乐并播放赌气动作');
            } else {
                // 其他: 触发对应索引的动作
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    const motionIndex = i - 1;
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    if (mainWindow) {
                        mainWindow.webContents.send('trigger-motion-hotkey', motionIndex);
                    }
                }, `触发动作 ${i}`);
            }
        }

        // Ctrl+Shift+0: 停止所有动作
        this._register('CommandOrControl+Shift+0', () => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
                mainWindow.webContents.send('stop-all-motions');
            }
        }, '停止所有动作');
    }

    /**
     * 注册气泡框切换快捷键
     */
    _registerBubbleToggle() {
        this._register('CommandOrControl+M', () => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
                mainWindow.webContents.send('toggle-bubble');
            }
        }, '切换气泡框显示/隐藏');
    }

    /**
     * 注册单个快捷键
     * @param {string} accelerator 快捷键组合
     * @param {Function} callback 回调函数
     * @param {string} description 描述
     */
    _register(accelerator, callback, description = '') {
        try {
            const success = globalShortcut.register(accelerator, callback);
            if (success) {
                this.shortcuts.push({ accelerator, description });
                console.log(`✓ 已注册快捷键: ${accelerator}${description ? ` (${description})` : ''}`);
            } else {
                console.warn(`✗ 快捷键注册失败: ${accelerator}`);
            }
        } catch (error) {
            console.error(`注册快捷键 ${accelerator} 时出错:`, error);
        }
    }

    /**
     * 取消所有快捷键
     */
    unregisterAll() {
        globalShortcut.unregisterAll();
        console.log('已取消所有全局快捷键');
        this.shortcuts = [];
    }

    /**
     * 获取已注册的快捷键列表
     */
    getRegisteredShortcuts() {
        return this.shortcuts;
    }
}

module.exports = { ShortcutManager };
