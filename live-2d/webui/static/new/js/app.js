// My Neuro WebUI - 前端 JavaScript v3.3

const serviceStates = {};
const SERVICE_LOG_TYPES = ['asr', 'tts', 'memos'];
const SERVICE_LABELS = {
    live2d: 'Live2D',
    asr: 'ASR',
    tts: 'TTS',
    memos: '记忆系统',
    rag: 'RAG',
    bert: 'BERT'
};
const LIVE2D_GATE_TIMEOUT_MS = 90000;
const UNSAVED_CONFIG_MESSAGE = '当前配置有未保存的修改，请先保存配置。';
const START_WITH_UNSAVED_MESSAGE = '当前配置有未保存的修改，启动桌宠前建议先保存配置。仍要继续启动吗？';
const CONFIG_DIRTY_PANELS = new Set(['basic-config', 'dialog-config', 'persona-config', 'llm-config', 'voice-settings', 'ui-settings']);
const configDirtyItems = new Set();
let isConfigDirtyTrackingReady = false;
let currentLogTab = 'system-log';
let logPollingInterval = null;
let runtimeLogOffset = null;
let runtimeLogCursor = '';
let runtimeLogRequestInFlight = false;
let lastPetLogContent = '';  // 记录上次桌宠日志内容指纹
let lastToolLogContent = ''; // 记录上次工具日志内容指纹
let lastServiceLogContent = { asr: '', tts: '', memos: '' };
let live2dGateState = { gated: false, blocking: [], timedOut: [] };
let live2dGateStartedAt = {};
const LOG_POLL_INTERVAL_MS = 1000;
const MAX_RENDERED_LOG_ENTRIES = 500;
const PTT_KEY_ALIASES = Object.freeze({
    ' ': 'space',
    spacebar: 'space',
    return: 'enter',
    esc: 'escape',
    control: 'ctrl',
    controlleft: 'ctrl',
    controlright: 'ctrlright',
    ctrlleft: 'ctrl',
    altleft: 'alt',
    shiftleft: 'shift',
    metaleft: 'meta',
    osleft: 'meta',
    osright: 'metaright',
    command: 'meta',
    cmd: 'meta',
    win: 'meta',
    windows: 'meta',
    option: 'alt',
    left: 'arrowleft',
    up: 'arrowup',
    right: 'arrowright',
    down: 'arrowdown',
    ';': 'semicolon',
    ':': 'semicolon',
    '=': 'equal',
    '+': 'equal',
    ',': 'comma',
    '<': 'comma',
    '-': 'minus',
    '_': 'minus',
    '.': 'period',
    '>': 'period',
    '/': 'slash',
    '?': 'slash',
    '`': 'backquote',
    '~': 'backquote',
    '[': 'bracketleft',
    '{': 'bracketleft',
    '\\': 'backslash',
    '|': 'backslash',
    ']': 'bracketright',
    '}': 'bracketright',
    "'": 'quote',
    '"': 'quote'
});
const PTT_SUPPORTED_KEYS = new Set([
    ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)),
    ...Array.from({ length: 10 }, (_, index) => String(index)),
    ...Array.from({ length: 24 }, (_, index) => `f${index + 1}`),
    ...Array.from({ length: 10 }, (_, index) => `numpad${index}`),
    'backspace',
    'tab',
    'enter',
    'capslock',
    'escape',
    'space',
    'pageup',
    'pagedown',
    'end',
    'home',
    'arrowleft',
    'arrowup',
    'arrowright',
    'arrowdown',
    'insert',
    'delete',
    'numpadmultiply',
    'numpadadd',
    'numpadsubtract',
    'numpaddecimal',
    'numpaddivide',
    'numpadenter',
    'semicolon',
    'equal',
    'comma',
    'minus',
    'period',
    'slash',
    'backquote',
    'bracketleft',
    'backslash',
    'bracketright',
    'quote',
    'ctrl',
    'ctrlright',
    'alt',
    'altright',
    'shift',
    'shiftright',
    'meta',
    'metaright',
    'numlock',
    'scrolllock',
    'printscreen'
]);
const PTT_KEY_LABELS = Object.freeze({
    backspace: 'Backspace',
    tab: 'Tab',
    enter: 'Enter',
    capslock: 'Caps Lock',
    escape: 'Esc',
    space: 'Space',
    pageup: 'Page Up',
    pagedown: 'Page Down',
    end: 'End',
    home: 'Home',
    arrowleft: '←',
    arrowup: '↑',
    arrowright: '→',
    arrowdown: '↓',
    insert: 'Insert',
    delete: 'Delete',
    numpadmultiply: 'Num ×',
    numpadadd: 'Num +',
    numpadsubtract: 'Num -',
    numpaddecimal: 'Num .',
    numpaddivide: 'Num /',
    numpadenter: 'Num Enter',
    semicolon: ';',
    equal: '=',
    comma: ',',
    minus: '-',
    period: '.',
    slash: '/',
    backquote: '`',
    bracketleft: '[',
    backslash: '\\',
    bracketright: ']',
    quote: "'",
    ctrl: 'Ctrl',
    ctrlright: 'Right Ctrl',
    alt: 'Alt',
    altright: 'Right Alt',
    shift: 'Shift',
    shiftright: 'Right Shift',
    meta: 'Win',
    metaright: 'Right Win',
    numlock: 'Num Lock',
    scrolllock: 'Scroll Lock',
    printscreen: 'Print Screen'
});
let pttKeyCaptureActive = false;

// 对话历史状态
let chatHistoryState = {
    messages: [],           // 当前显示的对话列表
    page: 1,                // 当前页码
    pageSize: 50,           // 每页数量
    hasMore: false,         // 是否还有更多历史
    total: 0,               // 总对话数
    isLoading: false,       // 是否正在加载
    pollInterval: null,     // 轮询定时器
    expandedContentKeys: new Set() // 用户手动展开的历史消息内容
};

// ============ Toast 通知系统 ============

// Toast 图标映射
const TOAST_ICONS = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
};

// Toast 配置
const TOAST_CONFIG = {
    maxToasts: 4,           // 最多显示的 Toast 数量
    durations: {
        success: 5000,      // 成功提示持续时间 (ms)
        error: 8000,        // 错误提示持续时间 (ms)
        warning: 6000,      // 警告提示持续时间 (ms)
        info: 5000          // 信息提示持续时间 (ms)
    },
    hideDuration: 150       // 隐藏动画持续时间 (ms)
};

// 显示 Toast 通知
function showToast(message, type = 'info', duration) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        console.warn('Toast 容器不存在');
        return;
    }

    // 如果 Toast 数量超过限制，移除最旧的
    const existingToasts = container.querySelectorAll('.toast');
    while (existingToasts.length >= TOAST_CONFIG.maxToasts) {
        const oldestToast = existingToasts[0];
        hideToast(oldestToast, false);
        break; // 每次只移除一个，避免多次触发
    }

    // 创建 Toast 元素
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-content">
            <p class="toast-message">${message}</p>
        </div>
        <button class="toast-close" onclick="event.stopPropagation(); this.parentElement.remove();">&times;</button>
    `;
    
    // 点击 Toast 时立即关闭
    toast.addEventListener('click', (e) => {
        if (!e.target.classList.contains('toast-close')) {
            hideToast(toast);
        }
    });
    
    // 添加到容器
    container.appendChild(toast);
    
    // 使用默认持续时间（如果未指定）
    const toastDuration = duration || TOAST_CONFIG.durations[type] || TOAST_CONFIG.durations.info;
    
    // 自动隐藏
    setTimeout(() => {
        hideToast(toast);
    }, toastDuration);
}

// 隐藏 Toast 通知
function hideToast(toast, useAnimation = true) {
    if (useAnimation) {
        toast.classList.add('toast-hiding');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, TOAST_CONFIG.hideDuration);
    } else {
        // 直接移除，不使用动画
        if (toast.parentElement) {
            toast.remove();
        }
    }
}

// 便捷函数
function showSuccess(message, duration) {
    showToast(message, 'success', duration);
}

function showError(message, duration) {
    showToast(message, 'error', duration);
}

function showWarning(message, duration) {
    showToast(message, 'warning', duration);
}

function showInfo(message, duration) {
    showToast(message, 'info', duration);
}

// ============ 日志系统 ============

// 添加日志条目（仅用于系统日志）
function addLog(message, level = 'info', logType = 'system') {
    const timestamp = new Date().toLocaleTimeString();
    let outputId;

    switch(logType) {
        case 'pet':
            outputId = 'pet-log-output';
            break;
        case 'tool':
            outputId = 'tool-log-output';
            break;
        default:
            outputId = 'system-log-output';
    }

    const logOutput = document.getElementById(outputId);
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry log-' + level;
    logEntry.textContent = '[' + timestamp + '] ' + message;
    logOutput.appendChild(logEntry);
    logOutput.scrollTop = logOutput.scrollHeight;
    
    // 同步到第二个面板
    syncLogToPanel2();
}

// 优先采用日志生产方给出的级别，避免正文、JSON 或对话内容中的关键词造成误判。
function classifyLogLevel(log) {
    const text = String(log ?? '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const sourceMatch = text.match(/^\s*\[(ERROR|CRITICAL|FATAL|WARN|WARNING|INFO|DEBUG)\]/i)
        || text.match(/^\s*\d{4}-\d{2}-\d{2}.*?\s-\s(ERROR|CRITICAL|FATAL|WARN|WARNING|INFO|DEBUG)\s-\s/i)
        || text.match(/^\s*(ERROR|CRITICAL|FATAL|WARN|WARNING|INFO|DEBUG)\s*:/i);
    const sourceLevel = sourceMatch?.[1]?.toUpperCase() || '';
    const message = sourceMatch
        ? text.slice(sourceMatch[0].length).trimStart()
        : text.trimStart();
    const signalText = message.replace(
        /^(?:\[(?:TOOL|Plugin:[^\]]+)\]\s*)*/i,
        ''
    );
    if (['ERROR', 'CRITICAL', 'FATAL'].includes(sourceLevel)) return 'error';
    if (['WARN', 'WARNING'].includes(sourceLevel)) return 'warning';
    if (sourceLevel === 'DEBUG') return 'info';

    const explicitFailure = /^(?:❌|\[(?:FAIL|FAILED|ERROR)\](?:\s|$))/i.test(signalText)
        || /\bHTTP\/\d(?:\.\d)?["']?\s+[45]\d{2}\b/i.test(text);
    const explicitSuccess = /^(?:✅|\[OK\](?:\s|$))/i.test(signalText)
        || /\bHTTP\/\d(?:\.\d)?["']?\s+2\d{2}\s+OK\b/i.test(text);
    if (explicitFailure) return 'error';
    if (explicitSuccess) return 'success';
    if (/^⚠(?:️)?/.test(signalText)) return 'warning';

    const successText = text.includes('成功')
        || /\b(?:success(?:ful(?:ly)?)?|succeeded|completed)\b/i.test(text);
    if (sourceLevel === 'INFO') return successText ? 'success' : 'info';

    if (text.includes('警告') || /\bwarn(?:ing)?\b/i.test(text)) return 'warning';
    if (text.includes('错误') || text.includes('失败')
        || /\b(?:error|failed|failure|exception|traceback|fatal)\b/i.test(text)) return 'error';
    return successText ? 'success' : 'info';
}

// 增量加载日志（只添加新日志，避免回弹）
function appendNewLogs(logType, newLogs) {
    const outputId = logType + '-log-output';
    const logOutput = document.getElementById(outputId);
    if (!logOutput) return;

    const wasAtBottom = (
        logOutput.scrollHeight - logOutput.clientHeight - logOutput.scrollTop < 50
    );

    // 为每条新日志添加条目（不添加时间戳，直接使用日志文件中的时间）
    newLogs.forEach(log => {
        const level = classifyLogLevel(log);
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-' + level;
        logEntry.textContent = log;  // 直接使用日志内容，不添加额外时间戳
        logOutput.appendChild(logEntry);
    });

    while (logOutput.children.length > MAX_RENDERED_LOG_ENTRIES) {
        logOutput.firstElementChild?.remove();
    }

    // 只有当用户已经在底部时才自动滚动到底部
    if (wasAtBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    // 同步到第二个面板
    syncLogToPanel2();
}

function getServiceLabel(serviceName) {
    return SERVICE_LABELS[serviceName] || serviceName;
}

function getLogTabService(tabId) {
    const match = String(tabId || '').match(/^(asr|tts|memos)-log/);
    return match ? match[1] : null;
}

function isServiceLogTab(tabId) {
    return Boolean(getLogTabService(tabId));
}

function resetServiceLogFingerprint(serviceName) {
    if (SERVICE_LOG_TYPES.includes(serviceName)) {
        lastServiceLogContent[serviceName] = '';
    }
}

function renderClearedLog(outputId, message = '日志已清空') {
    const logOutput = document.getElementById(outputId);
    if (logOutput) {
        logOutput.innerHTML = `<div class="log-entry log-info">${message}</div>`;
    }
}

async function clearServiceLog(serviceName, clearBackend = true) {
    if (!SERVICE_LOG_TYPES.includes(serviceName)) return;

    renderClearedLog(serviceName + '-log-output');
    renderClearedLog(serviceName + '-log-output2');
    resetServiceLogFingerprint(serviceName);

    if (clearBackend) {
        try {
            await fetch('/api/logs/service/' + serviceName + '/clear', { method: 'POST' });
        } catch (error) {
            console.error('清空服务日志失败:', error);
        }
    }
}

function switchToServiceLog(serviceName) {
    if (!SERVICE_LOG_TYPES.includes(serviceName)) return;

    const tabId = serviceName + '-log';
    const targetTab = document.querySelector(`#logPanelContainer1 .log-tab[onclick="switchLogTab('${tabId}')"]`);
    document.querySelectorAll('#logPanelContainer1 .log-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#logPanelContainer1 .log-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    targetTab?.classList.add('active');
    currentLogTab = tabId;
    stopChatHistoryPolling();
    loadServiceLog(serviceName);
}

// 切换日志标签页
function switchLogTab(tabId) {
    // 只操作第一个面板的 log-panel
    document.querySelectorAll('#logPanelContainer1 .log-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#logPanelContainer1 .log-tab').forEach(t => t.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');
    currentLogTab = tabId;

    // 如果切换到历史对话选项卡，加载对话历史
    if (tabId === 'chat-history') {
        if (chatHistoryState.messages.length === 0) {
            // 首次加载：先获取总数，计算最后一页，然后加载
            loadLastPageOfChatHistory();
        } else {
            // 非首次：重新加载最后一页（最新对话）
            loadLastPageOfChatHistory();
        }
        startChatHistoryPolling();
    } else {
        stopChatHistoryPolling();
    }

    pollVisibleLogs();

    // 不再同步第二个面板，两个面板的选项卡独立操作，方便对照不同日志
}

// 同步选项卡状态到第二个面板
function syncLogTabToPanel2(tabId) {
    const container2 = document.getElementById('logPanelContainer2');
    if (container2.style.display === 'none' || container2.style.display === '') return;
    
    // 映射到第二个面板的 tabId
    const tabIdMap = {
        'system-log': 'system-log2',
        'pet-log': 'pet-log2',
        'tool-log': 'tool-log2'
    };
    const tabId2 = tabIdMap[tabId];
    
    if (tabId2) {
        // 切换第二个面板的选项卡
        document.querySelectorAll('#logPanelContainer2 .log-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('#logPanelContainer2 .log-tab').forEach(t => t.classList.remove('active'));
        
        document.getElementById(tabId2).classList.add('active');
        // 找到对应的按钮并添加 active
        const buttonText = tabId === 'system-log' ? '系统日志' : tabId === 'pet-log' ? '桌宠日志' : '工具日志';
        const buttons = document.querySelectorAll('#logPanelContainer2 .log-tab');
        buttons.forEach(btn => {
            if (btn.textContent === buttonText) {
                btn.classList.add('active');
            }
        });
    }
}

// 清空当前日志
function clearCurrentLog() {
    const serviceLog = getLogTabService(currentLogTab);
    if (serviceLog) {
        clearServiceLog(serviceLog);
        return;
    }

    // 如果是历史对话选项卡，调用清空 API
    if (currentLogTab === 'chat-history') {
        if (confirm('确定要清空所有对话历史吗？此操作不可恢复！')) {
            fetch('/api/chat-history/clear', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showToast('对话历史已清空', 'success');
                        chatHistoryState.messages = [];
                        chatHistoryState.page = 1;
                        chatHistoryState.hasMore = false;
                        chatHistoryState.total = 0;
                        chatHistoryState.expandedContentKeys.clear();
                        renderChatHistory([]);
                    } else {
                        showToast('清空失败：' + data.error, 'error');
                    }
                })
                .catch(err => showToast('清空失败：' + err.message, 'error'));
        }
        return;
    }
    
    let outputId;
    switch(currentLogTab) {
        case 'pet-log':
            outputId = 'pet-log-output';
            break;
        case 'tool-log':
            outputId = 'tool-log-output';
            break;
        default:
            outputId = 'system-log-output';
    }
    const logOutput = document.getElementById(outputId);
    logOutput.innerHTML = '<div class="log-entry log-info">日志已清空</div>';

    // 重置内容指纹，使下次轮询能重新渲染
    if (currentLogTab === 'pet-log') lastPetLogContent = '';
    if (currentLogTab === 'tool-log') lastToolLogContent = '';
}

// 拆分/合并日志窗口
function toggleLogSplit() {
    const wrapper = document.getElementById('logWrapper');
    const container2 = document.getElementById('logPanelContainer2');
    const button = document.getElementById('splitLogButton');
    
    if (wrapper.classList.contains('split')) {
        // 合并
        wrapper.classList.remove('split');
        container2.style.display = 'none';
        button.classList.remove('active');
        button.textContent = '拆分';
    } else {
        // 拆分
        wrapper.classList.add('split');
        container2.style.display = 'flex';
        button.classList.add('active');
        button.textContent = '合并';
        // 同步当前日志到第二个面板
        syncLogToPanel2();
    }
}

