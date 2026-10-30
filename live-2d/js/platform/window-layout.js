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
