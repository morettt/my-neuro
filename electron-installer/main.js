const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const tar = require('tar');

const ENV_URL = 'https://modelscope.cn/models/morelle/my-neuro-env/resolve/master/my-neuro-env.tar.gz';
const APP_URLS = [
  'https://gh-proxy.org/https://github.com/morettt/my-neuro/archive/refs/tags/vv1.0.zip',
  'https://hk.gh-proxy.org/https://github.com/morettt/my-neuro/archive/refs/tags/vv1.0.zip',
  'https://github.com/morettt/my-neuro/archive/refs/tags/vv1.0.zip'
];
const LIVE2D_VERSION = 'v6.6.2';
const LIVE2D_URLS = [
  `https://gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/${LIVE2D_VERSION}/live-2d.zip`,
  `https://hk.gh-proxy.org/https://github.com/morettt/my-neuro/releases/download/${LIVE2D_VERSION}/live-2d.zip`,
  `https://github.com/morettt/my-neuro/releases/download/${LIVE2D_VERSION}/live-2d.zip`
];
let mainWindow;
let installing = false;

function defaultInstallDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  return path.join(localAppData, 'Programs', 'My-Neuro');
}

function resolveInstallDir(requestedDir) {
  if (typeof requestedDir !== 'string' || !requestedDir.trim()) return defaultInstallDir();
  const resolved = path.resolve(requestedDir.trim());
  if (resolved === path.parse(resolved).root) throw new Error('不能直接安装到磁盘根目录，请选择一个文件夹');
  return resolved;
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 780, height: 570, minWidth: 780, minHeight: 570, resizable: false, frame: false, backgroundColor: '#f2f2f0', title: 'My-Neuro Installer',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { successCodes = [0], ...spawnOptions } = options;
    const child = spawn(command, args, { windowsHide: true, ...spawnOptions });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data.toString(); });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => successCodes.includes(code) ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `${command} exited with ${code}`)));
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

function download(url, destination, options = {}) {
  const {start = 0, span = 100, label = '下载文件', timeoutMs = 0} = options;
  return new Promise((resolve, reject) => {
    const request = currentUrl => {
      let output;
      const req = https.get(currentUrl, { headers: { 'User-Agent': 'My-Neuro-Installer/1.0' } }, response => {
        if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) { response.resume(); return request(new URL(response.headers.location, currentUrl).toString()); }
        if (response.statusCode !== 200) { response.resume(); return reject(new Error(`${label}失败（HTTP ${response.statusCode}）`)); }
        const total = Number(response.headers['content-length']) || 0;
        let received = 0;
        output = fs.createWriteStream(destination);
        response.on('data', chunk => {
          received += chunk.length;
          const pct = total ? Math.floor(received / total * 100) : 0;
          send({ type:'progress', overall:total ? start + pct / 100 * span : start,
            label:`${label} ${(received/1048576).toFixed(0)} MB${total ? ` / ${(total/1048576).toFixed(0)} MB` : ''}` });
        });
        response.on('aborted', () => output.destroy(new Error(`${label}连接中断`)));
        response.pipe(output);
        output.on('finish', () => output.close(resolve));
        output.on('error', reject);
      });
      if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error(`${label}连续 10 秒无响应`)));
      req.on('error', error => output ? output.destroy(error) : reject(error));
    };
    request(url);
  });
}

function probeDownloadUrl(url, timeoutMs = 10000) {
  const started = Date.now();
  const targetBytes = 512 * 1024;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, bytes = 0) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve({url, score: bytes / Math.max(1, Date.now() - started)});
    };
    const request = currentUrl => {
      const req = https.get(currentUrl, {
        headers: {'User-Agent':'My-Neuro-Installer/1.0','Range':`bytes=0-${targetBytes - 1}`}
      }, response => {
        if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          return request(new URL(response.headers.location, currentUrl).toString());
        }
        if (![200,206].includes(response.statusCode)) {
          response.resume();
          return finish(new Error(`HTTP ${response.statusCode}`));
        }
        let received = 0;
        response.on('data', chunk => {
          received += chunk.length;
          if (received >= targetBytes) {
            finish(null, received);
            response.destroy();
          }
        });
        response.on('end', () => finish(received ? null : new Error('未收到数据'), received));
        response.on('error', error => { if (!settled) finish(error); });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('测速超时')));
      req.on('error', error => { if (!settled) finish(error); });
    };
    request(url);
  });
}