// 切换第二个日志面板的标签页
function switchLogTab2(tabId) {
    document.querySelectorAll('#logPanelContainer2 .log-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#logPanelContainer2 .log-tab').forEach(t => t.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');

    // 如果切换到历史对话选项卡，加载对话历史
    if (tabId === 'chat-history2') {
        if (chatHistoryState.messages.length === 0) {
            // 首次加载：先获取总数，计算最后一页，然后加载
            loadLastPageOfChatHistory();
        } else {
            // 非首次：重新加载最后一页（最新对话）
            loadLastPageOfChatHistory();
        }
        startChatHistoryPolling();
    } else {
        stopChatHistoryPolling();
    }
    pollVisibleLogs();
}

// 清空第二个面板的当前日志
function clearCurrentLog2() {
    const activePanel2 = document.querySelector('#logPanelContainer2 .log-panel.active');
    const serviceLog = activePanel2 ? getLogTabService(activePanel2.id) : null;
    if (serviceLog) {
        clearServiceLog(serviceLog);
        return;
    }

    let outputId;
    const activeTab = document.querySelector('#logPanelContainer2 .log-tab.active');
    const tabName = activeTab ? activeTab.textContent : '系统日志';

    if (tabName === '桌宠日志') {
        outputId = 'pet-log-output2';
    } else if (tabName === '工具日志') {
        outputId = 'tool-log-output2';
    } else if (tabName === '历史对话') {
        // 历史对话清空与第一个面板相同
        clearCurrentLog();
        return;
    } else {
        outputId = 'system-log-output2';
    }

    const logOutput = document.getElementById(outputId);
    logOutput.innerHTML = '<div class="log-entry log-info">日志已清空</div>';
}

// ============ 对话历史功能 ============

// 加载最后一页对话历史（首次加载时使用）
async function loadLastPageOfChatHistory() {
    if (chatHistoryState.isLoading) return;

    chatHistoryState.isLoading = true;
    console.log('[ChatHistory] 开始加载最后一页...');
    
    try {
        // 先获取第一页来确定总数
        const response = await fetch(`/api/chat-history?page=1&page_size=${chatHistoryState.pageSize}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        chatHistoryState.total = data.total;
        console.log(`[ChatHistory] 总对话数：${data.total}`);

        // 如果总数为 0，显示空状态
        if (data.total === 0) {
            document.getElementById('chat-history-output').innerHTML = 
                '<div class="log-entry log-info">暂无对话记录</div>';
            chatHistoryState.messages = [];
            chatHistoryState.page = 1;
            chatHistoryState.hasMorePrev = false;
            updateChatHistoryLoadMoreButton();
            return;
        }

        // 计算最后一页的页码
        const lastPage = Math.ceil(data.total / chatHistoryState.pageSize);
        console.log(`[ChatHistory] 最后一页：${lastPage}`);

        // 直接加载最后一页
        const responseLast = await fetch(`/api/chat-history?page=${lastPage}&page_size=${chatHistoryState.pageSize}`);
        const dataLast = await responseLast.json();

        if (dataLast.error) {
            throw new Error(dataLast.error);
        }

        console.log(`[ChatHistory] 加载到 ${dataLast.messages.length} 条消息`);

        chatHistoryState.page = lastPage;
        chatHistoryState.hasMorePrev = dataLast.has_prev;
        chatHistoryState.messages = dataLast.messages;

        renderChatHistory(chatHistoryState.messages, false, 0, 0);
        updateChatHistoryLoadMoreButton();
        
        // 在第一页时启动轮询
        if (lastPage === 1) {
            startChatHistoryPolling();
        }
        
        console.log('[ChatHistory] 加载完成');

    } catch (error) {
        console.error('[ChatHistory] 加载失败:', error);
        document.getElementById('chat-history-output').innerHTML =
            `<div class="log-entry log-error">加载失败：${error.message}</div>`;
    } finally {
        chatHistoryState.isLoading = false;
    }
}

// 加载对话历史（分页）
async function loadChatHistory(page = 1, prependToTop = false) {
    if (chatHistoryState.isLoading) return;

    const container = document.getElementById('chat-history-output');
    
    // 保存加载前的滚动位置
    const scrollBeforeLoad = container.scrollTop;
    const scrollHeightBeforeLoad = container.scrollHeight;

    chatHistoryState.isLoading = true;
    try {
        const response = await fetch(`/api/chat-history?page=${page}&page_size=${chatHistoryState.pageSize}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        chatHistoryState.page = page;
        chatHistoryState.hasMorePrev = data.has_prev;  // 是否还有更早的历史（上一页）
        chatHistoryState.total = data.total;

        if (prependToTop) {
            // 前置模式（加载更多历史对话）：将新内容添加到当前内容上方
            chatHistoryState.messages = [...data.messages, ...chatHistoryState.messages];
        } else {
            // 替换模式（初始加载或刷新）
            chatHistoryState.messages = data.messages;
        }

        renderChatHistory(chatHistoryState.messages, prependToTop, scrollBeforeLoad, scrollHeightBeforeLoad);
        updateChatHistoryLoadMoreButton();
        
        console.log(`[ChatHistory] 加载完成，当前页：${chatHistoryState.page}, 消息总数：${chatHistoryState.messages.length}`);

        // 管理轮询：当不在第一页时暂停轮询
        if (page > 1) {
            stopChatHistoryPolling();
        } else {
            startChatHistoryPolling();
        }

    } catch (error) {
        console.error('加载对话历史失败:', error);
        document.getElementById('chat-history-output').innerHTML =
            `<div class="log-entry log-error">加载失败：${error.message}</div>`;
    } finally {
        chatHistoryState.isLoading = false;
    }
}

// 渲染对话历史
function renderChatHistory(messages, prependToTop = false, scrollBeforeLoad = 0, scrollHeightBeforeLoad = 0) {
    const container = document.getElementById('chat-history-output');
    const logContainer = container.closest('.log-container');
    
    console.log(`[ChatHistory] renderChatHistory 调用`);
    console.log(`[ChatHistory] container 存在：${!!container}`);
    console.log(`[ChatHistory] logContainer 存在：${!!logContainer}`);
    console.log(`[ChatHistory] messages 数量：${messages ? messages.length : 'null'}`);
    
    // 确保 log-container 有正确的高度限制和滚动
    if (logContainer) {
        logContainer.style.overflowY = 'auto';
        console.log(`[ChatHistory] logContainer 高度：${logContainer.offsetHeight}px, 样式高度：${logContainer.style.height}`);
    }

    if (!messages || messages.length === 0) {
        console.log('[ChatHistory] 消息为空，显示空状态');
        container.innerHTML = '<div class="log-entry log-info">暂无对话记录</div>';
        return;
    }

    const htmlParts = [];

    // 添加"加载更多"按钮在顶部
    htmlParts.push(`
        <div class="chat-load-more" id="chat-load-more-container">
            <button id="chat-load-more-btn" onclick="loadMoreChatHistory()" ${!chatHistoryState.hasMorePrev ? 'disabled' : ''}>
                ${chatHistoryState.hasMorePrev ? '加载更多历史对话' : '没有更多了'}
            </button>
        </div>
    `);

    // 添加 CSS 样式
    htmlParts.push(`
        <style>
            .chat-message {
                margin-bottom: 10px;
                padding: 8px 12px;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.05);
                min-height: 2.4em;
                overflow-wrap: break-word;
                word-wrap: break-word;
            }
            .chat-message.user {
                background: rgba(74, 144, 217, 0.1);
                border-left: 3px solid #4a90d9;
            }
            .chat-message.assistant {
                background: rgba(212, 133, 13, 0.1);
                border-left: 3px solid #d4850d;
            }
            .chat-sender {
                font-weight: bold;
                margin-bottom: 2px;
                font-size: 13px;
                display: block;
            }
            .chat-sender.user {
                color: #4a90d9;
            }
            .chat-sender.assistant {
                color: #d4850d;
            }
            .chat-content {
                line-height: 1.5;
                color: #e0e0e0;
                white-space: pre-wrap;
                word-wrap: break-word;
                overflow-wrap: break-word;
                font-size: 14px;
                max-width: 100%;
            }
            .chat-content.chat-content-collapsed {
                max-height: 7.5em;
                overflow: hidden;
                position: relative;
            }
            .chat-content.chat-content-collapsed::after {
                content: '';
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 2em;
                pointer-events: none;
                background: linear-gradient(transparent, rgba(10, 15, 31, 0.95));
            }
            .chat-content-toggle {
                display: none;
                margin-top: 6px;
                padding: 2px 0;
                border: none;
                background: transparent;
                color: #7df5ff;
                cursor: pointer;
                font-size: 13px;
                font-family: inherit;
            }
            .chat-content-toggle.visible {
                display: inline-block;
            }
            .chat-content-toggle:hover {
                color: #00f0ff;
                text-decoration: underline;
            }
            .chat-content img {
                max-width: 100%;
                border-radius: 6px;
                margin: 8px 0;
                cursor: pointer;
                transition: transform 0.2s;
                display: block;
            }
            .chat-content img:hover {
                transform: scale(1.02);
            }
            .chat-load-more {
                text-align: center;
                padding: 12px;
            }
            .chat-load-more button {
                padding: 6px 16px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                border: none;
                border-radius: 6px;
                color: white;
                cursor: pointer;
                font-size: 13px;
            }
            .chat-load-more button:disabled {
                background: #555;
                cursor: not-allowed;
                font-size: 13px;
            }
            /* 工具调用样式 */
            .chat-tool-calls {
                margin: 8px 0;
                padding: 8px;
                background: rgba(102, 126, 234, 0.1);
                border-radius: 6px;
                border-left: 3px solid #667eea;
            }
            .chat-tool-call {
                margin: 4px 0;
                padding: 4px;
            }
            .chat-tool-name {
                font-weight: bold;
                color: #667eea;
                font-size: 13px;
                margin-bottom: 4px;
            }
            .chat-tool-args {
                font-family: monospace;
                font-size: 12px;
                color: #a0a0a0;
                white-space: pre-wrap;
                word-wrap: break-word;
                background: rgba(0, 0, 0, 0.2);
                padding: 4px 8px;
                border-radius: 4px;
            }
            /* 确保 chat-history-output 容器内的内容不会撑开父容器 */
            #chat-history-output {
                max-width: 100%;
            }
        </style>
    `);

    // 遍历消息（保持原顺序：旧→新）
    messages.forEach((msg, messageIndex) => {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        const senderName = role === 'user' ? '用户' : 'AI';
        const messageKey = getChatHistoryMessageKey(msg, messageIndex);
        let contentPartIndex = 0;
        
        let contentHtml = '';

        // 处理工具调用
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            contentHtml += '<div class="chat-tool-calls">';
            msg.tool_calls.forEach(tool => {
                const functionName = tool.function?.name || 'unknown';
                const functionArgs = tool.function?.arguments || '{}';
                contentHtml += `
                    <div class="chat-tool-call">
                        <div class="chat-tool-name">🔧 调用工具：${escapeHtml(functionName)}</div>
                        <div class="chat-tool-args">${escapeHtml(functionArgs)}</div>
                    </div>
                `;
            });
            contentHtml += '</div>';
        }

        // 处理 content 字段
        if (msg.content) {
            if (Array.isArray(msg.content)) {
                // content 是数组格式（多模态消息）
                msg.content.forEach(item => {
                    if (item.type === 'text') {
                        let text = escapeHtml(item.text || '');
                        text = renderBase64Images(text);
                        contentHtml += createCollapsibleChatContent(text, `${messageKey}:content:${contentPartIndex++}`);
                    } else if (item.type === 'image_url') {
                        const imageUrl = item.image_url?.url || '';
                        if (imageUrl.startsWith('data:image/')) {
                            contentHtml += `<img src="${imageUrl}" alt="图片" onclick="previewImage(this.src)" style="max-width: 100%; border-radius: 6px; margin: 8px 0; cursor: pointer;">`;
                        } else {
                            contentHtml += `<img src="${imageUrl}" alt="图片" onclick="previewImage(this.src)" style="max-width: 100%; border-radius: 6px; margin: 8px 0; cursor: pointer;">`;
                        }
                    }
                });
            } else {
                // content 是字符串格式
                let content = escapeHtml(msg.content || '');
                content = renderBase64Images(content);
                contentHtml += createCollapsibleChatContent(content, `${messageKey}:content:${contentPartIndex++}`);
            }
        }

        htmlParts.push(`
            <div class="chat-message ${role}">
                <div class="chat-sender ${role}">${senderName}</div>
                ${contentHtml}
            </div>
        `);
    });

    container.innerHTML = htmlParts.join('');
    
    console.log(`[ChatHistory] HTML 已渲染，总长度：${htmlParts.join('').length}`);

    // 等待布局完成后再判断 5 行折叠和同步第二面板
    requestAnimationFrame(() => {
        setupCollapsibleChatContent(container);
        syncLogToPanel2();
    });

    // 滚动位置处理 - 使用延迟确保内容完全渲染
    // 切换选项卡时需要等待 DOM 和样式完全应用
    setTimeout(() => {
        if (prependToTop) {
            // 加载更多时，计算新内容的高度并恢复滚动位置
            const newScrollHeight = container.scrollHeight;
            const heightDiff = newScrollHeight - scrollHeightBeforeLoad;
            container.scrollTop = scrollBeforeLoad + heightDiff;
            console.log(`[ChatHistory] 加载更多，恢复滚动位置：${container.scrollTop}`);
        } else {
            // 初始加载或刷新时，滚动到底部（最新对话）
            // 使用 scrollHeight 确保滚动到最底部
            const targetScroll = container.scrollHeight;
            container.scrollTop = targetScroll;
            console.log(`[ChatHistory] 滚动到底部：${targetScroll}, 实际滚动位置：${container.scrollTop}`);
            
            // 验证滚动是否成功
            setTimeout(() => {
                console.log(`[ChatHistory] 验证滚动位置：${container.scrollTop} / ${container.scrollHeight}`);
            }, 200);
        }
    }, 300);
}

// 生成可折叠的聊天文本块，实际是否显示按钮由渲染后的高度决定
function createCollapsibleChatContent(content, stateKey) {
    const safeStateKey = escapeHtml(String(stateKey));
    const isExpanded = chatHistoryState.expandedContentKeys.has(stateKey);
    const collapsedClass = isExpanded ? '' : ' chat-content-collapsed';
    const toggleText = isExpanded ? '收起' : '展开';

    return `
        <div class="chat-content${collapsedClass}" data-chat-content-key="${safeStateKey}">${content}</div>
        <button class="chat-content-toggle" type="button" onclick="toggleChatContent(this)">${toggleText}</button>
    `;
}

// 只给超过约 5 行的内容显示展开按钮，短文本保持普通显示
function setupCollapsibleChatContent(root) {
    root.querySelectorAll('.chat-content').forEach(content => {
        const toggle = content.nextElementSibling;
        if (!toggle || !toggle.classList.contains('chat-content-toggle')) return;

        const wasExpanded = !content.classList.contains('chat-content-collapsed');
        if (wasExpanded) {
            content.classList.add('chat-content-collapsed');
        }
        const hasOverflow = content.scrollHeight > content.clientHeight + 1;
        if (wasExpanded) {
            content.classList.remove('chat-content-collapsed');
        }

        if (hasOverflow) {
            toggle.classList.add('visible');
            toggle.textContent = content.classList.contains('chat-content-collapsed') ? '展开' : '收起';
            return;
        }

        if (content.dataset.chatContentKey) {
            chatHistoryState.expandedContentKeys.delete(content.dataset.chatContentKey);
        }
        content.classList.remove('chat-content-collapsed');
        toggle.remove();
    });
}

function getChatHistoryMessageKey(msg, fallbackIndex) {
    const fingerprint = JSON.stringify({
        role: msg?.role || '',
        content: msg?.content || '',
        tool_call_id: msg?.tool_call_id || '',
        tool_calls: msg?.tool_calls || []
    });
    const contentHash = hashString(fingerprint);

    if (msg && msg._history_index !== undefined && msg._history_index !== null) {
        return `history-${msg._history_index}-${contentHash}`;
    }

    return `fallback-${hashString(`${fallbackIndex}:${fingerprint}`)}`;
}

function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function setChatContentCollapsed(content, collapsed) {
    content.classList.toggle('chat-content-collapsed', collapsed);

    const toggle = content.nextElementSibling;
    if (toggle && toggle.classList.contains('chat-content-toggle')) {
        toggle.textContent = collapsed ? '展开' : '收起';
    }
}

// 展开或收起单条历史对话内容
function toggleChatContent(button) {
    const content = button.previousElementSibling;
    if (!content || !content.classList.contains('chat-content')) return;

    const shouldCollapse = !content.classList.contains('chat-content-collapsed');
    const stateKey = content.dataset.chatContentKey;

    if (stateKey) {
        if (shouldCollapse) {
            chatHistoryState.expandedContentKeys.delete(stateKey);
        } else {
            chatHistoryState.expandedContentKeys.add(stateKey);
        }

        document.querySelectorAll('.chat-content').forEach(item => {
            if (item.dataset.chatContentKey === stateKey) {
                setChatContentCollapsed(item, shouldCollapse);
            }
        });
        return;
    }

    setChatContentCollapsed(content, shouldCollapse);
}

// HTML 转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 渲染内容中的 base64 图片
function renderBase64Images(content) {
    // 匹配 data:image/jpeg;base64, 开头的图片
    const imageRegex = /data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g;
    return content.replace(imageRegex, (match) => {
        return `<img src="${match}" alt="图片" onclick="previewImage(this.src)">`;
    });
}

// 图片预览功能
function previewImage(src) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        z-index: 999999;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
    `;
    
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = `
        max-width: 98%;
        max-height: 98%;
        object-fit: contain;
    `;
    
    overlay.appendChild(img);
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}

// 加载更多历史对话
function loadMoreChatHistory() {
    // 检查是否还有更早的历史，或者是否正在加载
    if (!chatHistoryState.hasMorePrev || chatHistoryState.isLoading) return;

    // 加载上一页的内容（更早的历史），前置到顶部
    const prevPage = chatHistoryState.page - 1;
    if (prevPage < 1) return;
    
    loadChatHistory(prevPage, true);  // true 表示前置到顶部
}

// 更新加载更多按钮状态
function updateChatHistoryLoadMoreButton() {
    const btn = document.getElementById('chat-load-more-btn');
    if (btn) {
        btn.disabled = !chatHistoryState.hasMorePrev;
        btn.textContent = chatHistoryState.hasMorePrev ? '加载更多历史对话' : '没有更多了';
    }
}

// 启动对话历史轮询
function startChatHistoryPolling() {
    stopChatHistoryPolling();
    chatHistoryState.pollInterval = setInterval(() => {
        // 只在当前显示历史对话选项卡时轮询，且只在第一页（最新对话）时更新
        const isChatHistoryActive = document.getElementById('chat-history')?.classList.contains('active');
        if (isChatHistoryActive && chatHistoryState.messages.length > 0 && chatHistoryState.page === 1) {
            // 轮询时重新加载第一页，保持最新对话
            loadChatHistory(1, false);
        }
    }, 2000);
}

// 停止对话历史轮询
function stopChatHistoryPolling() {
    if (chatHistoryState.pollInterval) {
        clearInterval(chatHistoryState.pollInterval);
        chatHistoryState.pollInterval = null;
    }
}

// 同步日志到第二个面板
function syncLogToPanel2() {
    const container2 = document.getElementById('logPanelContainer2');
    if (container2.style.display === 'none' || container2.style.display === '') return;

    // 同步系统日志
    const systemLog1 = document.getElementById('system-log-output');
    const systemLog2 = document.getElementById('system-log-output2');
    systemLog2.innerHTML = systemLog1.innerHTML;

    // 同步桌宠日志
    const petLog1 = document.getElementById('pet-log-output');
    const petLog2 = document.getElementById('pet-log-output2');
    petLog2.innerHTML = petLog1.innerHTML;

    // 同步工具日志
    const toolLog1 = document.getElementById('tool-log-output');
    const toolLog2 = document.getElementById('tool-log-output2');
    toolLog2.innerHTML = toolLog1.innerHTML;

    SERVICE_LOG_TYPES.forEach(serviceName => {
        const serviceLog1 = document.getElementById(serviceName + '-log-output');
        const serviceLog2 = document.getElementById(serviceName + '-log-output2');
        if (serviceLog1 && serviceLog2) {
            serviceLog2.innerHTML = serviceLog1.innerHTML;
        }
    });

    // 同步对话历史
    const chatHistory1 = document.getElementById('chat-history-output');
    const chatHistory2 = document.getElementById('chat-history-output2');
    if (chatHistory2) {
        chatHistory2.innerHTML = chatHistory1.innerHTML;
    }

    // 同步滚动位置
    const activePanel1 = document.querySelector('#logPanelContainer1 .log-panel.active .log-container');
    const activePanel2 = document.querySelector('#logPanelContainer2 .log-panel.active .log-container');
    if (activePanel1 && activePanel2) {
        activePanel2.scrollTop = activePanel1.scrollTop;
    }
}

function visibleLogStreams() {
    const services = new Set();
    let runtime = false;
    const panels = document.querySelectorAll(
        '#logPanelContainer1 .log-panel.active, #logPanelContainer2 .log-panel.active'
    );
    panels.forEach(panel => {
        const container = panel.closest('.log-panel-container');
        if (!container || getComputedStyle(container).display === 'none') return;
        if (panel.id.startsWith('pet-log') || panel.id.startsWith('tool-log')) {
            runtime = true;
            return;
        }
        const service = getLogTabService(panel.id);
        if (service) services.add(service);
    });
    return { runtime, services };
}


async function loadRuntimeLogs() {
    if (runtimeLogRequestInFlight) return;
    runtimeLogRequestInFlight = true;
    try {
        const params = new URLSearchParams();
        if (runtimeLogOffset !== null) {
            params.set('offset', String(runtimeLogOffset));
            params.set('cursor', runtimeLogCursor);
        }
        const suffix = params.toString() ? '?' + params.toString() : '';
        const response = await fetch('/api/logs/runtime' + suffix);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || '运行日志读取失败');
        }

        if (data.reset) {
            document.getElementById('pet-log-output')?.replaceChildren();
            document.getElementById('tool-log-output')?.replaceChildren();
        }

        const logs = data.logs || {};
        if (Array.isArray(logs.pet) && logs.pet.length > 0) {
            appendNewLogs('pet', logs.pet);
        }
        if (Array.isArray(logs.tool) && logs.tool.length > 0) {
            appendNewLogs('tool', logs.tool);
        }
        runtimeLogOffset = Number.isFinite(Number(data.offset))
            ? Number(data.offset)
            : runtimeLogOffset;
        runtimeLogCursor = data.cursor || runtimeLogCursor;
    } catch (error) {
        console.error('加载运行日志失败:', error);
    } finally {
        runtimeLogRequestInFlight = false;
    }
}

async function loadServiceLog(serviceName) {
    if (!SERVICE_LOG_TYPES.includes(serviceName)) return;

    try {
        const response = await fetch('/api/logs/service/' + serviceName);
        if (response.ok) {
            const data = await response.json();
            const logOutput = document.getElementById(serviceName + '-log-output');
            if (!logOutput) return;

            const logs = data.logs || [];
            const contentFingerprint = logs.join('\n');
            if (contentFingerprint === lastServiceLogContent[serviceName]) return;

            logOutput.innerHTML = '';
            if (logs.length > 0) {
                appendNewLogs(serviceName, logs);
            } else {
                renderClearedLog(serviceName + '-log-output', `等待 ${getServiceLabel(serviceName)} 服务启动...`);
            }
            lastServiceLogContent[serviceName] = contentFingerprint;
            syncLogToPanel2();
        }
    } catch (error) {
        console.error('加载服务日志失败:', error);
    }
}

function pollVisibleLogs() {
    const dashboard = document.getElementById('dashboard');
    if (document.hidden || !dashboard?.classList.contains('active')) return;

    const streams = visibleLogStreams();
    if (streams.runtime) loadRuntimeLogs();
    streams.services.forEach(loadServiceLog);
}


// 启动日志轮询
function startLogPolling() {
    stopLogPolling();
    pollVisibleLogs();
    logPollingInterval = setInterval(pollVisibleLogs, LOG_POLL_INTERVAL_MS);
}

// 停止日志轮询
function stopLogPolling() {
    if (logPollingInterval) {
        clearInterval(logPollingInterval);
        logPollingInterval = null;
    }
}

// ============ API Key 显示/隐藏 ============

// 通用的密码显示/隐藏切换函数
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const toggleBtn = event.target;

    if (!input || !toggleBtn) return;

    if (input.type === 'password') {
        input.type = 'text';
        toggleBtn.textContent = '🙈';
    } else {
        input.type = 'password';
        toggleBtn.textContent = '👁️';
    }
}

// 兼容旧的 API Key 切换函数（LLM 配置页面）
function toggleApiKeyVisibility() {
    togglePasswordVisibility('api-key');
}

// ============ 服务控制 ============

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getServiceButton(serviceName, action) {
    return document.getElementById(serviceName + '-' + action);
}

function setButtonLoading(button, loadingText) {
    if (!button) return;
    if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.textContent = loadingText;
}

function restoreButtonText(button) {
    if (button && button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
    }
}

function applyLive2DGateState() {
    const startBtn = getServiceButton('live2d', 'start');
    const statusElement = document.getElementById('live2d-status');
    const hint = document.getElementById('live2dGateHint');
    const isLive2DRunning = serviceStates.live2d === 'running';

    if (startBtn) {
        startBtn.disabled = isLive2DRunning || live2dGateState.gated;
        startBtn.title = live2dGateState.gated
            ? '等待 ' + live2dGateState.blocking.map(getServiceLabel).join('、') + ' 端口响应...'
            : '';
    }

    if (statusElement && !isLive2DRunning) {
        statusElement.className = live2dGateState.gated ? 'status waiting' : 'status stopped';
    }

    if (hint) {
        if (live2dGateState.gated) {
            hint.textContent = '等待 ' + live2dGateState.blocking.map(getServiceLabel).join('、') + ' 端口响应后才能启动 Live2D';
            hint.classList.remove('warning');
        } else if (live2dGateState.timedOut.length > 0) {
            hint.textContent = live2dGateState.timedOut.map(getServiceLabel).join('、') + ' 可能启动失败，已允许手动启动 Live2D';
            hint.classList.add('warning');
        } else {
            hint.textContent = '';
            hint.classList.remove('warning');
        }
    }
}

async function updateLive2DGate() {
    try {
        const response = await fetch('/api/services/readiness');
        if (!response.ok) {
            return live2dGateState;
        }

        const readiness = await response.json();
        const now = Date.now();
        const blocking = [];
        const timedOut = [];

        SERVICE_LOG_TYPES.forEach(serviceName => {
            const state = readiness[serviceName] || {};
            if (state.started && !state.ready) {
                if (!live2dGateStartedAt[serviceName]) {
                    live2dGateStartedAt[serviceName] = now;
                }
                const elapsed = now - live2dGateStartedAt[serviceName];
                if (elapsed >= LIVE2D_GATE_TIMEOUT_MS) {
                    timedOut.push(serviceName);
                } else {
                    blocking.push(serviceName);
                }
            } else {
                delete live2dGateStartedAt[serviceName];
            }
        });

        live2dGateState = {
            gated: blocking.length > 0,
            blocking,
            timedOut
        };
        applyLive2DGateState();
    } catch (error) {
        console.error('获取服务就绪状态失败:', error);
    }
    return live2dGateState;
}

async function waitForLive2DGate(timeoutMs = LIVE2D_GATE_TIMEOUT_MS) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const gate = await updateLive2DGate();
        if (!gate.gated) {
            return true;
        }
        await sleep(1500);
    }
    await updateLive2DGate();
    return !live2dGateState.gated;
}

// 更新服务状态
function updateServiceStatus(serviceName, status) {
    serviceStates[serviceName] = status;
    const statusElement = document.getElementById(serviceName + '-status');
    const startBtn = document.getElementById(serviceName + '-start');
    const stopBtn = document.getElementById(serviceName + '-stop');
    const restartBtn = document.getElementById(serviceName + '-restart');

    // 终端页等位置可能没有对应状态点与按钮 id，避免抛错导致后续逻辑（如启动成功提示）不执行
    if (!statusElement) {
        return;
    }

    if (status === 'running') {
        statusElement.className = 'status running';
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (restartBtn) restartBtn && (restartBtn.disabled = false);
    } else {
        statusElement.className = 'status stopped';
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (restartBtn) restartBtn && (restartBtn.disabled = true);
    }

    if (serviceName === 'live2d') {
        applyLive2DGateState();
    }
}

// 启动服务
async function startService(serviceName, options = {}) {
    const startBtn = getServiceButton(serviceName, 'start');
    try {
        if (serviceName === 'live2d') {
            if (!options.skipUnsavedCheck && !confirmStartLive2dWithCurrentConfig()) {
                return false;
            }

            if (!options.skipGateCheck) {
                const gate = await updateLive2DGate();
                if (gate.gated) {
                    const message = 'Live2D 正在等待 ' + gate.blocking.map(getServiceLabel).join('、') + ' 端口响应';
                    addLog(message, 'warning', 'system');
                    showWarning(message);
                    return false;
                }
            }
        }

        setButtonLoading(startBtn, '启动中...');
        addLog('正在启动 ' + serviceName + ' 服务...', 'info', 'system');
        const response = await fetch('/api/start/' + serviceName, { method: 'POST' });
        const result = await response.json();

        if (response.ok && result.already_running) {
            updateServiceStatus(serviceName, 'running');
            addLog(serviceName + ' 服务已在运行', 'info', 'system');
            showSuccess(serviceName + ' 服务已在运行');
            if (SERVICE_LOG_TYPES.includes(serviceName)) {
                loadServiceLog(serviceName);
            }
            updateLive2DGate();
            return true;
        }

        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'running');
            addLog(serviceName + ' 服务启动成功', 'success', 'system');
            if (SERVICE_LOG_TYPES.includes(serviceName)) {
                loadServiceLog(serviceName);
            }
            updateLive2DGate();
            return true;
        } else {
            addLog(serviceName + ' 服务启动失败：' + (result.error || '未知错误'), 'error', 'system');
            updateServiceStatus(serviceName, 'stopped');
            showError(serviceName + ' 服务启动失败：' + (result.error || '未知错误'));
            if (result.log && SERVICE_LOG_TYPES.includes(result.log)) {
                switchToServiceLog(result.log);
            }
            updateLive2DGate();
            return false;
        }
    } catch (error) {
        addLog(serviceName + ' 服务启动异常：' + error.message, 'error', 'system');
        updateServiceStatus(serviceName, 'stopped');
        showError(serviceName + ' 服务启动异常：' + error.message);
        return false;
    } finally {
        restoreButtonText(startBtn);
        if (serviceStates[serviceName] !== 'running') {
            updateServiceStatus(serviceName, 'stopped');
        }
    }
}

async function openMemosWebUI() {
    const button = document.getElementById('memos-webui-start');
    try {
        setButtonLoading(button, '打开中...');
        addLog('正在打开记忆系统 WebUI...', 'info', 'system');

        const response = await fetch('/api/memos/webui/start', { method: 'POST' });
        const result = await response.json();

        if (response.ok && result.success) {
            const message = result.already_running ? '记忆系统 WebUI 已打开' : '记忆系统 WebUI 正在启动';
            addLog(`${message}：${result.url || 'http://127.0.0.1:8004'}`, 'success', 'system');
            showSuccess(message);
            return true;
        }

        const error = result.error || '未知错误';
        addLog('打开记忆系统 WebUI 失败：' + error, 'error', 'system');
        showError('打开记忆系统 WebUI 失败：' + error);
        return false;
    } catch (error) {
        addLog('打开记忆系统 WebUI 异常：' + error.message, 'error', 'system');
        showError('打开记忆系统 WebUI 异常：' + error.message);
        return false;
    } finally {
        restoreButtonText(button);
    }
}

// 停止服务
async function stopService(serviceName) {
    const startBtn = getServiceButton(serviceName, 'start');
    const stopBtn = getServiceButton(serviceName, 'stop');
    try {
        setButtonLoading(stopBtn, '停止中...');
        if (startBtn) startBtn.disabled = true;
        addLog('正在停止 ' + serviceName + ' 服务...', 'warning', 'system');
        const response = await fetch('/api/stop/' + serviceName, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'stopped');
            addLog(serviceName + ' 服务已停止', 'info', 'system');
            if (SERVICE_LOG_TYPES.includes(serviceName)) {
                await clearServiceLog(serviceName);
            }
            updateLive2DGate();
            return true;
        } else {
            addLog(serviceName + ' 服务停止失败：' + (result.error || '未知错误'), 'error', 'system');
            return false;
        }
    } catch (error) {
        addLog(serviceName + ' 服务停止异常：' + error.message, 'error', 'system');
        return false;
    } finally {
        restoreButtonText(stopBtn);
    }
}

// 重启服务（仅 Live2D）
async function restartService(serviceName) {
    try {
        if (serviceName === 'live2d' && !confirmStartLive2dWithCurrentConfig()) {
            return;
        }
        addLog('正在重启 ' + serviceName + ' 服务...', 'info', 'system');
        await stopService(serviceName);
        setTimeout(function() { startService(serviceName, { skipUnsavedCheck: serviceName === 'live2d' }); }, 1500);
    } catch (error) {
        addLog(serviceName + ' 服务重启异常：' + error.message, 'error', 'system');
    }
}

// 一键启动全部服务
async function startAllServices() {
    if (serviceStates.live2d !== 'running' && !confirmStartLive2dWithCurrentConfig()) {
        return;
    }

    addLog('开始一键启动全部服务...', 'info', 'system');
    const services = ['asr', 'tts', 'memos', 'rag', 'bert'];
    let successCount = 0;
    let failCount = 0;
    
    for (const service of services) {
        if (serviceStates[service] !== 'running') {
            const ok = await startService(service, { skipGateCheck: true });
            if (ok) successCount++;
            else failCount++;
            await sleep(1000);
        }
    }

    addLog('正在等待 ASR/TTS/记忆系统端口就绪...', 'info', 'system');
    const ready = await waitForLive2DGate();
    if (!ready && live2dGateState.blocking.length > 0) {
        addLog('等待端口超时：' + live2dGateState.blocking.map(getServiceLabel).join('、') + '，继续尝试启动 Live2D', 'warning', 'system');
    }

    if (serviceStates.live2d !== 'running') {
        const ok = await startService('live2d', { skipGateCheck: !ready, skipUnsavedCheck: true });
        if (ok) successCount++;
        else failCount++;
    }
    
    addLog('一键启动完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'info', 'system');
}

// 一键停止全部服务
async function stopAllServices() {
    addLog('开始一键停止全部服务...', 'warning', 'system');
    const services = ['live2d', 'asr', 'tts', 'memos', 'rag', 'bert'];
    let successCount = 0;
    let failCount = 0;
    
    for (const service of services) {
        if (serviceStates[service] === 'running') {
            addLog('正在停止 ' + service + ' 服务...', 'warning', 'system');
            try {
                const response = await fetch('/api/stop/' + service, { method: 'POST' });
                const result = await response.json();

                if (response.ok && result.success) {
                    updateServiceStatus(service, 'stopped');
                    addLog(service + ' 服务已停止', 'info', 'system');
                    if (SERVICE_LOG_TYPES.includes(service)) {
                        await clearServiceLog(service);
                    }
                    successCount++;
                } else {
                    addLog(service + ' 服务停止失败：' + (result.error || '未知错误'), 'error', 'system');
                    failCount++;
                }
            } catch (error) {
                addLog(service + ' 服务停止异常：' + error.message, 'error', 'system');
                failCount++;
            }
            await sleep(500);
        }
    }
    
    addLog('一键停止完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'info', 'system');
}

// 切换标签页
function getDirtyKeyForConfigElement(element) {
    if (!element || !element.closest) return null;
    if (element.id === 'live2d-model-select') return null;

    const pluginModal = element.closest('#pluginConfigModal');
    if (pluginModal && pluginModal.style.display !== 'none') {
        return 'plugin-config';
    }

    const panel = element.closest('.tab-content');
    if (!panel || !CONFIG_DIRTY_PANELS.has(panel.id)) return null;
    return panel.id;
}

function getConfigSaveButton(dirtyKey) {
    if (dirtyKey === 'plugin-config') {
        return document.getElementById('saveConfigBtn');
    }

    const container = document.getElementById('configSaveButtons');
    const activePanel = document.querySelector('.tab-content.active');
    if (!container || !activePanel || activePanel.id !== dirtyKey) return null;
    return container.querySelector('.config-save-button');
}

function createConfigSaveButton(tabName, saveHandler) {
    const isDirty = configDirtyItems.has(tabName);
    const dirtyClass = isDirty ? ' config-unsaved' : '';
    const titleAttr = isDirty ? ` title="${UNSAVED_CONFIG_MESSAGE}"` : '';
    return `<button class="config-save-button${dirtyClass}" onclick="${saveHandler}"${titleAttr}>保存配置</button>`;
}

function updateConfigDirtyIndicators() {
    CONFIG_DIRTY_PANELS.forEach(panelId => {
        const button = getConfigSaveButton(panelId);
        const tabButton = document.querySelector(`.tab-button[onclick="switchTab('${panelId}')"]`);
        const isDirty = configDirtyItems.has(panelId);

        if (button) {
            button.classList.toggle('config-unsaved', isDirty);
            button.title = isDirty ? UNSAVED_CONFIG_MESSAGE : '';
        }
        if (tabButton) {
            tabButton.classList.toggle('has-unsaved-config', isDirty);
        }
    });

    const pluginButton = getConfigSaveButton('plugin-config');
    if (pluginButton) {
        const isPluginDirty = configDirtyItems.has('plugin-config');
        pluginButton.classList.toggle('config-unsaved', isPluginDirty);
        pluginButton.title = isPluginDirty ? UNSAVED_CONFIG_MESSAGE : '';
    }
}

function markConfigDirty(dirtyKey) {
    if (!dirtyKey) return;
    configDirtyItems.add(dirtyKey);
    updateConfigDirtyIndicators();
}

function clearConfigDirty(dirtyKey) {
    configDirtyItems.delete(dirtyKey);
    updateConfigDirtyIndicators();
}

function clearAllConfigDirty() {
    configDirtyItems.clear();
    updateConfigDirtyIndicators();
}

function hasUnsavedConfig() {
    return configDirtyItems.size > 0;
}

function confirmLeaveDirtyConfig(dirtyKey) {
    if (!configDirtyItems.has(dirtyKey)) return true;
    return confirm(UNSAVED_CONFIG_MESSAGE);
}

function confirmStartLive2dWithCurrentConfig() {
    return !hasUnsavedConfig() || confirm(START_WITH_UNSAVED_MESSAGE);
}

function initConfigDirtyTracking() {
    if (isConfigDirtyTrackingReady) return;
    const markFromEvent = (event) => {
        const element = event.target;
        const tagName = element && element.tagName ? element.tagName.toLowerCase() : '';
        if (!['input', 'textarea', 'select'].includes(tagName)) return;
        if (element.type && ['button', 'submit', 'reset', 'file', 'hidden'].includes(element.type)) return;

        markConfigDirty(getDirtyKeyForConfigElement(element));
    };

    document.addEventListener('input', markFromEvent, true);
    document.addEventListener('change', markFromEvent, true);
    isConfigDirtyTrackingReady = true;
}

function switchTab(tabName) {
    const currentPanel = document.querySelector('.tab-content.active');
    if (currentPanel && currentPanel.id !== tabName && !confirmLeaveDirtyConfig(currentPanel.id)) {
        return;
    }

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    // 查找对应的按钮并添加 active 状态（兼容 event 不存在的情况）
    const targetButton = document.querySelector(`.tab-button[onclick="switchTab('${tabName}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }

    // 控制选项卡栏中保存按钮的显示/隐藏 - 只显示当前页面对应的按钮
    const configSaveButtons = document.getElementById('configSaveButtons');
    if (configSaveButtons) {
        let buttonHTML = '';
        switch(tabName) {
            case 'basic-config':
                buttonHTML = createConfigSaveButton('basic-config', 'saveBasicSettings()');
                break;
            case 'dialog-config':
                buttonHTML = createConfigSaveButton('dialog-config', 'saveDialogSettings()');
                break;
            case 'llm-config':
                buttonHTML = createConfigSaveButton('llm-config', 'saveLLMConfig()');
                break;
            case 'persona-config':
                buttonHTML = createConfigSaveButton('persona-config', 'savePersonaSettings()');
                break;
            case 'voice-settings':
                buttonHTML = createConfigSaveButton('voice-settings', 'saveCloudSettings()');
                break;
            case 'ui-settings':
                buttonHTML = createConfigSaveButton('ui-settings', 'saveUISettings()');
                break;
            default:
                // 无保存按钮的页面显示空占位，保持布局稳定
                buttonHTML = '<div class="config-save-placeholder"></div>';
                break;
        }
        configSaveButtons.innerHTML = buttonHTML;
        updateConfigDirtyIndicators();
    }

    if (tabName === 'ui-settings') {
        requestAnimationFrame(() => {
            initLive2dPreviewWorkbench();
            fitLive2dPreviewModel();
        });
    }
    if (tabName === 'dashboard') {
        pollVisibleLogs();
    }
}

// ============ 配置保存 ============

// 保存配置的通用函数
async function saveConfig(url, data, successMsg, dirtyKey = null) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(successMsg, 'success', 'system');
            if (dirtyKey) {
                clearConfigDirty(dirtyKey);
            }
        } else {
            addLog('保存失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存时出错：' + error.message, 'error', 'system');
    }
}

