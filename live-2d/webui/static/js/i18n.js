// i18next internationalization setup
// My Neuro WebUI - 国际化支持

const i18nConfig = {
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    debug: false,
    backend: {
        loadPath: 'static/locales/{{lng}}/translation.json'
    },
    detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
        lookupLocalStorage: 'i18nextLng'
    },
    interpolation: {
        escapeValue: false
    }
};

function initI18n() {
    return i18next
        .use(i18nextHttpBackend)
        .use(i18nextBrowserLanguageDetector)
        .init(i18nConfig)
        .then(function() {
            updatePageLanguage();
            i18next.on('languageChanged', function() {
                updatePageLanguage();
            });
        });
}

// Update all elements with data-i18n attributes
function updatePageLanguage() {
    // Update text content
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        const key = el.getAttribute('data-i18n');
        const translated = i18next.t(key);
        if (translated && translated !== key) {
            if (el.hasAttribute('placeholder')) {
                // skip placeholder here, handled by data-i18n-placeholder
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.getAttribute('type') !== 'password' && el.getAttribute('type') !== 'checkbox' && el.getAttribute('type') !== 'file') {
                    el.value = translated;
                }
            } else {
                el.textContent = translated;
            }
        }
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
        const key = el.getAttribute('data-i18n-placeholder');
        el.setAttribute('placeholder', i18next.t(key));
    });

    // Update title
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
        const key = el.getAttribute('data-i18n-title');
        el.setAttribute('title', i18next.t(key));
    });

    // Update HTML lang attribute
    document.documentElement.lang = i18next.language === 'zh' ? 'zh-CN' : 'en';

    // Update language selector options
    const selector = document.getElementById('language-selector');
    if (selector) {
        selector.value = i18next.language;
        selector.querySelectorAll('option[data-i18n]').forEach(function(opt) {
            const key = opt.getAttribute('data-i18n');
            const translated = i18next.t(key);
            if (translated && translated !== key) {
                opt.textContent = translated;
            }
        });
    }
}

// Change language
function changeLanguage(lng) {
    i18next.changeLanguage(lng);
}

// Shortcut for translation
function t(key, options) {
    return i18next.t(key, options);
}
