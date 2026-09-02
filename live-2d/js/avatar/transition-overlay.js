const overlay = () => document.getElementById('avatar-transition');
const fs = require('fs');
const path = require('path');
let hideTimer = null;
const CENTER_STORAGE_KEY = 'avatarTransitionCenter';
const CENTER_CACHE_PATH = path.join(__dirname, '..', '..', 'avatar-loading-position.json');

function savedModelCenter() {
    try {
        const saved = JSON.parse(localStorage.getItem(CENTER_STORAGE_KEY) || 'null');
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
            return {
                x: Math.max(0, Math.min(window.innerWidth, saved.x * window.innerWidth)),
                y: Math.max(0, Math.min(window.innerHeight, saved.y * window.innerHeight))
            };
        }
    } catch (_) {}
    return null;
}

function rememberModelCenter(center) {
    if (!center || window.innerWidth <= 0 || window.innerHeight <= 0) return;
    try {
        const normalized = {
            x: center.x / window.innerWidth,
            y: center.y / window.innerHeight
        };
        localStorage.setItem(CENTER_STORAGE_KEY, JSON.stringify(normalized));
        fs.writeFileSync(CENTER_CACHE_PATH, JSON.stringify(normalized), 'utf8');
    } catch (_) {}
}

function currentModelCenter(explicitModel = null) {
    const model = explicitModel || global.currentModel || global.avatarFacade?.getModel?.();
    let bounds = null;
    try {
        if (model?.getScreenHitBox) bounds = model.getScreenHitBox();
        else if (model?.getBounds) bounds = model.getBounds();
        else if (model?.viewRect) bounds = model.viewRect;
    } catch (_) {}

    if (!bounds) return savedModelCenter() || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const left = Number.isFinite(bounds.left) ? bounds.left : Number(bounds.x);
    const top = Number.isFinite(bounds.top) ? bounds.top : Number(bounds.y);
    const right = Number.isFinite(bounds.right) ? bounds.right : left + Number(bounds.width);
    const bottom = Number.isFinite(bounds.bottom) ? bounds.bottom : top + Number(bounds.height);
    if (![left, top, right, bottom].every(Number.isFinite)) {
        return savedModelCenter() || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    const visibleLeft = Math.max(0, Math.min(window.innerWidth, left));
    const visibleRight = Math.max(0, Math.min(window.innerWidth, right));
    const visibleTop = Math.max(0, Math.min(window.innerHeight, top));
    const visibleBottom = Math.max(0, Math.min(window.innerHeight, bottom));
    const hasVisibleArea = visibleRight > visibleLeft && visibleBottom > visibleTop;
    const center = hasVisibleArea
        ? { x: (visibleLeft + visibleRight) / 2, y: (visibleTop + visibleBottom) / 2 }
        : (savedModelCenter() || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    if (hasVisibleArea) rememberModelCenter(center);
    return center;
}

async function show(label = '正在切换皮套') {
    clearTimeout(hideTimer);
    const element = overlay();
    if (!element) return;
    const center = currentModelCenter();
    element.style.left = `${center.x}px`;
    element.style.top = `${center.y}px`;
    const text = element.querySelector('.avatar-transition-text');
    if (text) text.textContent = label;
    document.body.classList.add('avatar-switching');
    element.classList.add('active');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 380))));
}

function reposition(model = null) {
    const element = overlay();
    if (!element) return;
    const center = currentModelCenter(model);
    element.style.left = `${center.x}px`;
    element.style.top = `${center.y}px`;
}

async function fadeOut() {
    clearTimeout(hideTimer);
    const element = overlay();
    if (element) element.classList.remove('active');
    document.body.classList.add('avatar-switching');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 420))));
}

function hide() {
    clearTimeout(hideTimer);
    const element = overlay();
    // 模型此时已经装配完成，记录它的真实中心供下次冷启动定位转圈。
    const center = currentModelCenter();
    if (element) {
        element.style.left = `${center.x}px`;
        element.style.top = `${center.y}px`;
    }
    document.body.classList.remove('avatar-switching');
    document.body.classList.add('avatar-revealing');
    if (element) element.classList.remove('active');
    hideTimer = setTimeout(() => document.body.classList.remove('avatar-revealing'), 420);
}

module.exports = { show, hide, fadeOut, reposition };
