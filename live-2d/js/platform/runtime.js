const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function isWayland(env = process.env, platform = process.platform) {
    return platform === 'linux' && (env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY));
}

// Prefer the session's native backend, including when XWayland also exports
// DISPLAY. X11 remains an explicit compatibility mode in a Wayland session.
function linuxDisplayMode(env = process.env) {
    const mode = env.MY_NEURO_DISPLAY_MODE || (isWayland(env, 'linux') ? 'wayland' : 'x11');
    if (!['x11', 'wayland'].includes(mode)) throw new Error('MY_NEURO_DISPLAY_MODE must be x11 or wayland');
    if (mode === 'wayland' && !isWayland(env, 'linux')) throw new Error('Wayland is unavailable. Use MY_NEURO_DISPLAY_MODE=x11 in an X11 session.');
    if (mode === 'x11' && !env.DISPLAY) throw new Error('XWayland is unavailable (DISPLAY is unset). Use MY_NEURO_DISPLAY_MODE=wayland.');
    return mode;
}

const linuxSettingsPath = path.resolve(__dirname, '../../.runtime/linux-settings.json');

function readLinuxSettings(file = linuxSettingsPath) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function softwareRendering(env = process.env, settings = readLinuxSettings()) {
    return env.MY_NEURO_SOFTWARE_RENDERING !== undefined
        ? env.MY_NEURO_SOFTWARE_RENDERING === '1' : settings.softwareRendering === true;
}

// Ozone is initialized before application JS runs in modern Electron. Backend
// and GL switches must be present on the executable command line, including
// when the control panel launches the pet as a separate Electron process.
function electronLaunchArgs(entry, args = [], env = process.env, platform = process.platform, settings = readLinuxSettings()) {
    if (platform !== 'linux') return [entry, ...args];
    const switches = [`--ozone-platform=${linuxDisplayMode(env)}`];
    if (softwareRendering(env, settings)) {
        switches.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    } else {
        const backend = env.MY_NEURO_ANGLE_BACKEND || settings.angleBackend || 'auto';
        if (!['auto', 'gl', 'gles'].includes(backend)) throw new Error('MY_NEURO_ANGLE_BACKEND must be auto, gl or gles');
        if (backend !== 'auto') switches.push('--use-gl=angle', `--use-angle=${backend}`);
    }
    const features = ['WebRTCPipeWireCapturer'];
    if (isWayland(env, platform)) features.push('GlobalShortcutsPortal');
    switches.push(`--enable-features=${features.join(',')}`);
    return [...switches, entry, ...args];
}

function configureElectron(app) {
    if (process.platform !== 'linux') return { nativeWayland: false };
    // These are app settings; Ozone/GL configuration belongs in electronLaunchArgs.
    app.setDesktopName('io.github.morettt.MyNeuro.desktop');
    return { nativeWayland: linuxDisplayMode() === 'wayland' };
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

module.exports = { linuxSettingsPath, readLinuxSettings, softwareRendering, electronLaunchArgs, isWayland, linuxDisplayMode, configureElectron, projectPython, spawnManaged, stopManaged, requireLinuxPython };
