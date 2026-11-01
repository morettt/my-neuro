function windowScreenInfo({ nativeWayland, contentBounds, windowBounds, primaryDisplay, displays }) {
    if (!nativeWayland) return { primaryDisplay, allDisplays: displays, windowBounds };
    // Wayland deliberately does not expose a stable global window position.
    // Layout in the client surface, not in guessed desktop coordinates.
    const bounds = { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height };
    const display = { ...primaryDisplay, bounds, workArea: bounds };
    return { primaryDisplay: display, allDisplays: [display], windowBounds: bounds };
}

function fitViewRect(viewRect, hitBox, width, height) {
    if (!hitBox || hitBox.width <= 0 || hitBox.height <= 0) return null;
    const target = { x: width / 2, y: height / 2 + 12 };
    const factor = Math.min((width - 100) / hitBox.width, (height - 140) / hitBox.height, 1.5);
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return {
        x: target.x + (viewRect.x - hitBox.x - hitBox.width / 2) * factor,
        y: target.y + (viewRect.y - hitBox.y - hitBox.height / 2) * factor,
        width: viewRect.width * factor, height: viewRect.height * factor
    };
}

module.exports = { windowScreenInfo, fitViewRect };

function overlayDisplayBounds(display, platform = process.platform) {
    const bounds = display.bounds;
    if (platform !== 'linux') return bounds;
    const work = display.workArea;
    const area = work && work.width > 0 && work.height > 0 ? work : bounds;
    if (area.x === bounds.x && area.y === bounds.y && area.width === bounds.width && area.height === bounds.height) {
        // Mutter can infer fullscreen for an undecorated monitor-sized window,
        // even when Electron's isFullScreen() reports false. Leave a DIP border
        // when the monitor has no reserved panel/dock work area.
        return { x: area.x + 1, y: area.y + 1, width: Math.max(1, area.width - 2), height: Math.max(1, area.height - 2) };
    }
    return { ...area };
}

function overlayTopmostLevel(platform = process.platform) {
    return platform === 'linux' ? 'floating' : 'screen-saver';
}

module.exports.overlayDisplayBounds = overlayDisplayBounds;
module.exports.overlayTopmostLevel = overlayTopmostLevel;
