const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const tar = require('tar');

const ENV_URL = 'https://modelscope.cn/models/morelle/my-neuro-env/resolve/master/my-neuro-env.tar.gz';
let mainWindow;
let installing = false;

function createWindow() {
  mainWindow = new BrowserWindow({ width: 780, height: 570, minWidth: 780, minHeight: 570, resizable: false, frame: false, backgroundColor: '#f2f2f0', title: 'My-Neuro Installer',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited with ${code}`)));
  });
}

async function inspectSystem() {
  try {
    const output = await run('nvidia-smi', ['--query-gpu=name,memory.free', '--format=csv,noheader,nounits']);
    const [name, free] = output.split(/\r?\n/)[0].split(',').map(v => v.trim());
    const freeMb = Number.parseInt(free, 10);
    return { gpu: name, freeMb, ok: Number.isFinite(freeMb) && freeMb >= 5120 };
  } catch {
    let gpu = '未检测到显卡';
    try { gpu = await run('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notlike 'Microsoft*' } | Select-Object -First 1).Name"]); } catch {}
    return { gpu: gpu || '未检测到显卡', freeMb: null, ok: false };
  }
}

function send(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('install-status', payload);
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = currentUrl => https.get(currentUrl, { headers: { 'User-Agent': 'My-Neuro-Installer/1.0' } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) { response.resume(); return request(new URL(response.headers.location, currentUrl).toString()); }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`环境包下载失败（HTTP ${response.statusCode}）`)); }
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      const output = fs.createWriteStream(destination);
      response.on('data', chunk => {
        received += chunk.length;
        const pct = total ? Math.floor(received / total * 100) : 0;
        send({ type:'progress', overall:total ? 5 + Math.floor(pct * .38) : 5, fileProgress:pct,
          label:`下载环境包 ${(received/1048576).toFixed(0)} MB${total ? ` / ${(total/1048576).toFixed(0)} MB` : ''}` });
      });
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    }).on('error', reject);
    request(url);
  });
}

async function install(components) {
  const installDir = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
  const envDir = path.join(installDir, 'env');
  const envPython = path.join(envDir, 'python.exe');
  const archive = path.join(installDir, 'my-neuro-env.tar.gz');
  const batchScript = app.isPackaged ? path.join(process.resourcesPath, 'full-hub', 'Batch_Download.py') : path.join(installDir, 'full-hub', 'Batch_Download.py');
  const logPath = path.join(installDir, 'installer.log');
  const log = message => { const line = `[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${message}`; fs.appendFileSync(logPath, `${line}\n`, 'utf8'); send({type:'log',message:line}); };
  fs.writeFileSync(logPath, '', 'utf8');

  if (!fs.existsSync(envPython)) {
    log('开始下载 Python 环境包…');
    await download(ENV_URL, archive);
    send({type:'progress',overall:45,fileProgress:0,label:'正在安全解压环境包…'});
    fs.mkdirSync(envDir, {recursive:true});
    await tar.x({file:archive,cwd:envDir,preservePaths:false,strict:true});
    fs.unlinkSync(archive);
    log('环境解压完成');
  } else log('env 已存在，跳过环境下载');

  send({type:'progress',overall:60,fileProgress:0,label:'开始下载模型…'});
  const allowed = ['asr','bert','tts','rag','live2d'];
  const flags = allowed.filter(name => components.includes(name)).map(name => `--${name}`);
  if (flags.length) await new Promise((resolve, reject) => {
    const child = spawn(envPython, [batchScript, ...flags], {
      cwd: installDir,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let overall = 60;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutPending = '', stderrPending = '';
    const consume = (text, source) => {
      const combined = (source === 'stdout' ? stdoutPending : stderrPending) + text;
      const parts = combined.split(/[\r\n]+/);
      const pending = parts.pop() || '';
      if (source === 'stdout') stdoutPending = pending; else stderrPending = pending;
      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        const named = line.match(/Downloading\s+\[(.+?)\].*?(\d{1,3})%/i);
        const generic = line.match(/\|\s*(\d{1,3})%/);
        const pct = named ? Number(named[2]) : generic ? Number(generic[1]) : null;
        if (pct !== null) {
          send({ type:'progress', overall:Math.min(95,overall+=.2), fileProgress:pct,
            label:named ? `下载 ${named[1]}` : line.replace(/[|━─█▏▎▍▌▋▊▉]+/g, ' ').replace(/\s+/g, ' ').slice(0,80) });
          continue;
        }
        log(line);
        send({type:'progress',overall:Math.min(95,overall+=.2),fileProgress:0,label:line.slice(0,80)});
      }
    };
    child.stdout.on('data',data => consume(stdoutDecoder.write(data),'stdout'));
    child.stderr.on('data',data => consume(stderrDecoder.write(data),'stderr'));
    child.on('error',reject);
    child.on('close',code => {
      consume(stdoutDecoder.end() + '\n','stdout'); stdoutPending = '';
      consume(stderrDecoder.end() + '\n','stderr'); stderrPending = '';
      code===0 ? resolve() : reject(new Error(`模型下载失败（退出码 ${code}）`));
    });
  });
  log('安装成功'); send({type:'done',logPath});
}

ipcMain.handle('inspect-system', inspectSystem);
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('start-install', async (_event, components) => {
  if (installing) return {accepted:false};
  installing = true;
  install(Array.isArray(components)?components:[]).catch(error => send({type:'error',message:error.message})).finally(() => {installing=false;});
  return {accepted:true};
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
