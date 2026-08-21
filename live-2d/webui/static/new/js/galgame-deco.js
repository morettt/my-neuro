/* ============================================================
   My Neuro WebUI — galgame 主题樱花花瓣粒子
   独立 IIFE:不依赖、不修改 app.js / theme.js。
   仅在 data-theme="galgame" 时生成花瓣层,切到 cyber 时移除;
   尊重 prefers-reduced-motion(不生成花瓣)。
   ============================================================ */
(function () {
    var LAYER_CLASS = 'sakura-layer';
    var PETAL_CLASS = 'sakura';
    var PETAL_COUNT = 16;

    function isGalgame() {
        return document.documentElement.getAttribute('data-theme') === 'galgame';
    }

    function reducedMotion() {
        return window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function removeLayer() {
        var old = document.querySelector('.' + LAYER_CLASS);
        if (old) old.parentNode.removeChild(old);
    }

    function buildLayer() {
        removeLayer();
        if (!isGalgame() || reducedMotion()) return;

        var layer = document.createElement('div');
        layer.className = LAYER_CLASS;
        layer.setAttribute('aria-hidden', 'true');

        for (var i = 0; i < PETAL_COUNT; i++) {
            var p = document.createElement('i');
            p.className = PETAL_CLASS;
            var delay = rand(0, 14).toFixed(2) + 's';
            p.style.setProperty('--sak-left', rand(0, 100).toFixed(2) + 'vw');
            p.style.setProperty('--sak-size', rand(10, 18).toFixed(1) + 'px');
            p.style.setProperty('--sak-opacity', rand(0.5, 0.9).toFixed(2));
            p.style.setProperty('--sak-duration', rand(9, 16).toFixed(2) + 's');
            p.style.setProperty('--sak-delay', '-' + delay); // 负延迟:开局花瓣已散布全屏
            p.style.setProperty('--sak-drift', rand(-40, 120).toFixed(0) + 'px');
            p.style.setProperty('--sak-sway', rand(20, 48).toFixed(0) + 'px');
            p.style.setProperty('--sak-sway-duration', rand(2.2, 4).toFixed(2) + 's');
            layer.appendChild(p);
        }
        document.body.appendChild(layer);
    }

    function onThemeChange() {
        if (isGalgame()) buildLayer();
        else removeLayer();
    }

    document.addEventListener('DOMContentLoaded', function () {
        buildLayer();

        // 监听 data-theme 属性变化(theme.js 切换主题时重建/移除)
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].attributeName === 'data-theme') {
                    onThemeChange();
                    return;
                }
            }
        }).observe(document.documentElement, { attributes: true });

        // 系统动态偏好变化时同步
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
            var handler = function () { onThemeChange(); };
            if (mq.addEventListener) mq.addEventListener('change', handler);
            else if (mq.addListener) mq.addListener(handler);
        }
    });
})();
