/**
 * releases.js - 版本更新检查模块
 * 自动检查 GitHub releases，高亮更新按钮，弹窗展示版本列表
 */
(function () {
    'use strict';

    // ============ 状态 ============
    let currentVersion = '';
    let releases = [];
    let hasNewVersion = false;

    // ============ 注入样式 ============
    function injectStyles() {
        if (document.getElementById('releases-styles')) return;
        const style = document.createElement('style');
        style.id = 'releases-styles';
        style.textContent = `
/* 更新按钮高亮 */
#checkUpdateBtn.has-update {
    color: #60a5fa !important;
    animation: releases-pulse 2s ease-in-out infinite;
}
@keyframes releases-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

/* Releases 模态框特殊样式 */
#releasesModal .modal-content {
    max-width: 720px;
}
#releasesModal .releases-header {
    display: flex;
    align-items: center;
    gap: 10px;
}
#releasesModal .releases-version-badge {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 12px;
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
}
#releasesModal .releases-list {
    max-height: 60vh;
    overflow-y: auto;
}
#releasesModal .release-item {
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
#releasesModal .release-item:last-child {
    border-bottom: none;
}
#releasesModal .release-item:hover {
    background: rgba(255,255,255,0.03);
}
#releasesModal .release-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 6px;
}
#releasesModal .release-name {
    font-weight: 600;
    font-size: 15px;
    color: #e5e7eb;
}
#releasesModal .release-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
}
#releasesModal .badge {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 4px;
    font-weight: 500;
}
.badge-latest {
    background: rgba(34,197,94,0.2);
    color: #4ade80;
}
.badge-new {
    background: rgba(251,191,36,0.2);
    color: #fbbf24;
}
.badge-pre {
    background: rgba(168,85,247,0.2);
    color: #c084fc;
}
#releasesModal .release-date {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
}
#releasesModal .release-body {
    font-size: 13px;
    color: #9ca3af;
    margin: 8px 0;
    line-height: 1.6;
    max-height: 200px;
    overflow-y: auto;
}
#releasesModal .release-body h1,
#releasesModal .release-body h2,
#releasesModal .release-body h3 {
    font-weight: 600;
    margin: 0.5em 0 0.25em;
    color: #d1d5db;
}
#releasesModal .release-body h1 { font-size: 1.1em; }
#releasesModal .release-body h2 { font-size: 1em; }
#releasesModal .release-body h3 { font-size: 0.95em; }
#releasesModal .release-body ul,
#releasesModal .release-body ol {
    padding-left: 1.25em;
    margin: 0.25em 0;
}
#releasesModal .release-body ul { list-style-type: disc; }
#releasesModal .release-body ol { list-style-type: decimal; }
#releasesModal .release-body li { margin: 0.15em 0; }
#releasesModal .release-body a {
    color: #60a5fa;
    text-decoration: underline;
}
#releasesModal .release-body code {
    background: rgba(255,255,255,0.08);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
}
#releasesModal .release-body pre {
    background: rgba(255,255,255,0.06);
    padding: 0.5em;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5em 0;
}
#releasesModal .release-body pre code {
    background: none;
    padding: 0;
}
#releasesModal .release-body p { margin: 0.25em 0; }
#releasesModal .release-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #60a5fa;
    text-decoration: none;
}
#releasesModal .release-link:hover {
    text-decoration: underline;
}

/* 骨架屏加载 */
#releasesModal .releases-skeleton {
    padding: 20px;
}
#releasesModal .skeleton-item {
    margin-bottom: 16px;
}
#releasesModal .skeleton-bar {
    height: 14px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    margin-bottom: 8px;
}
@keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* 错误状态 */
#releasesModal .releases-error {
    text-align: center;
    padding: 30px 20px;
    color: #9ca3af;
}
#releasesModal .releases-error button {
    margin-top: 12px;
    padding: 6px 20px;
    border-radius: 8px;
    border: none;
    background: #6366f1;
    color: white;
    cursor: pointer;
    font-size: 13px;
}
#releasesModal .releases-error button:hover {
    background: #4f46e5;
}

/* 空状态 */
#releasesModal .releases-empty {
    text-align: center;
    padding: 40px 20px;
    color: #6b7280;
}
`;
        document.head.appendChild(style);
    }

    // ============ 创建模态框 DOM ============
    function createModal() {
        if (document.getElementById('releasesModal')) return;

        const modal = document.createElement('div');
        modal.id = 'releasesModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div class="releases-header">
                        <h3 data-i18n="releases.title">${t('releases.title')}</h3>
                        <span class="releases-version-badge" id="releasesCurrentBadge"></span>
                    </div>
                    <button class="btn-close" id="releasesCloseBtn">&times;</button>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div id="releasesContent"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 关闭按钮
        document.getElementById('releasesCloseBtn').addEventListener('click', closeModal);

        // 点击背景关闭
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });

        // ESC 关闭
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.style.display !== 'none') {
                closeModal();
            }
        });
    }

    // ============ 打开/关闭模态框 ============
    function openModal() {
        const modal = document.getElementById('releasesModal');
        if (!modal) return;
        modal.style.setProperty('display', 'block', 'important');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        const modal = document.getElementById('releasesModal');
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    // ============ 版本比较 ============
    function isNewer(tagName) {
        const currentRelease = releases.find(r => r.tag_name === currentVersion);
        if (!currentRelease || !currentRelease.published_at) return false;
        const targetRelease = releases.find(r => r.tag_name === tagName);
        if (!targetRelease || !targetRelease.published_at) return false;
        return new Date(targetRelease.published_at).getTime() > new Date(currentRelease.published_at).getTime();
    }

    function checkHasNewVersion() {
        const currentRelease = releases.find(r => r.tag_name === currentVersion);
        if (!currentRelease || !currentRelease.published_at) return false;
        return releases.some(r =>
            !r.prerelease && r.published_at &&
            new Date(r.published_at).getTime() > new Date(currentRelease.published_at).getTime()
        );
    }

    // ============ Markdown 渲染 ============
    function renderMarkdown(text) {
        if (!text) return '';
        try {
            if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
                return DOMPurify.sanitize(marked.parse(text, { async: false }));
            }
        } catch (e) {
            console.warn('Markdown rendering failed, using plain text:', e);
        }
        // 降级：简单转义 HTML
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============ 日期格式化 ============
    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch {
            return dateStr;
        }
    }

    // ============ 渲染加载骨架屏 ============
    function renderLoading() {
        let html = '<div class="releases-skeleton">';
        for (let i = 0; i < 3; i++) {
            html += `
                <div class="skeleton-item">
                    <div class="skeleton-bar" style="width: 40%;"></div>
                    <div class="skeleton-bar" style="width: 100%;"></div>
                    <div class="skeleton-bar" style="width: 70%;"></div>
                </div>`;
        }
        html += '</div>';
        return html;
    }

    // ============ 渲染错误状态 ============
    function renderError() {
        return `
            <div class="releases-error">
                <p>${t('releases.fetch_error')}</p>
                <button id="releasesRetryBtn">${t('releases.retry')}</button>
            </div>`;
    }

    // ============ 渲染空状态 ============
    function renderEmpty() {
        return `<div class="releases-empty">${t('releases.no_releases')}</div>`;
    }

    // ============ 渲染版本列表 ============
    function renderReleases() {
        if (releases.length === 0) return renderEmpty();

        let html = '<div class="releases-list">';
        releases.forEach(function (release, index) {
            const name = release.name || release.tag_name;
            const isNew = isNewer(release.tag_name);

            // 标签
            let badges = '';
            if (index === 0) {
                badges += `<span class="badge badge-latest">${t('releases.latest')}</span>`;
            }
            if (isNew) {
                badges += `<span class="badge badge-new">${t('releases.new_available')}</span>`;
            }
            if (release.prerelease) {
                badges += `<span class="badge badge-pre">${t('releases.prerelease')}</span>`;
            }

            // Release body
            const bodyHtml = release.body
                ? `<div class="release-body">${renderMarkdown(release.body)}</div>`
                : '';

            // GitHub link
            const linkHtml = release.html_url
                ? `<a class="release-link" href="${release.html_url}" target="_blank" rel="noopener noreferrer">
                       ${t('releases.view_on_github')}
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                           <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                           <polyline points="15 3 21 3 21 9"></polyline>
                           <line x1="10" y1="14" x2="21" y2="3"></line>
                       </svg>
                   </a>`
                : '';

            html += `
                <div class="release-item">
                    <div class="release-header">
                        <div>
                            <div class="release-name">${escapeHtml(name)}</div>
                            <div class="release-badges">${badges}</div>
                            <div class="release-date">${formatDate(release.published_at)}</div>
                        </div>
                    </div>
                    ${bodyHtml}
                    ${linkHtml}
                </div>`;
        });
        html += '</div>';
        return html;
    }

    // ============ HTML 转义 ============
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============ 更新按钮高亮 ============
    function updateButtonHighlight() {
        const btn = document.getElementById('checkUpdateBtn');
        if (!btn) return;
        if (hasNewVersion) {
            btn.classList.add('has-update');
        } else {
            btn.classList.remove('has-update');
        }
    }

    // ============ 获取并展示 releases ============
    async function fetchAndShowReleases(isAutoCheck) {
        const content = document.getElementById('releasesContent');
        const badge = document.getElementById('releasesCurrentBadge');

        if (!isAutoCheck && content) {
            content.innerHTML = renderLoading();
            openModal();
        }

        try {
            const resp = await fetch('/api/releases');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            if (data.error && (!data.releases || data.releases.length === 0)) {
                throw new Error(data.error);
            }

            currentVersion = data.current_version || '';
            releases = data.releases || [];
            hasNewVersion = checkHasNewVersion();
            updateButtonHighlight();

            if (!isAutoCheck) {
                if (badge) {
                    badge.textContent = t('releases.current_version') + ': ' + currentVersion;
                }
                if (content) {
                    content.innerHTML = renderReleases();
                    bindRetryButton();
                }
            }
        } catch (e) {
            console.warn('获取 releases 失败:', e);
            if (!isAutoCheck && content) {
                content.innerHTML = renderError();
                bindRetryButton();
            }
        }
    }

    // ============ 绑定重试按钮 ============
    function bindRetryButton() {
        const retryBtn = document.getElementById('releasesRetryBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', function () {
                fetchAndShowReleases(false);
            });
        }
    }

    // ============ 全局入口：打开弹窗 ============
    window.openReleasesModal = function () {
        fetchAndShowReleases(false);
    };

    // ============ 初始化 ============
    async function init() {
        // 等待 i18n 就绪
        if (window.i18nReady) {
            try { await window.i18nReady; } catch (e) { /* ignore */ }
        }

        injectStyles();
        createModal();

        // 静默检查更新（不弹窗）
        fetchAndShowReleases(true);
    }

    // DOMContentLoaded 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
