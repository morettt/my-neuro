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
        this._registerAppControls();
        this._registerTTSInterrupt();
        this._registerWindowTopMost();
        this._registerChatFocus();
        this._registerMotionAndMusicControls();
        this._registerSubtitleToggle(); // --- 核心修改：新增快捷键注册 ---

        console.log(`已注册 ${this.shortcuts.length} 个全局快捷键`);
    }

    _registerAppControls() {
        this._register('CommandOrControl+Q', () => app.quit(), '退出应用');
    }

    _registerTTSInterrupt() {
        this._register('CommandOrControl+G', () => {
            BrowserWindow.getAllWindows()[0]?.webContents.send('interrupt-tts');
        }, '打断 TTS 语音');
    }

    _registerWindowTopMost() {
        this._register('CommandOrControl+T', () => {
            BrowserWindow.getAllWindows().forEach(win => win.setAlwaysOnTop(true, 'screen-saver'));
        }, '强制窗口置顶');
    }

    _registerChatFocus() {
        this._register('Alt+`', () => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('toggle-chat-focus');
            }
        }, '切换焦点到聊天框');
    }
    
    // --- 核心修改：新增方法 ---
    _registerSubtitleToggle() {
        this._register('Alt+0', () => {
             BrowserWindow.getAllWindows()[0]?.webContents.send('toggle-subtitle-visibility');
        }, '显示/隐藏字幕组件');
    }

    _registerMotionAndMusicControls() {
        for (let i = 1; i <= 9; i++) {
            const action = () => {
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (!mainWindow) return;
                if (i === 6) {
                    mainWindow.webContents.send('trigger-music-play');
                } else if (i === 8) {
                    mainWindow.webContents.send('trigger-music-stop-with-motion');
                } else {
                    mainWindow.webContents.send('trigger-motion-hotkey', i - 1);
                }
            };
            const desc = i === 6 ? '播放随机音乐' : i === 8 ? '停止音乐并播放赌气动作' : `触发动作 ${i}`;
            this._register(`CommandOrControl+Shift+${i}`, action, desc);
        }
        this._register('CommandOrControl+Shift+0', () => {
            BrowserWindow.getAllWindows()[0]?.webContents.send('stop-all-motions');
        }, '停止所有动作');
    }

    _register(accelerator, callback, description = '') {
        try {
            if (globalShortcut.register(accelerator, callback)) {
                this.shortcuts.push({ accelerator, description });
                console.log(`✓ 已注册快捷键: ${accelerator}${description ? ` (${description})` : ''}`);
            } else {
                console.warn(`✗ 快捷键注册失败: ${accelerator}`);
            }
        } catch (error) {
            console.error(`注册快捷键 ${accelerator} 时出错:`, error);
        }
    }

    unregisterAll() {
        globalShortcut.unregisterAll();
        console.log('已取消所有全局快捷键');
        this.shortcuts = [];
    }

    getRegisteredShortcuts() {
        return this.shortcuts;
    }
}

module.exports = { ShortcutManager };