const { globalShortcut, BrowserWindow, app } = require('electron');

let uiohookApi = null;
try {
    uiohookApi = require('uiohook-napi');
} catch (error) {
    console.warn('[PTT] uiohook-napi is unavailable; PTT will use window focus fallback only.', error.message);
}

class ShortcutManager {
    constructor(config = {}) {
        this.config = config || {};
        this.shortcuts = [];
        this.pttKey = this._normalizeKey(this.config.asr?.ptt_key || 'v') || 'v';
        this.pttKeyCode = null;
        this.pttKeyDown = false;
        this.pttHookStarted = false;
        this.pttHandlers = null;
    }

    registerAll() {
        this._registerAppControls();
        this._registerTTSInterrupt();
        this._registerWindowTopMost();
        this._registerMotionAndMusicControls();
        this._registerBubbleToggle();
        this._registerGlobalPTT();

        console.log(`Registered ${this.shortcuts.length} global shortcuts.`);
    }

    _registerAppControls() {
        this._register('CommandOrControl+Q', () => {
            app.quit();
        }, 'Quit app');
    }

    _registerTTSInterrupt() {
        this._register('CommandOrControl+G', () => {
            this._sendToMainWindow('interrupt-tts');
        }, 'Interrupt TTS');
    }

    _registerWindowTopMost() {
        this._register('CommandOrControl+T', () => {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
                win.setAlwaysOnTop(true, 'screen-saver');
            });
        }, 'Force window topmost');
    }

    _registerMotionAndMusicControls() {
        for (let i = 1; i <= 9; i++) {
            if (i === 6) {
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    this._sendToMainWindow('trigger-music-play');
                }, 'Play random music');
            } else if (i === 8) {
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    this._sendToMainWindow('trigger-music-stop-with-motion');
                }, 'Stop music with motion');
            } else {
                this._register(`CommandOrControl+Shift+${i}`, () => {
                    this._sendToMainWindow('trigger-motion-hotkey', i - 1);
                }, `Trigger motion ${i}`);
            }
        }

        this._register('CommandOrControl+Shift+0', () => {
            this._sendToMainWindow('stop-all-motions');
        }, 'Stop all motions');
    }

    _registerBubbleToggle() {
        this._register('CommandOrControl+M', () => {
            this._sendToMainWindow('toggle-bubble');
        }, 'Toggle bubble');
    }

    _registerGlobalPTT() {
        if (!uiohookApi) return;

        const { uIOhook } = uiohookApi;
        this.pttKeyCode = this._resolveUiohookKeyCode(this.pttKey);
        if (this.pttKeyCode == null) {
            console.warn(`[PTT] Unsupported ptt_key "${this.pttKey}". Global PTT is disabled.`);
            return;
        }

        const isPTTEvent = (event) => event && event.keycode === this.pttKeyCode;
        const onKeyDown = (event) => {
            if (!isPTTEvent(event) || this.pttKeyDown) return;
            this.pttKeyDown = true;
            this._sendPTT('down');
        };
        const onKeyUp = (event) => {
            if (!isPTTEvent(event)) return;
            if (!this.pttKeyDown) {
                this._sendPTT('up');
                return;
            }
            this.pttKeyDown = false;
            this._sendPTT('up');
        };

        try {
            uIOhook.on('keydown', onKeyDown);
            uIOhook.on('keyup', onKeyUp);
            uIOhook.start();
            this.pttHandlers = { onKeyDown, onKeyUp };
            this.pttHookStarted = true;
            console.log(`[PTT] Global hold-to-talk registered on ${this.pttKey.toUpperCase()}.`);
        } catch (error) {
            try {
                uIOhook.off('keydown', onKeyDown);
                uIOhook.off('keyup', onKeyUp);
            } catch (_) {
                // Ignore cleanup errors from a partially started hook.
            }
            console.warn('[PTT] Failed to start global PTT hook; window focus fallback remains available.', error);
        }
    }

    _unregisterGlobalPTT() {
        if (!uiohookApi) return;

        const { uIOhook } = uiohookApi;
        if (this.pttHandlers) {
            try {
                uIOhook.off('keydown', this.pttHandlers.onKeyDown);
                uIOhook.off('keyup', this.pttHandlers.onKeyUp);
            } catch (error) {
                console.warn('[PTT] Failed to remove global PTT handlers.', error);
            }
            this.pttHandlers = null;
        }

        if (this.pttHookStarted) {
            try {
                uIOhook.stop();
            } catch (error) {
                console.warn('[PTT] Failed to stop global PTT hook.', error);
            }
        }

        this.pttHookStarted = false;
        this.pttKeyDown = false;
    }

    _register(accelerator, callback, description = '') {
        try {
            const success = globalShortcut.register(accelerator, callback);
            if (success) {
                this.shortcuts.push({ accelerator, description });
                console.log(`Registered shortcut: ${accelerator}${description ? ` (${description})` : ''}`);
            } else {
                console.warn(`Failed to register shortcut: ${accelerator}`);
            }
        } catch (error) {
            console.error(`Error registering shortcut ${accelerator}:`, error);
        }
    }

    unregisterAll() {
        this._unregisterGlobalPTT();
        globalShortcut.unregisterAll();
        this.shortcuts = [];
        console.log('Unregistered all global shortcuts.');
    }

    getRegisteredShortcuts() {
        return this.shortcuts;
    }

    _sendPTT(action) {
        this._sendToMainWindow('ptt-global-key', {
            action,
            key: this.pttKey,
            source: 'uiohook'
        });
    }

    _sendToMainWindow(channel, ...args) {
        const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
        if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
        mainWindow.webContents.send(channel, ...args);
    }

    _normalizeKey(value) {
        const raw = String(value || '').trim().toLowerCase();
        const aliases = {
            ' ': 'space',
            spacebar: 'space',
            return: 'enter',
            esc: 'escape',
            control: 'ctrl',
            command: 'meta',
            cmd: 'meta',
            win: 'meta',
            windows: 'meta',
            option: 'alt',
            left: 'arrowleft',
            up: 'arrowup',
            right: 'arrowright',
            down: 'arrowdown'
        };
        return aliases[raw] || raw;
    }

    _resolveUiohookKeyCode(key) {
        if (!uiohookApi) return null;

        const { UiohookKey } = uiohookApi;
        if (/^[a-z]$/.test(key)) return UiohookKey[key.toUpperCase()];
        if (/^[0-9]$/.test(key)) return UiohookKey[key];
        if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return UiohookKey[key.toUpperCase()];

        const names = {
            backspace: 'Backspace',
            tab: 'Tab',
            enter: 'Enter',
            escape: 'Escape',
            space: 'Space',
            pageup: 'PageUp',
            pagedown: 'PageDown',
            end: 'End',
            home: 'Home',
            arrowleft: 'ArrowLeft',
            arrowup: 'ArrowUp',
            arrowright: 'ArrowRight',
            arrowdown: 'ArrowDown',
            insert: 'Insert',
            delete: 'Delete',
            ctrl: 'Ctrl',
            alt: 'Alt',
            altright: 'AltRight',
            shift: 'Shift',
            shiftright: 'ShiftRight',
            meta: 'Meta'
        };

        if (/^numpad[0-9]$/.test(key)) {
            const digit = key.slice('numpad'.length);
            return UiohookKey[`Numpad${digit}`];
        }

        const name = names[key];
        return name ? UiohookKey[name] : null;
    }
}

module.exports = { ShortcutManager };