// ============ LLM 提供商管理 ============
// 数据存储在 llm_providers.json（后端 /api/config/llm 读写）。
// config.llm 只保留 provider_id / model_id 引用；temperature / reasoning 为模型级参数。

const llmProviderState = {
    providers: [],            // provider 数组（编辑中的工作副本）
    selectedProviderId: null, // 编辑器当前打开的 provider
    activeProviderId: '',     // config.llm.provider_id（当前对话使用）
    activeModelId: '',        // config.llm.model_id
    fallbackProviderId: '',   // config.llm.retry.fallback_provider_id（空回复抢救保底）
    fallbackModelId: '',      // config.llm.retry.fallback_model_id
    fetchedModels: {},        // providerId -> [modelId]（从 API 拉取、尚未添加的）
    expandedParams: {}        // modelId -> bool（参数面板展开状态）
};

function getSelectedLLMProvider() {
    return llmProviderState.providers.find(p => p.id === llmProviderState.selectedProviderId) || null;
}

function generateProviderId() {
    let i = 1;
    while (llmProviderState.providers.some(p => p.id === `provider-${i}`)) i++;
    return `provider-${i}`;
}

function makeLLMModelRef(providerId, modelId) {
    return providerId && modelId ? `${providerId}|${modelId}` : '';
}

function parseLLMModelRef(value) {
    const raw = String(value || '').trim();
    if (!raw || !raw.includes('|')) return { providerId: '', modelId: '' };
    const [providerId, ...modelParts] = raw.split('|');
    return {
        providerId: providerId.trim(),
        modelId: modelParts.join('|').trim()
    };
}

function getFallbackModelRef() {
    return makeLLMModelRef(llmProviderState.fallbackProviderId, llmProviderState.fallbackModelId);
}

function renderLLMFallbackModelSelect() {
    const select = document.getElementById('llm-fallback-model-select');
    if (!select) return;

    const selectedValue = getFallbackModelRef();
    select.innerHTML = '';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '（不启用保底模型）';
    select.appendChild(emptyOpt);

    for (const provider of (llmProviderState.providers || [])) {
        if (!provider || provider.enabled === false) continue;
        const providerName = provider.name || provider.id;
        for (const model of (provider.models || [])) {
            if (!model || model.enabled === false || !model.model_id) continue;
            const opt = document.createElement('option');
            opt.value = makeLLMModelRef(provider.id, model.model_id);
            opt.textContent = `${providerName} / ${model.model_id}`;
            select.appendChild(opt);
        }
    }

    if (selectedValue && !Array.from(select.options).some(o => o.value === selectedValue)) {
        const opt = document.createElement('option');
        opt.value = selectedValue;
        opt.textContent = selectedValue + '（已失效）';
        select.appendChild(opt);
    }

    select.value = selectedValue;
}

// ---- 渲染 ----

function renderLLMProviderUI() {
    renderLLMProviderList();
    renderLLMProviderEditor();
    renderLLMFallbackModelSelect();
}

function renderLLMProviderList() {
    const listEl = document.getElementById('llm-provider-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    for (const provider of llmProviderState.providers) {
        const item = document.createElement('div');
        item.className = 'llm-provider-item'
            + (provider.id === llmProviderState.selectedProviderId ? ' selected' : '')
            + (provider.enabled === false ? ' disabled' : '');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'llm-provider-item-name';
        nameSpan.textContent = provider.name || provider.id;
        item.appendChild(nameSpan);

        const badges = document.createElement('span');
        badges.className = 'llm-provider-item-badges';
        if (provider.id === llmProviderState.activeProviderId) {
            const badge = document.createElement('span');
            badge.className = 'llm-provider-badge active';
            badge.textContent = '对话';
            badges.appendChild(badge);
        }
        if (provider.id === llmProviderState.fallbackProviderId) {
            const badge = document.createElement('span');
            badge.className = 'llm-provider-badge fallback';
            badge.textContent = '保底';
            badges.appendChild(badge);
        }
        if (provider.enabled === false) {
            const badge = document.createElement('span');
            badge.className = 'llm-provider-badge muted';
            badge.textContent = '已禁用';
            badges.appendChild(badge);
        }
        item.appendChild(badges);
        item.onclick = () => selectLLMProvider(provider.id);
        listEl.appendChild(item);
    }
}

function renderLLMProviderEditor() {
    const emptyEl = document.getElementById('llm-provider-editor-empty');
    const bodyEl = document.getElementById('llm-provider-editor-body');
    if (!emptyEl || !bodyEl) return;
    const provider = getSelectedLLMProvider();
    if (!provider) {
        emptyEl.style.display = '';
        emptyEl.textContent = llmProviderState.providers.length === 0
            ? '还没有提供商，点击左侧「添加」创建一个'
            : '在左侧选择一个提供商进行编辑';
        bodyEl.style.display = 'none';
        return;
    }
    emptyEl.style.display = 'none';
    bodyEl.style.display = '';
    _setVal('provider-name', provider.name || '');
    _setVal('provider-api-key', provider.api_key || '');
    _setVal('provider-api-url', provider.api_url || '');
    _setChk('provider-enabled', provider.enabled !== false);
    renderLLMProviderModels();
}

// 编辑器输入实时写回工作副本
function onProviderEditorInput() {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    const nextName = document.getElementById('provider-name').value.trim() || provider.id;
    const nextApiKey = document.getElementById('provider-api-key').value;
    const nextApiUrl = document.getElementById('provider-api-url').value.trim();
    const nextEnabled = document.getElementById('provider-enabled').checked;
    const changed = provider.name !== nextName
        || provider.api_key !== nextApiKey
        || provider.api_url !== nextApiUrl
        || provider.enabled !== nextEnabled;

    provider.name = nextName;
    provider.api_key = nextApiKey;
    provider.api_url = nextApiUrl;
    provider.enabled = nextEnabled;
    if (changed) {
        markConfigDirty('llm-config');
    }
    renderLLMProviderList();
    renderLLMFallbackModelSelect();
}

function renderLLMProviderModels() {
    const listEl = document.getElementById('llm-provider-model-list');
    const titleEl = document.getElementById('llm-provider-models-title');
    if (!listEl) return;
    listEl.innerHTML = '';
    const provider = getSelectedLLMProvider();
    if (!provider) return;

    const models = Array.isArray(provider.models) ? provider.models : (provider.models = []);
    const enabledCount = models.filter(m => m.enabled !== false).length;
    if (titleEl) titleEl.textContent = `模型列表（${enabledCount}/${models.length} 启用）`;

    const keyword = (document.getElementById('provider-model-search')?.value || '').trim().toLowerCase();
    const visibleModels = keyword
        ? models.filter(m => m.model_id.toLowerCase().includes(keyword))
        : models;

    if (visibleModels.length === 0 && models.length > 0) {
        const empty = document.createElement('div');
        empty.className = 'llm-provider-model-empty';
        empty.textContent = '没有匹配的模型';
        listEl.appendChild(empty);
    } else if (models.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'llm-provider-model-empty';
        empty.textContent = '还没有模型。可以「从 API 获取」或手动添加';
        listEl.appendChild(empty);
    }

    for (const model of visibleModels) {
        listEl.appendChild(createProviderModelRow(provider, model));
    }

    // 从 API 拉取、尚未添加的模型
    const fetched = (llmProviderState.fetchedModels[provider.id] || [])
        .filter(id => !models.some(m => m.model_id === id))
        .filter(id => !keyword || id.toLowerCase().includes(keyword));
    if (fetched.length > 0) {
        const header = document.createElement('div');
        header.className = 'llm-provider-model-fetched-header';
        header.textContent = `从 API 获取到 ${fetched.length} 个可添加模型：`;
        listEl.appendChild(header);
        for (const modelId of fetched) {
            listEl.appendChild(createFetchedModelRow(provider, modelId));
        }
    }

    renderLLMFallbackModelSelect();
}

function createProviderModelRow(provider, model) {
    const row = document.createElement('div');
    row.className = 'llm-provider-model-row' + (model.enabled === false ? ' disabled' : '');

    const main = document.createElement('div');
    main.className = 'llm-provider-model-main';

    // 启用开关
    const enableLabel = document.createElement('label');
    enableLabel.className = 'llm-provider-toggle';
    enableLabel.title = '启用/禁用该模型';
    const enableCb = document.createElement('input');
    enableCb.type = 'checkbox';
    enableCb.checked = model.enabled !== false;
    enableCb.onchange = () => { model.enabled = enableCb.checked; markConfigDirty('llm-config'); renderLLMProviderModels(); };
    enableLabel.appendChild(enableCb);
    main.appendChild(enableLabel);

    // 模型 ID
    const nameSpan = document.createElement('span');
    nameSpan.className = 'llm-provider-model-name';
    nameSpan.textContent = model.model_id;
    nameSpan.title = model.model_id;
    main.appendChild(nameSpan);

    // 当前对话标记 / 设为对话模型
    const isActive = provider.id === llmProviderState.activeProviderId
        && model.model_id === llmProviderState.activeModelId;
    const isFallback = provider.id === llmProviderState.fallbackProviderId
        && model.model_id === llmProviderState.fallbackModelId;
    if (isActive) {
        const badge = document.createElement('span');
        badge.className = 'llm-provider-badge active';
        badge.textContent = '✦ 当前对话';
        main.appendChild(badge);
    } else {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'llm-provider-mini-btn';
        useBtn.textContent = '设为对话模型';
        useBtn.onclick = () => setActiveProviderModel(model.model_id);
        main.appendChild(useBtn);
    }
    if (isFallback) {
        const badge = document.createElement('span');
        badge.className = 'llm-provider-badge fallback';
        badge.textContent = '保底';
        main.appendChild(badge);
    }

    // 参数展开按钮
    const paramsBtn = document.createElement('button');
    paramsBtn.type = 'button';
    paramsBtn.className = 'llm-provider-mini-btn';
    const expanded = !!llmProviderState.expandedParams[model.model_id];
    paramsBtn.textContent = expanded ? '参数 ▴' : '参数 ▾';
    paramsBtn.onclick = () => {
        llmProviderState.expandedParams[model.model_id] = !expanded;
        renderLLMProviderModels();
    };
    main.appendChild(paramsBtn);

    // 测活按钮
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'llm-provider-mini-btn';
    testBtn.textContent = '测活';
    testBtn.onclick = () => testProviderModel(model.model_id, testBtn);
    main.appendChild(testBtn);

    // 删除按钮
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'llm-provider-mini-btn danger';
    delBtn.textContent = '删除';
    delBtn.onclick = () => {
        provider.models = provider.models.filter(m => m.model_id !== model.model_id);
        if (provider.id === llmProviderState.fallbackProviderId && model.model_id === llmProviderState.fallbackModelId) {
            llmProviderState.fallbackProviderId = '';
            llmProviderState.fallbackModelId = '';
        }
        markConfigDirty('llm-config');
        renderLLMProviderModels();
    };
    main.appendChild(delBtn);

    row.appendChild(main);

    // 模型级参数面板（temperature / reasoning）
    if (expanded) {
        row.appendChild(createModelParamsPanel(model));
    }
    return row;
}

