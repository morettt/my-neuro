const overlay = () => document.getElementById('avatar-transition');
let hideTimer = null;

function currentModelCenter() {
    const model = global.currentModel || global.avatarFacade?.getModel?.();
    let bounds = null;
    try {
        if (model?.getScreenHitBox) bounds = model.getScreenHitBox();
        else if (model?.getBounds) bounds = model.getBounds();
        else if (model?.viewRect) bounds = model.viewRect;
    } catch (_) {}

    if (!bounds) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const left = Number.isFinite(bounds.left) ? bounds.left : Number(bounds.x);
    const top = Number.isFinite(bounds.top) ? bounds.top : Number(bounds.y);
    const right = Number.isFinite(bounds.right) ? bounds.right : left + Number(bounds.width);
    const bottom = Number.isFinite(bounds.bottom) ? bounds.bottom : top + Number(bounds.height);
    if (![left, top, right, bottom].every(Number.isFinite)) {
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    const visibleLeft = Math.max(0, Math.min(window.innerWidth, left));
    const visibleRight = Math.max(0, Math.min(window.innerWidth, right));
    const visibleTop = Math.max(0, Math.min(window.innerHeight, top));
    const visibleBottom = Math.max(0, Math.min(window.innerHeight, bottom));
    const hasVisibleArea = visibleRight > visibleLeft && visibleBottom > visibleTop;
    return hasVisibleArea
        ? { x: (visibleLeft + visibleRight) / 2, y: (visibleTop + visibleBottom) / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
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
    document.body.classList.remove('avatar-switching');
    document.body.classList.add('avatar-revealing');
    if (element) element.classList.remove('active');
    hideTimer = setTimeout(() => document.body.classList.remove('avatar-revealing'), 420);
}

module.exports = { show, hide, fadeOut };