async function rankDownloadUrls(urls, log, label) {
  log(`正在测试 ${label} 的 ${urls.length} 个下载源`);
  const results = await Promise.allSettled(urls.map(url => probeDownloadUrl(url)));
  const ranked = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .sort((a, b) => b.score - a.score)
    .map(result => result.url);
  const unavailable = urls.filter(url => !ranked.includes(url));
  const ordered = [...ranked, ...unavailable];
  log(`测速完成，优先使用下载源 ${urls.indexOf(ordered[0]) + 1}`);
  return ordered;
}

async function deploySource(installDir, log) {
  const archive = path.join(installDir, 'my-neuro-source.zip');
  const staging = path.join(installDir, '.my-neuro-source-staging');
  if (fs.existsSync(staging)) fs.rmSync(staging, {recursive:true,force:true});
  fs.mkdirSync(staging, {recursive:true});
  const appUrls = await rankDownloadUrls(APP_URLS, log, '程序源码');
  let downloaded = false;
  for (let index = 0; index < appUrls.length; index += 1) {
    try {
      if (fs.existsSync(archive)) fs.rmSync(archive, {force:true});
      const sourceNumber = APP_URLS.indexOf(appUrls[index]) + 1;
      log(`正在从下载源 ${sourceNumber}/3 下载 vv1.0 程序源码`);
      await download(appUrls[index], archive, {start:2,span:23,label:'下载程序源码',timeoutMs:10000});
      downloaded = true;
      break;
    } catch (error) {
      log(`程序源码下载源 ${APP_URLS.indexOf(appUrls[index]) + 1} 失败: ${error.message}`);
    }
  }
  if (!downloaded) throw new Error('所有程序源码下载源均失败');
  send({type:'progress',overall:26,label:'正在解压程序源码…'});
  await run('tar.exe', ['-xf', archive, '-C', staging]);
  const entries = fs.readdirSync(staging, {withFileTypes:true});
  const sourceRoot = entries.length === 1 && entries[0].isDirectory()
    ? path.join(staging, entries[0].name) : staging;
  await run('robocopy.exe', [sourceRoot, installDir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
    successCodes: [0, 1, 2, 3, 4, 5, 6, 7]
  });
  fs.unlinkSync(archive);
  fs.rmSync(staging, {recursive:true,force:true});
  log('程序源码部署完成');
}

async function installLive2D(installDir, log) {
  const archive = path.join(installDir, 'live-2d.zip');
  const staging = path.join(installDir, 'live-2d-temp');
  const target = path.join(installDir, 'live-2d');
  if (fs.existsSync(staging)) fs.rmSync(staging, {recursive:true,force:true});
  let downloaded = false;
  try {
    send({type:'module-status',status:'start',module:'live2d'});
    const live2dUrls = await rankDownloadUrls(LIVE2D_URLS, log, 'Live2D');
    for (let index = 0; index < live2dUrls.length; index += 1) {
      try {
        if (fs.existsSync(archive)) fs.rmSync(archive, {force:true});
        const sourceNumber = LIVE2D_URLS.indexOf(live2dUrls[index]) + 1;
        log(`正在从下载源 ${sourceNumber}/3 下载 Live2D ${LIVE2D_VERSION}`);
        await download(live2dUrls[index], archive, {start:28,span:62,label:'下载 Live2D',timeoutMs:10000});
        downloaded = true;
        break;
      } catch (error) {
        log(`Live2D 下载源 ${LIVE2D_URLS.indexOf(live2dUrls[index]) + 1} 失败: ${error.message}`);
      }
    }
    if (!downloaded) throw new Error('所有 Live2D 下载源均失败');
    fs.mkdirSync(staging, {recursive:true});
    send({type:'progress',overall:92,label:'正在解压 Live2D…'});
    await run('tar.exe', ['-xf', archive, '-C', staging]);
    if (!fs.readdirSync(staging).length) throw new Error('Live2D 压缩包解压后为空');
    if (fs.existsSync(target)) fs.rmSync(target, {recursive:true,force:true});
    fs.renameSync(staging, target);
    log(`Live2D ${LIVE2D_VERSION} 安装完成`);
    send({type:'module-status',status:'done',module:'live2d'});
  } catch (error) {
    send({type:'module-status',status:'fail',module:'live2d'});
    throw error;
  } finally {
    if (fs.existsSync(archive)) fs.rmSync(archive, {force:true});
    if (fs.existsSync(staging)) fs.rmSync(staging, {recursive:true,force:true});
  }
}