function createModelParamsPanel(model) {
    const panel = document.createElement('div');
    panel.className = 'llm-provider-model-params';

    // -- 温度 --
    const tempRow = document.createElement('div');
    tempRow.className = 'llm-provider-param-row';
    const tempLabel = document.createElement('label');
    tempLabel.className = 'llm-provider-toggle';
    const tempCb = document.createElement('input');
    tempCb.type = 'checkbox';
    tempCb.checked = model.temperature_enabled === true;
    tempLabel.appendChild(tempCb);
    tempLabel.appendChild(document.createTextNode(' 启用温度'));
    tempRow.appendChild(tempLabel);

    const tempInput = document.createElement('input');
    tempInput.type = 'number';
    tempInput.min = '0';
    tempInput.max = '2';
    tempInput.step = '0.1';
    tempInput.className = 'llm-provider-param-number';
    tempInput.value = model.temperature !== undefined ? model.temperature : 1.0;
    tempInput.disabled = model.temperature_enabled !== true;
    tempInput.onchange = () => {
        const v = parseFloat(tempInput.value);
        if (Number.isFinite(v)) model.temperature = v;
        markConfigDirty('llm-config');
    };
    tempCb.onchange = () => {
        model.temperature_enabled = tempCb.checked;
        if (tempCb.checked && model.temperature === undefined) {
            model.temperature = parseFloat(tempInput.value) || 1.0;
        }
        tempInput.disabled = !tempCb.checked;
        markConfigDirty('llm-config');
    };
    tempRow.appendChild(tempInput);
    panel.appendChild(tempRow);

    // -- 思考模式 --
    const reasonRow = document.createElement('div');
    reasonRow.className = 'llm-provider-param-row';
    const reasonLabel = document.createElement('label');
    reasonLabel.className = 'llm-provider-toggle';
    const reasonCb = document.createElement('input');
    reasonCb.type = 'checkbox';
    reasonCb.checked = model.reasoning_enabled === true;
    reasonLabel.appendChild(reasonCb);
    reasonLabel.appendChild(document.createTextNode(' 启用思考模式（推理模型生效）'));
    reasonRow.appendChild(reasonLabel);

    const effortSelect = document.createElement('select');
    effortSelect.className = 'llm-provider-param-select';
    for (const [value, label] of [
        ['minimal', 'minimal - 最低'],
        ['low', 'low - 低'],
        ['medium', 'medium - 中'],
        ['high', 'high - 高'],
        ['xhigh', 'xhigh - 超高（extra high，部分模型支持）'],
        ['max', 'max - 最大（部分模型支持）']
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        effortSelect.appendChild(opt);
    }
    // 已保存的值不在预设列表时（如手动改过配置文件），追加为自定义选项避免被静默改掉
    const savedEffort = model.reasoning_effort || 'medium';
    if (!Array.from(effortSelect.options).some(o => o.value === savedEffort)) {
        const opt = document.createElement('option');
        opt.value = savedEffort;
        opt.textContent = savedEffort + '（自定义）';
        effortSelect.appendChild(opt);
    }
    effortSelect.value = savedEffort;
    effortSelect.disabled = model.reasoning_enabled !== true;
    effortSelect.onchange = () => { model.reasoning_effort = effortSelect.value; markConfigDirty('llm-config'); };
    reasonCb.onchange = () => {
        model.reasoning_enabled = reasonCb.checked;
        if (reasonCb.checked && !model.reasoning_effort) {
            model.reasoning_effort = effortSelect.value || 'medium';
        }
        effortSelect.disabled = !reasonCb.checked;
        markConfigDirty('llm-config');
    };
    reasonRow.appendChild(effortSelect);
    panel.appendChild(reasonRow);

    const hint = document.createElement('div');
    hint.className = 'llm-provider-param-hint';
    hint.textContent = '未勾选的参数不会发送给 API（使用模型默认值）。参数跟随模型，切换对话模型时自动生效。';
    panel.appendChild(hint);
    return panel;
}

function createFetchedModelRow(provider, modelId) {
    const row = document.createElement('div');
    row.className = 'llm-provider-model-row fetched';
    const main = document.createElement('div');
    main.className = 'llm-provider-model-main';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'llm-provider-model-name';
    nameSpan.textContent = modelId;
    nameSpan.title = modelId;
    main.appendChild(nameSpan);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'llm-provider-mini-btn';
    addBtn.textContent = '＋ 添加';
    addBtn.onclick = () => {
        provider.models.push({ model_id: modelId, name: modelId, enabled: true });
        markConfigDirty('llm-config');
        renderLLMProviderModels();
    };
    main.appendChild(addBtn);
    row.appendChild(main);
    return row;
}

// ---- 交互 ----

function selectLLMProvider(providerId) {
    llmProviderState.selectedProviderId = providerId;
    renderLLMProviderUI();
}

function addLLMProvider() {
    const id = generateProviderId();
    llmProviderState.providers.push({
        id,
        name: '新提供商',
        api_key: '',
        api_url: '',
        enabled: true,
        models: []
    });
    llmProviderState.selectedProviderId = id;
    markConfigDirty('llm-config');
    renderLLMProviderUI();
}

function deleteLLMProvider() {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    if (!confirm(`确定删除提供商「${provider.name || provider.id}」及其全部模型配置？`)) return;
    llmProviderState.providers = llmProviderState.providers.filter(p => p.id !== provider.id);
    if (llmProviderState.activeProviderId === provider.id) {
        llmProviderState.activeProviderId = '';
        llmProviderState.activeModelId = '';
    }
    if (llmProviderState.fallbackProviderId === provider.id) {
        llmProviderState.fallbackProviderId = '';
        llmProviderState.fallbackModelId = '';
    }
    llmProviderState.selectedProviderId = llmProviderState.providers[0]?.id || null;
    markConfigDirty('llm-config');
    renderLLMProviderUI();
}

function onFallbackModelChange() {
    const ref = document.getElementById('llm-fallback-model-select')?.value || '';
    const parsed = parseLLMModelRef(ref);
    llmProviderState.fallbackProviderId = parsed.providerId;
    llmProviderState.fallbackModelId = parsed.modelId;
    markConfigDirty('llm-config');
    renderLLMProviderUI();
}

function addProviderModelManually() {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    const input = document.getElementById('provider-new-model-id');
    const modelId = (input?.value || '').trim();
    if (!modelId) {
        showError('请输入模型 ID');
        return;
    }
    if (provider.models.some(m => m.model_id === modelId)) {
        showError('该模型已存在');
        return;
    }
    provider.models.push({ model_id: modelId, name: modelId, enabled: true });
    if (input) input.value = '';
    markConfigDirty('llm-config');
    renderLLMProviderModels();
}

function setActiveProviderModel(modelId) {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    llmProviderState.activeProviderId = provider.id;
    llmProviderState.activeModelId = modelId;
    markConfigDirty('llm-config');
    renderLLMProviderUI();
}

async function fetchProviderModels() {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    onProviderEditorInput();  // 先同步编辑器中的 key/url
    if (!provider.api_url || !provider.api_key) {
        showError('请先填写 API Key 和 API URL');
        return;
    }
    const btn = document.getElementById('provider-fetch-models-btn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '获取中...'; }
    try {
        const response = await fetch('/api/config/llm/providers/models/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_url: provider.api_url, api_key: provider.api_key })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            llmProviderState.fetchedModels[provider.id] = result.models || [];
            addLog(`获取到 ${(result.models || []).length} 个模型`, 'success', 'system');
            renderLLMProviderModels();
        } else {
            showError(result.error || '获取模型列表失败');
        }
    } catch (error) {
        showError('获取模型列表出错：' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

async function testProviderModel(modelId, btn) {
    const provider = getSelectedLLMProvider();
    if (!provider) return;
    onProviderEditorInput();
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '测试中'; }
    try {
        const response = await fetch('/api/config/llm/providers/models/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_url: provider.api_url,
                api_key: provider.api_key,
                model_id: modelId
            })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            showSuccess(`✅ ${modelId} 测活成功`);
            addLog(`模型测活成功: ${modelId}`, 'success', 'system');
        } else {
            showError(`❌ ${modelId} 测活失败：` + (result.detail || result.error || '未知错误'));
            addLog(`模型测活失败: ${modelId} - ${result.detail || result.error || ''}`, 'error', 'system');
        }
    } catch (error) {
        showError('测活出错：' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

// 保存 LLM 配置（providers + 当前对话模型选择）
async function saveLLMConfig() {
    onProviderEditorInput();  // 同步编辑器未失焦的修改

    // 基本校验
    for (const provider of llmProviderState.providers) {
        if (!provider.api_url) {
            showError(`提供商「${provider.name || provider.id}」缺少 API URL`);
            return;
        }
    }

    const payload = {
        providers: llmProviderState.providers,
        provider_id: llmProviderState.activeProviderId,
        model_id: llmProviderState.activeModelId,
        fallback_model_ref: getFallbackModelRef()
    };
    try {
        const response = await fetch('/api/config/llm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('LLM 配置保存成功', 'success', 'system');
            showSuccess('LLM 配置保存成功');
            clearConfigDirty('llm-config');
            // 重新加载，同步后端规范化结果，并刷新对话/视觉模型下拉
            await loadLLMConfig();
            try { await loadDialogConfig(); } catch (e) { /* 忽略 */ }
            try { await loadBasicConfig(); } catch (e) { /* 忽略 */ }
        } else {
            addLog('LLM 配置保存失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('LLM 配置保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('LLM 配置保存时出错：' + error.message, 'error', 'system');
        showError('LLM 配置保存时出错：' + error.message);
    }
}

// 加载 LLM 配置（providers + 当前选择）
async function loadLLMConfig() {
    try {
        const response = await fetch('/api/config/llm');
        if (response.ok) {
            const data = await response.json();
            llmProviderState.providers = Array.isArray(data.providers) ? data.providers : [];
            llmProviderState.activeProviderId = data.provider_id || '';
            llmProviderState.activeModelId = data.model_id || '';
            if (data.fallback_provider_id || data.fallback_model_id) {
                llmProviderState.fallbackProviderId = data.fallback_provider_id || '';
                llmProviderState.fallbackModelId = data.fallback_model_id || '';
            } else {
                const parsedFallback = parseLLMModelRef(data.fallback_model_ref || '');
                llmProviderState.fallbackProviderId = parsedFallback.providerId;
                llmProviderState.fallbackModelId = parsedFallback.modelId;
            }
            // 保持当前选中项；失效时选第一个
            if (!llmProviderState.providers.some(p => p.id === llmProviderState.selectedProviderId)) {
                llmProviderState.selectedProviderId =
                    llmProviderState.providers.find(p => p.id === llmProviderState.activeProviderId)?.id
                    || llmProviderState.providers[0]?.id
                    || null;
            }
            renderLLMProviderUI();
            // 人格设置（system_prompt 同接口返回）
            _setVal('system-prompt', data.system_prompt || '');
        }
    } catch (error) {
        console.error('加载 LLM 配置失败:', error);
    }
}

// ============ 人格设置 ============

async function loadPersonaSettings() {
    try {
        const response = await fetch('/api/settings/persona');
        if (response.ok) {
            const data = await response.json();
            _setVal('system-prompt', data.system_prompt || '');
        }
    } catch (error) {
        console.error('加载人格设置失败:', error);
    }
}

async function savePersonaSettings() {
    try {
        const response = await fetch('/api/settings/persona', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ system_prompt: document.getElementById('system-prompt').value })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('人格设置保存成功', 'success', 'system');
            showSuccess('人格设置保存成功');
            clearConfigDirty('persona-config');
        } else {
            showError('人格设置保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        showError('人格设置保存时出错：' + error.message);
    }
}

// 保存对话设置
async function saveChatSettings() {
    const settings = {
        intro_text: document.getElementById('intro-text').value,
        max_messages: parseInt(document.getElementById('max-messages').value),
        enable_limit: document.getElementById('enable-limit').checked,
        persistent_history: document.getElementById('persistent-history').checked,
        history_file: document.getElementById('history-file').value
    };
    await saveConfig('/api/settings/chat', settings, '对话设置保存成功', 'dialog-config');
}

// 保存云端配置
async function saveCloudSettings() {
    const data = {
        // 通用云端配置
        provider: document.getElementById('cloud-provider').value,
        api_key: document.getElementById('cloud-api-key').value,
        // 云端 TTS 配置
        cloud_tts: {
            enabled: document.getElementById('cloud-tts-enabled').checked,
            url: document.getElementById('cloud-tts-url').value,
            model: document.getElementById('cloud-tts-model').value,
            voice: document.getElementById('cloud-tts-voice').value,
            response_format: document.getElementById('cloud-tts-format').value,
            speed: parseFloat(document.getElementById('cloud-tts-speed').value) || 1.0
        },
        // 阿里云 TTS 配置
        aliyun_tts: {
            enabled: document.getElementById('aliyun-tts-enabled').checked,
            api_key: document.getElementById('aliyun-tts-api-key').value,
            workspace_id: document.getElementById('aliyun-tts-workspace-id').value.trim(),
            model: document.getElementById('aliyun-tts-model').value,
            voice: document.getElementById('aliyun-tts-voice').value
        },
        // 字节跳动 TTS 配置
        volcengine_tts: {
            enabled: document.getElementById('volcengine-tts-enabled').checked,
            appid: document.getElementById('volcengine-tts-appid').value,
            access_token: document.getElementById('volcengine-tts-access-token').value,
            voice_type: document.getElementById('volcengine-tts-voice-type').value,
            resource_id: document.getElementById('volcengine-tts-resource-id').value
        },
        // 百度流式 ASR 配置
        baidu_asr: {
            enabled: document.getElementById('baidu-asr-enabled').checked,
            url: document.getElementById('baidu-asr-url').value,
            appid: parseInt(document.getElementById('baidu-asr-appid').value) || 0,
            appkey: document.getElementById('baidu-asr-appkey').value,
            dev_pid: parseInt(document.getElementById('baidu-asr-devpid').value) || 0
        },
        // 云端肥牛网关配置
        api_gateway: {
            use_gateway: document.getElementById('gateway-enabled').checked,
            base_url: document.getElementById('gateway-base-url').value,
            api_key: document.getElementById('gateway-api-key').value
        }
    };
    try {
        const response = await fetch('/api/settings/voice', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('云端配置保存成功', 'success', 'system');
            showSuccess('云端配置保存成功');
            clearConfigDirty('voice-settings');
        } else {
            addLog('云端配置保存失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('云端配置保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('云端配置保存时出错：' + error.message, 'error', 'system');
        showError('云端配置保存时出错：' + error.message);
    }
}

// 加载云端配置
async function loadCloudSettings() {
    try {
        const response = await fetch('/api/settings/voice');
        if (response.ok) {
            const data = await response.json();

            // 云端肥牛配置
            const gateway = data.api_gateway || {};
            document.getElementById('gateway-enabled').checked = gateway.use_gateway === true;
            document.getElementById('gateway-base-url').value = gateway.base_url || '';
            document.getElementById('gateway-api-key').value = gateway.api_key || '';

            // 云服务通用配置
            document.getElementById('cloud-provider').value = data.provider || 'siliconflow';
            document.getElementById('cloud-api-key').value = data.api_key || '';

            // 云端 TTS 配置
            const cloud_tts = data.cloud_tts || {};
            document.getElementById('cloud-tts-enabled').checked = cloud_tts.enabled === true;
            document.getElementById('cloud-tts-url').value = cloud_tts.url || '';
            document.getElementById('cloud-tts-model').value = cloud_tts.model || '';
            document.getElementById('cloud-tts-voice').value = cloud_tts.voice || '';
            document.getElementById('cloud-tts-format').value = cloud_tts.response_format || 'mp3';
            document.getElementById('cloud-tts-speed').value = cloud_tts.speed || 1.0;

            // 阿里云 TTS 配置
            const aliyun_tts = data.aliyun_tts || {};
            document.getElementById('aliyun-tts-enabled').checked = aliyun_tts.enabled === true;
            document.getElementById('aliyun-tts-api-key').value = aliyun_tts.api_key || '';
            document.getElementById('aliyun-tts-workspace-id').value = aliyun_tts.workspace_id || '';
            document.getElementById('aliyun-tts-model').value = aliyun_tts.model || '';
            document.getElementById('aliyun-tts-voice').value = aliyun_tts.voice || '';

            // 字节跳动 TTS 配置
            const volcengine_tts = data.volcengine_tts || {};
            document.getElementById('volcengine-tts-enabled').checked = volcengine_tts.enabled === true;
            document.getElementById('volcengine-tts-appid').value = volcengine_tts.appid || '';
            document.getElementById('volcengine-tts-access-token').value = volcengine_tts.access_token || '';
            document.getElementById('volcengine-tts-voice-type').value = volcengine_tts.voice_type || '';
            document.getElementById('volcengine-tts-resource-id').value = volcengine_tts.resource_id || 'seed-tts-2.0';

            // 百度流式 ASR 配置
            const baidu_asr = data.baidu_asr || {};
            document.getElementById('baidu-asr-enabled').checked = baidu_asr.enabled === true;
            document.getElementById('baidu-asr-url').value = baidu_asr.url || '';
            document.getElementById('baidu-asr-appid').value = baidu_asr.appid || '';
            document.getElementById('baidu-asr-appkey').value = baidu_asr.appkey || '';
            document.getElementById('baidu-asr-devpid').value = baidu_asr.dev_pid || '15372';
        }
    } catch (error) {
        console.error('加载云端配置失败:', error);
    }
}

// 打开云端肥牛官网
function openGatewayWebsite() {
    window.open('http://mynewbot.com', '_blank');
}

// 切换云端配置子选项卡
function switchCloudTab(tab) {
    // 更新选项卡按钮状态
    document.querySelectorAll('#voice-settings .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 更新面板显示
    document.querySelectorAll('#voice-settings .cloud-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(tab + '-panel').classList.add('active');
}

// ============ 声音克隆 ============

// 切换声音克隆子选项卡
function switchVoiceCloneTab(tab) {
    // 更新选项卡按钮状态
    document.querySelectorAll('#model-manager .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 更新面板显示
    document.querySelectorAll('#model-manager .voice-clone-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(tab + '-panel').classList.add('active');
}

// 模型文件变量
let selectedModelFile = null;
let selectedAudioFile = null;
let selectedGptModelFile = null;  // 可选：GPT 模型（.ckpt）

// 处理模型文件选择
function handleModelFileSelect(files) {
    if (files && files.length > 0) {
        selectedModelFile = files[0];
        const statusEl = document.getElementById('model-file-status');
        statusEl.textContent = '已选择：' + selectedModelFile.name;
        statusEl.classList.add('has-file');
    }
}

// 处理音频文件选择
function handleAudioFileSelect(files) {
    if (files && files.length > 0) {
        selectedAudioFile = files[0];
        const statusEl = document.getElementById('audio-file-status');
        statusEl.textContent = '已选择：' + selectedAudioFile.name;
        statusEl.classList.add('has-file');
    }
}

// 处理GPT模型文件选择（可选）
function handleGptModelFileSelect(files) {
    if (files && files.length > 0) {
        selectedGptModelFile = files[0];
        const statusEl = document.getElementById('gpt-model-file-status');
        statusEl.textContent = '已选择：' + selectedGptModelFile.name;
        statusEl.classList.add('has-file');
    }
}

// 初始化拖拽事件
function initFileDragDrop() {
    const modelDropArea = document.getElementById('model-drop-area');
    const audioDropArea = document.getElementById('audio-drop-area');

    // 模型文件拖拽
    if (modelDropArea) {
        modelDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            modelDropArea.classList.add('drag-over');
        });

        modelDropArea.addEventListener('dragleave', () => {
            modelDropArea.classList.remove('drag-over');
        });

        modelDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            modelDropArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleModelFileSelect(files);
                // 同时更新 input 的 files（用于后续处理）
                const input = document.getElementById('model-file-input');
                input.files = files;
            }
        });
    }

    // 音频文件拖拽
    if (audioDropArea) {
        audioDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            audioDropArea.classList.add('drag-over');
        });

        audioDropArea.addEventListener('dragleave', () => {
            audioDropArea.classList.remove('drag-over');
        });

        audioDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            audioDropArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleAudioFileSelect(files);
                const input = document.getElementById('audio-file-input');
                input.files = files;
            }
        });
    }

    // GPT模型文件拖拽（可选）
    const gptModelDropArea = document.getElementById('gpt-model-drop-area');
    if (gptModelDropArea) {
        gptModelDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            gptModelDropArea.classList.add('drag-over');
        });

        gptModelDropArea.addEventListener('dragleave', () => {
            gptModelDropArea.classList.remove('drag-over');
        });

        gptModelDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            gptModelDropArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleGptModelFileSelect(files);
                const input = document.getElementById('gpt-model-file-input');
                input.files = files;
            }
        });
    }
}

