// My Neuro WebUI - 前端 JavaScript v3.3

const serviceStates = {};
let currentLogTab = 'system-log';
let logPollingInterval = null;
let lastPetLogCount = 0;  // 记录上次桌宠日志数量
let lastToolLogCount = 0; // 记录上次工具日志数量

// 对话历史状态
let chatHistoryState = {
    messages: [],           // 当前显示的对话列表
    page: 1,                // 当前页码
    pageSize: 50,           // 每页数量
    hasMore: false,         // 是否还有更多历史
    total: 0,               // 总对话数
    isLoading: false,       // 是否正在加载
    pollInterval: null      // 轮询定时器
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
        console.warn(t('common.error') + ': Toast container not found');
        return;
    }
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
    message = (typeof t === 'function') ? t(message, {defaultValue: message}) : message;
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

// 增量加载日志（只添加新日志，避免回弹）
function appendNewLogs(logType, newLogs) {
    const outputId = logType + '-log-output';
    const logOutput = document.getElementById(outputId);
    
    // 为每条新日志添加条目（不添加时间戳，直接使用日志文件中的时间）
    newLogs.forEach(log => {
        const level = log.includes('错误') || log.includes('失败') || log.includes('error') || log.includes('fail') || log.includes('❌') ? 'error' :
                     log.includes('成功') || log.includes('success') || log.includes('✅') ? 'success' :
                     log.includes('警告') || log.includes('warning') || log.includes('⚠️') ? 'warning' : 'info';
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-' + level;
        logEntry.textContent = log;  // 直接使用日志内容，不添加额外时间戳
        logOutput.appendChild(logEntry);
    });
    
    // 只有当用户已经在底部时才自动滚动到底部
    const isAtBottom = logOutput.scrollHeight - logOutput.clientHeight - logOutput.scrollTop < 50;
    if (isAtBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
    }
    
    // 同步到第二个面板
    syncLogToPanel2();
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
        const buttonText = tabId === 'system-log' ? t('dashboard.system_log') : tabId === 'pet-log' ? t('dashboard.pet_log') : t('dashboard.tool_log');
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
    // 如果是历史对话选项卡，调用清空 API
    if (currentLogTab === 'chat-history') {
        if (confirm(t('logs.clear_confirm'))) {
            fetch('/api/chat-history/clear', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showToast(t('logs.clear_success'), 'success');
                        chatHistoryState.messages = [];
                        chatHistoryState.page = 1;
                        chatHistoryState.hasMore = false;
                        chatHistoryState.total = 0;
                        renderChatHistory([]);
                    } else {
                        showToast(t('logs.clear_failed') + '：' + data.error, 'error');
                    }
                })
                .catch(err => showToast(t('logs.clear_failed') + '：' + err.message, 'error'));
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
    logOutput.innerHTML = '<div class="log-entry log-info">' + t('dashboard.log_cleared') + '</div>';
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
        button.textContent = t('common.expand');
    } else {
        // 拆分
        wrapper.classList.add('split');
        container2.style.display = 'flex';
        button.classList.add('active');
        button.textContent = t('common.collapse');
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
}

// 清空第二个面板的当前日志
function clearCurrentLog2() {
    // 获取第一个面板当前的 tab 状态
    let outputId;
    const activeTab = document.querySelector('#logPanelContainer1 .log-tab.active');
    const tabName = activeTab ? activeTab.textContent : t('dashboard.system_log');

    if (tabName === t('dashboard.pet_log')) {
        outputId = 'pet-log-output2';
    } else if (tabName === t('dashboard.tool_log')) {
        outputId = 'tool-log-output2';
    } else if (tabName === t('dashboard.chat_history')) {
        // 历史对话清空与第一个面板相同
        clearCurrentLog();
        return;
    } else {
        outputId = 'system-log-output2';
    }

    const logOutput = document.getElementById(outputId);
    logOutput.innerHTML = '<div class="log-entry log-info">' + t('dashboard.log_cleared') + '</div>';
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
                '<div class="log-entry log-info">' + t('logs.no_chat_history') + '</div>';
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

        // 只在没有轮询时才启动，避免轮询调用时重置计时器
        if (!chatHistoryState.pollInterval) {
            startChatHistoryPolling();
        }

        console.log('[ChatHistory] 加载完成');

    } catch (error) {
        console.error('[ChatHistory] load failed:', error);
        document.getElementById('chat-history-output').innerHTML =
            `<div class="log-entry log-error">${t('logs.load_failed')}：${error.message}</div>`;
    } finally {
        chatHistoryState.isLoading = false;
    }
}

