'use strict';
/**
 * 验证 chinese-workday 通过 .cjs 缓存 + createRequire 可正确加载（与 index.js 逻辑一致）
 * 运行：node test-load-workday.cjs
 * 或（与桌面端 Node 版本对齐）：在 live-2d 目录 ELECTRON_RUN_AS_NODE=1 npx electron plugins/community/dawn-dusk-line/test-load-workday.cjs
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const pluginDir = __dirname;
const bundleSrc = path.join(pluginDir, 'node_modules', 'chinese-workday', 'dist', 'chinese-workday.cjs.js');
const bundleCjs = path.join(pluginDir, '.chinese-workday-bundle.cjs');

function fail(msg) {
    console.error('[FAIL]', msg);
    process.exit(1);
}

if (!fs.existsSync(bundleSrc)) {
    fail(`缺少依赖: ${bundleSrc}（请在插件目录执行 npm install）`);
}

const needCopy =
    !fs.existsSync(bundleCjs) || fs.statSync(bundleSrc).mtimeMs > fs.statSync(bundleCjs).mtimeMs;
if (needCopy) {
    fs.copyFileSync(bundleSrc, bundleCjs);
}

const req = createRequire(path.join(pluginDir, 'index.js'));
let mod;
try {
    mod = req(bundleCjs);
} catch (e) {
    fail(`require 抛错: ${e.message}`);
}

if (!mod || typeof mod.isHoliday !== 'function' || typeof mod.isWorkday !== 'function') {
    fail(`API 异常: keys=${mod ? Object.keys(mod).length : 0}`);
}

// 2025-01-01 为元旦（法定节假日）
const y = '2025-01-01';
const hol = mod.isHoliday(y);
const work = mod.isWorkday(y);
if (hol !== true) {
    fail(`isHoliday(${y}) 期望 true，得到 ${hol}`);
}
if (work !== false) {
    fail(`isWorkday(${y}) 期望 false，得到 ${work}`);
}

let festival;
try {
    festival = mod.getFestival(y);
} catch (e) {
    fail(`getFestival 抛错: ${e.message}`);
}
if (!festival || typeof festival !== 'string') {
    fail(`getFestival(${y}) 期望非空字符串，得到 ${JSON.stringify(festival)}`);
}

console.log('[OK] chinese-workday 经 .cjs 缓存加载成功');
console.log(`     ${y} isHoliday=${hol} isWorkday=${work} getFestival=${festival}`);
