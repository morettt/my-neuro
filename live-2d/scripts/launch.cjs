#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { electronLaunchArgs, linuxSettingsPath, readLinuxSettings } = require('../js/platform/runtime');
const [mode = 'control', ...args] = process.argv.slice(2);
if (!['control', 'pet'].includes(mode)) throw new Error('Expected control or pet');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const forwarded = args.filter(arg => !['--software-rendering', '--hardware-rendering'].includes(arg));
if (args.includes('--software-rendering') && args.includes('--hardware-rendering')) throw new Error('Choose software or hardware rendering');
if (process.platform === 'linux' && args.some(arg => ['--software-rendering', '--hardware-rendering'].includes(arg))) {
    const software = args.includes('--software-rendering');
    env.MY_NEURO_SOFTWARE_RENDERING = software ? '1' : '0';
    fs.mkdirSync(path.dirname(linuxSettingsPath), { recursive: true });
    fs.writeFileSync(linuxSettingsPath, JSON.stringify({ ...readLinuxSettings(), softwareRendering: software }, null, 2) + '\n');
}
const child = spawn(require('electron'), electronLaunchArgs(mode === 'control' ? 'control-main.js' : '.', forwarded, env), {
    cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit'
});
child.once('error', error => { console.error(`Electron failed to start: ${error.message}`); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
