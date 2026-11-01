// Electron's setIgnoreMouseEvents({ forward: true }) forwards movement only on
// Windows/macOS. Poll X11 cursor positions to recover hit testing on an ignored
// overlay; clicks and drags themselves remain native Chromium input events.
function startX11PointerPolling(win, screen, {
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = Date.now
} = {}) {
    let previous = '';
    let sentAt = -Infinity;
    let stopped = false;
    const timer = setIntervalFn(() => {
        if (stopped || win.isDestroyed() || win.webContents.isDestroyed() || !win.isVisible()) return;
        if (win.webContents.isLoadingMainFrame()) return;
        const cursor = screen.getCursorScreenPoint();
        const bounds = win.getContentBounds();
        // Electron screen points and content bounds are already DIP, matching
        // renderer CSS pixels. Multiplying by devicePixelRatio breaks HiDPI.
        const key = [cursor.x, cursor.y, bounds.x, bounds.y, bounds.width, bounds.height].join(',');
        const time = now();
        if (key === previous && time - sentAt < 250) return;
        previous = key;
        sentAt = time;
        win.webContents.send('linux-pointer-position', {
            clientX: cursor.x - bounds.x, clientY: cursor.y - bounds.y,
            screenX: cursor.x, screenY: cursor.y
        });
    }, 33);
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearIntervalFn(timer);
    };
    win.once('closed', stop);
    return stop;
}

module.exports = { startX11PointerPolling };
