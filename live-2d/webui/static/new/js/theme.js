/* ============================================================
   My Neuro WebUI — 主题切换（galgame 角色 / cyber 赛博）
   独立模块：不依赖、不修改 app.js；选择结果存 localStorage。
   旧值 neuro（已废弃的简洁主题）自动迁移为 galgame。
   ============================================================ */
(function () {
    var STORAGE_KEY = 'webui-theme';
    var THEMES = ['galgame', 'cyber'];
    var FALLBACK_LABELS = {
        zh: { galgame: '角色', cyber: '赛博' },
        en: { galgame: 'Galgame', cyber: 'Cyber' }
    };

    function currentTheme() {
        var t = document.documentElement.getAttribute('data-theme');
        return THEMES.indexOf(t) !== -1 ? t : 'galgame';
    }

    function currentLang() {
        var lang = (document.documentElement.lang || 'zh').toLowerCase();
        return lang.indexOf('en') === 0 ? 'en' : 'zh';
    }

    function updateLabel(theme) {
        var label = document.getElementById('theme-toggle-label');
        if (!label) return;
        // 界面语言切换后 i18next 可用时，跟随界面语言
        if (window.i18next && typeof window.i18next.t === 'function') {
            var key = 'app.theme_' + theme;
            var translated = window.i18next.t(key);
            if (translated && translated !== key) {
                label.textContent = translated;
                return;
            }
        }
        label.textContent = FALLBACK_LABELS[currentLang()][theme];
    }

    function applyTheme(theme) {
        if (THEMES.indexOf(theme) === -1) theme = 'galgame'; // 未知值与旧值 neuro 一并迁移
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* 隐私模式下静默 */ }
        updateLabel(theme);
    }

    window.toggleTheme = function () {
        applyTheme(currentTheme() === 'galgame' ? 'cyber' : 'galgame');
    };

    document.addEventListener('DOMContentLoaded', function () {
        var saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        applyTheme(saved || 'galgame');
        if (window.i18next && typeof window.i18next.on === 'function') {
            window.i18next.on('languageChanged', function () { updateLabel(currentTheme()); });
        }
    });
})();