// 生成 TTS 的 bat 文件
async function generateTTSBat() {
    const roleName = document.getElementById('voice-clone-role-name').value.trim();
    const language = document.getElementById('voice-clone-language').value;
    const text = document.getElementById('voice-clone-text').value.trim();

    if (!selectedModelFile) {
        showError('请先选择模型文件（pth）');
        return;
    }
    if (!selectedAudioFile) {
        showError('请先选择参考音频（wav）');
        return;
    }
    if (!roleName) {
        showError('请输入角色名称');
        return;
    }
    if (!text) {
        showError('请输入参考音频的文本内容');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('model_file', selectedModelFile);
        formData.append('audio_file', selectedAudioFile);
        if (selectedGptModelFile) {
            formData.append('gpt_model_file', selectedGptModelFile);
        }
        formData.append('role_name', roleName);
        formData.append('language', language);
        formData.append('text', text);

        const response = await fetch('/api/voice-clone/generate-bat', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        const statusEl = document.getElementById('voice-clone-status');

        if (response.ok && result.success) {
            statusEl.textContent = '状态：' + result.message;
            statusEl.classList.add('has-file');
            showSuccess(result.message);
        } else {
            statusEl.textContent = '状态：生成失败 - ' + (result.error || '未知错误');
            showError('生成失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        const statusEl = document.getElementById('voice-clone-status');
        statusEl.textContent = '状态：生成失败 - ' + error.message;
        showError('生成时出错：' + error.message);
    }
}

// 页面加载完成后初始化（主初始化入口）
document.addEventListener('DOMContentLoaded', function() {
    // 初始化保存按钮状态（防止页面跳动）
    initConfigDirtyTracking();
    switchTab('dashboard');

    // 检查服务状态
    checkServiceStatus();
    // 每 5 秒检查一次状态
    setInterval(checkServiceStatus, 5000);
    // 检查本地依赖端口，动态控制 Live2D 启动按钮
    updateLive2DGate();
    setInterval(updateLive2DGate, 1500);

    // 加载系统信息
    loadSystemInfo();
    // 每秒更新一次运行时间
    setInterval(updateUptime, 1000);

    // 加载所有配置同步状态
    loadAllSettings();

    // 加载插件列表
    loadPlugins();
    // 每 10 秒自动刷新插件列表（检测新安装的插件）
    setInterval(loadPlugins, 10000);

    // 启动日志轮询
    startLogPolling();

    // 加载模型列表（使用 refreshModelList 函数）
    refreshModelList();

    // 工具屋 tab 已移除（参考线上 v2.6），不再在启动时初始化工具列表
    // Function Call / MCP 工具的查看入口现在通过"广场"内部子选项卡进入
    // refreshAllTools();

    // 配置轮询已禁用（2026-03-09）- 存在 bug 导致复选框跳动
    // setInterval(loadAllSettings, 2000);

    // 初始化文件拖拽
    initFileDragDrop();

    // 重置日志内容指纹
    lastPetLogContent = '';
    lastToolLogContent = '';
    lastServiceLogContent = { asr: '', tts: '', memos: '' };

    addLog('WebUI 控制面板已就绪', 'success', 'system');

    console.log('My Neuro WebUI 初始化完成');

    // 页面卸载时停止所有轮询
    window.addEventListener('beforeunload', (event) => {
        if (hasUnsavedConfig()) {
            event.preventDefault();
            event.returnValue = '';
            return;
        }
        stopLogPolling();
        stopChatHistoryPolling();
    });

    // 初始化日志高度调整手柄
    initLogResizer();
});

// 初始化日志高度调整手柄
function initLogResizer() {
    const resizer = document.getElementById('logResizer');
    
    let isResizing = false;
    let startY;
    let startHeight = 0;
    
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        startY = e.clientY;
        
        // 获取当前主面板中活动日志容器的高度作为基准
        const activeMainContainer = document.querySelector('#logPanelContainer1 .log-panel.active .log-container');
        if (activeMainContainer) {
            startHeight = activeMainContainer.offsetHeight;
        }
        
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        
        const deltaY = e.clientY - startY;
        const newHeight = Math.max(100, Math.min(1000, startHeight + deltaY));
        
        // 统一所有主面板日志容器的高度
        const mainContainers = document.querySelectorAll('.log-container[data-log-type="main"]');
        mainContainers.forEach(container => {
            container.style.height = newHeight + 'px';
        });
        
        // 同步调整第二个面板的日志容器高度
        const secondContainers = document.querySelectorAll('.log-container[data-log-type="second"]');
        secondContainers.forEach(container => {
            container.style.height = newHeight + 'px';
        });
    });
    
    document.addEventListener('mouseup', function() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// 保存直播设置
async function saveBilibiliSettings() {
    const settings = {
        enabled: document.getElementById('bilibili-enabled').checked,
        roomId: document.getElementById('bilibili-room-id').value,
        checkInterval: parseInt(document.getElementById('bilibili-check-interval').value),
        maxMessages: parseInt(document.getElementById('bilibili-max-messages').value)
    };
    await saveConfig('/api/settings/bilibili', settings, '直播设置保存成功');
}

// 保存当前模型
async function saveCurrentModel() {
    const model = document.getElementById('current-model').value;
    await saveConfig('/api/settings/current-model', { model }, '模型已切换为：' + model);
}

// 保存 UI 设置
async function saveUISettings() {
    const settings = {
        show_chat_box: document.getElementById('show-chat-box').checked,
        show_model: !document.getElementById('hide-model').checked,  // 勾选表示隐藏，所以取反
        model_scale: parseFloat(document.getElementById('model-scale').value),
        avatar_motion_mode: document.getElementById('avatar-motion-mode')?.value || 'blend',
        motion_style: document.getElementById('choreo-motion-style')?.value || '',
        subtitle_user: document.getElementById('subtitle-user').value,
        subtitle_ai: document.getElementById('subtitle-ai').value,
        subtitle_enabled: document.getElementById('subtitle-enabled').checked
    };
    try {
        const response = await fetch('/api/settings/ui', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('UI 设置保存成功', 'success', 'system');
            showSuccess('UI 设置保存成功');
            clearConfigDirty('ui-settings');
        } else {
            addLog('UI 设置保存失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('UI 设置保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('UI 设置保存时出错：' + error.message, 'error', 'system');
        showError('UI 设置保存时出错：' + error.message);
    }
}

// 保存主动对话设置
async function saveAutoChatSettings() {
    const settings = {
        enabled: document.getElementById('auto-chat-enabled').checked,
        idle_time: parseInt(document.getElementById('idle-time').value),
        prompt: document.getElementById('auto-chat-prompt').value,
        mood_chat_enabled: document.getElementById('mood-chat-enabled').checked,
        ai_diary_enabled: document.getElementById('ai-diary-enabled').checked
    };
    await saveConfig('/api/settings/autochat', settings, '主动对话设置保存成功');
}

// 保存动态主动对话设置
async function saveMoodChatSettings() {
    const settings = {
        enabled: document.getElementById('mood-chat-enabled').checked,
        prompt: document.getElementById('mood-chat-prompt').value
    };
    await saveConfig('/api/settings/mood-chat', settings, '动态主动对话设置保存成功');
}

// 保存高级设置
async function saveAdvancedSettings() {
    const settings = {
        auto_screenshot: document.getElementById('auto-screenshot').checked,
        use_vision_model: document.getElementById('use-vision-model').checked,
        memory_enabled: document.getElementById('memory-enabled').checked,
        memos_auto_inject: document.getElementById('memos-auto-inject').checked,
        memos_inject_top_k: parseInt(document.getElementById('memos-inject-top-k').value),
        memos_similarity: parseFloat(document.getElementById('memos-similarity').value),
        auto_close_services: document.getElementById('auto-close-services').checked
    };
    await saveConfig('/api/settings/advanced', settings, '高级设置保存成功');
}

// ============ 工具和模型 ============

// ============ 工具屋管理 ============

// 当前工具选项卡
let currentToolTab = 'fc';

// 切换工具子选项卡
function switchToolTab(tab) {
    currentToolTab = tab;

    // 更新选项卡按钮状态
    document.querySelectorAll('#tools .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }

    // 更新面板显示
    document.querySelectorAll('#tools .tool-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    const targetPanel = document.getElementById(tab + '-tools-panel');
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
}

// 刷新所有工具列表
async function refreshAllTools() {
    await refreshFCTools();
    await refreshMCPTools();
}

// 刷新 Function Call 工具列表
async function refreshFCTools() {
    try {
        const response = await fetch('/api/tools/list/fc');
        if (!response.ok) {
            console.error('FC 工具列表请求失败:', response.status);
            return;
        }
        
        const data = await response.json();
        const fcToolsList = document.getElementById('fc-tools-list');
        
        if (!fcToolsList) {
            console.error('fc-tools-list 元素不存在');
            return;
        }
        
        fcToolsList.innerHTML = '';

        const tools = data.tools || [];
        if (tools.length === 0) {
            fcToolsList.innerHTML = '<div class="log-entry log-info">没有找到 Function Call 工具</div>';
            return;
        }

        tools.forEach(tool => {
            const card = createToolCard(tool);
            fcToolsList.appendChild(card);
        });
    } catch (error) {
        console.error('获取 FC 工具列表失败:', error);
        const fcToolsList = document.getElementById('fc-tools-list');
        if (fcToolsList) {
            fcToolsList.innerHTML = `<div class="log-entry log-error">加载失败：${error.message}</div>`;
        }
    }
}

// 刷新 MCP 工具列表
async function refreshMCPTools() {
    try {
        const response = await fetch('/api/tools/list/mcp');
        if (!response.ok) {
            console.error('MCP 工具列表请求失败:', response.status);
            return;
        }
        
        const data = await response.json();
        const mcpToolsList = document.getElementById('mcp-tools-list');
        
        if (!mcpToolsList) {
            console.error('mcp-tools-list 元素不存在');
            return;
        }
        
        mcpToolsList.innerHTML = '';

        const tools = data.tools || [];
        if (tools.length === 0) {
            mcpToolsList.innerHTML = '<div class="log-entry log-info">没有找到 MCP 工具</div>';
            return;
        }

        tools.forEach(tool => {
            const card = createToolCard(tool, 'mcp');
            mcpToolsList.appendChild(card);
        });
    } catch (error) {
        console.error('获取 MCP 工具列表失败:', error);
        const mcpToolsList = document.getElementById('mcp-tools-list');
        if (mcpToolsList) {
            mcpToolsList.innerHTML = `<div class="log-entry log-error">加载失败：${error.message}</div>`;
        }
    }
}

// 创建工具卡片
function createToolCard(tool, type = 'fc') {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.toolName = tool.name;
    card.dataset.toolType = type;
    card.setAttribute('data-is-external', tool.is_external === true ? 'true' : 'false');

    const statusClass = tool.enabled ? 'enabled' : 'disabled';
    const statusText = tool.enabled ? '已启用' : '已禁用';
    const toggleText = tool.enabled ? '禁用' : '启用';

    // 工具名称：使用 short_desc（来自注释第一行）
    const toolName = tool.name;
    // 简介：使用 short_desc（注释提取的简短描述）
    const briefDesc = tool.short_desc || '无描述';
    // 完整描述：name: description 格式
    const fullDesc = tool.name + ': ' + (tool.description || '无详细描述');

    card.innerHTML = `
        <div class="tool-card-body">
            <div class="tool-card-header">
                <div class="tool-card-main">
                    <h4 class="tool-name">${toolName}</h4>
                    <p class="tool-brief">${briefDesc}</p>
                </div>
                <span class="tool-status-inline ${statusClass}">● ${statusText}</span>
            </div>
            <div class="tool-card-actions">
                <button class="btn-tool-toggle" onclick="toggleTool(event, '${toolName}', '${type}')">
                    ${toggleText}
                </button>
                <button class="btn-tool-expand" onclick="toggleToolDetail(event, this)">
                    ▼
                </button>
            </div>
        </div>
        <div class="tool-card-detail">
            <p class="tool-full-desc">${fullDesc}</p>
        </div>
    `;

    return card;
}

// 切换工具详情显示
function toggleToolDetail(event, btn) {
    event.stopPropagation();
    
    const card = btn.closest('.tool-card');
    const detail = card.querySelector('.tool-card-detail');
    
    if (detail.style.display === 'block') {
        detail.style.display = 'none';
        btn.textContent = '▼';
        card.classList.remove('expanded');
    } else {
        detail.style.display = 'block';
        btn.textContent = '▲';
        card.classList.add('expanded');
    }
}

// 切换工具启用状态
async function toggleTool(event, toolName, toolType) {
    event.stopPropagation();

    const card = event.target.closest('.tool-card');
    const toggleBtn = event.target;
    // 使用 getAttribute 避免大小写问题
    const isExternal = card.getAttribute('data-is-external') === 'true';

    try {
        const response = await fetch('/api/tools/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: toolName,
                type: toolType,
                is_external: isExternal
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // 外部 MCP 工具切换后需要刷新列表（因为名称会变化）
            if (isExternal) {
                await refreshMCPTools();
                addLog(`工具已${result.enabled ? '启用' : '禁用'}`, 'success', 'system');
            } else {
                const newEnabled = result.enabled;

                // 更新按钮文本
                toggleBtn.textContent = newEnabled ? '禁用' : '启用';

                // 更新状态显示（使用 tool-status-inline）
                const statusEl = card.querySelector('.tool-status-inline');
                if (statusEl) {
                    const statusIcon = newEnabled ? '●' : '○';
                    const statusText = newEnabled ? '已启用' : '已禁用';
                    statusEl.className = `tool-status-inline ${newEnabled ? 'enabled' : 'disabled'}`;
                    statusEl.textContent = `${statusIcon} ${statusText}`;
                }

                addLog(`工具 ${toolName} 已${newEnabled ? '启用' : '禁用'}`, 'success', 'system');
            }
        } else {
            addLog(`工具切换失败：${result.error || '未知错误'}`, 'error', 'system');
        }
    } catch (error) {
        addLog(`工具切换异常：${error.message}`, 'error', 'system');
    }
}
// 刷新模型列表（v2：四形态皮套统一入口）
async function refreshModelList() {
    await loadAvatarStatus();
}

// ============ 四形态皮套管理 ============

const AVATAR_TYPE_LABELS = { live2d: 'Live2D', vrm: 'VRM', mmd: 'MMD', pngtuber: 'PNGTuber' };
let avatarStatusCache = null;

// 读取当前形态/各形态已选模型/桌宠在线状态，并刷新 UI
async function loadAvatarStatus() {
    const typeSelect = document.getElementById('avatar-type-select');
    if (!typeSelect) return;
    try {
        const response = await fetch('/api/avatar/status');
        if (!response.ok) return;
        const data = await response.json();
        if (!data.success) return;
        avatarStatusCache = data;

        typeSelect.value = data.model_type || 'live2d';

        const currentLabel = document.getElementById('avatar-type-current');
        if (currentLabel) {
            currentLabel.textContent = `当前形态：${AVATAR_TYPE_LABELS[data.model_type] || data.model_type}`;
        }
        const petStatus = document.getElementById('avatar-pet-status');
        if (petStatus) {
            petStatus.textContent = data.pet_running ? '（桌宠运行中，改动即时生效）' : '（桌宠未运行，改动将在启动后生效）';
        }

        await loadAvatarModels(typeSelect.value);
    } catch (error) {
        console.error('获取皮套状态失败:', error);
    }
}

// 加载指定形态的模型列表并预选当前选择
async function loadAvatarModels(type) {
    const modelSelect = document.getElementById('avatar-model-select');
    if (!modelSelect) return;
    modelSelect.innerHTML = '<option value="">加载中...</option>';
    try {
        const response = await fetch(`/api/avatar/models/${encodeURIComponent(type)}`);
        const data = await response.json();
        const models = (data && data.models) || [];

        modelSelect.innerHTML = '';
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = `（未找到模型，请按目录约定放置后刷新）`;
            modelSelect.appendChild(option);
            return;
        }
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m.value;
            option.textContent = m.name + (m.value !== m.name ? `（${m.value}）` : '');
            modelSelect.appendChild(option);
        });

        // 预选：该形态当前已保存的选择
        const selected = avatarStatusCache?.selections?.[type];
        if (selected && [...modelSelect.options].some(o => o.value === selected)) {
            modelSelect.value = selected;
        }
    } catch (error) {
        console.error('获取形态模型列表失败:', error);
        modelSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

// 形态下拉变化时联动模型列表（不立即应用）
function onAvatarTypeSelectChange() {
    const typeSelect = document.getElementById('avatar-type-select');
    if (typeSelect) loadAvatarModels(typeSelect.value);
}

// 应用形态切换
async function applyAvatarType() {
    const typeSelect = document.getElementById('avatar-type-select');
    if (!typeSelect) return;
    const type = typeSelect.value;
    try {
        const response = await fetch('/api/avatar/type/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(result.message || `皮套形态已切换为：${AVATAR_TYPE_LABELS[type] || type}`, 'success', 'system');
            // 跨引擎切换会重载桌宠窗口，延迟刷新状态
            setTimeout(loadAvatarStatus, result.hot ? 4000 : 500);
        } else {
            addLog('切换形态失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换形态时出错：' + error.message, 'error', 'system');
    }
}

// 应用当前形态的模型选择
async function applyAvatarModel() {
    const typeSelect = document.getElementById('avatar-type-select');
    const modelSelect = document.getElementById('avatar-model-select');
    if (!typeSelect || !modelSelect) return;
    const type = typeSelect.value;
    const model = modelSelect.value;
    if (!model) {
        addLog('请先选择模型', 'warning', 'system');
        return;
    }
    try {
        const response = await fetch('/api/avatar/model/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, model })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(result.message || `模型已应用：${model}`, 'success', 'system');
            if (type === 'live2d') {
                // Live2D 换模型后刷新动作/表情配置面板
                live2dPreviewState.info = null;
                try { await initLive2dPreviewWorkbench(true); } catch (e) {}
                try { await loadExpressionConfig(); } catch (e) {}
                try { await loadAllMotions(); } catch (e) {}
            }
            setTimeout(loadAvatarStatus, 1500);
        } else {
            addLog('应用模型失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('应用模型时出错：' + error.message, 'error', 'system');
    }
}

// ============ 游戏中心 ============

// 启动 Minecraft 游戏
async function startMinecraftGame() {
    try {
        const response = await fetch('/api/game/minecraft/start', { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            showSuccess('Minecraft 游戏已启动！');
        } else {
            const errorMsg = result.error || '启动失败';
            if (errorMsg.includes('开启游戏终端.bat')) {
                showError('启动脚本不存在：开启游戏终端.bat');
            } else {
                showError('启动失败：' + errorMsg);
            }
        }
    } catch (error) {
        showError('启动时出错：' + error.message);
    }
}

// ============ 工具调用日志 ============

// 添加工具调用日志的函数（供外部调用）
function addToolLog(toolName, result) {
    addLog('工具调用：' + toolName + ' -> ' + result, 'info', 'tool');
}

// ============ 配置加载 ============

// 安全设置元素值（强制设置，不考虑焦点状态）
function _setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function _setChk(id, value) { const el = document.getElementById(id); if (el) el.checked = value; }

// 旧版 LLM 基础配置加载入口：LLM 配置已迁移至提供商管理（loadLLMConfig），此处保留空实现兼容旧调用
async function loadConfigs() {}

// 检查服务状态
async function checkServiceStatus() {
    try {
        const response = await fetch('/api/status');
        if (response.ok) {
            const status = await response.json();
            Object.keys(status).forEach(service => {
                updateServiceStatus(service, status[service]);
            });
        }
    } catch (error) {
        console.error('获取服务状态失败:', error);
    }
}

// 加载系统信息（版本等静态信息）
async function loadSystemInfo() {
    try {
        const response = await fetch('/api/system/info');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('webui-version').textContent = data.version;
            // 保存启动时间戳用于计算运行时间
            window.startTimestamp = data.start_timestamp;
            // 立即更新一次运行时间
            updateUptime();
        }
    } catch (error) {
        console.error('加载系统信息失败:', error);
    }
}

// 更新运行时间（每秒调用）
function updateUptime() {
    if (!window.startTimestamp) return;
    
    const now = Date.now() / 1000;  // 当前时间戳（秒）
    const uptimeSeconds = Math.floor(now - window.startTimestamp);
    
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days}天${hours}小时${minutes}分钟${seconds}秒`;
    } else if (hours > 0) {
        uptimeStr = `${hours}小时${minutes}分钟${seconds}秒`;
    } else if (minutes > 0) {
        uptimeStr = `${minutes}分钟${seconds}秒`;
    } else {
        uptimeStr = `${seconds}秒`;
    }
    
    document.getElementById('system-uptime').textContent = uptimeStr;
}

// ============ 插件管理 ============

// 刷新插件列表（手动触发）
async function refreshPlugins() {
    try {
        const btn = event?.target;
        if (btn) {
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '🔄 刷新中...';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = originalText;
            }, 2000);
        }
        await loadPlugins();
        addLog('插件列表已刷新', 'success', 'system');
    } catch (error) {
        addLog('刷新插件列表失败：' + error.message, 'error', 'system');
    }
}

// 切换插件子选项卡
function switchPluginTab(tab) {
    // 更新选项卡按钮状态
    document.querySelectorAll('#plugins .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }

    // 更新面板显示
    document.querySelectorAll('#plugins .plugin-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    const targetPanel = document.getElementById(tab + '-plugin-panel');
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
    
    // 切换时自动刷新插件列表
    loadPlugins();
}

// 加载插件列表
async function loadPlugins() {
    try {
        const response = await fetch('/api/plugins/list');
        if (response.ok) {
            const plugins = await response.json();
            renderPlugins(plugins);
            updatePluginPanelButtons(plugins);
        } else {
            addLog('加载插件列表失败', 'error', 'system');
        }
    } catch (error) {
        addLog('加载插件列表时出错：' + error.message, 'error', 'system');
    }
}

// 渲染插件列表（按类别分组）
function renderPlugins(plugins) {
    const builtinContainer = document.getElementById('builtin-plugins-list');
    const communityContainer = document.getElementById('community-plugins-list');

    if (!builtinContainer || !communityContainer) {
        console.error('插件容器未找到');
        return;
    }

    builtinContainer.innerHTML = '';
    communityContainer.innerHTML = '';

    plugins.forEach(plugin => {
        const card = createPluginCard(plugin);
        if (plugin.category === 'built-in') {
            builtinContainer.appendChild(card);
        } else {
            communityContainer.appendChild(card);
        }
    });
}

// 创建插件卡片
function createPluginCard(plugin) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    // 使用 plugin_path 作为唯一标识符（如 built-in/mood-chat 或 community/mood-chat）
    card.dataset.pluginPath = plugin.plugin_path;

    const statusIcon = plugin.enabled ? '●' : '○';
    const statusText = plugin.enabled ? '已启用' : '已禁用';
    const compatibilityWarning = plugin.compatible === false
        ? `<div class="market-card-warning">${escapeHtml(plugin.compatibility_message || '插件框架版本可能不兼容')}</div>`
        : '';
    const updateBadge = plugin.has_update && plugin.latest_version
        ? `<span class="update-badge version-badge">可更新到 ${escapeHtml(plugin.latest_version)}</span>`
        : '';
    const panelButton = plugin.has_local_panel
        ? `<button class="btn-open-panel" onclick="openPluginPanel('${escapeJsString(plugin.plugin_path)}')">打开面板</button>`
        : '';

    card.innerHTML = `
        <div class="plugin-card-header">
            <div>
                <h4>${escapeHtml(plugin.display_name)} <span style="font-size: 12px; opacity: 0.6;">v${escapeHtml(plugin.version)}</span> ${updateBadge}</h4>
                <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">作者：${escapeHtml(plugin.author)}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}">
                    ${statusIcon} ${statusText}
                </span>
            </div>
        </div>
        ${compatibilityWarning}
        <p class="plugin-description">${escapeHtml(plugin.description)}</p>
        <div class="plugin-actions">
            <button class="btn-plugin-toggle" onclick="togglePlugin('${escapeJsString(plugin.plugin_path)}')">
                ${plugin.enabled ? '禁用' : '启用'}
            </button>
            <button class="btn-open-config" onclick="openPluginConfig('${escapeJsString(plugin.plugin_path)}')">
                ${plugin.has_own_config ? '配置' : '打开配置'}
            </button>
            ${panelButton}
        </div>
    `;

    return card;
}

// 切换插件启用状态（使用 plugin_path 作为唯一标识符）
async function togglePlugin(pluginPath) {
    try {
        const response = await fetch('/api/plugins/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_path: pluginPath })
        });
        const result = await response.json();

        if (response.ok && result.success) {
            const action = result.action;
            const newEnabled = action === 'enabled';
            // 使用 plugin_path 选择卡片
            const card = document.querySelector(`.plugin-card[data-plugin-path="${pluginPath}"]`);
            if (card) {
                const statusEl = card.querySelector('.plugin-status');
                const toggleBtn = card.querySelector('.btn-plugin-toggle');

                statusEl.className = `plugin-status ${newEnabled ? 'enabled' : 'disabled'}`;
                statusEl.innerHTML = `${newEnabled ? '●' : '○'} ${newEnabled ? '已启用' : '已禁用'}`;
                toggleBtn.textContent = newEnabled ? '禁用' : '启用';
            }

            addLog(`插件 ${pluginPath} 已${newEnabled ? '启用' : '禁用'}`, 'success', 'system');

            // 重新加载插件列表
            loadPlugins();
        } else {
            addLog('切换插件状态失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换插件状态时出错：' + error.message, 'error', 'system');
    }
}

// 打开插件配置（使用 display_name 作为唯一标识符）
async function openPluginConfig(pluginPath) {
    try {
        // 首先检查插件是否有配置文件
        const pluginsResponse = await fetch('/api/plugins/list');
        if (!pluginsResponse.ok) {
            throw new Error('无法获取插件列表');
        }
        
        const plugins = await pluginsResponse.json();
        // 使用 plugin_path 查找插件
        const plugin = plugins.find(p => p.plugin_path === pluginPath);
        
        if (!plugin || !plugin.has_own_config) {
            // 如果没有配置文件，打开插件目录
            const response = await fetch('/api/plugins/open-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plugin_path: pluginPath })
            });
            const result = await response.json();
            
            if (response.ok && result.success) {
                addLog(result.message, 'success', 'system');
            } else {
                addLog('打开配置失败：' + (result.error || '未知错误'), 'error', 'system');
                if (result.config_path) {
                    addLog(`配置路径：${result.config_path}`, 'info', 'system');
                }
            }
            return;
        }
        
        // 如果有配置文件，打开配置模态框 - 使用 display_name 作为标识符
        openPluginConfigModal(pluginPath, plugin.display_name);
    } catch (error) {
        addLog('打开配置时出错：' + error.message, 'error', 'system');
    }
}

async function openPluginPanel(pluginPath) {
    const windowName = pluginPath === 'built-in/auto-act'
        ? 'feiniu-house'
        : `plugin-panel-${String(pluginPath || 'panel').replace(/[^a-z0-9_-]/gi, '-')}`;
    const popup = window.open('', windowName);
    try {
        const response = await fetch('/api/plugins/panel-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_path: pluginPath })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            const url = result.url || '';
            if (!result.enabled) {
                if (popup) popup.close();
                addLog('该插件未启用，独立页面没有运行', 'warning', 'system');
                return;
            }
            if (popup) {
                popup.opener = null;
                popup.location.replace(url);
                popup.focus();
            } else {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            const panelLabel = result.panel_kind === 'feiniu-house' ? '肥牛小屋' : '人格导演面板';
            addLog(result.available
                ? `已打开${panelLabel}：${url}`
                : `已打开${panelLabel}地址，但当前未探测到运行状态：${url}`,
                result.available ? 'success' : 'warning',
                'system'
            );
        } else {
            if (popup) popup.close();
            addLog('打开面板失败：' + (result.error || '未知错误'), 'error', 'system');
            if (result.url) {
                addLog(`面板地址：${result.url}`, 'info', 'system');
            }
        }
    } catch (error) {
        if (popup) popup.close();
        addLog('打开面板时出错：' + error.message, 'error', 'system');
    }
}

function openFeiniuHouse() {
    return openPluginPanel('built-in/auto-act');
}

// 打开插件配置模态框
function openPluginConfigModal(pluginPath, displayName) {
    // 设置模态框标题（使用 display_name 显示）
    document.getElementById('pluginConfigModalTitle').textContent = `插件配置 - ${displayName}`;
    
    // 显示加载状态
    document.getElementById('pluginConfigLoading').style.display = 'block';
    document.getElementById('pluginConfigError').style.display = 'none';
    document.getElementById('pluginConfigForm').style.display = 'none';
    
    // 显示模态框 - 使用 setProperty 确保覆盖 CSS 的 !important
    const modal = document.getElementById('pluginConfigModal');
    modal.style.setProperty('display', 'block', 'important');
    
    // 保存当前滚动位置
    window.scrollPosition = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
    
    // 禁用背景滚动 - 使用纯 CSS 居中，不依赖 body 样式
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    // 保存 plugin_path 用于后续操作（如保存配置）
    window.currentPluginPath = pluginPath;
    
    // 加载配置数据 - 使用 display_name 作为标识符
    loadPluginConfig(displayName);
}

// 关闭插件配置模态框
function closePluginConfigModal(force = false) {
    if (!force && !confirmLeaveDirtyConfig('plugin-config')) {
        return;
    }
    if (!force) {
        clearConfigDirty('plugin-config');
    }

    // 恢复背景滚动
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    
    // 恢复到之前的滚动位置
    window.scrollTo(0, window.scrollPosition || 0);
    
    // 隐藏模态框
    document.getElementById('pluginConfigModal').style.display = 'none';
}

// 检查 README 是否存在 - 使用 display_name 识别插件
async function checkReadmeExists(displayName) {
    try {
        const response = await fetch(`/api/plugins/${encodeURIComponent(displayName)}/readme-exists`, {
            method: 'GET'
        });
        const result = await response.json();
        
        const readmeBtn = document.getElementById('readmeBtn');
        if (readmeBtn) {
            if (result.exists) {
                readmeBtn.disabled = false;
                readmeBtn.style.opacity = '1';
                readmeBtn.style.cursor = 'pointer';
            } else {
                readmeBtn.disabled = true;
                readmeBtn.style.opacity = '0.5';
                readmeBtn.style.cursor = 'not-allowed';
            }
        }
    } catch (error) {
        console.error('检查 README 存在性失败:', error);
        // 出错时也禁用按钮
        const readmeBtn = document.getElementById('readmeBtn');
        if (readmeBtn) {
            readmeBtn.disabled = true;
            readmeBtn.style.opacity = '0.5';
            readmeBtn.style.cursor = 'not-allowed';
        }
    }
}

// 打开插件 README 文件 - 使用 display_name 识别插件
async function openPluginReadme() {
    if (!window.currentPluginDisplayName) {
        showToast('没有打开的插件配置', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/plugins/${encodeURIComponent(window.currentPluginDisplayName)}/readme`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        
        if (response.ok && result.success) {
            showToast('已打开 README 文件', 'success');
        } else {
            showToast('该插件没有 README.md 文件', 'warning');
        }
    } catch (error) {
        showToast('打开配置说明时出错', 'error');
    }
}

// 加载插件配置（使用 display_name 作为唯一标识符）
async function loadPluginConfig(displayName) {
    try {
        const response = await fetch(`/api/plugins/${encodeURIComponent(displayName)}/config`);
        const result = await response.json();
        
        if (response.ok && result.success) {
            // 隐藏加载状态，显示表单
            document.getElementById('pluginConfigLoading').style.display = 'none';
            document.getElementById('pluginConfigError').style.display = 'none';
            document.getElementById('pluginConfigForm').style.display = 'block';
            
            // 保存配置键顺序（用于保持渲染和保存顺序）
            window.currentPluginConfigKeys = result.config_keys || Object.keys(result.config);
            
            // 保存当前插件的 display_name 用于后续操作
            window.currentPluginDisplayName = displayName;
            
            // 渲染配置表单（使用键顺序）
            renderPluginConfigForm(result.config);
            clearConfigDirty('plugin-config');
            
            // 检查 README 是否存在
            checkReadmeExists(displayName);
        } else {
            // 显示错误
            document.getElementById('pluginConfigLoading').style.display = 'none';
            document.getElementById('pluginConfigError').style.display = 'block';
            document.getElementById('pluginConfigErrorText').textContent = result.error || '加载配置失败';
        }
    } catch (error) {
        document.getElementById('pluginConfigLoading').style.display = 'none';
        document.getElementById('pluginConfigError').style.display = 'block';
        document.getElementById('pluginConfigErrorText').textContent = '加载配置时出错：' + error.message;
    }
}

// 渲染插件配置表单 - 保持原始配置顺序
function renderPluginConfigForm(config) {
    const fieldsContainer = document.getElementById('pluginConfigFields');
    fieldsContainer.innerHTML = '';
    
    // 保存原始配置用于重置
    window.currentPluginConfig = JSON.parse(JSON.stringify(config));
    
    // 使用从后端获取的键顺序（如果没有则使用 Object.keys）
    const keys = window.currentPluginConfigKeys || Object.keys(config);
    for (const key of keys) {
        if (config.hasOwnProperty(key)) {
            const field = config[key];
            if (field?.hidden === true) continue;
            const fieldElement = createConfigField(key, field);
            fieldsContainer.appendChild(fieldElement);
        }
    }
}

// objectPath：从根到「当前字段父级」的键路径（用 __ 连接），用于生成全局唯一的 DOM id，支持任意层嵌套（如世界之眼 agent_models.code.api_key）
function configFieldDomId(key, objectPath) {
    if (!objectPath) return `config-${key}`;
    return `config-${objectPath}__${key}`;
}

// 创建配置字段元素（objectPath 为父级路径前缀，空字符串表示顶层）
function createConfigField(key, field, objectPath) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'config-field';
    fieldDiv.dataset.fieldKey = key;
    
    const inputId = configFieldDomId(key, objectPath);
    
    let inputElement;
    
    switch (field.type) {
        case 'string':
        case 'text':
            if (field.type === 'text') {
                inputElement = document.createElement('textarea');
                inputElement.rows = 3;
            } else {
                inputElement = document.createElement('input');
                inputElement.type = 'text';
            }
            inputElement.value = field.value !== undefined ? field.value : field.default;
            break;
            
        case 'int':
        case 'float':
            inputElement = document.createElement('input');
            inputElement.type = 'number';
            inputElement.step = field.type === 'float' ? '0.1' : '1';
            inputElement.value = field.value !== undefined ? field.value : field.default;
            break;
            
        case 'bool':
            inputElement = document.createElement('input');
            inputElement.type = 'checkbox';
            inputElement.checked = field.value !== undefined ? field.value : field.default;
            break;

        case 'select': {
            inputElement = document.createElement('select');
            const currentValue = String(
                field.value !== undefined ? field.value : (field.default ?? '')
            );
            for (const item of (Array.isArray(field.options) ? field.options : [])) {
                const option = document.createElement('option');
                if (item && typeof item === 'object') {
                    option.value = String(item.value ?? '');
                    option.textContent = String(item.label ?? item.value ?? '');
                    if (item.description) option.title = String(item.description);
                } else {
                    option.value = String(item ?? '');
                    option.textContent = String(item ?? '');
                }
                inputElement.appendChild(option);
            }
            if (
                currentValue
                && !Array.from(inputElement.options).some(option => option.value === currentValue)
            ) {
                const invalidOption = document.createElement('option');
                invalidOption.value = currentValue;
                invalidOption.textContent = currentValue + '（当前值不在选项中）';
                inputElement.appendChild(invalidOption);
            }
            inputElement.value = currentValue;
            break;
        }

        // LLM 提供商下拉（选项来自「LLM 配置」中的提供商管理，值为 provider id）
        case 'llm_provider': {
            inputElement = document.createElement('select');
            inputElement.classList.add('plugin-llm-provider-select');
            const currentProvider = String((field.value !== undefined ? field.value : field.default) || '');
            populatePluginLlmProviderSelect(inputElement, currentProvider);
            inputElement.addEventListener('change', () => {
                refreshPluginLlmModelSelects(true);
                markConfigDirty('plugin-config');
            });
            break;
        }

        // LLM 模型下拉（通过 provider_field 与提供商下拉联动，值为 model id）
        case 'llm_model': {
            inputElement = document.createElement('select');
            inputElement.classList.add('plugin-llm-model-select');
            inputElement.dataset.providerField = field.provider_field || '';
            const currentModel = String((field.value !== undefined ? field.value : field.default) || '');
            const providerId = field.provider_field
                ? String(getPluginSchemaValueByPath(field.provider_field) || '')
                : '';
            populatePluginLlmModelSelect(inputElement, providerId, currentModel);
            break;
        }

        case 'object': {
            const childObjectPath = objectPath ? `${objectPath}__${key}` : key;
            const nestedDomId = `nested-${childObjectPath.replace(/\./g, '_')}`;
            fieldDiv.innerHTML = `
                <h4>${field.title || key}</h4>
                <div class="field-description">${field.description || ''}</div>
                <div class="nested-config" id="${nestedDomId}"></div>
            `;
            
            const nestedContainer = fieldDiv.querySelector(`#${nestedDomId}`);
            for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
                if (nestedField?.hidden === true) continue;
                const nestedFieldElement = createConfigField(nestedKey, nestedField, childObjectPath);
                nestedContainer.appendChild(nestedFieldElement);
            }
            return fieldDiv;
        }
            
        default:
            inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.value = field.value !== undefined ? field.value : field.default;
    }
    
    inputElement.id = inputId;
    inputElement.name = key;
    
    fieldDiv.innerHTML = `
        <h4>${field.title || key}</h4>
        <div class="field-description">${field.description || ''}</div>
    `;
    
    fieldDiv.appendChild(inputElement);
    
    return fieldDiv;
}

// ---- 插件配置中的 LLM 提供商/模型下拉支持 ----

// 按点路径（如 "llm.provider_id"）从插件 schema 中取已保存的值
function getPluginSchemaValueByPath(path) {
    if (!path || !window.currentPluginConfig) return '';
    const parts = String(path).split('.').filter(Boolean);
    if (parts.length === 0) return '';
    let node = window.currentPluginConfig[parts[0]];
    for (let i = 1; i < parts.length && node; i++) {
        node = (node.fields || {})[parts[i]];
    }
    if (!node || typeof node !== 'object') return '';
    const value = node.value !== undefined ? node.value : node.default;
    return value !== undefined && value !== null ? String(value) : '';
}

// 点路径 → 插件配置表单的 DOM id（与 configFieldDomId 的 __ 连接规则一致）
function pluginFieldDomIdFromPath(path) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (parts.length === 0) return '';
    const key = parts.pop();
    return configFieldDomId(key, parts.join('__'));
}

function populatePluginLlmProviderSelect(select, selectedValue) {
    select.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '（跟随全局对话模型）';
    select.appendChild(emptyOpt);
    for (const provider of (llmProviderState.providers || [])) {
        if (provider.enabled === false) continue;
        const opt = document.createElement('option');
        opt.value = provider.id;
        opt.textContent = provider.name || provider.id;
        select.appendChild(opt);
    }
    if (selectedValue && !Array.from(select.options).some(o => o.value === selectedValue)) {
        const opt = document.createElement('option');
        opt.value = selectedValue;
        opt.textContent = selectedValue + '（已失效）';
        select.appendChild(opt);
    }
    select.value = selectedValue || '';
}

function populatePluginLlmModelSelect(select, providerId, selectedValue) {
    select.innerHTML = '';
    const hasProvider = Boolean(providerId);
    select.disabled = !hasProvider;
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = hasProvider
        ? '（自动选择该提供商默认模型）'
        : '（请先选择提供商）';
    select.appendChild(emptyOpt);
    if (!hasProvider) {
        select.value = '';
        return;
    }
    const provider = (llmProviderState.providers || []).find(p => p.id === providerId);
    for (const model of (provider?.models || [])) {
        if (model.enabled === false) continue;
        const opt = document.createElement('option');
        opt.value = model.model_id;
        opt.textContent = model.model_id;
        select.appendChild(opt);
    }
    if (selectedValue && !Array.from(select.options).some(o => o.value === selectedValue)) {
        const opt = document.createElement('option');
        opt.value = selectedValue;
        opt.textContent = selectedValue + '（不在列表）';
        select.appendChild(opt);
    }
    select.value = selectedValue || '';
}

// 提供商下拉变化时，刷新所有依赖它的模型下拉
function refreshPluginLlmModelSelects(resetSelection = false) {
    document.querySelectorAll('select.plugin-llm-model-select').forEach(select => {
        const providerFieldPath = select.dataset.providerField || '';
        let providerId = '';
        if (providerFieldPath) {
            const providerSelect = document.getElementById(pluginFieldDomIdFromPath(providerFieldPath));
            providerId = providerSelect
                ? providerSelect.value
                : String(getPluginSchemaValueByPath(providerFieldPath) || '');
        }
        populatePluginLlmModelSelect(select, providerId, resetSelection ? '' : select.value);
    });
}

// 重置插件配置为默认值
function resetPluginConfig() {
    if (!window.currentPluginConfig || !window.currentPluginPath) {
        return;
    }
    
    const config = JSON.parse(JSON.stringify(window.currentPluginConfig));
    
    // 遍历所有字段，重置为默认值
    for (const [key, field] of Object.entries(config)) {
        resetFieldToDefault(key, field);
    }

    // 重置后刷新 LLM 模型下拉的联动选项
    refreshPluginLlmModelSelects();

    markConfigDirty('plugin-config');
    addLog('配置已重置为默认值', 'info', 'system');
}

function resetFieldToDefault(key, field, objectPath) {
    if (field.type === 'object') {
        const childObjectPath = objectPath ? `${objectPath}__${key}` : key;
        for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
            resetFieldToDefault(nestedKey, nestedField, childObjectPath);
        }
        return;
    }
    
    const inputId = configFieldDomId(key, objectPath);
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (field.type === 'bool') {
        input.checked = field.default;
    } else {
        input.value = field.default;
    }
}

// 保存插件配置（使用 display_name 作为唯一标识符）
async function savePluginConfig() {
    if (!window.currentPluginConfig || !window.currentPluginDisplayName) {
        addLog('没有打开的插件配置', 'warning', 'system');
        return;
    }
    
    try {
        // 收集表单数据（按照原始键顺序）
        const updatedConfig = collectConfigFormData();
        
        // 使用 display_name 发送保存请求
        const response = await fetch(`/api/plugins/${encodeURIComponent(window.currentPluginDisplayName)}/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedConfig)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            addLog('插件配置保存成功', 'success', 'system');
            showSuccess('插件配置保存成功');
            clearConfigDirty('plugin-config');
            closePluginConfigModal(true);
            // 重新加载插件列表以更新状态
            loadPlugins();
        } else {
            addLog('保存配置失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('保存配置失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('保存配置时出错：' + error.message, 'error', 'system');
        showError('保存配置时出错：' + error.message);
    }
}

function collectObjectSubtree(field, objectPath) {
    const value = {};
    for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
        if (nestedField?.hidden === true) {
            value[nestedKey] = nestedField.value !== undefined
                ? nestedField.value
                : nestedField.default;
            continue;
        }
        if (nestedField.type === 'object') {
            const childPath = objectPath ? `${objectPath}__${nestedKey}` : nestedKey;
            value[nestedKey] = collectObjectSubtree(nestedField, childPath);
        } else {
            const leafPath = objectPath ? `${objectPath}__${nestedKey}` : nestedKey;
            const nestedInput = document.getElementById(`config-${leafPath}`);
            if (nestedInput) {
                if (nestedField.type === 'bool') {
                    value[nestedKey] = nestedInput.checked;
                } else if (nestedField.type === 'int') {
                    const parsed = parseInt(nestedInput.value);
                    value[nestedKey] = !isNaN(parsed) ? parsed : (nestedField.default ?? 0);
                } else if (nestedField.type === 'float') {
                    const parsed = parseFloat(nestedInput.value);
                    value[nestedKey] = !isNaN(parsed) ? parsed : (nestedField.default ?? 0.0);
                } else {
                    value[nestedKey] = nestedInput.value;
                }
            } else {
                value[nestedKey] = nestedField.default;
            }
        }
    }
    return value;
}

function collectConfigFormData() {
    const updatedConfig = {};
    const keys = window.currentPluginConfigKeys || Object.keys(window.currentPluginConfig || {});
    
    for (const key of keys) {
        const field = window.currentPluginConfig[key];
        if (!field) continue;
        
        let value;
        
        if (field.type === 'object') {
            updatedConfig[key] = collectObjectSubtree(field, key);
            continue;
        }
        
        const input = document.getElementById(configFieldDomId(key, ''));
        if (!input) continue;
        
        if (field.type === 'bool') {
            value = input.checked;
        } else if (field.type === 'int') {
            const parsed = parseInt(input.value);
            value = !isNaN(parsed) ? parsed : (field.default ?? 0);
        } else if (field.type === 'float') {
            const parsed = parseFloat(input.value);
            value = !isNaN(parsed) ? parsed : (field.default ?? 0.0);
        } else {
            value = input.value;
        }
        
        updatedConfig[key] = value;
    }
    
    return updatedConfig;
}

function updateFieldFromForm(key, field, objectPath) {
    if (field.type === 'object') {
        const childObjectPath = objectPath ? `${objectPath}__${key}` : key;
        for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
            updateFieldFromForm(nestedKey, nestedField, childObjectPath);
        }
        return;
    }
    
    const inputId = configFieldDomId(key, objectPath);
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (field.type === 'bool') {
        field.value = input.checked;
    } else if (field.type === 'int') {
        const parsed = parseInt(input.value);
        field.value = !isNaN(parsed) ? parsed : 0;
    } else if (field.type === 'float') {
        const parsed = parseFloat(input.value);
        field.value = !isNaN(parsed) ? parsed : 0.0;
    } else {
        field.value = input.value;
    }
}

// 更新插件卡片按钮状态（使用 plugin_path 作为唯一标识符）
function updatePluginCardButtons(plugins) {
    plugins.forEach(plugin => {
        // 使用 plugin_path 选择卡片
        const card = document.querySelector(`.plugin-card[data-plugin-path="${plugin.plugin_path}"]`);
        if (card) {
            const configBtn = card.querySelector('.btn-open-config');
            if (configBtn) {
                if (plugin.has_own_config) {
                    configBtn.textContent = '配置';
                    configBtn.disabled = false;
                    configBtn.style.background = ''; // 清掉内联渐变,回到 CSS 主题配色
                } else {
                    configBtn.textContent = '无配置';
                    configBtn.disabled = true;
                    configBtn.style.background = ''; // 由 button:disabled 主题样式接管
                }
            }
        }
    });
}

function updatePluginPanelButtons(plugins) {
    (plugins || []).forEach(plugin => {
        const card = document.querySelector(`.plugin-card[data-plugin-path="${plugin.plugin_path}"]`);
        if (!card) return;
        const panelBtn = card.querySelector('.btn-open-panel');
        if (!panelBtn) return;
        const canOpen = plugin.has_local_panel === true && plugin.enabled === true;
        panelBtn.disabled = !canOpen;
        panelBtn.style.opacity = canOpen ? '1' : '0.45';
        panelBtn.style.cursor = canOpen ? 'pointer' : 'not-allowed';
        panelBtn.textContent = canOpen ? '打开面板' : '面板未运行';
    });
}

// 重写 renderPlugins 函数以包含按钮状态更新
function renderPlugins(plugins) {
    const builtinContainer = document.getElementById('builtin-plugins-list');
    const communityContainer = document.getElementById('community-plugins-list');

    if (!builtinContainer || !communityContainer) {
        console.error('插件容器未找到');
        return;
    }

    builtinContainer.innerHTML = '';
    communityContainer.innerHTML = '';

    const sorted = [...plugins].sort((a, b) => {
        const byEnabled = Number(b.enabled) - Number(a.enabled);
        if (byEnabled !== 0) return byEnabled;
        const na = (a.display_name || a.plugin_path || '').toLowerCase();
        const nb = (b.display_name || b.plugin_path || '').toLowerCase();
        return na.localeCompare(nb, 'zh-CN', { sensitivity: 'base' });
    });

    sorted.forEach(plugin => {
        const card = createPluginCard(plugin);
        if (plugin.category === 'built-in') {
            builtinContainer.appendChild(card);
        } else {
            communityContainer.appendChild(card);
        }
    });
    
    // 更新按钮状态
    updatePluginCardButtons(plugins);
    updatePluginPanelButtons(plugins);
}

// 保存基础配置
async function saveBasicSettings() {
    try {
        const config = {
            auto_screenshot: document.getElementById('auto-screenshot').checked,
            use_vision_model: document.getElementById('use-vision-model').checked,
            show_chat_box: document.getElementById('show-chat-box').checked,
            show_model: !document.getElementById('hide-model').checked,  // 勾选表示隐藏，所以取反
            voice_barge_in: document.getElementById('voice-barge-in').checked,
            ptt_enabled: document.getElementById('ptt-enabled')?.checked === true,
            ptt_key: getPTTKeyValue(),
            tools_enabled: document.getElementById('tools-enabled').checked,
            mcp_enabled: document.getElementById('mcp-enabled').checked,
            // 视觉模型引用（'provider_id|model_id'，在 LLM 配置中统一管理）
            vision_model_ref: document.getElementById('vision-model-select')?.value || ''
        };

        const response = await fetch('/api/settings/advanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            setPTTKeyValue(result.ptt_key || config.ptt_key);
            addLog('基础配置已保存', 'success', 'system');
            showSuccess('基础配置已保存');
            clearConfigDirty('basic-config');
        } else {
            addLog('保存基础配置失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('保存基础配置失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('保存基础配置时出错：' + error.message, 'error', 'system');
        showError('保存基础配置时出错：' + error.message);
    }
}

// 加载基础配置
async function loadBasicConfig() {
    try {
        const response = await fetch('/api/settings/advanced');
        if (response.ok) {
            const config = await response.json();
            _setChk('auto-screenshot', config.auto_screenshot === true);
            _setChk('use-vision-model', config.use_vision_model === true);
            _setChk('auto-close-services', config.auto_close_services === true);
            _setChk('show-chat-box', config.show_chat_box === true);
            _setChk('show-model', config.show_model === true);
            _setChk('voice-barge-in', config.voice_barge_in === true);
            _setChk('ptt-enabled', config.ptt_enabled === true);
            setPTTKeyValue(config.ptt_key || 'v');
            _setChk('tools-enabled', config.tools_enabled === true);
            _setChk('mcp-enabled', config.mcp_enabled === true);

            // 加载视觉模型下拉（选项来自 LLM 提供商管理）
            fillModelRefSelect('vision-model-select', config.vision_model_options, config.vision_model_ref || '');
        }
    } catch (error) {
        console.error('加载基础配置失败:', error);
    }
}

// 用后端返回的模型选项填充下拉框（value 为 'provider_id|model_id' 复合值）
function fillModelRefSelect(selectId, options, selectedValue) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '';
    for (const option of (options || [])) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
    }
    // 当前选中值不在选项中时，保留为自定义项显示，避免静默丢失
    if (selectedValue && !Array.from(select.options).some(o => o.value === selectedValue)) {
        const opt = document.createElement('option');
        opt.value = selectedValue;
        opt.textContent = selectedValue + '（已失效）';
        select.appendChild(opt);
    }
    select.value = selectedValue || (select.options[0] ? select.options[0].value : '');
}

function pttTranslation(key, fallback) {
    try {
        const translated = typeof t === 'function' ? t(key) : '';
        return translated && translated !== key ? translated : fallback;
    } catch (_) {
        return fallback;
    }
}

function normalizePTTKeyValue(value) {
    const original = value == null ? '' : String(value);
    const raw = original === ' ' ? ' ' : original.trim().toLowerCase();
    if (!raw) return '';
    if (/^key[a-z]$/.test(raw)) return raw.slice(3);
    if (/^digit[0-9]$/.test(raw)) return raw.slice(5);
    return PTT_KEY_ALIASES[raw] || raw;
}

function pttKeyFromKeyboardEvent(event) {
    const fromCode = normalizePTTKeyValue(event?.code);
    if (PTT_SUPPORTED_KEYS.has(fromCode)) return fromCode;

    const fromKey = normalizePTTKeyValue(event?.key);
    return PTT_SUPPORTED_KEYS.has(fromKey) ? fromKey : '';
}

function formatPTTKeyLabel(value) {
    const key = normalizePTTKeyValue(value);
    if (PTT_KEY_LABELS[key]) return PTT_KEY_LABELS[key];
    if (/^numpad[0-9]$/.test(key)) return `Num ${key.slice(-1)}`;
    if (/^[a-z0-9]$/.test(key) || /^f([1-9]|1[0-9]|2[0-4])$/.test(key)) {
        return key.toUpperCase();
    }
    return key || 'V';
}

function getPTTKeyValue() {
    const input = document.getElementById('ptt-key');
    const key = normalizePTTKeyValue(input?.dataset?.key || input?.value || 'v');
    return PTT_SUPPORTED_KEYS.has(key) ? key : 'v';
}

function setPTTKeyValue(value, { markDirty = false } = {}) {
    const input = document.getElementById('ptt-key');
    if (!input) return 'v';

    const normalized = normalizePTTKeyValue(value);
    const key = PTT_SUPPORTED_KEYS.has(normalized) ? normalized : 'v';
    input.dataset.key = key;
    input.value = formatPTTKeyLabel(key);

    if (markDirty) {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return key;
}

function updatePTTKeyCaptureUI(active) {
    const binding = document.getElementById('ptt-key-binding');
    const input = document.getElementById('ptt-key');
    const button = document.getElementById('ptt-key-capture');
    binding?.classList.toggle('is-capturing', active);

    if (input) {
        input.value = active
            ? pttTranslation('dialog_config.ptt_key_waiting', '请按键...')
            : formatPTTKeyLabel(input.dataset.key || 'v');
    }
    if (button) {
        const translationKey = active
            ? 'dialog_config.ptt_key_cancel'
            : 'dialog_config.ptt_key_change';
        button.setAttribute('data-i18n', translationKey);
        button.textContent = active
            ? pttTranslation(translationKey, '取消')
            : pttTranslation(translationKey, '更改按键');
        button.setAttribute('aria-pressed', String(active));
    }
}

function stopPTTKeyCapture() {
    if (!pttKeyCaptureActive) return;
    pttKeyCaptureActive = false;
    document.removeEventListener('keydown', capturePTTKey, true);
    document.removeEventListener('pointerdown', cancelPTTKeyCaptureOnOutsideClick, true);
    window.removeEventListener('blur', stopPTTKeyCapture);
    updatePTTKeyCaptureUI(false);
}

function cancelPTTKeyCaptureOnOutsideClick(event) {
    const binding = document.getElementById('ptt-key-binding');
    if (binding && !binding.contains(event.target)) {
        stopPTTKeyCapture();
    }
}

function capturePTTKey(event) {
    if (!pttKeyCaptureActive || event.repeat) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const key = pttKeyFromKeyboardEvent(event);
    if (!key) {
        showError(pttTranslation('dialog_config.ptt_key_unsupported', '这个按键暂不支持'));
        return;
    }

    setPTTKeyValue(key, { markDirty: true });
    stopPTTKeyCapture();
}

function startPTTKeyCapture() {
    if (pttKeyCaptureActive) {
        stopPTTKeyCapture();
        return;
    }

    pttKeyCaptureActive = true;
    updatePTTKeyCaptureUI(true);
    document.addEventListener('keydown', capturePTTKey, true);
    document.addEventListener('pointerdown', cancelPTTKeyCaptureOnOutsideClick, true);
    window.addEventListener('blur', stopPTTKeyCapture);
}

// 保存对话配置
async function saveDialogSettings() {
    try {
        const config = {
            intro_text: document.getElementById('intro-text').value,
            max_messages: parseInt(document.getElementById('max-messages').value) || 30,
            enable_limit: document.getElementById('enable-limit').checked,
            persistent_history: document.getElementById('persistent-history').checked,
            // 对话模型引用（'provider_id|model_id'，在 LLM 配置中统一管理）
            dialog_model_ref: document.getElementById('dialog-model-select')?.value || '',
            tts_enabled: document.getElementById('tts-enabled').checked,
            asr_enabled: document.getElementById('asr-enabled').checked,
            voice_barge_in: document.getElementById('voice-barge-in').checked,
            ptt_enabled: document.getElementById('ptt-enabled')?.checked === true,
            ptt_key: getPTTKeyValue(),
            show_chat_box: document.getElementById('show-chat-box').checked
        };

        const response = await fetch('/api/settings/dialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            setPTTKeyValue(result.ptt_key || config.ptt_key);
            addLog('对话配置已保存', 'success', 'system');
            showSuccess('对话配置已保存');
            clearConfigDirty('dialog-config');
        } else {
            addLog('保存对话配置失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('保存对话配置失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('保存对话配置时出错：' + error.message, 'error', 'system');
        showError('保存对话配置时出错：' + error.message);
    }
}

// 加载对话配置
async function loadDialogConfig() {
    try {
        const response = await fetch('/api/settings/dialog');
        if (response.ok) {
            const config = await response.json();
            fillModelRefSelect('dialog-model-select', config.dialog_model_options, config.dialog_model_ref || '');
            document.getElementById('intro-text').value = config.intro_text || '你好啊';
            document.getElementById('max-messages').value = config.max_messages || 30;
            document.getElementById('enable-limit').checked = config.enable_limit === true;
            document.getElementById('persistent-history').checked = config.persistent_history === true;
            document.getElementById('tts-enabled').checked = config.tts_enabled === true;
            document.getElementById('asr-enabled').checked = config.asr_enabled === true;
            document.getElementById('voice-barge-in').checked = config.voice_barge_in === true;
            const pttEl = document.getElementById('ptt-enabled');
            if (pttEl) pttEl.checked = config.ptt_enabled === true;
            setPTTKeyValue(config.ptt_key || 'v');
            document.getElementById('show-chat-box').checked = config.show_chat_box === true;
        }
    } catch (error) {
        console.error('加载对话配置失败:', error);
    }
}

// 加载 UI 设置
async function loadUISettings() {
    try {
        const response = await fetch('/api/settings/ui');
        if (response.ok) {
            const data = await response.json();
            console.log('loadUISettings API response:', data);
            
            _setChk('show-chat-box', data.show_chat_box === true);
            _setVal('model-scale', data.model_scale || 2.3);
            _setVal('avatar-motion-mode', data.avatar_motion_mode || 'blend');
            _setVal('choreo-motion-style', data.motion_style || '');
            // hide-model: 勾选表示隐藏，所以取反
            _setChk('hide-model', data.show_model !== true);
            
            // 处理 subtitle_labels 对象 - 支持多种数据结构
            let subtitleLabels = {};
            if (data.subtitle_labels) {
                // 直接包含 subtitle_labels 字段
                subtitleLabels = data.subtitle_labels;
                console.log('Found subtitle_labels in root:', subtitleLabels);
            } else if (data.ui && data.ui.subtitle_labels) {
                // 包含在 ui 对象中的 subtitle_labels 字段
                subtitleLabels = data.ui.subtitle_labels;
                console.log('Found subtitle_labels in ui object:', subtitleLabels);
            } else {
                // 尝试从根级别获取 user 和 ai 字段
                subtitleLabels = {
                    enabled: data.subtitle_enabled || data['subtitle-labels-enabled'] || false,
                    user: data.subtitle_user || data['subtitle-user'] || '',
                    ai: data.subtitle_ai || data['subtitle-ai'] || ''
                };
                console.log('Using fallback subtitle fields:', subtitleLabels);
            }
            
            _setChk('subtitle-enabled', subtitleLabels.enabled === true);
            // 强制设置值，即使为空字符串
            _setVal('subtitle-user', subtitleLabels.user || '');
            _setVal('subtitle-ai', subtitleLabels.ai || '');
            
            console.log('UI settings loaded successfully');
        } else {
            console.error('loadUISettings API returned non-ok status:', response.status);
        }
    } catch (error) {
        console.error('加载 UI 设置失败:', error);
    }
}

// 保存 Live2D 模型（v2：旧入口，委托到四形态统一逻辑）
async function saveLive2DModel() {
    await applyAvatarModel();
}

// 复位皮套位置
async function resetModelPosition() {
    try {
        // 调用后端 API 复位模型位置
        const response = await fetch('/api/live2d/model/reset-position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            addLog('皮套位置已复位', 'success', 'system');
            showSuccess('皮套位置已复位，请重启桌宠生效');
        } else {
            addLog('复位皮套位置失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('复位失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('复位皮套位置时出错：' + error.message, 'error', 'system');
        showError('复位出错：' + error.message);
    }
}

// 调整字幕位置（桌宠窗口进入拖动/缩放模式）
async function adjustSubtitlePosition() {
    try {
        const response = await fetch('/api/live2d/subtitle/adjust-position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            addLog('已进入字幕调整模式', 'success', 'system');
            showSuccess(result.message || '已进入字幕调整模式，请到桌宠窗口拖动调整');
        } else {
            addLog('进入字幕调整模式失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('调整失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('进入字幕调整模式时出错：' + error.message, 'error', 'system');
        showError('调整出错：' + error.message);
    }
}

// 复位字幕位置
async function resetSubtitlePosition() {
    try {
        const response = await fetch('/api/live2d/subtitle/reset-position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            addLog('字幕位置已复位', 'success', 'system');
            showSuccess(result.message || '字幕位置已复位');
        } else {
            addLog('复位字幕位置失败：' + (result.error || '未知错误'), 'error', 'system');
            showError('复位失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('复位字幕位置时出错：' + error.message, 'error', 'system');
        showError('复位出错：' + error.message);
    }
}

// 页面可见性改变��也检查状态
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        checkServiceStatus();
        pollVisibleLogs();
    }
});

// ============ 广场 ============

// 切换广场子选项卡
function switchMarketTab(tab) {
    // 只更新广场选项卡按钮状态（使用 #market 限制范围）
    document.querySelectorAll('#market .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 只更新广场面板显示（使用 #market 限制范围）
    document.querySelectorAll('#market .market-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(tab + '-market-panel').classList.add('active');
}

// 刷新提示词广场
async function refreshPromptMarket() {
    try {
        const listElement = document.getElementById('prompt-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">正在加载提示词列表...</div>';

        const response = await fetch('/api/market/prompts');
        const data = await response.json();
        
        if (data.success && data.prompts && data.prompts.length > 0) {
            listElement.innerHTML = '';
            data.prompts.forEach((prompt) => {
                const card = createPromptCard(prompt);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">��无提示词</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载失败') + '</div>';
        }
    } catch (error) {
        document.getElementById('prompt-market-list').innerHTML = 
            '<div class="log-entry log-error">加载出错：' + error.message + '</div>';
    }
}

// 创建提示词卡片
function createPromptCard(prompt) {
    const card = document.createElement('div');
    card.className = 'market-card';

    const title = prompt.title || '未命名提示词';
    const summary = prompt.summary || '';
    const prerequisites = prompt.prerequisites || '';
    const content = prompt.content || '';

    let html = `<div class="market-card-header">
        <h4 class="market-card-title">💡 ${title}</h4>
    </div>`;

    if (summary) {
        html += `<p class="market-card-summary">${summary}</p>`;
    }

    if (prerequisites) {
        html += `<div class="market-card-warning">⚠️ 使用条件：${prerequisites}</div>`;
    }

    // 添加应用按钮
    html += `<button onclick="applyPrompt('${title.replace(/'/g, "\\'")}')" class="btn-sm" style="margin-top: 10px;">应用</button>`;

    card.innerHTML = html;
    return card;
}

// 应用提示词
async function applyPrompt(title) {
    // 从服务器获取提示词详细内容
    try {
        const response = await fetch('/api/market/prompts');
        const data = await response.json();
        if (data.success) {
            const prompt = data.prompts.find(p => p.title === title);
            if (prompt && prompt.content) {
                const result = await fetch('/api/market/prompts/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: prompt.content })
                });
                const res = await result.json();
                if (res.success) {
                    // 设置到 AI 人设输入框
                    const promptInput = document.getElementById('system-prompt');
                    if (promptInput) {
                        promptInput.value = res.content;
                    }
                    showSuccess('提示词已应用，请在 LLM 配置中保存');
                } else {
                    showError('应用失败：' + (res.error || '未知错误'));
                }
            }
        }
    } catch (error) {
        showError('应用时出错：' + error.message);
    }
}

// 刷新工具广场
async function refreshToolMarket() {
    try {
        const listElement = document.getElementById('tool-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">正在加载工具列表...</div>';

        const response = await fetch('/api/market/tools');
        const data = await response.json();
        
        if (data.success && data.tools && data.tools.length > 0) {
            listElement.innerHTML = '';
            data.tools.forEach((tool) => {
                const card = createMarketToolCard(tool);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">暂无工具</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载失败') + '</div>';
        }
    } catch (error) {
        document.getElementById('tool-market-list').innerHTML = 
            '<div class="log-entry log-error">加载出错：' + error.message + '</div>';
    }
}

// 创建广场工具卡���
function createMarketToolCard(tool) {
    const card = document.createElement('div');
    card.className = 'market-card';

    const toolName = tool.tool_name || tool.name || '未命名工具';
    const toolId = tool.id || '';
    const fileName = tool.file_name || toolName + '.js';

    // 优先使用后端返回的 download_url，如果没有则回退到用 id 构建
    const downloadUrl = tool.download_url || (toolId ? `http://mynewbot.com/api/download-tool/${toolId}` : '');

    const html = `<div class="market-card-header">
        <h4 class="market-card-title">📦 ${toolName}</h4>
    </div>
    <button onclick="downloadTool('${toolName.replace(/'/g, "\\'")}', '${downloadUrl}', '${fileName}')" class="btn-sm" style="margin-top: 10px;">⬇ 下载</button>`;

    card.innerHTML = html;
    return card;
}

// 下载工具
async function downloadTool(toolName, downloadUrl, fileName) {
    try {
        const result = await fetch('/api/market/tools/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                tool_name: toolName, 
                download_url: downloadUrl,
                file_name: fileName
            })
        });
        const res = await result.json();
        if (res.success) {
            showSuccess(`工具 ${toolName} 已下载！`);
        } else {
            showError('下载失败：' + (res.error || '未知错误'));
        }
    } catch (error) {
        showError('下载时出错：' + error.message);
    }
}

// 刷新 FC 广场
async function refreshFCMarket() {
    try {
        const listElement = document.getElementById('fc-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">正在加载 FC 工具列表...</div>';

        const response = await fetch('/api/market/fc-tools');
        const data = await response.json();

        if (data.success && data.fc_tools && data.fc_tools.length > 0) {
            listElement.innerHTML = '';
            data.fc_tools.forEach((tool) => {
                const card = createFCCard(tool);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">暂无 FC 工具</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载失败') + '</div>';
        }
    } catch (error) {
        document.getElementById('fc-market-list').innerHTML =
            '<div class="log-entry log-error">加载出错：' + error.message + '</div>';
    }
}

// 创建 FC 工具卡片
function createFCCard(tool) {
    const card = document.createElement('div');
    card.className = 'market-card';

    const toolName = tool.tool_name || tool.name || '未命名工具';
    const downloadUrl = tool.download_url || '';

    const html = `<div class="market-card-header">
        <h4 class="market-card-title">🔧 ${toolName}</h4>
    </div>
    <button onclick="downloadFCtool('${toolName.replace(/'/g, "\\'")}', '${downloadUrl}')" class="btn-sm" style="margin-top: 10px;">⬇ 下载</button>`;

    card.innerHTML = html;
    return card;
}

// 下载 FC 工具
async function downloadFCtool(toolName, downloadUrl) {
    try {
        const result = await fetch('/api/market/fc-tools/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool_name: toolName, download_url: downloadUrl })
        });
        const res = await result.json();
        if (res.success) {
            showSuccess(`FC 工具 ${toolName} 已下载！`);
        } else {
            showError('下载失败：' + (res.error || '未知错误'));
        }
    } catch (error) {
        showError('下载时出错：' + error.message);
    }
}

let pluginMarketUpdateCandidates = [];
let pluginMarketItems = [];
let pluginMarketRefreshSeq = 0;

function escapeJsString(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 1000000) {
        return (count / 1000000).toFixed(count >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    }
    if (count >= 1000) {
        return (count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    }
    return String(Math.max(0, count));
}

function updatePluginMarketToolbar() {
    const toolbar = document.getElementById('plugin-market-update-toolbar');
    const updateAllBtn = document.getElementById('plugin-market-update-all-btn');
    const updateCount = document.getElementById('plugin-market-update-count');
    if (!toolbar || !updateAllBtn || !updateCount) return;

    const count = pluginMarketUpdateCandidates.length;
    updateCount.textContent = count > 0 ? `发现 ${count} 个可更新插件` : '暂无可更新插件';
    updateAllBtn.classList.toggle('is-hidden', count === 0);
    toolbar.classList.remove('is-hidden');
}

function renderPluginMarketList(plugins) {
    const listElement = document.getElementById('plugin-market-list');
    if (!listElement) return;

    if (!plugins || plugins.length === 0) {
        listElement.innerHTML = '<div class="log-entry log-info">暂无插件</div>';
        return;
    }

    listElement.innerHTML = '';
    plugins.forEach((plugin) => {
        const card = createPluginMarketCard(plugin);
        listElement.appendChild(card);
    });
}

// 刷新插件广场
async function refreshPluginMarket() {
    try {
        const refreshSeq = ++pluginMarketRefreshSeq;
        const listElement = document.getElementById('plugin-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">正在加载插件列表...</div>';
        pluginMarketUpdateCandidates = [];
        pluginMarketItems = [];
        updatePluginMarketToolbar();

        const response = await fetch('/api/market/plugins?check_updates=false');
        const data = await response.json();

        if (data.success && data.plugins && data.plugins.length > 0) {
            pluginMarketItems = data.plugins;
            renderPluginMarketList(pluginMarketItems);
            refreshPluginMarketUpdates(refreshSeq).catch((error) => {
                console.warn('插件更新检查失败:', error);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">暂无插件</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载失败') + '</div>';
        }
    } catch (error) {
        document.getElementById('plugin-market-list').innerHTML =
            '<div class="log-entry log-error">加载出错：' + error.message + '</div>';
    }
}

async function refreshPluginMarketUpdates(refreshSeq) {
    const response = await fetch('/api/market/plugins/check-updates');
    const data = await response.json();

    if (refreshSeq !== pluginMarketRefreshSeq) return;

    if (!data.success || !Array.isArray(data.plugins)) {
        console.warn('插件更新检查失败:', data.error || 'unknown error');
        return;
    }

    const updatesByName = new Map(data.plugins.map((plugin) => [plugin.name, plugin]));
    pluginMarketItems = pluginMarketItems.map((plugin) => {
        const updateInfo = updatesByName.get(plugin.name);
        return updateInfo ? { ...plugin, ...updateInfo } : plugin;
    });
    pluginMarketUpdateCandidates = pluginMarketItems.filter((plugin) => plugin.installed && plugin.has_update);
    updatePluginMarketToolbar();
    renderPluginMarketList(pluginMarketItems);
}

// 创建插件广场卡片
function createPluginMarketCard(plugin) {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.dataset.pluginName = plugin.name;  // 存储插件名用于后续更新

    const pluginName = plugin.name || plugin.display_name || '未命名插件';
    const displayName = plugin.display_name || pluginName;
    const desc = plugin.description || plugin.desc || '无描述';
    const author = plugin.author || '未知作者';
    const repo = plugin.repo || '';
    const downloadUrl = plugin.download_url || repo;
    const installed = plugin.installed || false;
    const installing = plugin.installing || false;
    const localVersion = plugin.local_version || plugin.version || '';
    const latestVersion = plugin.latest_version || plugin.version || '';
    const hasUpdate = installed && plugin.has_update && latestVersion;
    const downloads = Number(plugin.downloads) || 0;
    const stars = Number(plugin.stars) || 0;
    const starred = !!plugin.starred;

    // 根据状态设置按钮文本和样式（installed 优先于 installing）
    let btnText, btnDisabled, buttonAction;
    if (hasUpdate) {
        btnText = `⬆ 更新到 ${latestVersion}`;
        btnDisabled = '';
        buttonAction = `updatePlugin('${escapeJsString(pluginName)}', '${escapeJsString(repo)}')`;
    } else if (installed) {
        btnText = localVersion ? `✓ 已安装 ${localVersion}` : '✓ 已安装';
        btnDisabled = 'disabled';
        buttonAction = '';
    } else if (installing) {
        // 正在安装
        btnText = plugin.status === 'updating' ? '⏳ 更新中...' : '⏳ 安装中...';
        btnDisabled = 'disabled';
        buttonAction = '';
    } else {
        // 未安装
        btnText = '⬇ 安装';
        btnDisabled = '';
        buttonAction = `installPlugin('${escapeJsString(pluginName)}', '${escapeJsString(downloadUrl)}')`;
    }

    const authorLine = escapeHtml(author);
    const repoHref = repo ? escapeHtml(repo) : '';
    const versionBlock = `<div class="market-card-versions">
            ${localVersion ? `<span class="version-badge">当前 ${escapeHtml(localVersion)}</span>` : ''}
            ${latestVersion ? `<span class="version-badge ${hasUpdate ? 'update-badge' : ''}">最新 ${escapeHtml(latestVersion)}</span>` : ''}
            ${plugin.update_error ? `<span class="version-badge muted-badge" title="${escapeAttribute(plugin.update_error)}">更新检查失败</span>` : ''}
           </div>`;
    const statsBlock = `<div class="market-card-stats">
            <span class="market-stat" title="${escapeAttribute(`${downloads} 次安装下载`)}">⬇ ${escapeHtml(formatCount(downloads))} 次下载</span>
            <button type="button"
                class="star-btn ${starred ? 'starred' : ''}"
                data-plugin-name="${escapeAttribute(pluginName)}"
                data-stars="${stars}"
                aria-pressed="${starred ? 'true' : 'false'}"
                title="${starred ? '取消 Star' : '点亮 Star'}"
                onclick="togglePluginStar('${escapeJsString(pluginName)}', this)">★ <span class="star-count">${escapeHtml(formatCount(stars))}</span></button>
           </div>`;
    const metaBlock = repo
        ? `<div class="market-card-meta">
            <span class="market-card-author">👤 作者：${authorLine}</span>
            <a class="market-card-source-link" href="${repoHref}" target="_blank" rel="noopener noreferrer">📎 查看来源</a>
           </div>`
        : `<p class="market-card-author">👤 作者：${authorLine}</p>`;

    const html = `<div class="market-card-header">
        <h4 class="market-card-title">🧩 ${escapeHtml(displayName)}</h4>
        ${metaBlock}
        ${versionBlock}
        ${statsBlock}
        <p class="market-card-summary">${escapeHtml(desc)}</p>
        <div class="install-progress" id="progress-${escapeAttribute(pluginName)}" style="display: none;">
            <div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>
            <span class="progress-text">准备中...</span>
        </div>
    </div>
    <button ${buttonAction ? `onclick="${escapeAttribute(buttonAction)}"` : ''}
        class="btn-sm market-action-btn" style="margin-top: 10px;" ${btnDisabled}>${escapeHtml(btnText)}</button>`;

    card.innerHTML = html;
    return card;
}

async function togglePluginStar(pluginName, btnEl) {
    if (!btnEl || btnEl.disabled) return;

    btnEl.disabled = true;
    try {
        const response = await fetch('/api/market/plugins/star', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_name: pluginName })
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            const message = result.error === 'stats_disabled'
                ? '插件统计功能未启用'
                : 'Star 操作失败';
            showError(message);
            return;
        }

        const stars = Number(result.stars) || 0;
        btnEl.dataset.stars = String(stars);
        btnEl.classList.toggle('starred', !!result.starred);
        btnEl.setAttribute('aria-pressed', result.starred ? 'true' : 'false');
        btnEl.setAttribute('title', result.starred ? '取消 Star' : '点亮 Star');

        const countEl = btnEl.querySelector('.star-count');
        if (countEl) {
            countEl.textContent = formatCount(stars);
        }

        pluginMarketItems = pluginMarketItems.map((plugin) => {
            if (plugin.name !== pluginName) return plugin;
            return { ...plugin, stars, starred: !!result.starred };
        });
    } catch (error) {
        showError('Star 操作出错：' + error.message);
    } finally {
        btnEl.disabled = false;
    }
}

// 安装插件
async function installPlugin(pluginName, downloadUrl) {
    try {
        pluginMarketRefreshSeq++;
        // 更新按钮状态
        const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
        if (card) {
            const btn = card.querySelector('.market-action-btn');
            btn.disabled = true;
            btn.textContent = '⏳ 安装中...';
            btn.classList.add('btn-installing');
            
            // 显示进度条
            const progressDiv = document.getElementById(`progress-${pluginName}`);
            if (progressDiv) {
                progressDiv.style.display = 'block';
            }
        }

        const result = await fetch('/api/market/plugins/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_name: pluginName, repo: downloadUrl, download_url: downloadUrl })
        });
        const res = await result.json();
        
        if (res.success) {
            // 开始轮询检测插件目录
            pollPluginInstalled(pluginName);
        } else {
            showError('安装失败：' + (res.error || '未知错误'));
            // 恢复按钮状态
            restoreInstallButton(pluginName, '⬇ 安装');
        }
    } catch (error) {
        showError('安装时出错：' + error.message);
        restoreInstallButton(pluginName, '⬇ 安装');
    }
}

// 更新单个插件
async function updatePlugin(pluginName, repo) {
    try {
        pluginMarketRefreshSeq++;
        const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
        if (card) {
            const btn = card.querySelector('.market-action-btn');
            btn.disabled = true;
            btn.textContent = '⏳ 更新中...';
            btn.classList.add('btn-installing');

            const progressDiv = document.getElementById(`progress-${pluginName}`);
            const progressText = progressDiv ? progressDiv.querySelector('.progress-text') : null;
            const progressFill = progressDiv ? progressDiv.querySelector('.progress-fill') : null;
            if (progressDiv) progressDiv.style.display = 'block';
            if (progressText) progressText.textContent = '正在下载并更新...';
            if (progressFill) progressFill.style.width = '50%';
        }

        const response = await fetch('/api/market/plugins/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_name: pluginName, repo })
        });
        const result = await response.json();

        if (response.ok && result.success) {
            showSuccess(`插件 ${pluginName} 已更新`);
            setTimeout(() => refreshPluginMarket(), 500);
        } else {
            showError('更新失败：' + (result.error || '未知错误'));
            restoreInstallButton(pluginName, '⬆ 重试更新');
        }
    } catch (error) {
        showError('更新时出错：' + error.message);
        restoreInstallButton(pluginName, '⬆ 重试更新');
    }
}

// 批量更新插件
async function updateAllPlugins() {
    if (!pluginMarketUpdateCandidates.length) {
        showSuccess('当前没有可更新插件');
        return;
    }

    pluginMarketRefreshSeq++;
    const names = pluginMarketUpdateCandidates.map((plugin) => plugin.name);
    const updateAllBtn = document.getElementById('plugin-market-update-all-btn');
    if (updateAllBtn) {
        updateAllBtn.disabled = true;
        updateAllBtn.textContent = '⏳ 批量更新中...';
    }

    try {
        const response = await fetch('/api/market/plugins/update-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugin_names: names })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            showSuccess(result.message || '插件已全部更新');
        } else {
            showError(result.message || result.error || '部分插件更新失败');
        }
        setTimeout(() => refreshPluginMarket(), 500);
    } catch (error) {
        showError('批量更新时出错：' + error.message);
    } finally {
        if (updateAllBtn) {
            updateAllBtn.disabled = false;
            updateAllBtn.textContent = '⬆ 全部更新';
        }
    }
}

// 恢复安装按钮状态
function restoreInstallButton(pluginName, text) {
    const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
    if (card) {
        const btn = card.querySelector('.market-action-btn');
        btn.disabled = false;
        btn.textContent = text;
        btn.classList.remove('btn-installing');
    }
    const progressDiv = document.getElementById(`progress-${pluginName}`);
    if (progressDiv) progressDiv.style.display = 'none';
}

// Poll the durable install task so asynchronous failures surface immediately.
async function pollPluginInstalled(pluginName) {
    const maxAttempts = 180;
    let attempts = 0;

    const poll = async () => {
        try {
            const response = await fetch(
                `/api/market/plugins/install-status/${encodeURIComponent(pluginName)}`
            );
            const data = await response.json();

            const progressDiv = document.getElementById(`progress-${pluginName}`);
            const progressFill = progressDiv ? progressDiv.querySelector('.progress-fill') : null;
            const progressText = progressDiv ? progressDiv.querySelector('.progress-text') : null;

            if (!response.ok || data.success === false) {
                throw new Error(data.error || '无法读取安装状态');
            }

            if (data.status === 'failed') {
                const errorMessage = data.error || '未知错误';
                if (progressText) progressText.textContent = '安装失败';
                showError('安装失败：' + errorMessage);
                restoreInstallButton(pluginName, '⬇ 安装');
                return;
            }

            if (data.status === 'completed' || data.installed) {
                if (progressFill) progressFill.style.width = '100%';
                if (progressText) progressText.textContent = '✓ 安装完成';
                setTimeout(() => refreshPluginMarket(), 500);
                return;
            }

            if (progressFill) {
                const progress = Number(data.progress);
                progressFill.style.width = (
                    Number.isFinite(progress) ? Math.max(0, Math.min(99, progress)) : 0
                ) + '%';
            }
            if (progressText) {
                const labels = {
                    queued: '等待安装...',
                    downloading: '正在下载...',
                    extracting: '正在解压...',
                    installing_deps: '正在安装依赖...'
                };
                progressText.textContent = labels[data.status] || '正在安装...';
            }

            if (!data.installing && !data.status) {
                showError('安装任务已丢失，请重试');
                restoreInstallButton(pluginName, '⬇ 安装');
                return;
            }

            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
                if (progressText) progressText.textContent = '安装超时，请重试';
                restoreInstallButton(pluginName, '⬇ 安装');
            }
        } catch (error) {
            console.error('轮询安装状态失败:', error);
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
                showError('读取安装状态失败：' + error.message);
                restoreInstallButton(pluginName, '⬇ 安装');
            }
        }
    };

    poll();
}

// ============ 初始化 ============

// 加载所有配置（页面启动时同步 config.json 状态）
async function loadAllSettings() {
    try { await loadConfigs(); } catch (e) { console.error('loadConfigs 失败:', e); }
    try { await loadLLMConfig(); } catch (e) { console.error('loadLLMConfig 失败:', e); }
    try { await loadPersonaSettings(); } catch (e) { console.error('loadPersonaSettings 失败:', e); }
    try { await loadBasicConfig(); } catch (e) { console.error('loadBasicConfig 失败:', e); }
    try { await loadDialogConfig(); } catch (e) { console.error('loadDialogConfig 失败:', e); }
    try { await loadCloudSettings(); } catch (e) { console.error('loadCloudSettings 失败:', e); }
    try { await loadUISettings(); } catch (e) { console.error('loadUISettings 失败:', e); }
    try { await initLive2dPreviewWorkbench(); } catch (e) { console.error('initLive2dPreviewWorkbench 失败:', e); }
}

// ============ Live2D 动作管理 ============

// 切换 UI 设置子选项卡
function switchUISubTab(tab) {
    // 更新选项卡按钮状态
    document.querySelectorAll('#ui-settings .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    const targetButton = (typeof event !== 'undefined' && event?.target)
        ? event.target
        : document.querySelector(`#ui-settings .sub-tab-button[onclick="switchUISubTab('${tab}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }

    // 更新面板显示
    document.querySelectorAll('#ui-settings .ui-sub-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(tab + '-sub-panel').classList.add('active');

    // 根据选项卡加载内容
    if (tab === 'ui') {
        // 切换到 UI 设置时加载模型列表
        refreshModelList();
    } else if (tab === 'expression') {
        // 切换到表情选项卡时加载表情配置
        initLive2dPreviewWorkbench();
        loadExpressionConfig();
    } else if (tab === 'motion') {
        // 切换到动作选项卡时加载所有动作（已分类 + 未分类）
        initLive2dPreviewWorkbench();
        loadAllMotions();
    }
}

// 开始唱歌
// ============ Live2D preview workbench ============

let live2dPreviewState = {
    app: null,
    model: null,
    info: null,
    loadedPath: '',
    loading: null
};

function live2dAssetUrl(path) {
    if (!path) return '';
    const clean = String(path).replace(/^\/+/, '');
    return '/live-2d/' + clean;
}

function setLive2dPreviewStatus(message) {
    const el = document.getElementById('live2d-preview-status');
    if (el) el.textContent = message || '';
}

function getLive2dPreviewResolution() {
    const dpr = Number(window.devicePixelRatio || 1);
    return Math.max(1, Math.min(dpr, 2.5));
}

function renderLive2dPreviewFrame() {
    try {
        live2dPreviewState.app?.render?.();
        requestAnimationFrame(() => {
            try {
                live2dPreviewState.app?.render?.();
            } catch (_) {}
        });
    } catch (_) {}
}

function createLive2dPreviewExpressionManager(model, definitions) {
    const motionManager = model?.internalModel?.motionManager;
    const settings = model?.internalModel?.settings;
    if (!motionManager || !settings || !window.PIXI?.live2d?.Cubism4ExpressionManager) {
        return null;
    }

    settings.expressions = definitions;
    settings.resolveURL = settings.resolveURL || function(url) {
        return url;
    };

    try {
        return new PIXI.live2d.Cubism4ExpressionManager(settings, {
            autoFocus: false,
            autoHitTest: false
        });
    } catch (error) {
        console.warn('Failed to create Live2D preview expression manager', error);
        return null;
    }
}

function syncLive2dPreviewDefinitions(model, info) {
    const motionManager = model?.internalModel?.motionManager;
    if (!motionManager || !info) return;

    motionManager.definitions = motionManager.definitions || {};
    motionManager.motionGroups = motionManager.motionGroups || {};
    for (const [group, items] of Object.entries(info.motion_groups || {})) {
        motionManager.definitions[group] = (items || []).map(item => ({
            File: item.file,
            FadeInTime: item.fade_in_time || 0,
            FadeOutTime: item.fade_out_time || 0
        }));
        motionManager.motionGroups[group] = motionManager.motionGroups[group] || [];
    }

    const expressionDefinitions = (info.expressions || []).map(item => ({
        Name: item.name || String(item.file || '').split('/').pop()?.replace(/\.exp3\.json$/i, ''),
        File: item.file
    }));
    let expressionManager = motionManager.expressionManager;
    if (!expressionManager && expressionDefinitions.length) {
        expressionManager = createLive2dPreviewExpressionManager(model, expressionDefinitions);
        if (expressionManager) {
            motionManager.expressionManager = expressionManager;
        }
    }
    if (expressionManager) {
        expressionManager.definitions = expressionDefinitions;
        expressionManager.expressions = expressionManager.expressions || [];
    } else if (info.expressions?.length) {
        console.warn('Live2D expression manager is not available for preview injection');
    }
}

function fitLive2dPreviewModel() {
    const stage = document.querySelector('.live2d-preview-stage');
    const model = live2dPreviewState.model;
    if (!stage || !model) return;

    const width = stage.clientWidth || 420;
    const height = stage.clientHeight || 420;
    if (live2dPreviewState.app?.renderer) {
        live2dPreviewState.app.renderer.resolution = getLive2dPreviewResolution();
        live2dPreviewState.app.renderer.resize(width, height);
    }

    const originalWidth = model.internalModel?.width || model.width || 1;
    const originalHeight = model.internalModel?.height || model.height || 1;
    if (model.anchor?.set) {
        model.anchor.set(0.5, 0.5);
    }
    const scale = Math.min(width / originalWidth, height / originalHeight) * 0.88;
    model.scale.set(Math.max(0.02, scale));
    model.x = width / 2;
    model.y = height / 2;
    renderLive2dPreviewFrame();
}

async function ensureLive2dPreviewInfo(force = false) {
    if (live2dPreviewState.info && !force) return live2dPreviewState.info;
    const response = await fetch('/api/live2d/preview/info');
    const info = await response.json();
    if (!(response.ok && info.success)) {
        throw new Error(info.error || 'Failed to load Live2D preview info');
    }
    live2dPreviewState.info = info;
    renderLive2dPreviewMeta(info);
    return info;
}

function renderLive2dPreviewMeta(info) {
    const meta = document.getElementById('live2d-preview-meta');
    if (meta) {
        const source = info.using_sidecar ? '独立配置' : '旧版兼容';
        meta.textContent = `当前模型：${info.model_name || '-'}（${source}）`;
    }

    const select = document.getElementById('live2d-idle-group-select');
    if (select) {
        const groups = Object.keys(info.motion_groups || {});
        select.innerHTML = '';
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '无（仅模型呼吸）';
        select.appendChild(noneOption);
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group;
            select.appendChild(option);
        });
        select.value = info.idle?.group || '';
    }

    const expressionSelect = document.getElementById('live2d-idle-expression-select');
    if (expressionSelect) {
        expressionSelect.innerHTML = '';
        const noneOption = document.createElement('option');
        noneOption.value = '';
        noneOption.textContent = '无';
        expressionSelect.appendChild(noneOption);
        (info.expressions || []).forEach(item => {
            const option = document.createElement('option');
            option.value = item.file || '';
            option.textContent = item.name || item.file || '';
            expressionSelect.appendChild(option);
        });
        expressionSelect.value = info.idle?.expression || '';
    }

    const hint = document.getElementById('live2d-preview-hint');
    if (hint) {
        const idleFile = info.idle?.file || '无';
        const idleExpression = info.idle?.expression || '无';
        const idleGroup = info.idle?.group || '无';
        hint.textContent = `待机动作：${idleGroup} / ${idleFile}。待机表情：${idleExpression}。同一个情绪可以同时绑定动作和表情。`;
    }
}

async function ensureLive2dPreviewModel(force = false) {
    if (live2dPreviewState.loading && !force) return live2dPreviewState.loading;

    live2dPreviewState.loading = (async () => {
        const info = await ensureLive2dPreviewInfo(force);
        if (!info.model_path) throw new Error('当前 Live2D 模型缺少 model3.json');
        if (!window.PIXI?.live2d?.Live2DModel) {
            throw new Error('Live2D 预览运行时不可用');
        }

        const modelUrl = live2dAssetUrl(info.model_path);
        if (!live2dPreviewState.app) {
            const stage = document.querySelector('.live2d-preview-stage');
            const canvas = document.getElementById('live2d-preview-canvas');
            const width = stage?.clientWidth || 420;
            const height = stage?.clientHeight || 420;
            live2dPreviewState.app = new PIXI.Application({
                view: canvas,
                width,
                height,
                autoStart: true,
                backgroundAlpha: 0,
                antialias: true,
                preserveDrawingBuffer: true,
                autoDensity: true,
                resolution: getLive2dPreviewResolution(),
                powerPreference: 'high-performance'
            });
            window.addEventListener('resize', fitLive2dPreviewModel);
        }

        if (live2dPreviewState.model && live2dPreviewState.loadedPath === modelUrl && !force) {
            fitLive2dPreviewModel();
            return live2dPreviewState.model;
        }

        setLive2dPreviewStatus('正在加载预览模型...');
        if (live2dPreviewState.model) {
            try {
                live2dPreviewState.app.stage.removeChild(live2dPreviewState.model);
                live2dPreviewState.model.destroy({ children: true, texture: true, baseTexture: true });
            } catch (_) {}
            live2dPreviewState.model = null;
        }

        const model = await PIXI.live2d.Live2DModel.from(modelUrl, {
            autoFocus: false,
            autoHitTest: false
        });
        syncLive2dPreviewDefinitions(model, info);
        live2dPreviewState.app.stage.addChild(model);
        live2dPreviewState.model = model;
        live2dPreviewState.loadedPath = modelUrl;
        fitLive2dPreviewModel();
        setLive2dPreviewStatus(`预览已就绪：${info.model_name || ''}`);
        renderLive2dPreviewFrame();
        return model;
    })();

    try {
        return await live2dPreviewState.loading;
    } finally {
        live2dPreviewState.loading = null;
    }
}

function findLive2dMotionRef(filePath, preferredGroup) {
    const groups = live2dPreviewState.info?.motion_groups || {};
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (preferredGroup && groups[preferredGroup]) {
        const index = groups[preferredGroup].findIndex(item => item.file === normalized);
        if (index >= 0) return { group: preferredGroup, index };
    }
    for (const [group, items] of Object.entries(groups)) {
        const index = items.findIndex(item => item.file === normalized);
        if (index >= 0) return { group, index };
    }
    return null;
}

async function playPreviewMotionFile(filePath, preferredGroup) {
    try {
        const model = await ensureLive2dPreviewModel();
        const ref = findLive2dMotionRef(filePath, preferredGroup);
        if (!ref) throw new Error(`模型中找不到动作文件：${filePath}`);
        if (model.internalModel?.motionManager) {
            model.internalModel.motionManager.stopAllMotions();
        }
        model.motion(ref.group, ref.index);
        setLive2dPreviewStatus(`动作：${ref.group}[${ref.index}] ${filePath}`);
        renderLive2dPreviewFrame();
    } catch (error) {
        setLive2dPreviewStatus(error.message);
        showError('预览失败：' + error.message);
    }
}

async function playPreviewExpressionFile(filePath) {
    try {
        const model = await ensureLive2dPreviewModel();
        const fileName = String(filePath || '').split('/').pop() || '';
        const expressionName = fileName.replace(/\.exp3\.json$/i, '');
        if (!expressionName) throw new Error('表情文件为空');
        model.expression(expressionName);
        setLive2dPreviewStatus(`表情：${expressionName}`);
        renderLive2dPreviewFrame();
    } catch (error) {
        setLive2dPreviewStatus(error.message);
        showError('预览失败：' + error.message);
    }
}

function live2dExpressionNameFromFile(filePath) {
    const fileName = String(filePath || '').split('/').pop() || '';
    return fileName.replace(/\.exp3\.json$/i, '');
}

function resetLive2dPreviewExpression() {
    try {
        const expressionManager = live2dPreviewState.model?.internalModel?.motionManager?.expressionManager;
        if (expressionManager && typeof expressionManager.resetExpression === 'function') {
            expressionManager.resetExpression();
            renderLive2dPreviewFrame();
            return true;
        }
    } catch (error) {
        console.warn('Failed to reset Live2D preview expression', error);
    }
    return false;
}

async function initLive2dPreviewWorkbench(force = false) {
    const workbench = document.getElementById('live2d-preview-workbench');
    if (!workbench || workbench.offsetParent === null) {
        return;
    }
    try {
        await ensureLive2dPreviewInfo(force);
        await ensureLive2dPreviewModel(force);
    } catch (error) {
        setLive2dPreviewStatus(error.message);
        console.error('Live2D preview init failed:', error);
    }
}

async function previewSelectedIdleMotion() {
    try {
        const info = await ensureLive2dPreviewInfo();
        const select = document.getElementById('live2d-idle-group-select');
        const expressionSelect = document.getElementById('live2d-idle-expression-select');
        const group = select ? select.value : (info.idle?.group ?? 'Idle');
        const expression = expressionSelect?.value || '';
        const item = (info.motion_groups?.[group] || [])[0];
        if (group) {
            if (!item) throw new Error(`待机动作组没有可预览动作：${group}`);
            await playPreviewMotionFile(item.file, group);
        } else {
            const model = await ensureLive2dPreviewModel();
            model.internalModel?.motionManager?.stopAllMotions?.();
            setLive2dPreviewStatus('待机动作：无（仅模型呼吸）');
            renderLive2dPreviewFrame();
        }
        if (expression) {
            await playPreviewExpressionFile(expression);
            setLive2dPreviewStatus(`待机：${group || '无'} / ${item?.file || '仅模型呼吸'} + ${live2dExpressionNameFromFile(expression)}`);
        } else {
            resetLive2dPreviewExpression();
        }
    } catch (error) {
        showError('待机预览失败：' + error.message);
    }
}

async function saveIdleMotionGroup() {
    try {
        const select = document.getElementById('live2d-idle-group-select');
        const expressionSelect = document.getElementById('live2d-idle-expression-select');
        const group = select?.value || '';
        const expression = expressionSelect?.value || '';
        const response = await fetch('/api/live2d/idle/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group, expression })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            throw new Error(result.error || '保存待机设置失败');
        }
        await ensureLive2dPreviewInfo(true);
        showSuccess('待机设置已保存');
    } catch (error) {
        showError('保存待机设置失败：' + error.message);
    }
}

async function startSinging() {
    try {
        const response = await fetch('/api/live2d/singing/start', { method: 'POST' });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError('启动失败：' + (result.error || '未知错误'));
        } else {
            showSuccess('开始唱歌');
        }
    } catch (error) {
        showError('启动时出错：' + error.message);
    }
}

// 停止唱歌
async function stopSinging() {
    try {
        const response = await fetch('/api/live2d/singing/stop', { method: 'POST' });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError('停止失败：' + (result.error || '未知错误'));
        } else {
            showSuccess('停止唱歌');
        }
    } catch (error) {
        showError('停止时出错：' + error.message);
    }
}

// 一键复位
async function resetMotion() {
    try {
        const response = await fetch('/api/live2d/motion/reset', { method: 'POST' });
        
        // 检查响应类型
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            // 返回的不是 JSON，可能是 HTML 错误页面
            const text = await response.text();
            throw new Error('服务器返回了非 JSON 响应，可能是路由冲突或服务器错误');
        }
        
        const result = await response.json();
        if (response.ok && result.success) {
            showSuccess('动作配置已还原');
            // 重新加载配置
            await loadAllMotions();
        } else {
            showError('复位失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        showError('复位时出错：' + error.message);
    }
}

// 添加动作到分类
function addMotionToCategory(btn) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.motion3.json,.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const actionsContainer = btn.previousElementSibling;
            const emptyTip = actionsContainer.querySelector('.empty-tip');
            if (emptyTip) {
                emptyTip.remove();
            }
            
            const motionItem = document.createElement('div');
            motionItem.className = 'motion-item';
            motionItem.innerHTML = `
                <span>${file.name}</span>
                <div>
                    <button onclick="previewMotion(this)" class="btn-sm">预览</button>
                    <button onclick="removeMotion(this)" class="btn-sm">删除</button>
                </div>
            `;
            actionsContainer.appendChild(motionItem);
        }
    };
    input.click();
}

// 预览动作
async function previewMotion(btn) {
    const motionItem = btn.closest('.motion-item');
    const motionName = motionItem.querySelector('span').textContent;
    await playPreviewMotionFile(motionKeyToPath[motionName] || motionName);
}

// 删除动作
function removeMotion(btn) {
    const motionItem = btn.closest('.motion-item');
    const actionsContainer = motionItem.parentElement;
    motionItem.remove();
    
    if (actionsContainer.children.length === 0) {
        actionsContainer.innerHTML = '<div class="empty-tip">点击"+添加动作"选择动作文件</div>';
    }
}

// 加载未分类动作（可用动作列表）- 从 emotion_actions.json 读取
async function loadUncategorizedMotions() {
    try {
        const response = await fetch('/api/live2d/motions/uncategorized');
        if (response.ok) {
            const data = await response.json();
            // data.motions 现在是映射对象：{"动作 1": "motions/xxx.json", ...}
            renderAvailableMotions(data.motions || {});
        }
    } catch (error) {
        console.error('加载未分类动作失败:', error);
    }
}

// 渲染可用动作列表 - 显示键名，拖拽时传输文件路径
function renderAvailableMotions(motionMap) {
    const container = document.getElementById('available-motions');
    if (!container) return;

    container.innerHTML = '';

    const motionKeys = Object.keys(motionMap);
    if (motionKeys.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无可用动作</div>';
        return;
    }

    motionKeys.forEach(motionKey => {
        const filePath = motionMap[motionKey];  // 获取文件路径
        const btn = document.createElement('button');
        btn.className = 'motion-button';
        btn.textContent = motionKey;  // 显示键名（如"动作 1"）
        btn.draggable = true;
        btn.dataset.motionKey = motionKey;  // 存储键名
        btn.dataset.filePath = filePath;    // 存储文件路径

        // 点击预览 - 使用文件路径预览
        btn.onclick = () => previewMotionFromList(motionKey);

        // 拖拽开始 - 传输文件路径（用于绑定）
        btn.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', motionKey);
            e.dataTransfer.setData('application/motion', motionKey);
            e.dataTransfer.setData('application/motion-path', filePath);
        };

        container.appendChild(btn);
    });
}

// 动作配置缓存（存储键名到文件路径的映射）
let motionKeyToPath = {};
let motionPathToKey = {};
// 动作配置（存储情绪分类的动作列表）
let motionConfig = {};
// 情绪分类列表
const EMOTION_CATEGORIES = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];

// 加载已分类动作到情绪分类区域 - 显示键名而不是文件路径
async function loadCategorizedMotions() {
    try {
        const response = await fetch('/api/live2d/motions/categorized');
        if (!response.ok) {
            console.error('加载已分类动作失败:', response.status);
            return;
        }

        const data = await response.json();
        const categorized = data.categorized || {};

        // 初始化 motionConfig（用于保存）
        motionConfig = {};
        for (const [emotion, files] of Object.entries(categorized)) {
            motionConfig[emotion] = Array.isArray(files) ? files : [];
        }

        // 构建键名到文件路径的映射
        motionKeyToPath = {};
        motionPathToKey = {};

        // 1. 先从已分类动作中构建情绪分类的映射（用于显示）
        for (const [emotion, files] of Object.entries(categorized)) {
            if (Array.isArray(files)) {
                for (const filePath of files) {
                    // 情绪分类也加入映射，但不作为自定义键名
                    motionPathToKey[filePath] = emotion;
                }
            }
        }

        // 2. 从未分类动作中获取自定义键名映射（关键修复）
        try {
            const uncategorizedResp = await fetch('/api/live2d/motions/uncategorized');
            if (uncategorizedResp.ok) {
                const uncategorizedData = await uncategorizedResp.json();
                const motionMap = uncategorizedData.motions || {};
                // motionMap 格式：{"动作 1": "motions/xxx.json", "动作 2": "motions/yyy.json"}
                for (const [key, filePath] of Object.entries(motionMap)) {
                    motionKeyToPath[key] = filePath;
                    motionPathToKey[filePath] = key;  // 覆盖情绪分类的映射
                }
            }
        } catch (e) {
            console.warn('加载未分类动作失败，仅使用已分类映射:', e);
        }

        // 情绪名称映射（中文到英文）
        const emotionMap = {
            '开心': 'happy',
            '生气': 'angry',
            '难过': 'sad',
            '惊讶': 'surprised',
            '害羞': 'shy',
            '俏皮': 'playful'
        };

        // 遍历每个情绪分类
        for (const [emotionName, motionFiles] of Object.entries(categorized)) {
            const englishEmotion = emotionMap[emotionName] || emotionName;
            const container = document.querySelector(`.emotion-category-actions[data-emotion="${englishEmotion}"]`);

            if (container) {
                container.innerHTML = '';
                if (motionFiles && motionFiles.length > 0) {
                    motionFiles.forEach(motionFile => {
                        // 查找文件路径对应的键名
                        const motionKey = motionPathToKey[motionFile];
                        // 如果键名是情绪分类名或不存在，使用文件名的友好显示
                        let displayName;
                        if (!motionKey || EMOTION_CATEGORIES.includes(motionKey)) {
                            displayName = getMotionDisplayName(motionFile);
                        } else {
                            displayName = motionKey;  // 使用自定义键名（如"动作 1"）
                        }
                        const item = createMotionBindingItem(englishEmotion, motionFile, displayName);
                        container.appendChild(item);
                    });
                } else {
                    container.innerHTML = '<div class="empty-tip">拖拽动作到此绑定</div>';
                }
            }
        }

        // 设置拖放区域
        setupMotionDropZones();
    } catch (error) {
        console.error('加载已分类动作失败:', error);
    }
}

// 根据文件路径查找对应的动作键名
function findMotionKeyByFile(filePath) {
    // 直接从映射中查找
    return motionPathToKey[filePath] || null;
}

// 从文件路径获取显示名称
function getMotionDisplayName(filePath) {
    let name = filePath;
    if (name.includes('/')) {
        name = name.split('/').pop();
    }
    if (name.endsWith('.motion3.json')) {
        name = name.replace('.motion3.json', '');
    }
    return name;
}

// 创建动作绑定项 - 显示键名
function createMotionBindingItem(emotion, filePath, displayName) {
    const item = document.createElement('div');
    item.className = 'motion-binding-item';

    // 使用完整路径进行预览和删除
    const escapedFilePath = filePath.replace(/'/g, "\\'");
    const escapedEmotion = emotion.replace(/'/g, "\\'");

    item.innerHTML = `
        <span data-file-path="${escapedFilePath}">${displayName}</span>
        <div>
            <button onclick="previewMotionByPath('${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">预览</button>
            <button onclick="removeMotionBinding('${escapedEmotion}', '${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">删除</button>
        </div>
    `;
    return item;
}

// 设置动作拖放区域
function setupMotionDropZones() {
    const dropZones = document.querySelectorAll('.emotion-category-actions');

    dropZones.forEach(zone => {
        zone.ondragover = (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        };

        zone.ondragleave = () => {
            zone.classList.remove('drag-over');
        };

        zone.ondrop = (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            // 优先获取文件路径，如果没有则使用键名
            const filePath = e.dataTransfer.getData('application/motion-path');
            const motionKey = e.dataTransfer.getData('application/motion') ||
                              e.dataTransfer.getData('text/plain');
            const emotion = zone.dataset.emotion;

            if (emotion) {
                // 传递文件路径和键名
                bindMotionToEmotion(emotion, motionKey, filePath);
            }
        };
    });
}

// 绑定动作到情绪 - 保存文件路径到情绪分类
async function bindMotionToEmotion(emotion, motionKey, filePath) {
    // motionKey 是配置中的键名（如"动作 1"）
    // filePath 是文件路径（如"motions/hiyori_m01.motion3.json"）
    
    // 如果没有传入 filePath，尝试从映射中获取
    if (!filePath && motionKey) {
        filePath = motionKeyToPath[motionKey] || getMotionFilePathByKey(motionKey);
    }

    // 情绪名称映射（英文到中文）
    const emotionMapReverse = {
        'happy': '开心',
        'angry': '生气',
        'sad': '难过',
        'surprised': '惊讶',
        'shy': '害羞',
        'playful': '俏皮'
    };

    const chineseEmotion = emotionMapReverse[emotion] || emotion;

    // 初始化该情绪的动作数组
    if (!motionConfig[chineseEmotion]) {
        motionConfig[chineseEmotion] = [];
    }

    // 检查是否已存在（检查文件路径）
    if (motionConfig[chineseEmotion].includes(filePath)) {
        showWarning('该动作已绑定到此情绪');
        return;
    }

    // 添加动作（使用文件路径）
    motionConfig[chineseEmotion].push(filePath);

    // 更新 UI - 使用 data-file-path 属性匹配 - 显示键名
    const container = document.querySelector(`.emotion-category-actions[data-emotion="${emotion}"]`);
    if (container) {
        const emptyTip = container.querySelector('.empty-tip');
        if (emptyTip) {
            emptyTip.remove();
        }

        const item = createMotionBindingItem(emotion, filePath, motionKey);
        container.appendChild(item);
    }

    // 自动保存配置
    await saveMotionConfigSilent();

    addLog(`已将动作 "${motionKey}" 绑定到 ${chineseEmotion}`, 'success', 'system');
}

// 根据键名获取文件路径
function getMotionFilePathByKey(motionKey) {
    // 遍历配置查找文件路径
    for (const [key, value] of Object.entries(motionConfig)) {
        if (key === motionKey && Array.isArray(value) && value.length > 0) {
            return value[0];
        }
    }
    // 如果找不到，返回默认格式
    return 'motions/' + motionKey + '.motion3.json';
}

// 删除动作绑定
async function removeMotionBinding(emotion, filePath) {
    // 情绪名称映射（英文到中文）
    const emotionMapReverse = {
        'happy': '开心',
        'angry': '生气',
        'sad': '难过',
        'surprised': '惊讶',
        'shy': '害羞',
        'playful': '俏皮'
    };
    
    const chineseEmotion = emotionMapReverse[emotion] || emotion;
    
    if (motionConfig[chineseEmotion]) {
        const index = motionConfig[chineseEmotion].indexOf(filePath);
        if (index > -1) {
            motionConfig[chineseEmotion].splice(index, 1);
            
            // 更新UI
            const container = document.querySelector(`.emotion-category-actions[data-emotion="${emotion}"]`);
            if (container) {
                const items = container.querySelectorAll('.motion-binding-item');
                items.forEach(item => {
                    if (item.querySelector('span').dataset.filePath === filePath) {
                        item.remove();
                    }
                });
                
                // 如果没有动作了，显示空提示
                if (container.children.length === 0) {
                    container.innerHTML = '<div class="empty-tip">拖拽动作到此绑定</div>';
                }
            }

            // 自动保存配置
            await saveMotionConfigSilent();
            
            addLog(`已移除动作 "${filePath}" 从 ${chineseEmotion}`, 'info', 'system');
        }
    }
}

// 加载所有动作（已分类 + 未分类）
async function loadAllMotions() {
    await Promise.all([
        loadCategorizedMotions(),
        loadUncategorizedMotions()
    ]);
}

// 预览动作（通过文件路径）
async function previewMotionByPath(filePath) {
    await playPreviewMotionFile(filePath);
}

// 预览列表中的动作（通过键名）
async function previewMotionFromList(motionKey) {
    try {
        // 优先从 motionKeyToPath 映射中获取文件路径
        let filePath = motionKeyToPath[motionKey];
        
        // 如果映射中没有，再从 motionConfig 中查找
        if (!filePath) {
            filePath = getMotionFilePathByKey(motionKey);
        }

        await playPreviewMotionFile(filePath);
    } catch (error) {
        showError('预览时出错：' + error.message);
    }
}

// 预览动作（通过键名，如"动作 1"）
async function previewMotionByKey(motionKey) {
    try {
        // 从配置中查找键名对应的文件路径
        const filePath = getMotionFilePathByKey(motionKey);
        await playPreviewMotionFile(filePath);
    } catch (error) {
        showError('预览时出错：' + error.message);
    }
}

// 保存动作配置
async function saveMotionConfig() {
    try {
        const categories = [];
        document.querySelectorAll('#emotion-categories-grid .emotion-category').forEach(category => {
            const nameEl = category.querySelector('.emotion-category-header span');
            const name = nameEl ? nameEl.textContent.replace(/[😊😠😢😲😳😜]\s*/, '') : '未命名';

            const actionsEl = category.querySelector('.emotion-category-actions');
            const emotion = actionsEl ? actionsEl.dataset.emotion : 'unknown';

            const motions = [];
            actionsEl.querySelectorAll('.motion-item').forEach(item => {
                motions.push(item.querySelector('span').textContent);
            });

            categories.push({ name, emotion, motions });
        });

        const response = await fetch('/api/live2d/motions/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            addLog('动作配置已保存', 'success', 'system');
            showSuccess('动作配置已保存');
            await ensureLive2dPreviewInfo(true);
        } else {
            showError('保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        showError('保存时出错：' + error.message);
    }
}

// 静默保存动作配置（用于拖拽绑定时自动保存）
async function saveMotionConfigSilent() {
    try {
        // 情绪名称映射（中文到英文）
        const emotionMap = {
            '开心': 'happy',
            '生气': 'angry',
            '难过': 'sad',
            '惊讶': 'surprised',
            '害羞': 'shy',
            '俏皮': 'playful'
        };

        const categories = [];
        for (const [emotionName, motions] of Object.entries(motionConfig)) {
            const englishEmotion = emotionMap[emotionName] || emotionName;
            categories.push({
                name: emotionName,
                emotion: englishEmotion,
                motions: motions
            });
        }

        await fetch('/api/live2d/motions/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories })
        });
        await ensureLive2dPreviewInfo(true);
    } catch (error) {
        console.error('静默保存动作配置失败:', error);
    }
}

// ============ Live2D 表情管理 ============

// 表情配置缓存
let expressionConfig = {};
// 表情键名到文件路径的映射
let expressionKeyToPath = {};
let expressionPathToKey = {};

// 加载表情配置
async function loadExpressionConfig() {
    try {
        const response = await fetch('/api/live2d/expressions/config');
        if (response.ok) {
            const data = await response.json();
            const expressions = data.expressions || {};
            
            // 初始化 expressionConfig
            expressionConfig = {};
            for (const [emotion, files] of Object.entries(expressions)) {
                expressionConfig[emotion] = Array.isArray(files) ? files : [];
            }
            
            // 构建表情键名到文件路径的映射
            expressionKeyToPath = {};
            expressionPathToKey = {};
            
            // 从可用表情中获取自定义键名映射
            const availableExpressions = data.available_expressions || {};
            // availableExpressions 格式：{"表情 1": "expressions/xxx.exp3.json", ...}
            for (const [key, filePath] of Object.entries(availableExpressions)) {
                expressionKeyToPath[key] = filePath;
                expressionPathToKey[filePath] = key;
            }
            
            renderExpressionConfigWithMapping(expressionConfig);
            renderAvailableExpressions(availableExpressions);
        }
    } catch (error) {
        console.error('加载表情配置失败:', error);
        document.getElementById('available-expressions').innerHTML =
            '<div class="empty-tip">加载表情失败</div>';
    }
}

// 表情分类列表
const EXPRESSION_CATEGORIES = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];

// 渲染表情配置 - 使用映射显示键名
function renderExpressionConfigWithMapping(config) {
    const emotions = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];

    emotions.forEach(emotion => {
        const container = document.querySelector(`.emotion-expression-actions[data-emotion="${emotion}"]`);
        if (!container) return;

        // 清空现有内容
        container.innerHTML = '';

        const expressionFiles = config[emotion] || [];
        if (expressionFiles.length > 0) {
            expressionFiles.forEach(exprFile => {
                // 查找文件路径对应的键名
                const exprKey = expressionPathToKey[exprFile];
                // 如果键名是情绪分类名或不存在，使用文件名的友好显示
                let displayName;
                if (!exprKey || EXPRESSION_CATEGORIES.includes(exprKey)) {
                    displayName = getExpressionDisplayName(exprFile);
                } else {
                    displayName = exprKey;  // 使用自定义键名（如"表情 1"）
                }

                const item = createExpressionBindingItem(emotion, exprFile, displayName);
                container.appendChild(item);
            });
        } else {
            container.innerHTML = '<div class="empty-tip">拖拽表情到此绑定</div>';
        }
    });
}

// 从文件路径获取显示名称
function getExpressionDisplayName(filePath) {
    let name = filePath;
    if (name.includes('/')) {
        name = name.split('/').pop();
    }
    if (name.endsWith('.exp3.json')) {
        name = name.replace('.exp3.json', '');
    }
    // 将 expression1, expression2 转换为 表情 1, 表情 2
    if (name.startsWith('expression')) {
        const num = name.replace('expression', '');
        if (!isNaN(parseInt(num))) {
            name = '表情' + num;
        }
    }
    return name;
}

// 创建表情绑定项 - 使用传入的 displayName 参数
function createExpressionBindingItem(emotion, filePath, displayName) {
    const item = document.createElement('div');
    item.className = 'expression-binding-item';

    // 使用完整路径进行删除和预览
    const escapedFilePath = filePath.replace(/'/g, "\\'");
    const escapedEmotion = emotion.replace(/'/g, "\\'");

    item.innerHTML = `
        <span data-file-path="${escapedFilePath}">${displayName}</span>
        <div>
            <button onclick="previewExpressionFromBinding('${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">预览</button>
            <button onclick="removeExpressionBinding('${escapedEmotion}', '${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">删除</button>
        </div>
    `;
    return item;
}

// 预览绑定区域中的表情（通过文件路径）
async function previewExpressionFromBinding(filePath) {
    await playPreviewExpressionFile(filePath);
}

// 渲染可用表情列表 - 显示键名，拖拽时传输文件路径
function renderAvailableExpressions(expressionMap) {
    const container = document.getElementById('available-expressions');
    if (!container) return;

    container.innerHTML = '';

    const exprKeys = Object.keys(expressionMap);
    if (exprKeys.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无可用表情</div>';
        return;
    }

    exprKeys.forEach(exprKey => {
        const filePath = expressionMap[exprKey];  // 获取文件路径
        const btn = document.createElement('button');
        btn.className = 'expression-button';
        btn.textContent = exprKey;  // 显示键名（如"表情 1"）
        btn.draggable = true;
        btn.dataset.expressionKey = exprKey;  // 存储键名
        btn.dataset.filePath = filePath;      // 存储文件路径

        // 点击预览 - 使用键名预览
        btn.onclick = () => previewExpressionByKey(exprKey);

        // 拖拽开始 - 传输文件路径（用于绑定）
        btn.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', exprKey);
            e.dataTransfer.setData('application/expression', exprKey);
            e.dataTransfer.setData('application/expression-path', filePath);
        };

        container.appendChild(btn);
    });

    // 设置拖放区域
    setupExpressionDropZones();
}

// 设置表情拖放区域
function setupExpressionDropZones() {
    const dropZones = document.querySelectorAll('.emotion-expression-actions');

    dropZones.forEach(zone => {
        zone.ondragover = (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        };

        zone.ondragleave = () => {
            zone.classList.remove('drag-over');
        };

        zone.ondrop = (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            // 优先获取文件路径，如果没有则使用键名
            const filePath = e.dataTransfer.getData('application/expression-path');
            const expressionKey = e.dataTransfer.getData('application/expression') ||
                                  e.dataTransfer.getData('text/plain');
            const emotion = zone.dataset.emotion;

            if (emotion) {
                // 传递文件路径和键名
                bindExpressionToEmotion(emotion, expressionKey, filePath);
            }
        };
    });
}

// 绑定表情到情绪 - 保存文件路径到情绪分类
async function bindExpressionToEmotion(emotion, expressionKey, filePath) {
    // expressionKey 是配置中的键名（如"表情 2"）
    // filePath 是文件路径（如"expressions/xxx.exp3.json"）
    
    // 如果没有传入 filePath，尝试从映射中获取
    if (!filePath && expressionKey) {
        filePath = expressionKeyToPath[expressionKey] || getExpressionFilePathByKey(expressionKey);
    }

    // 初始化该情绪的表情数组
    if (!expressionConfig[emotion]) {
        expressionConfig[emotion] = [];
    }

    // 检查是否已存在（检查文件路径）
    if (expressionConfig[emotion].includes(filePath)) {
        showWarning('该表情已绑定到此情绪');
        return;
    }

    // 添加表情（使用文件路径）
    expressionConfig[emotion].push(filePath);

    // 更新 UI - 显示键名
    const container = document.querySelector(`.emotion-expression-actions[data-emotion="${emotion}"]`);
    if (container) {
        const emptyTip = container.querySelector('.empty-tip');
        if (emptyTip) {
            emptyTip.remove();
        }

        const item = createExpressionBindingItem(emotion, filePath, expressionKey);
        container.appendChild(item);
    }

    // 自动保存配置
    await saveExpressionConfigSilent();

    addLog(`已将表情 "${expressionKey}" 绑定到 ${emotion}`, 'success', 'system');
}

// 根据键名获取文件路径
function getExpressionFilePathByKey(expressionKey) {
    // 遍历配置查找文件路径
    for (const [key, value] of Object.entries(expressionConfig)) {
        if (key === expressionKey && Array.isArray(value) && value.length > 0) {
            return value[0];
        }
    }
    // 如果找不到，返回默认格式
    return 'expressions/' + expressionKey + '.exp3.json';
}

// 删除表情绑定
async function removeExpressionBinding(emotion, filePath) {
    if (expressionConfig[emotion]) {
        const index = expressionConfig[emotion].indexOf(filePath);
        if (index > -1) {
            expressionConfig[emotion].splice(index, 1);
            
            // 更新UI
            const container = document.querySelector(`.emotion-expression-actions[data-emotion="${emotion}"]`);
            if (container) {
                const items = container.querySelectorAll('.expression-binding-item');
                items.forEach(item => {
                    const span = item.querySelector('span');
                    if (span && span.dataset.filePath === filePath) {
                        item.remove();
                    }
                });
                
                // 如果没有表情了，显示空提示
                if (container.children.length === 0) {
                    container.innerHTML = '<div class="empty-tip">拖拽表情到此绑定</div>';
                }
            }

            // 自动保存配置
            await saveExpressionConfigSilent();

            // 从键名获取显示名用于日志
            const exprKey = expressionPathToKey[filePath] || getExpressionDisplayName(filePath);
            addLog(`已移除表情 "${exprKey}" 从 ${emotion}`, 'info', 'system');
        }
    }
}

// 预览表情（通过文件名）
async function previewExpression(expressionName) {
    try {
        // 确保表情名称包含完整的文件路径
        let fullExpressionName = expressionName;
        if (!fullExpressionName.includes('/')) {
            fullExpressionName = 'expressions/' + expressionName + '.exp3.json';
        }
        await playPreviewExpressionFile(fullExpressionName);
    } catch (error) {
        showError('预览时出错：' + error.message);
    }
}

// 预览表情（通过键名，如"表情 1"）
async function previewExpressionByKey(expressionKey) {
    try {
        const filePath = expressionKeyToPath[expressionKey] || getExpressionFilePathByKey(expressionKey);
        await playPreviewExpressionFile(filePath);
    } catch (error) {
        showError('预览时出错：' + error.message);
    }
}

// 一键还原表情
async function resetExpression() {
    try {
        const response = await fetch('/api/live2d/expressions/reset', {
            method: 'POST'
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('表情配置已还原', 'success', 'system');
            // 重新加载配置
            await loadExpressionConfig();
        } else {
            addLog('还原失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('还原时出错：' + error.message, 'error', 'system');
    }
}

// 保存表情配置
async function saveExpressionConfig() {
    try {
        const response = await fetch('/api/live2d/expressions/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expressions: expressionConfig })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            addLog('表情配置已保存', 'success', 'system');
            showSuccess('表情配置已保存');
            await ensureLive2dPreviewInfo(true);
        } else {
            showError('保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        showError('保存时出错：' + error.message);
    }
}

// 静默保存表情配置（用于拖拽绑定时自动保存）
async function saveExpressionConfigSilent() {
    try {
        await fetch('/api/live2d/expressions/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expressions: expressionConfig })
        });
        await ensureLive2dPreviewInfo(true);
    } catch (error) {
        console.error('静默保存表情配置失败:', error);
    }
}

// ============ 头部折叠功能 ============

// 头部折叠状态
let isHeaderCollapsed = false;

// 切换头部折叠状态
function toggleHeaderCollapse() {
    const body = document.body;
    const collapseBtn = document.querySelector('.btn-collapse-header');
    
    isHeaderCollapsed = !isHeaderCollapsed;
    
    if (isHeaderCollapsed) {
        // 折叠状态
        body.classList.add('header-collapsed');
        if (collapseBtn) {
            collapseBtn.querySelector('.collapse-text').textContent = '展开';
        }
    } else {
        // 展开状态
        body.classList.remove('header-collapsed');
        if (collapseBtn) {
            collapseBtn.querySelector('.collapse-text').textContent = '折叠';
        }
    }
}