// 加载对话历史（分页）
async function loadChatHistory(page = 1, prependToTop = false) {
    if (chatHistoryState.isLoading) return;

    const container = document.getElementById('chat-history-output');
    const scrollEl = container.closest('.log-container') || container;

    // 保存加载前的滚动位置
    const scrollBeforeLoad = scrollEl.scrollTop;
    const scrollHeightBeforeLoad = scrollEl.scrollHeight;

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
        console.error('Load chat history failed:', error);
        document.getElementById('chat-history-output').innerHTML =
            `<div class="log-entry log-error">${t('logs.load_failed')}：${error.message}</div>`;
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
        container.innerHTML = '<div class="log-entry log-info">' + t('logs.no_chat_history') + '</div>';
        return;
    }

    const htmlParts = [];

    // 添加"加载更多"按钮在顶部（仅有更多时显示）
    if (chatHistoryState.hasMorePrev) {
        htmlParts.push(`
            <div class="chat-load-more" id="chat-load-more-container">
                <button id="chat-load-more-btn" onclick="loadMoreChatHistory()">` + t('logs.load_more') + `</button>
            </div>
        `);
    }


    // 遍历消息（保持原顺序：旧→新）
    messages.forEach((msg) => {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        const senderName = role === 'user' ? t('logs.user') : t('logs.ai');
        
        let contentHtml = '';

        // 处理工具调用
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            contentHtml += '<div class="chat-tool-calls">';
            msg.tool_calls.forEach(tool => {
                const functionName = tool.function?.name || 'unknown';
                const functionArgs = tool.function?.arguments || '{}';
                contentHtml += `
                    <div class="chat-tool-call">
                        <div class="chat-tool-name">🔧 ${t('logs.tool_call')}：${escapeHtml(functionName)}</div>
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
                        let text = escapeHtml(item.text || '').replace(/\n+/g, ' ');
                        text = renderBase64Images(text);
                        contentHtml += `<div class="chat-content">${text}</div>`;
                    } else if (item.type === 'image_url') {
                        const imageUrl = item.image_url?.url || '';
                        if (imageUrl.startsWith('data:image/')) {
                            contentHtml += `<img src="${imageUrl}" alt="${t('common.image')}" onclick="previewImage(this.src)" style="max-width: 100%; border-radius: 6px; margin: 8px 0; cursor: pointer;">`;
                        } else {
                            contentHtml += `<img src="${imageUrl}" alt="${t('common.image')}" onclick="previewImage(this.src)" style="max-width: 100%; border-radius: 6px; margin: 8px 0; cursor: pointer;">`;
                        }
                    }
                });
            } else {
                // content 是字符串格式
                let content = escapeHtml(msg.content || '').replace(/\n+/g, ' ');
                content = renderBase64Images(content);
                contentHtml += `<div class="chat-content">${content}</div>`;
            }
        }

        htmlParts.push(`
            <div class="chat-message ${role}">
                <span class="chat-sender ${role}">${senderName}</span>
                <span class="chat-content">${contentHtml}</span>
            </div>
        `);
    });

    container.innerHTML = htmlParts.join('');
    
    console.log(`[ChatHistory] HTML 已渲染，总长度：${htmlParts.join('').length}`);

    // 同步到第二个面板
    syncLogToPanel2();

    // 滚动位置处理 - 使用延迟确保内容完全渲染
    // 切换选项卡时需要等待 DOM 和样式完全应用
    setTimeout(() => {
        const scrollEl = logContainer || container;
        if (prependToTop) {
            const newScrollHeight = scrollEl.scrollHeight;
            const heightDiff = newScrollHeight - scrollHeightBeforeLoad;
            scrollEl.scrollTop = scrollBeforeLoad + heightDiff;
        } else {
            scrollEl.scrollTop = scrollEl.scrollHeight;
        }
    }, 50);
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
        return `<img src="${match}" alt="${t('common.image')}" onclick="previewImage(this.src)">`;
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
    const container = document.getElementById('chat-load-more-container');
    if (container) container.style.display = chatHistoryState.hasMorePrev ? '' : 'none';
}

// 启动对话历史轮询
function startChatHistoryPolling() {
    stopChatHistoryPolling();
    chatHistoryState.pollInterval = setInterval(() => {
        if (!chatHistoryState.isLoading) {
            loadLastPageOfChatHistory();
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

function syncLogToPanel2() {
    // 右侧面板现在只显示历史对话，无需同步日志
}

// 加载日志（增量更新）
async function loadLogs(logType) {
    try {
        const response = await fetch('/api/logs/' + logType);
        if (response.ok) {
            const data = await response.json();
            if (data.logs && data.logs.length > 0) {
                const outputId = logType + '-log-output';
                const logOutput = document.getElementById(outputId);
                
                // 检查日志数量是否变化
                const currentCount = logType === 'pet' ? lastPetLogCount : lastToolLogCount;
                const newCount = data.logs.length;
                
                // 只有当日志数量增加时才添加新日志
                if (newCount > currentCount) {
                    const newLogs = data.logs.slice(currentCount);  // 只取新增的日志
                    appendNewLogs(logType, newLogs);
                    
                    // 更新计数
                    if (logType === 'pet') {
                        lastPetLogCount = newCount;
                    } else {
                        lastToolLogCount = newCount;
                    }
                }
                // 如果日志数量减少（文件被清空），重置并重新加载
                else if (newCount < currentCount) {
                    logOutput.innerHTML = '';
                    if (logType === 'pet') {
                        lastPetLogCount = 0;
                    } else {
                        lastToolLogCount = 0;
                    }
                    // 重新加载所有日志
                    appendNewLogs(logType, data.logs);
                    if (logType === 'pet') {
                        lastPetLogCount = data.logs.length;
                    } else {
                        lastToolLogCount = data.logs.length;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Load logs failed:', error);
    }
}

// 启动日志轮询
function startLogPolling() {
    // 每 500 毫秒轮询一次桌宠日志和工具日志
    logPollingInterval = setInterval(() => {
        loadLogs('pet');
        loadLogs('tool');
    }, 500);
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

// 更新服务状态
function updateServiceStatus(serviceName, status) {
    serviceStates[serviceName] = status;

    // live2d 使用单一切换按钮
    if (serviceName === 'live2d') {
        const toggleBtn = document.getElementById('live2d-toggle');
        if (toggleBtn) {
            if (status === 'running') {
                toggleBtn.textContent = t('dashboard.stop');
                toggleBtn.classList.add('running');
            } else {
                toggleBtn.textContent = t('dashboard.start');
                toggleBtn.classList.remove('running');
            }
        }
        return;
    }

    const statusElement = document.getElementById(serviceName + '-status');
    const startBtn = document.getElementById(serviceName + '-start');
    const stopBtn = document.getElementById(serviceName + '-stop');
    const restartBtn = document.getElementById(serviceName + '-restart');

    if (status === 'running') {
        if (statusElement) statusElement.className = 'status running';
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (restartBtn) restartBtn.disabled = false;
    } else {
        if (statusElement) statusElement.className = 'status stopped';
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (restartBtn) restartBtn.disabled = true;
    }
}

// Live2D 启动/关闭切换
async function toggleLive2dService() {
    if (serviceStates['live2d'] === 'running') {
        await stopService('live2d');
    } else {
        await startService('live2d');
    }
}

// 启动服务
async function startService(serviceName) {
    try {
        addLog(t('services.starting') + ' ' + serviceName + ' ' + t('services.service_suffix'), 'info', 'system');
        const response = await fetch('/api/start/' + serviceName, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'running');
            addLog(serviceName + ' ' + t('services.start_success'), 'success', 'system');
            
            // Live2D 启动后加载显示器列表
            if (serviceName === 'live2d') {
                setTimeout(loadDisplayList, 1500);
            }
        } else {
            addLog(serviceName + ' ' + t('services.start_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(serviceName + ' ' + t('services.start_error') + '：' + error.message, 'error', 'system');
    }
}

// 停止服务
async function stopService(serviceName) {
    try {
        addLog(t('services.stopping') + ' ' + serviceName + ' ' + t('services.service_suffix'), 'warning', 'system');
        const response = await fetch('/api/stop/' + serviceName, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'stopped');
            addLog(serviceName + ' ' + t('services.stop_success'), 'info', 'system');
        } else {
            addLog(serviceName + ' ' + t('services.stop_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(serviceName + ' ' + t('services.stop_error') + '：' + error.message, 'error', 'system');
    }
}

// 重启服务（仅 Live2D）
async function restartService(serviceName) {
    try {
        addLog(t('services.restarting') + ' ' + serviceName + ' ' + t('services.service_suffix'), 'info', 'system');
        await stopService(serviceName);
        setTimeout(function() { startService(serviceName); }, 1500);
    } catch (error) {
        addLog(serviceName + ' ' + t('services.restart_error') + '：' + error.message, 'error', 'system');
    }
}

// 一键启动全部服务
async function startAllServices() {
    addLog(t('services.start_all_begin'), 'info', 'system');
    const services = ['live2d', 'asr', 'tts', 'memos', 'rag', 'bert'];
    let successCount = 0;
    let failCount = 0;
    
    for (const service of services) {
        if (serviceStates[service] !== 'running') {
            addLog(t('services.starting') + ' ' + service + ' ' + t('services.service_suffix'), 'info', 'system');
            try {
                const response = await fetch('/api/start/' + service, { method: 'POST' });
                const result = await response.json();

                if (response.ok && result.success) {
                    updateServiceStatus(service, 'running');
                    addLog(service + ' ' + t('services.start_success'), 'success', 'system');
                    successCount++;
                } else {
                    addLog(service + ' ' + t('services.start_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
                    failCount++;
                }
            } catch (error) {
                addLog(service + ' ' + t('services.start_error') + '：' + error.message, 'error', 'system');
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    addLog(t('services.start_all_done') + ' ' + successCount + ' ' + t('services.count_unit') + t('services.count_suffix') + ' ' + failCount + ' ' + t('services.count_unit'), 'info', 'system');
}

// 一键停止全部服务
async function stopAllServices() {
    addLog(t('services.stop_all_begin'), 'warning', 'system');
    const services = ['live2d', 'asr', 'tts', 'memos', 'rag', 'bert'];
    let successCount = 0;
    let failCount = 0;
    
    for (const service of services) {
        if (serviceStates[service] === 'running') {
            addLog(t('services.stopping') + ' ' + service + ' ' + t('services.service_suffix'), 'warning', 'system');
            try {
                const response = await fetch('/api/stop/' + service, { method: 'POST' });
                const result = await response.json();

                if (response.ok && result.success) {
                    updateServiceStatus(service, 'stopped');
                    addLog(service + ' ' + t('services.stop_success'), 'info', 'system');
                    successCount++;
                } else {
                    addLog(service + ' ' + t('services.stop_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
                    failCount++;
                }
            } catch (error) {
                addLog(service + ' ' + t('services.stop_error') + '：' + error.message, 'error', 'system');
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    addLog(t('services.stop_all_done') + ' ' + successCount + ' ' + t('services.count_unit') + t('services.count_suffix') + ' ' + failCount + ' ' + t('services.count_unit'), 'info', 'system');
}

// 切换标签页
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    // 查找对应的按钮并添加 active 状态（兼容 event 不存在的情况）
    const targetButton = document.querySelector(`.tab-button[onclick="switchTab('${tabName}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }

    // 保存按钮已移至各面板底部，此处不再需要动态控制
}

// ============ 配置保存 ============

// 保存配置的通用函数
async function saveConfig(url, data, successMsg) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(successMsg, 'success', 'system');
        } else {
            addLog(t('common.save') + t('common.error') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(t('common.error') + '：' + error.message, 'error', 'system');
    }
}

// 保存 LLM 配置
async function saveLLMConfig() {
    const config = {
        api_key: document.getElementById('api-key').value,
        api_url: document.getElementById('api-url').value,
        model: document.getElementById('model').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        system_prompt: document.getElementById('system-prompt').value
    };
    try {
        const response = await fetch('/api/config/llm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(config)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(t('llm_config.save_success'), 'success', 'system');
            showSuccess(t('llm_config.save_success'));
        } else {
            addLog(t('llm_config.save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('llm_config.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('llm_config.save_error') + '：' + error.message, 'error', 'system');
        showError(t('llm_config.save_error') + '：' + error.message);
    }
}

// 加载 LLM 配置
async function loadLLMConfig() {
    try {
        const response = await fetch('/api/config/llm');
        if (response.ok) {
            const data = await response.json();
            _setVal('api-key', data.api_key || '');
            _setVal('api-url', data.api_url || '');
            _setVal('model', data.model || '');
            _setVal('temperature', data.temperature || 0.9);
            _setVal('system-prompt', data.system_prompt || '');
        }
    } catch (error) {
        console.error('加载 LLM 配置失败:', error);
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
    await saveConfig('/api/settings/chat', settings, t('dialog_config.save_success'));
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
            model: document.getElementById('aliyun-tts-model').value,
            voice: document.getElementById('aliyun-tts-voice').value
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
            addLog(t('cloud_config.save_success'), 'success', 'system');
            showSuccess(t('cloud_config.save_success'));
        } else {
            addLog(t('cloud_config.save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('cloud_config.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('cloud_config.save_error') + '：' + error.message, 'error', 'system');
        showError(t('cloud_config.save_error') + '：' + error.message);
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
            document.getElementById('aliyun-tts-model').value = aliyun_tts.model || '';
            document.getElementById('aliyun-tts-voice').value = aliyun_tts.voice || '';

            // 百度流式 ASR 配置
            const baidu_asr = data.baidu_asr || {};
            document.getElementById('baidu-asr-enabled').checked = baidu_asr.enabled === true;
            document.getElementById('baidu-asr-url').value = baidu_asr.url || '';
            document.getElementById('baidu-asr-appid').value = baidu_asr.appid || '';
            document.getElementById('baidu-asr-appkey').value = baidu_asr.appkey || '';
            document.getElementById('baidu-asr-devpid').value = baidu_asr.dev_pid || '15372';
        }
    } catch (error) {
        console.error('Load cloud config failed:', error);
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

// 处理模型文件选择
function handleModelFileSelect(files) {
    if (files && files.length > 0) {
        selectedModelFile = files[0];
        const statusEl = document.getElementById('model-file-status');
        statusEl.textContent = t('voice_clone.selected') + selectedModelFile.name;
        statusEl.classList.add('has-file');
    }
}

// 处理音频文件选择
function handleAudioFileSelect(files) {
    if (files && files.length > 0) {
        selectedAudioFile = files[0];
        const statusEl = document.getElementById('audio-file-status');
        statusEl.textContent = t('voice_clone.selected') + selectedAudioFile.name;
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
}

// 生成 TTS 的 bat 文件
async function generateTTSBat() {
    const roleName = document.getElementById('voice-clone-role-name').value.trim();
    const language = document.getElementById('voice-clone-language').value;
    const text = document.getElementById('voice-clone-text').value.trim();

    if (!selectedModelFile) {
        showError('Please select model file (pth)');
        return;
    }
    if (!selectedAudioFile) {
        showError('Please select reference audio (wav)');
        return;
    }
    if (!roleName) {
        showError('Please enter role name');
        return;
    }
    if (!text) {
        showError('Please enter reference audio text');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('model_file', selectedModelFile);
        formData.append('audio_file', selectedAudioFile);
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
            statusEl.textContent = t('voice_clone.status_generating') + result.message;
            statusEl.classList.add('has-file');
            showSuccess(result.message);
        } else {
            statusEl.textContent = t('voice_clone.status_generating') + t('common.error') + ' - ' + (result.error || t('common.unknown_error'));
            showError(t('common.error') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        const statusEl = document.getElementById('voice-clone-status');
        statusEl.textContent = t('voice_clone.status_generating') + t('common.error') + ' - ' + error.message;
        showError(t('common.error') + '：' + error.message);
    }
}

// 页面加载完成后初始化（主初始化入口）
document.addEventListener('DOMContentLoaded', async function() {
    // 等待 i18next 初始化完成
    if (window.i18nReady) {
        try { await window.i18nReady; } catch (e) { console.error('i18n init failed:', e); }
    }
    // 初始化保存按钮状态（防止页面跳动）
    switchTab('dashboard');

    // 检查服务状态
    checkServiceStatus();
    // 每 5 秒检查一次状态
    setInterval(checkServiceStatus, 5000);

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

    // 右侧面板默认显示历史对话，页面加载时主动拉取
    loadLastPageOfChatHistory();

    // 加载模型列表（使用 refreshModelList 函数）
    refreshModelList();


    // 加载工具列表
    refreshAllTools();

    // 配置轮询已禁用（2026-03-09）- 存在 bug 导致复选框跳动
    // setInterval(loadAllSettings, 2000);

    // 初始化文件拖拽
    initFileDragDrop();

    // 重置日志计数器
    lastPetLogCount = 0;
    lastToolLogCount = 0;

    addLog(t('logs.webui_ready'), 'success', 'system');

    console.log(t('logs.init_complete'));

    // 页面卸载时停止所有轮询
    window.addEventListener('beforeunload', () => {
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
        const newHeight = Math.max(100, Math.min(800, startHeight + deltaY));
        
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
    await saveConfig('/api/settings/bilibili', settings, 'Live settings saved');
}

// 保存当前模型
async function saveCurrentModel() {
    const model = document.getElementById('current-model').value;
    await saveConfig('/api/settings/current-model', { model }, t('ui_settings.model_switch_success') + model);
}

// 保存 UI 设置
async function saveUISettings() {
    const settings = {
        show_chat_box: document.getElementById('show-chat-box').checked,
        show_model: !document.getElementById('hide-model').checked,  // 勾选表示隐藏，所以取反
        subtitle_labels: {
            enabled: document.getElementById('subtitle-enabled').checked,
            user: document.getElementById('subtitle-user').value,
            ai: document.getElementById('subtitle-ai').value
        }
    };
    try {
        const response = await fetch('/api/settings/ui', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog(t('ui_settings.ui_save_success'), 'success', 'system');
            showSuccess(t('ui_settings.ui_save_success'));
        } else {
            addLog(t('ui_settings.ui_save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('ui_settings.ui_save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('ui_settings.ui_save_error') + '：' + error.message, 'error', 'system');
        showError(t('ui_settings.ui_save_error') + '：' + error.message);
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
    await saveConfig('/api/settings/autochat', settings, 'Auto-chat settings saved');
}

// 保存动态主动对话设置
async function saveMoodChatSettings() {
    const settings = {
        enabled: document.getElementById('mood-chat-enabled').checked,
        prompt: document.getElementById('mood-chat-prompt').value
    };
    await saveConfig('/api/settings/mood-chat', settings, 'Mood chat settings saved');
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
    await saveConfig('/api/settings/advanced', settings, 'Advanced settings saved');
}

// ============ 工具和模型 ============

// ============ 工具屋管理 ============

// 当前工具选项卡
let currentToolTab = 'mcp';

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
    await refreshMCPTools();
}

// 刷新 MCP 工具列表
async function refreshMCPTools() {
    try {
        const response = await fetch('/api/tools/list/mcp');
        if (!response.ok) {
            console.error('MCP tool list request failed:', response.status);
            return;
        }
        
        const data = await response.json();
        const mcpToolsList = document.getElementById('mcp-tools-list');
        
        if (!mcpToolsList) {
            console.error('mcp-tools-list element not found');
            return;
        }
        
        mcpToolsList.innerHTML = '';

        const tools = data.tools || [];
        if (tools.length === 0) {
            mcpToolsList.innerHTML = '<div class="log-entry log-info">' + t('tools.no_tools') + '</div>';
            return;
        }

        tools.forEach(tool => {
            const card = createToolCard(tool, 'mcp');
            mcpToolsList.appendChild(card);
        });
    } catch (error) {
        console.error('Get MCP tool list failed:', error);
        const mcpToolsList = document.getElementById('mcp-tools-list');
        if (mcpToolsList) {
            mcpToolsList.innerHTML = `<div class="log-entry log-error">${t('tools.load_failed')}：${error.message}</div>`;
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
    const statusText = tool.enabled ? t('plugins.enabled') : t('plugins.disabled');
    const toggleText = tool.enabled ? t('plugins.disable_btn') : t('plugins.enable_btn');

    // 工具名称：使用 short_desc（来自注释第一行）
    const toolName = tool.name;
    // 简介：使用 short_desc（注释提取的简短描述）
    const briefDesc = tool.short_desc || t('tools.no_desc');
    // 完整描述：name: description 格式
    const fullDesc = tool.name + ': ' + (tool.description || t('tools.no_desc'));

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
                addLog(t('tools.toggle_success') + ' ' + (result.enabled ? t('plugins.enabled') : t('plugins.disabled')), 'success', 'system');
            } else {
                const newEnabled = result.enabled;

                // 更新按钮文本
                toggleBtn.textContent = newEnabled ? t('plugins.disable_btn') : t('plugins.enable_btn');

                // 更新状态显示（使用 tool-status-inline）
                const statusEl = card.querySelector('.tool-status-inline');
                if (statusEl) {
                    const statusIcon = newEnabled ? '●' : '○';
                    const statusText = newEnabled ? t('plugins.enabled') : t('plugins.disabled');
                    statusEl.className = `tool-status-inline ${newEnabled ? 'enabled' : 'disabled'}`;
                    statusEl.textContent = `${statusIcon} ${statusText}`;
                }

                addLog(t('tools.toggle_success') + ' ' + toolName + ' ' + (newEnabled ? t('plugins.enabled') : t('plugins.disabled')), 'success', 'system');
            }
        } else {
            addLog(t('tools.toggle_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(t('tools.toggle_error') + '：' + error.message, 'error', 'system');
    }
}

// 刷新模型列表
async function refreshModelList() {
    try {
        const response = await fetch('/api/models/list');

        if (response.ok) {
            const data = await response.json();
            const models = data.models || [];
            const modelSelect = document.getElementById('live2d-model-select');

            if (!modelSelect) {
                return;
            }

            modelSelect.innerHTML = '';

            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });

            const currentResponse = await fetch('/api/settings/current-model');
            if (currentResponse.ok) {
                const currentData = await currentResponse.json();
                if (currentData.success && currentData.model) {
                    modelSelect.value = currentData.model;
                }
            }
        }
    } catch (error) {
        console.error('获取模型列表时出错:', error);
    }
}

// 保存 Live2D 模型
async function saveLive2DModel() {
    try {
        const modelName = document.getElementById('live2d-model-select').value;

        const response = await fetch('/api/settings/current-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            addLog(t('ui_settings.model_switch_success') + modelName, 'success', 'system');
            await loadExpressionConfig();
            await loadAllMotions();
            addLog('Motion & expression config reloaded', 'info', 'system');
        } else {
            addLog(t('ui_settings.model_switch_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(t('ui_settings.model_switch_failed') + '：' + error.message, 'error', 'system');
    }
}

// ============ 游戏中心 ============

// 启动 Minecraft 游戏
async function startMinecraftGame() {
    try {
        const response = await fetch('/api/game/minecraft/start', { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            showSuccess(t('game.start_success'));
        } else {
            const errorMsg = result.error || t('services.start_failed');
            if (errorMsg.includes('开启游戏终端.bat')) {
                showError(t('game.start_script_missing') + '开启游戏终端.bat');
            } else {
                showError(t('services.start_failed') + '：' + errorMsg);
            }
        }
    } catch (error) {
        showError(t('services.start_error') + '：' + error.message);
    }
}

// ============ 工具调用日志 ============

// 添加工具调用日志的函数（供外部调用）
function addToolLog(toolName, result) {
    addLog(t('logs.tool_call') + '：' + toolName + ' -> ' + result, 'info', 'tool');
}

// ============ 配置加载 ============

// 安全设置元素值（强制设置，不考虑焦点状态）
function _setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function _setChk(id, value) { const el = document.getElementById(id); if (el) el.checked = value; }

// 加载 LLM 基础配置（仅供内部使用）
async function loadConfigs() {
    try {
        let resp = await fetch('/api/config/llm');
        if (resp.ok) {
            const config = await resp.json();
            _setVal('api-key', config.api_key || '');
            _setVal('api-url', config.api_url || '');
            _setVal('model', config.model || '');
            _setVal('temperature', config.temperature || 0.9);
            _setVal('system-prompt', config.system_prompt || '');
        }
    } catch (error) {
        console.error('加载 LLM 配置失败:', error);
    }
}

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
            document.getElementById('neuro-version').textContent = data.neuro_version;
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
        uptimeStr = `${days}${t('common.day')}${hours}${t('common.hour')}${minutes}${t('common.minute')}${seconds}${t('common.second')}`;
    } else if (hours > 0) {
        uptimeStr = `${hours}${t('common.hour')}${minutes}${t('common.minute')}${seconds}${t('common.second')}`;
    } else if (minutes > 0) {
        uptimeStr = `${minutes}${t('common.minute')}${seconds}${t('common.second')}`;
    } else {
        uptimeStr = `${seconds}${t('common.second')}`;
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
            btn.textContent = t('plugins.refreshing');
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = originalText;
            }, 2000);
        }
        await loadPlugins();
        addLog(t('plugins.refresh_success'), 'success', 'system');
    } catch (error) {
        addLog(t('plugins.refresh_failed') + '：' + error.message, 'error', 'system');
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
        } else {
            addLog(t('plugins.load_failed'), 'error', 'system');
        }
    } catch (error) {
        addLog(t('plugins.load_failed') + '：' + error.message, 'error', 'system');
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
    const statusText = plugin.enabled ? t('plugins.enabled') : t('plugins.disabled');

    card.innerHTML = `
        <div class="plugin-card-header">
            <div>
                <h4>${plugin.display_name} <span style="font-size: 12px; opacity: 0.6;">v${plugin.version}</span></h4>
                <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">${t('plugins.author')}${plugin.author}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}">
                    ${statusIcon} ${statusText}
                </span>
            </div>
        </div>
        <p class="plugin-description">${plugin.description}</p>
        <div class="plugin-actions">
            <button class="btn-plugin-toggle" onclick="togglePlugin('${plugin.plugin_path}')">
                ${plugin.enabled ? t('plugins.disable_btn') : t('plugins.enable_btn')}
            </button>
            <button class="btn-open-config" onclick="openPluginConfig('${plugin.plugin_path}')">
                ${plugin.has_own_config ? t('plugins.config_btn') : t('plugins.open_config')}
            </button>
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
                statusEl.innerHTML = `${newEnabled ? '●' : '○'} ${newEnabled ? t('plugins.enabled') : t('plugins.disabled')}`;
                toggleBtn.textContent = newEnabled ? t('plugins.disable_btn') : t('plugins.enable_btn');
            }

            addLog(t('plugins.toggle_success') + ' ' + pluginPath + ' ' + (newEnabled ? t('plugins.enabled') : t('plugins.disabled')), 'success', 'system');

            // 重新加载插件列表
            loadPlugins();
        } else {
            addLog(t('plugins.toggle_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(t('plugins.toggle_failed') + '：' + error.message, 'error', 'system');
    }
}

// 打开插件配置（使用 display_name 作为唯一标识符）
async function openPluginConfig(pluginPath) {
    try {
        // 首先检查插件是否有配置文件
        const pluginsResponse = await fetch('/api/plugins/list');
        if (!pluginsResponse.ok) {
            throw new Error(t('plugins.load_failed'));
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
                addLog(t('plugins.config_error') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
                if (result.config_path) {
                    addLog(t('plugins.config_path') + result.config_path, 'info', 'system');
                }
            }
            return;
        }
        
        // 如果有配置文件，打开配置模态框 - 使用 display_name 作为标识符
        openPluginConfigModal(pluginPath, plugin.display_name);
    } catch (error) {
        addLog(t('plugins.config_error_load') + '：' + error.message, 'error', 'system');
    }
}

// 打开插件配置模态框
function openPluginConfigModal(pluginPath, displayName) {
    // 设置模态框标题（使用 display_name 显示）
    document.getElementById('pluginConfigModalTitle').textContent = t('plugins.config_title') + ' - ' + displayName;
    
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
function closePluginConfigModal() {
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
        showToast(t('plugins.no_open_config'), 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/plugins/${encodeURIComponent(window.currentPluginDisplayName)}/readme`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        
        if (response.ok && result.success) {
            showToast(t('plugins.open_readme_success'), 'success');
        } else {
            showToast(t('plugins.no_readme'), 'warning');
        }
    } catch (error) {
        showToast(t('plugins.readme_btn') + t('common.error'), 'error');
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
            
            // 检查 README 是否存在
            checkReadmeExists(displayName);
        } else {
            // 显示错误
            document.getElementById('pluginConfigLoading').style.display = 'none';
            document.getElementById('pluginConfigError').style.display = 'block';
            document.getElementById('pluginConfigErrorText').textContent = result.error || t('plugins.config_error');
        }
    } catch (error) {
        document.getElementById('pluginConfigLoading').style.display = 'none';
        document.getElementById('pluginConfigError').style.display = 'block';
        document.getElementById('pluginConfigErrorText').textContent = t('plugins.config_error_load') + '：' + error.message;
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
            const fieldElement = createConfigField(key, field);
            fieldsContainer.appendChild(fieldElement);
        }
    }
}

// 创建配置字段元素
function createConfigField(key, field) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'config-field';
    fieldDiv.dataset.fieldKey = key;
    
    let inputElement;
    
    // 根据字段类型创建不同的输入元素
    switch (field.type) {
        case 'string':
        case 'text':
            inputElement = document.createElement('input');
            inputElement.type = field.type === 'text' ? 'textarea' : 'text';
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
            
        case 'object':
            // 处理嵌套对象
            fieldDiv.innerHTML = `
                <h4>${field.title || key}</h4>
                <div class="field-description">${field.description || ''}</div>
                <div class="nested-config" id="nested-${key}"></div>
            `;
            
            const nestedContainer = fieldDiv.querySelector(`#nested-${key}`);
            for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
                const nestedFieldElement = createConfigField(nestedKey, nestedField);
                nestedContainer.appendChild(nestedFieldElement);
            }
            return fieldDiv;
            
        default:
            inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.value = field.value !== undefined ? field.value : field.default;
    }
    
    inputElement.id = `config-${key}`;
    inputElement.name = key;
    
    fieldDiv.innerHTML = `
        <h4>${field.title || key}</h4>
        <div class="field-description">${field.description || ''}</div>
    `;
    
    fieldDiv.appendChild(inputElement);
    
    return fieldDiv;
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
    
    addLog(t('plugins.reset_default'), 'info', 'system');
}

// 重置单个字段为默认值
function resetFieldToDefault(key, field) {
    const input = document.getElementById(`config-${key}`);
    if (!input) return;
    
    if (field.type === 'object') {
        // 递归处理嵌套字段
        for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
            resetFieldToDefault(nestedKey, nestedField);
        }
    } else if (field.type === 'bool') {
        input.checked = field.default;
    } else {
        input.value = field.default;
    }
}

// 保存插件配置（使用 display_name 作为唯一标识符）
async function savePluginConfig() {
    if (!window.currentPluginConfig || !window.currentPluginDisplayName) {
        addLog(t('plugins.no_open_config'), 'warning', 'system');
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
            addLog(t('plugins.save_success'), 'success', 'system');
            showSuccess(t('plugins.save_success'));
            closePluginConfigModal();
            // 重新加载插件列表以更新状态
            loadPlugins();
        } else {
            addLog(t('plugins.save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('plugins.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('plugins.save_error') + '：' + error.message, 'error', 'system');
        showError(t('plugins.save_error') + '：' + error.message);
    }
}

// 收集表单数据 - 按照原始键顺序收集
function collectConfigFormData() {
    const updatedConfig = {};
    const keys = window.currentPluginConfigKeys || Object.keys(window.currentPluginConfig || {});
    
    for (const key of keys) {
        const field = window.currentPluginConfig[key];
        if (!field) continue;
        
        const input = document.getElementById(`config-${key}`);
        if (!input) continue;
        
        // 根据字段类型收集值
        let value;
        if (field.type === 'bool') {
            value = input.checked;
        } else if (field.type === 'int') {
            value = parseInt(input.value) || field.default || 0;
        } else if (field.type === 'float') {
            value = parseFloat(input.value) || field.default || 0.0;
        } else if (field.type === 'object') {
            // 处理嵌套对象
            value = {};
            for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
                const nestedInput = document.getElementById(`config-${nestedKey}`);
                if (nestedInput) {
                    if (nestedField.type === 'bool') {
                        value[nestedKey] = nestedInput.checked;
                    } else if (nestedField.type === 'int') {
                        value[nestedKey] = parseInt(nestedInput.value) || nestedField.default || 0;
                    } else if (nestedField.type === 'float') {
                        value[nestedKey] = parseFloat(nestedInput.value) || nestedField.default || 0.0;
                    } else {
                        value[nestedKey] = nestedInput.value;
                    }
                } else {
                    // 如果找不到输入元素，使用默认值
                    value[nestedKey] = nestedField.default;
                }
            }
        } else {
            // text, string 等类型
            value = input.value;
        }
        
        updatedConfig[key] = value;
    }
    
    return updatedConfig;
}

// 从表单更新字段值
function updateFieldFromForm(key, field) {
    const input = document.getElementById(`config-${key}`);
    if (!input) return;
    
    if (field.type === 'object') {
        // 递归处理嵌套字段
        for (const [nestedKey, nestedField] of Object.entries(field.fields || {})) {
            updateFieldFromForm(nestedKey, nestedField);
        }
    } else if (field.type === 'bool') {
        field.value = input.checked;
    } else if (field.type === 'int') {
        field.value = parseInt(input.value) || 0;
    } else if (field.type === 'float') {
        field.value = parseFloat(input.value) || 0.0;
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
                    configBtn.textContent = t('plugins.config_btn');
                    configBtn.disabled = false;
                    configBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
                } else {
                    configBtn.textContent = t('plugins.no_config');
                    configBtn.disabled = true;
                    configBtn.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)';
                }
            }
        }
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

    plugins.forEach(plugin => {
        const card = createPluginCard(plugin);
        if (plugin.category === 'built-in') {
            builtinContainer.appendChild(card);
        } else {
            communityContainer.appendChild(card);
        }
    });
    
    // 更新按钮状态
    updatePluginCardButtons(plugins);
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
            mcp_enabled: document.getElementById('mcp-enabled').checked,
            vision_model: {
                api_key: document.getElementById('vision-model-api-key').value,
                api_url: document.getElementById('vision-model-api-url').value,
                model: document.getElementById('vision-model-name').value
            }
        };

        const response = await fetch('/api/settings/advanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            addLog(t('dialog_config.save_success'), 'success', 'system');
            showSuccess(t('dialog_config.save_success'));
        } else {
            addLog(t('dialog_config.save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('dialog_config.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('dialog_config.save_error') + '：' + error.message, 'error', 'system');
        showError(t('dialog_config.save_error') + '：' + error.message);
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
            _setChk('mcp-enabled', config.mcp_enabled === true);

            // 加载视觉模型配置
            if (config.vision_model) {
                _setVal('vision-model-api-key', config.vision_model.api_key || '');
                _setVal('vision-model-api-url', config.vision_model.api_url || '');
                _setVal('vision-model-name', config.vision_model.model || '');
            }
        }
    } catch (error) {
        console.error('加载基础配置失败:', error);
    }
}

// 保存对话配置
async function saveDialogSettings() {
    try {
        // 保存基础对话配置到 /api/settings/dialog
        const config = {
            intro_text: document.getElementById('intro-text').value,
            max_messages: parseInt(document.getElementById('max-messages').value) || 30,
            enable_limit: document.getElementById('enable-limit').checked,
            persistent_history: document.getElementById('persistent-history').checked,
            tts_enabled: document.getElementById('tts-enabled').checked,
            asr_enabled: document.getElementById('asr-enabled').checked,
            voice_barge_in: document.getElementById('voice-barge-in').checked,
            show_chat_box: document.getElementById('show-chat-box').checked
        };

        const response1 = await fetch('/api/settings/dialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        // 保存高级配置到 /api/settings/advanced
        const advancedConfig = {
            auto_screenshot: document.getElementById('auto-screenshot').checked,
            use_vision_model: document.getElementById('use-vision-model').checked,
            show_chat_box: document.getElementById('show-chat-box').checked,
            show_model: !document.getElementById('hide-model').checked,
            voice_barge_in: document.getElementById('voice-barge-in').checked,
            mcp_enabled: document.getElementById('mcp-enabled').checked,
            vision_model: {
                api_key: document.getElementById('vision-model-api-key').value,
                api_url: document.getElementById('vision-model-api-url').value,
                model: document.getElementById('vision-model-name').value
            }
        };

        const response2 = await fetch('/api/settings/advanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(advancedConfig)
        });

        const result1 = await response1.json();
        const result2 = await response2.json();

        if (response1.ok && result1.success && response2.ok && result2.success) {
            addLog(t('dialog_config.save_success'), 'success', 'system');
            showSuccess(t('dialog_config.save_success'));
        } else {
            const errorMsg = (result1.error || result2.error || t('common.unknown_error'));
            addLog(t('dialog_config.save_failed') + '：' + errorMsg, 'error', 'system');
            showError(t('dialog_config.save_failed') + '：' + errorMsg);
        }
    } catch (error) {
        addLog(t('dialog_config.save_error') + '：' + error.message, 'error', 'system');
        showError(t('dialog_config.save_error') + '：' + error.message);
    }
}

// 加载对话配置
async function loadDialogConfig() {
    try {
        const response = await fetch('/api/settings/dialog');
        if (response.ok) {
            const config = await response.json();
            document.getElementById('intro-text').value = config.intro_text || t('ui_settings.intro_placeholder');
            document.getElementById('max-messages').value = config.max_messages || 30;
            document.getElementById('enable-limit').checked = config.enable_limit === true;
            document.getElementById('persistent-history').checked = config.persistent_history === true;
            document.getElementById('tts-enabled').checked = config.tts_enabled === true;
            document.getElementById('asr-enabled').checked = config.asr_enabled === true;
            document.getElementById('voice-barge-in').checked = config.voice_barge_in === true;
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
            addLog(t('ui_settings.model_reset_success'), 'success', 'system');
            showSuccess(t('ui_settings.model_reset_success'));
        } else {
            addLog(t('ui_settings.model_reset_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
            showError(t('ui_settings.model_reset_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        addLog(t('ui_settings.model_reset_failed') + '：' + error.message, 'error', 'system');
        showError(t('ui_settings.model_reset_failed') + '：' + error.message);
    }
}

// 页面可见性改变��也检查状态
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        checkServiceStatus();
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
        listElement.innerHTML = '<div class="log-entry log-info">' + t('market.loading_list') + '</div>';

        const response = await fetch('/api/market/prompts');
        const data = await response.json();

        if (data.success && data.prompts && data.prompts.length > 0) {
            listElement.innerHTML = '';
            data.prompts.forEach((prompt) => {
                const card = createPromptCard(prompt);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">' + t('market.no_prompt') + '</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || t('market.load_failed')) + '</div>';
        }
    } catch (error) {
        document.getElementById('prompt-market-list').innerHTML =
            '<div class="log-entry log-error">' + t('market.load_error') + '：' + error.message + '</div>';
    }
}

// 创建提示词卡片
function createPromptCard(prompt) {
    const card = document.createElement('div');
    card.className = 'market-card';

    const title = prompt.title || t('market.unnamed_prompt');
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
        html += `<div class="market-card-warning">⚠️ ${t('market.using_condition')}：${prerequisites}</div>`;
    }

    // 添加应用按钮
    html += `<button onclick="applyPrompt('${title.replace(/'/g, "\\'")}')" class="btn-sm" style="margin-top: 10px;" data-i18n="market.apply">${t('market.apply')}</button>`;

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
                    showSuccess(t('market.apply_success'));
                } else {
                    showError(t('market.apply_failed') + '：' + (res.error || t('common.unknown_error')));
                }
            }
        }
    } catch (error) {
        showError(t('market.apply_failed') + '：' + error.message);
    }
}



// 刷新插件广场
async function refreshPluginMarket() {
    try {
        const listElement = document.getElementById('plugin-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">' + t('market.loading_plugin_list') + '</div>';

        const response = await fetch('/api/market/plugins');
        const data = await response.json();

        if (data.success && data.plugins && data.plugins.length > 0) {
            listElement.innerHTML = '';
            data.plugins.forEach((plugin) => {
                const card = createPluginMarketCard(plugin);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">' + t('market.no_plugin') + '</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || t('market.load_failed')) + '</div>';
        }
    } catch (error) {
        document.getElementById('plugin-market-list').innerHTML =
            '<div class="log-entry log-error">' + t('market.load_error') + '：' + error.message + '</div>';
    }
}

// 创建插件广场卡片
function createPluginMarketCard(plugin) {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.dataset.pluginName = plugin.name;  // 存储插件名用于后续更新

    const pluginName = plugin.name || plugin.display_name || t('market.unnamed_prompt');
    const displayName = plugin.display_name || pluginName;
    const desc = plugin.description || plugin.desc || t('market.no_desc');
    const author = plugin.author || t('market.unknown_author');
    const repo = plugin.repo || '';
    const downloadUrl = plugin.download_url || repo + '/archive/refs/heads/main.zip';
    const installed = plugin.installed || false;
    const installing = plugin.installing || false;

    // 根据状态设置按钮文本和样式（installed 优先于 installing）
    let btnText, btnDisabled, btnI18n;
    if (installed) {
        // 已安装状态优先
        btnText = t('market.plugin_installed');
        btnDisabled = 'disabled';
        btnI18n = 'market.plugin_installed';
    } else if (installing) {
        // 正在安装
        btnText = t('market.plugin_installing');
        btnDisabled = 'disabled';
        btnI18n = 'market.plugin_installing';
    } else {
        // 未安装
        btnText = t('market.plugin_install');
        btnDisabled = '';
        btnI18n = 'market.plugin_install';
    }

    const html = `<div class="market-card-header">
        <h4 class="market-card-title">🧩 ${displayName}</h4>
        <p class="market-card-author">${t('plugins.author')}${author}</p>
        <p class="market-card-summary">${desc}</p>
        <div class="install-progress" id="progress-${pluginName}" style="display: none;">
            <div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>
            <span class="progress-text">${t('market.progress_ready')}</span>
        </div>
    </div>
    <button onclick="installPlugin('${pluginName.replace(/'/g, "\\'")}', '${downloadUrl.replace(/'/g, "\\'")}')" 
        class="btn-sm" style="margin-top: 10px;" ${btnDisabled} data-i18n="${btnI18n}">${btnText}</button>`;

    card.innerHTML = html;
    return card;
}

// 安装插件
async function installPlugin(pluginName, downloadUrl) {
    try {
        // 更新按钮状态
        const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
        if (card) {
            const btn = card.querySelector('button');
            btn.disabled = true;
            btn.textContent = t('market.plugin_installing');
            btn.setAttribute('data-i18n', 'market.plugin_installing');
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
            body: JSON.stringify({ plugin_name: pluginName, download_url: downloadUrl })
        });
        const res = await result.json();
        
        if (res.success) {
            // 开始轮询检测插件目录
            pollPluginInstalled(pluginName);
        } else {
            showError(t('market.install_failed') + '：' + (res.error || t('common.unknown_error')));
            // 恢复按钮状态
            restoreInstallButton(pluginName, t('market.plugin_install'));
        }
    } catch (error) {
        showError(t('market.install_error') + '：' + error.message);
        restoreInstallButton(pluginName, t('market.plugin_install'));
    }
}

// 恢复安装按钮状态
function restoreInstallButton(pluginName, text) {
    const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
    if (card) {
        const btn = card.querySelector('button');
        btn.disabled = false;
        btn.textContent = text;
        btn.setAttribute('data-i18n', 'market.plugin_install');
        btn.classList.remove('btn-installing');
    }
    const progressDiv = document.getElementById(`progress-${pluginName}`);
    if (progressDiv) progressDiv.style.display = 'none';
}

// 轮询检测插件是否已安装（检测目录存在）
async function pollPluginInstalled(pluginName) {
    const maxAttempts = 180;  // 最多轮询 180 次（约 3 分钟）
    let attempts = 0;
    
    const poll = async () => {
        try {
            // 直接检查插件目录是否存在
            const response = await fetch(`/api/market/plugins/check-installed/${pluginName}`);
            const data = await response.json();
            
            const progressDiv = document.getElementById(`progress-${pluginName}`);
            const progressFill = progressDiv ? progressDiv.querySelector('.progress-fill') : null;
            const progressText = progressDiv ? progressDiv.querySelector('.progress-text') : null;
            
            if (data.installed) {
                // 插件已安装，成功！
                if (progressFill) progressFill.style.width = '100%';
                if (progressText) progressText.textContent = t('market.progress_done');
                // 延迟刷新列表，让后端有时间清理任务状态
                setTimeout(() => refreshPluginMarket(), 500);
                return;
            }
            
            // 还未安装，进度条动画
            if (progressFill) {
                const progress = (attempts % 50) * 2;  // 0-100 循环动画
                progressFill.style.width = progress + '%';
            }
            
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);  // 每秒检查一次
            } else {
                // 超时
                if (progressText) progressText.textContent = t('market.progress_timeout');
                restoreInstallButton(pluginName, t('market.plugin_install'));
            }
        } catch (error) {
            console.error('轮询安装状态失败:', error);
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
                restoreInstallButton(pluginName, t('market.plugin_install'));
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
    try { await loadBasicConfig(); } catch (e) { console.error('loadBasicConfig 失败:', e); }
    try { await loadDialogConfig(); } catch (e) { console.error('loadDialogConfig 失败:', e); }
    try { await loadCloudSettings(); } catch (e) { console.error('loadCloudSettings 失败:', e); }
    try { await loadUISettings(); } catch (e) { console.error('loadUISettings 失败:', e); }
}

// ============ Live2D 动作管理 ============

// 切换 UI 设置子选项卡
function switchUISubTab(tab) {
    // 更新选项卡按钮状态
    document.querySelectorAll('#ui-settings .sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

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
        loadExpressionConfig();
    } else if (tab === 'motion') {
        // 切换到动作选项卡时加载所有动作（已分类 + 未分类）
        loadAllMotions();
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
            throw new Error('Server returned non-JSON response, possible route conflict or server error');
        }
        
        const result = await response.json();
        if (response.ok && result.success) {
            showSuccess(t('ui_settings.motion_reset_success'));
            // 重新加载配置
            await loadAllMotions();
        } else {
            showError(t('ui_settings.model_reset_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.model_reset_failed') + '：' + error.message);
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
                    <button onclick="previewMotion(this)" class="btn-sm">${t('ui_settings.preview')}</button>
                    <button onclick="removeMotion(this)" class="btn-sm">${t('ui_settings.delete')}</button>
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
    try {
        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: motionName })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
}

// 删除动作
function removeMotion(btn) {
    const motionItem = btn.closest('.motion-item');
    const actionsContainer = motionItem.parentElement;
    motionItem.remove();
    
    if (actionsContainer.children.length === 0) {
        actionsContainer.innerHTML = '<div class="empty-tip">' + t('ui_settings.empty_tip_motion') + '</div>';
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
        container.innerHTML = '<div class="empty-tip">' + t('ui_settings.no_motion') + '</div>';
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
                    container.innerHTML = '<div class="empty-tip">' + t('ui_settings.empty_tip_drop_motion') + '</div>';
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
            <button onclick="previewMotionByPath('${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">${t('ui_settings.preview')}</button>
            <button onclick="removeMotionBinding('${escapedEmotion}', '${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">${t('ui_settings.delete')}</button>
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
        showWarning(t('ui_settings.already_bound_motion'));
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

    addLog(t('ui_settings.motion_bind_success') + ' "' + motionKey + '" ' + chineseEmotion, 'success', 'system');
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
                    container.innerHTML = '<div class="empty-tip">' + t('ui_settings.empty_tip_drop_motion') + '</div>';
                }
            }

            // 自动保存配置
            await saveMotionConfigSilent();
            
            addLog(t('ui_settings.motion_remove') + ' "' + filePath + '" ' + chineseEmotion, 'info', 'system');
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
    try {
        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: filePath })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
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

        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: filePath })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
}

// 预览动作（通过键名，如"动作 1"）
async function previewMotionByKey(motionKey) {
    try {
        // 从配置中查找键名对应的文件路径
        const filePath = getMotionFilePathByKey(motionKey);
        
        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: filePath })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
}

