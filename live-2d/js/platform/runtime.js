const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function isWayland(env = process.env, platform = process.platform) {
    return platform === 'linux' && (env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY));
}

// Overlay positioning and pointer forwarding need X11. Native Wayland uses a
// normal, interactive window instead of an unpositionable desktop-sized overlay.
function linuxDisplayMode(env = process.env) {
    const mode = env.MY_NEURO_DISPLAY_MODE || (env.DISPLAY ? 'x11' : 'wayland');
    if (!['x11', 'wayland'].includes(mode)) throw new Error('MY_NEURO_DISPLAY_MODE must be x11 or wayland');
    if (mode === 'x11' && !env.DISPLAY) throw new Error('XWayland is unavailable (DISPLAY is unset). Use MY_NEURO_DISPLAY_MODE=wayland.');
    return mode;
}

function configureElectron(app) {
    if (process.platform !== 'linux') return { nativeWayland: false };
    const mode = linuxDisplayMode();
    if (process.env.MY_NEURO_SOFTWARE_RENDERING === '1') {
        app.commandLine.appendSwitch('use-gl', 'angle');
        app.commandLine.appendSwitch('use-angle', 'swiftshader');
        app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    }
    app.commandLine.appendSwitch('ozone-platform', mode);
    const features = new Set(app.commandLine.getSwitchValue('enable-features').split(',').filter(Boolean));
    features.add('WebRTCPipeWireCapturer');
    if (isWayland()) features.add('GlobalShortcutsPortal');
    app.commandLine.appendSwitch('enable-features', [...features].join(','));
    app.setDesktopName('io.github.morettt.MyNeuro.desktop');
    return { nativeWayland: mode === 'wayland' };
}

function projectPython(root, env = process.env, platform = process.platform) {
    return env.MY_NEURO_PYTHON || path.join(root, 'env', ...(platform === 'win32' ? ['python.exe'] : ['bin', 'python']));
}

function spawnManaged(command, args, options = {}) {
    return spawn(command, args, { ...options, detached: process.platform !== 'win32' });
}

async function stopManaged(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode) return;
    if (process.platform === 'win32') {
        await new Promise((resolve, reject) => {
            const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
            killer.once('error', reject);
            killer.once('exit', code => code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`)));
        });
        return;
    }
    // Only signal groups created by spawnManaged; never kill unrelated listeners.
    const signal = name => {
        try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    signal('SIGTERM');
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
        try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    signal('SIGKILL');
}

function requireLinuxPython(root) {
    const python = projectPython(root);
    if (!fs.existsSync(python)) throw new Error('缺少 Linux Python 环境，请先运行 ./scripts/setup-linux.sh；模型依赖需另行安装。');
    return python;
}

module.exports = { isWayland, linuxDisplayMode, configureElectron, projectPython, spawnManaged, stopManaged, requireLinuxPython };
