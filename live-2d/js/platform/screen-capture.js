const { isWayland } = require('./runtime');

async function captureScreen({ desktopCapturer, screen, screenshot, wayland = isWayland() }) {
    if (wayland) {
        // PipeWire/xdg-desktop-portal shows the compositor's source picker.
        // Do not infer a screen from global cursor coordinates under Wayland.
        const sources = await desktopCapturer.getSources({
            types: ['screen'], thumbnailSize: { width: 1600, height: 900 }
        });
        const source = sources.find(item => !item.thumbnail.isEmpty());
        if (!source) throw new Error('屏幕共享已取消或未返回图像。请确认 PipeWire 与 xdg-desktop-portal 正常运行。');
        return source.thumbnail;
    }
    const displays = (await screenshot.listDisplays()).sort((a, b) => (a.left || 0) - (b.left || 0));
    const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const index = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x).findIndex(d => d.id === current.id);
    if (!displays[index]) throw new Error('无法匹配当前显示器');
    return screenshot({ screen: displays[index].id, format: 'jpg' });
}

module.exports = { captureScreen };