// 保存动作配置
async function saveMotionConfig() {
    try {
        const categories = [];
        document.querySelectorAll('#emotion-categories-grid .emotion-category').forEach(category => {
            const nameEl = category.querySelector('.emotion-category-header span');
            const name = nameEl ? nameEl.textContent.replace(/[😊😠😢😲😳😜]\s*/, '') : t('common.unnamed');

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
            addLog(t('ui_settings.motion_save_success'), 'success', 'system');
            showSuccess(t('ui_settings.motion_save_success'));
        } else {
            showError(t('ui_settings.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.ui_save_error') + '：' + error.message);
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
            '<div class="empty-tip">' + t('ui_settings.loading_expression') + t('common.error') + '</div>';
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
            container.innerHTML = '<div class="empty-tip">' + t('ui_settings.empty_tip_drop_expression') + '</div>';
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
            <button onclick="previewExpressionFromBinding('${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">${t('ui_settings.preview')}</button>
            <button onclick="removeExpressionBinding('${escapedEmotion}', '${escapedFilePath}')" class="btn-sm" style="padding: 2px 6px; font-size: 11px;">${t('ui_settings.delete')}</button>
        </div>
    `;
    return item;
}

// 预览绑定区域中的表情（通过文件路径）
async function previewExpressionFromBinding(filePath) {
    try {
        // 从文件路径查找键名
        const exprKey = expressionPathToKey[filePath];
        // 如果有键名，发送键名；否则发送文件路径
        const expressionToSend = exprKey || filePath;
        
        const response = await fetch('/api/live2d/expression/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: expressionToSend })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
}

// 渲染可用表情列表 - 显示键名，拖拽时传输文件路径
function renderAvailableExpressions(expressionMap) {
    const container = document.getElementById('available-expressions');
    if (!container) return;

    container.innerHTML = '';

    const exprKeys = Object.keys(expressionMap);
    if (exprKeys.length === 0) {
        container.innerHTML = '<div class="empty-tip">' + t('ui_settings.no_expression') + '</div>';
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
        showWarning(t('ui_settings.already_bound_expression'));
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

    addLog(t('ui_settings.expression_bind_success') + ' "' + expressionKey + '" ' + emotion, 'success', 'system');
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
                    container.innerHTML = '<div class="empty-tip">' + t('ui_settings.empty_tip_drop_expression') + '</div>';
                }
            }

            // 自动保存配置
            await saveExpressionConfigSilent();

            // 从键名获取显示名用于日志
            const exprKey = expressionPathToKey[filePath] || getExpressionDisplayName(filePath);
            addLog(t('ui_settings.expression_remove') + ' "' + exprKey + '" ' + emotion, 'info', 'system');
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
        
        const response = await fetch('/api/live2d/expression/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: fullExpressionName })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
    }
}

// 预览表情（通过键名，如"表情 1"）
async function previewExpressionByKey(expressionKey) {
    try {
        // 直接发送键名作为 expression_name，让 Live2D 前端查找对应文件
        const response = await fetch('/api/live2d/expression/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: expressionKey })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            showError(t('ui_settings.preview_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.preview_failed') + '：' + error.message);
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
            addLog(t('ui_settings.expression_reset_success'), 'success', 'system');
            // 重新加载配置
            await loadExpressionConfig();
        } else {
            addLog(t('ui_settings.save_failed') + '：' + (result.error || t('common.unknown_error')), 'error', 'system');
        }
    } catch (error) {
        addLog(t('common.error') + '：' + error.message, 'error', 'system');
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
            addLog(t('ui_settings.expression_save_success'), 'success', 'system');
            showSuccess(t('ui_settings.expression_save_success'));
        } else {
            showError(t('ui_settings.save_failed') + '：' + (result.error || t('common.unknown_error')));
        }
    } catch (error) {
        showError(t('ui_settings.ui_save_error') + '：' + error.message);
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
            collapseBtn.querySelector('.collapse-text').textContent = t('common.expand');
        }
    } else {
        // 展开状态
        body.classList.remove('header-collapsed');
        if (collapseBtn) {
            collapseBtn.querySelector('.collapse-text').textContent = t('common.collapse');
        }
    }
}

// ============ 显示器切换功能 ============

// 加载显示器列表
async function loadDisplayList() {
    const select = document.getElementById('display-select');
    const statusDiv = document.getElementById('display-status');
    const switchBtn = document.getElementById('switch-display-btn');
    
    if (!select) return;
    
    try {
        const response = await fetch('/api/live2d/display/list');
        const data = await response.json();
        
        if (data.success && data.displays && data.displays.length > 0) {
            select.innerHTML = '';
            
            data.displays.forEach(display => {
                const option = document.createElement('option');
                option.value = display.index;
                option.textContent = display.label;
                select.appendChild(option);
            });
            
            select.disabled = false;
            switchBtn.disabled = false;
            statusDiv.textContent = t('ui_settings.display_detected') || `检测到 ${data.displays.length} 个显示器`;
        } else {
            statusDiv.textContent = data.error || t('ui_settings.display_unavailable') || '无法获取显示器信息';
        }
    } catch (error) {
        console.error('加载显示器列表失败:', error);
        statusDiv.textContent = t('ui_settings.display_not_running') || 'Electron 未启动或连接失败';
    }
}

// 切换显示器
async function switchDisplay() {
    const select = document.getElementById('display-select');
    const displayIndex = parseInt(select.value);
    
    if (isNaN(displayIndex)) {
        showToast(t('ui_settings.select_display_first') || '请选择目标显示器', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/live2d/display/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_index: displayIndex })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
        } else {
            showToast(t('ui_settings.switch_failed') + ': ' + (result.error || t('common.unknown_error')), 'error');
        }
    } catch (error) {
        showToast(t('ui_settings.switch_error') + ': ' + error.message, 'error');
    }
}