async function install(request) {
  const edition = request?.edition === 'cloud' ? 'cloud' : 'local';
  const components = Array.isArray(request?.components) ? request.components : [];
  const installDir = resolveInstallDir(request?.installDir);
  fs.mkdirSync(installDir, {recursive:true});
  const envDir = path.join(installDir, 'env');
  const envPython = path.join(envDir, 'python.exe');
  const archive = path.join(installDir, 'my-neuro-env.tar.gz');
  const modelRoot = path.join(installDir, 'full-hub');
  const batchScript = path.join(modelRoot, 'Batch_Download.py');
  const bundledBatchScript = app.isPackaged
    ? path.join(process.resourcesPath, 'full-hub', 'Batch_Download.py')
    : batchScript;
  let logPath = path.join(installDir, 'installer.log');
  const log = message => { const line = `[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${message}`; fs.appendFileSync(logPath, `${line}\n`, 'utf8'); send({type:'log',message:line}); };
  fs.writeFileSync(logPath, '', 'utf8');
  log(`安装根目录: ${installDir}`);
  log(`模型保存目录: ${modelRoot}`);

  try {
    await deploySource(installDir, log);
  } catch (error) {
    const sourceArchive = path.join(installDir, 'my-neuro-source.zip');
    const sourceStaging = path.join(installDir, '.my-neuro-source-staging');
    if (fs.existsSync(sourceArchive)) fs.rmSync(sourceArchive, {force:true});
    if (fs.existsSync(sourceStaging)) fs.rmSync(sourceStaging, {recursive:true,force:true});
    throw error;
  }
  if (edition === 'cloud') {
    await installLive2D(installDir, log);
    send({type:'progress',overall:100,label:'云端版安装完成'});
    log('云端版安装成功');
    send({type:'done',logPath});
    return;
  }
  fs.mkdirSync(modelRoot, {recursive:true});
  if (app.isPackaged) fs.copyFileSync(bundledBatchScript, batchScript);

  if (!fs.existsSync(envPython)) {
    log('开始下载 Python 环境包…');
    await download(ENV_URL, archive, {start:28,span:27,label:'下载 Python 环境'});
    send({type:'progress',overall:56,label:'正在安全解压环境包…'});
    fs.mkdirSync(envDir, {recursive:true});
    await tar.x({file:archive,cwd:envDir,preservePaths:false,strict:true});
    fs.unlinkSync(archive);
    log('环境解压完成');
  } else log('env 已存在，跳过环境下载');

  if (!fs.existsSync(envPython)) throw new Error(`Python 环境无效: ${envPython}`);

  send({type:'progress',overall:60,fileProgress:0,label:'开始下载模型…'});
  const allowed = ['asr','bert','tts','rag','live2d'];
  const flags = allowed.filter(name => components.includes(name)).map(name => `--${name}`);
  const expectedBytes = {asr:2,bert:1,tts:4,rag:2,live2d:.2};
  const expectedModelBytes = allowed.filter(name => components.includes(name))
    .reduce((sum,name) => sum + expectedBytes[name] * 1024 ** 3, 0);
  const downloadedByFile = new Map();
  let downloadedModelBytes = 0;
  const parseBytes = (value,unit) => {
    const powers = {B:0,KB:1,MB:2,GB:3,TB:4};
    return Number(value) * 1024 ** (powers[unit.toUpperCase()] ?? 0);
  };
  const capacityOverall = () => expectedModelBytes > 0
    ? Math.min(95,60 + downloadedModelBytes / expectedModelBytes * 35) : 95;
  if (flags.length) await new Promise((resolve, reject) => {
    const child = spawn(envPython, [batchScript, ...flags], {
      cwd: installDir,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        MY_NEURO_FULL_HUB_DIR: modelRoot
      }
    });
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
        const moduleEvent = line.match(/^@@MODULE_(START|DONE|FAIL):(live2d|bert|tts|rag|asr)$/);
        if (moduleEvent) {
          send({type:'module-status',status:moduleEvent[1].toLowerCase(),module:moduleEvent[2]});
          continue;
        }
        const named = line.match(/Downloading\s+\[(.+?)\].*?(\d{1,3})%.*?([\d.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB|TB)/i);
        const generic = line.match(/\|\s*(\d{1,3})%/);
        const pct = named ? Number(named[2]) : generic ? Number(generic[1]) : null;
        if (pct !== null) {
          if (named) {
            const file = named[1];
            const currentBytes = parseBytes(named[3],named[4]);
            const previousBytes = downloadedByFile.get(file) || 0;
            if (currentBytes > previousBytes) {
              downloadedModelBytes += currentBytes - previousBytes;
              downloadedByFile.set(file,currentBytes);
            }
          }
          send({ type:'progress', overall:capacityOverall(), fileProgress:pct,
            label:named ? `下载 ${named[1]}` : line.replace(/[|━─█▏▎▍▌▋▊▉]+/g, ' ').replace(/\s+/g, ' ').slice(0,80) });
          continue;
        }
        log(line);
        send({type:'progress',overall:capacityOverall(),fileProgress:0,label:line.slice(0,80)});
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
  const hasFile = directory => {
    if (!fs.existsSync(directory)) return false;
    const pending = [directory];
    while (pending.length) {
      for (const entry of fs.readdirSync(pending.pop(), {withFileTypes:true})) {
        if (entry.isFile()) return true;
        if (entry.isDirectory()) pending.push(path.join(entry.parentPath || entry.path, entry.name));
      }
    }
    return false;
  };
  const outputDirs = {
    asr:path.join(modelRoot,'asr-hub'),
    bert:path.join(modelRoot,'bert-hub'),
    tts:path.join(modelRoot,'tts-hub'),
    rag:path.join(modelRoot,'rag-hub'),
    live2d:path.join(installDir,'live-2d')
  };
  const missing = Object.entries(outputDirs)
    .filter(([name]) => components.includes(name))
    .filter(([,dir]) => !hasFile(dir))
    .map(([name]) => name.toUpperCase());
  if (missing.length) throw new Error(`模型目录为空: ${missing.join(', ')}。目标目录: ${modelRoot}`);
  log('安装成功'); send({type:'done',logPath});
}

ipcMain.handle('inspect-system', inspectSystem);
ipcMain.handle('get-default-install-dir', () => defaultInstallDir());
ipcMain.handle('choose-install-dir', (_event, currentDir) => {
  let dialogStart = typeof currentDir === 'string' && currentDir.trim() ? path.resolve(currentDir.trim()) : defaultInstallDir();
  while (!fs.existsSync(dialogStart) && dialogStart !== path.parse(dialogStart).root) dialogStart = path.dirname(dialogStart);
  const result = dialog.showOpenDialogSync(mainWindow, {
    title: '选择 My-Neuro 安装位置',
    defaultPath: dialogStart,
    buttonLabel: '选择此文件夹',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  });
  return result?.[0] || null;
});
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('start-install', async (_event, request) => {
  if (installing) return {accepted:false};
  installing = true;
  install(request && typeof request === 'object' ? request : {}).catch(error => send({type:'error',message:error.message})).finally(() => {installing=false;});
  return {accepted:true};
});
app.whenReady().then(() => {
  const automatedEdition = process.env.MY_NEURO_AUTOMATED_EDITION;
  if (automatedEdition) {
    const resultFile = process.env.MY_NEURO_AUTOMATED_RESULT;
    install({edition: automatedEdition, components: []}).then(() => {
      if (resultFile) fs.writeFileSync(resultFile, 'OK', 'utf8');
      app.exit(0);
    }).catch(error => {
      if (resultFile) fs.writeFileSync(resultFile, error.stack || error.message, 'utf8');
      app.exit(1);
    });
    return;
  }
  const diagnosticFile = process.env.MY_NEURO_PATH_DIAGNOSTIC;
  if (diagnosticFile) {
    const installDir = defaultInstallDir();
    fs.writeFileSync(diagnosticFile, JSON.stringify({
      portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
      processExecPath: process.execPath,
      installDir,
      modelRoot: path.join(installDir, 'full-hub')
    }, null, 2), 'utf8');
    app.quit();
    return;
  }
  createWindow();
});
app.on('window-all-closed', () => app.quit());
