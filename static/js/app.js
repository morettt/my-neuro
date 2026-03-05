// My Neuro WebUI - 前端 JavaScript v3.3

const serviceStates = {};
let currentLogTab = 'system-log';
let logPollingInterval = null;
let moodPollingInterval = null;
let lastPetLogCount = 0;  // 记录上次桌宠日志数量
let lastToolLogCount = 0; // 记录上次工具日志数量

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
}

// 增量加载日志（只添加新日志，避免回弹）
function appendNewLogs(logType, newLogs) {
    const outputId = logType + '-log-output';
    const logOutput = document.getElementById(outputId);
    
    // 为每条新日志添加条目（不添加时间戳，直接使用日志文件中的时间）
    newLogs.forEach(log => {
        const level = log.includes('错误') || log.includes('失败') || log.includes('❌') ? 'error' :
                     log.includes('成功') || log.includes('✅') ? 'success' :
                     log.includes('警告') || log.includes('⚠️') ? 'warning' : 'info';
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
}

// 切换日志标签页
function switchLogTab(tabId) {
    document.querySelectorAll('.log-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');
    currentLogTab = tabId;
}

// 清空当前日志
function clearCurrentLog() {
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
        console.error('加载日志失败:', error);
    }
}

// 启动日志轮询
function startLogPolling() {
    // 每 500 毫秒轮询一次桌宠日志和工具日志（提高频率以获得更好的实时性）
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

// ============ 心情分系统 ============

// 加载心情分
async function loadMoodStatus() {
    try {
        const response = await fetch('/api/mood/status');
        if (response.ok) {
            const data = await response.json();
            const scoreEl = document.getElementById('mood-score');
            const statusEl = document.getElementById('mood-status');

            if (scoreEl && statusEl) {
                scoreEl.textContent = data.score || '--';
                statusEl.textContent = data.status || '（未启动）';

                // 根据心情分设置颜色
                if (data.score >= 90) {
                    scoreEl.style.color = '#4ade80';  // 绿色 - 兴奋
                } else if (data.score >= 80) {
                    scoreEl.style.color = '#60a5fa';  // 蓝色 - 正常
                } else if (data.score >= 60) {
                    scoreEl.style.color = '#fb923c';  // 橙色 - 低落
                } else {
                    scoreEl.style.color = '#f87171';  // 红色 - 沉默
                }
            }
        }
    } catch (error) {
        console.error('加载心情分失败:', error);
    }
}

// 启动心情分轮询
function startMoodPolling() {
    // 每 3 秒轮询一次心情分
    moodPollingInterval = setInterval(() => {
        loadMoodStatus();
    }, 3000);
}

// 停止心情分轮询
function stopMoodPolling() {
    if (moodPollingInterval) {
        clearInterval(moodPollingInterval);
        moodPollingInterval = null;
    }
}

// ============ API Key 显示/隐藏 ============

function toggleApiKeyVisibility() {
    const apiKeyInput = document.getElementById('api-key');
    const toggleBtn = event.target;
    
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleBtn.textContent = '🙈';
    } else {
        apiKeyInput.type = 'password';
        toggleBtn.textContent = '👁️';
    }
}

// ============ 服务控制 ============

// 更新服务状态
function updateServiceStatus(serviceName, status) {
    serviceStates[serviceName] = status;
    const statusElement = document.getElementById(serviceName + '-status');
    const startBtn = document.getElementById(serviceName + '-start');
    const stopBtn = document.getElementById(serviceName + '-stop');
    const restartBtn = document.getElementById(serviceName + '-restart');
    
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
}

// 启动服务
async function startService(serviceName) {
    try {
        addLog('正在启动 ' + serviceName + ' 服务...', 'info', 'system');
        const response = await fetch('/api/start/' + serviceName, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'running');
            addLog(serviceName + ' 服务启动成功', 'success', 'system');
        } else {
            addLog(serviceName + ' 服务启动失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog(serviceName + ' 服务启动异常：' + error.message, 'error', 'system');
    }
}

// 停止服务
async function stopService(serviceName) {
    try {
        addLog('正在停止 ' + serviceName + ' 服务...', 'warning', 'system');
        const response = await fetch('/api/stop/' + serviceName, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            updateServiceStatus(serviceName, 'stopped');
            addLog(serviceName + ' 服务已停止', 'info', 'system');
        } else {
            addLog(serviceName + ' 服务停止失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog(serviceName + ' 服务停止异常：' + error.message, 'error', 'system');
    }
}

// 重启服务（仅 Live2D）
async function restartService(serviceName) {
    try {
        addLog('正在重启 ' + serviceName + ' 服务...', 'info', 'system');
        await stopService(serviceName);
        setTimeout(function() { startService(serviceName); }, 1500);
    } catch (error) {
        addLog(serviceName + ' 服务重启异常：' + error.message, 'error', 'system');
    }
}

// 一键启动全部服务
async function startAllServices() {
    addLog('开始一键启动全部服务...', 'info', 'system');
    const services = ['live2d', 'asr', 'tts', 'memos', 'rag', 'bert'];
    let successCount = 0;
    let failCount = 0;
    
    for (const service of services) {
        if (serviceStates[service] !== 'running') {
            addLog('正在启动 ' + service + ' 服务...', 'info', 'system');
            try {
                const response = await fetch('/api/start/' + service, { method: 'POST' });
                const result = await response.json();

                if (response.ok && result.success) {
                    updateServiceStatus(service, 'running');
                    addLog(service + ' 服务启动成功', 'success', 'system');
                    successCount++;
                } else {
                    addLog(service + ' 服务启动失败：' + (result.error || '未知错误'), 'error', 'system');
                    failCount++;
                }
            } catch (error) {
                addLog(service + ' 服务启动异常：' + error.message, 'error', 'system');
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
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
                    successCount++;
                } else {
                    addLog(service + ' 服务停止失败：' + (result.error || '未知错误'), 'error', 'system');
                    failCount++;
                }
            } catch (error) {
                addLog(service + ' 服务停止异常：' + error.message, 'error', 'system');
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    addLog('一键停止完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'info', 'system');
}

// 切换标签页
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
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
            addLog('保存失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存时出错：' + error.message, 'error', 'system');
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
    await saveConfig('/api/config/llm', config, 'LLM 配置保存成功');
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
    await saveConfig('/api/settings/chat', settings, '对话设置保存成功');
}

// 保存声音设置
async function saveVoiceSettings() {
    const settings = {
        tts: {
            enabled: document.getElementById('tts-enabled').checked,
            url: document.getElementById('tts-url').value,
            language: document.getElementById('tts-language').value
        },
        asr: {
            enabled: document.getElementById('asr-enabled').checked,
            vad_url: document.getElementById('vad-url').value,
            voice_barge_in: document.getElementById('voice-barge-in').checked
        },
        cloud_tts: {
            enabled: document.getElementById('cloud-tts-enabled').checked,
            api_key: document.getElementById('cloud-tts-api-key').value,
            model: document.getElementById('cloud-tts-model').value,
            voice: document.getElementById('cloud-tts-voice').value
        },
        baidu_asr: {
            enabled: document.getElementById('baidu-asr-enabled').checked,
            appid: document.getElementById('baidu-appid').value,
            appkey: document.getElementById('baidu-appkey').value
        }
    };
    await saveConfig('/api/settings/voice', settings, '声音设置保存成功');
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
        show_model: document.getElementById('show-model').checked,
        model_scale: parseFloat(document.getElementById('model-scale').value),
        subtitle_user: document.getElementById('subtitle-user').value,
        subtitle_ai: document.getElementById('subtitle-ai').value
    };
    await saveConfig('/api/settings/ui', settings, 'UI 设置保存成功');
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
        vision_enabled: document.getElementById('vision-enabled').checked,
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

// 当前工具选项卡
let currentToolTab = 'fc';

// 切换工具子选项卡
function switchToolTab(tab) {
    currentToolTab = tab;
    
    // 更新选项卡按钮状态
    document.querySelectorAll('.sub-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // 更新面板显示
    document.querySelectorAll('.tool-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(tab + '-tools-panel').classList.add('active');
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
        if (response.ok) {
            const data = await response.json();
            const fcToolsList = document.getElementById('fc-tools-list');
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
        } else {
            addLog('获取 Function Call 工具列表失败', 'error', 'system');
        }
    } catch (error) {
        addLog('获取 Function Call 工具列表时出错：' + error.message, 'error', 'system');
    }
}

// 刷新 MCP 工具列表
async function refreshMCPTools() {
    try {
        const response = await fetch('/api/tools/list/mcp');
        if (response.ok) {
            const data = await response.json();
            const mcpToolsList = document.getElementById('mcp-tools-list');
            mcpToolsList.innerHTML = '';
            
            const tools = data.tools || [];
            if (tools.length === 0) {
                mcpToolsList.innerHTML = '<div class="log-entry log-info">没有找到 MCP 工具</div>';
                return;
            }
            
            tools.forEach(tool => {
                const card = createToolCard(tool);
                mcpToolsList.appendChild(card);
            });
        } else {
            addLog('获取 MCP 工具列表失败', 'error', 'system');
        }
    } catch (error) {
        addLog('获取 MCP 工具列表时出错：' + error.message, 'error', 'system');
    }
}

// 创建工具卡片（折叠式）
function createToolCard(tool) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.toolName = tool.name;
    card.dataset.toolType = tool.type;
    card.dataset.isExternal = tool.is_external || false;
    
    const statusIcon = tool.enabled ? '●' : '○';
    const statusText = tool.enabled ? '已启用' : '已禁用';
    
    // 外部工具的特殊处理
    let displayName = tool.name;
    if (tool.is_external) {
        // 外部工具显示实际名称（去掉 _disabled）
        displayName = tool.actual_name || tool.name.replace('_disabled', '');
    }
    
    card.innerHTML = `
        <div class="tool-card-header" onclick="toggleToolDetail(this)">
            <h4>
                ${displayName}
                <span class="tool-short-desc">${tool.short_desc || ''}</span>
            </h4>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tool-status ${tool.enabled ? 'enabled' : 'disabled'}" style="font-size: 12px; padding: 4px 10px;">
                    ${statusIcon} ${statusText}
                </span>
                <button class="btn-toggle-tool" 
                        onclick="toggleTool(event, '${tool.name}', '${tool.type}', ${tool.enabled}, ${tool.is_external || false})"
                        style="padding: 6px 14px; font-size: 12px;">
                    ${tool.enabled ? '禁用' : '启用'}
                </button>
                <span class="toggle-icon">▼</span>
            </div>
        </div>
        <div class="tool-card-detail">
            <p class="tool-description">${tool.description || '无描述'}</p>
        </div>
    `;
    
    return card;
}

// 切换工具详情显示（折叠/展开）
function toggleToolDetail(headerEl) {
    const card = headerEl.closest('.tool-card');
    const detail = card.querySelector('.tool-card-detail');
    const toggleIcon = card.querySelector('.toggle-icon');
    
    if (detail.classList.contains('expanded')) {
        detail.classList.remove('expanded');
        detail.style.display = 'none';
        card.classList.remove('expanded');
    } else {
        detail.classList.add('expanded');
        detail.style.display = 'block';
        card.classList.add('expanded');
    }
}

// 切换工具启用状态
async function toggleTool(event, toolName, toolType, currentEnabled, isExternal) {
    event.stopPropagation();  // 防止触发卡片折叠
    
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
            const newEnabled = result.enabled;
            const statusIcon = newEnabled ? '●' : '○';
            const statusText = newEnabled ? '已启用' : '已禁用';
            const btnText = newEnabled ? '禁用' : '启用';
            
            // 更新卡片状态显示
            const card = event.target.closest('.tool-card');
            const statusEl = card.querySelector('.tool-status');
            const btnEl = card.querySelector('.btn-toggle-tool');
            
            statusEl.className = `tool-status ${newEnabled ? 'enabled' : 'disabled'}`;
            statusEl.innerHTML = `${statusIcon} ${statusText}`;
            btnEl.textContent = btnText;
            
            addLog(`工具 ${toolName} 已${newEnabled ? '启用' : '禁用'}`, 'success', 'system');
            
            // 关闭展开状态
            const detail = card.querySelector('.tool-card-detail');
            detail.classList.remove('expanded');
            detail.style.display = 'none';
            card.classList.remove('expanded');
            
            // 重新刷新对应工具列表
            if (toolType === 'fc') {
                refreshFCTools();
            } else {
                refreshMCPTools();
            }
        } else {
            addLog('切换工具状态失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换工具状态时出错：' + error.message, 'error', 'system');
    }
}

// 刷新模型列表
async function refreshModelList() {
    try {
        const response = await fetch('/api/models/list');
        if (response.ok) {
            const models = await response.json();
            const modelList = document.getElementById('model-list');
            const modelSelect = document.getElementById('current-model');
            modelList.innerHTML = '';
            modelSelect.innerHTML = '<option value="">选择模型...</option>';
            
            models.forEach(model => {
                const modelCard = document.createElement('div');
                modelCard.className = 'model-card';
                modelCard.innerHTML = '<h4>' + model + '</h4>';
                modelCard.onclick = function() {
                    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
                    modelCard.classList.add('selected');
                    modelSelect.value = model;
                };
                modelList.appendChild(modelCard);
                
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
        }
    } catch (error) {
        addLog('获取模型列表时出错：' + error.message, 'error', 'system');
    }
}

// 下载 Minecraft
async function downloadMinecraft() {
    try {
        addLog('正在下载 Minecraft 服务器...', 'info', 'system');
        const response = await fetch('/api/game/minecraft/download', { method: 'POST' });
        const result = await response.json();
        if (response.ok && result.success) {
            addLog('Minecraft 服务器下载完成', 'success', 'system');
        } else {
            addLog('下载失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('下载时出错：' + error.message, 'error', 'system');
    }
}

// 启动游戏
function launchGame(gameName) {
    addLog('正在启动 ' + gameName + '...', 'info', 'system');
}

// ============ 工具调用日志 ============

// 添加工具调用日志的函数（供外部调用）
function addToolLog(toolName, result) {
    addLog('工具调用：' + toolName + ' -> ' + result, 'info', 'tool');
}

// ============ 配置加载 ============

async function loadConfigs() {
    try {
        let resp = await fetch('/api/config/llm');
        if (resp.ok) {
            const config = await resp.json();
            document.getElementById('api-key').value = config.api_key || '';
            document.getElementById('api-url').value = config.api_url || '';
            document.getElementById('model').value = config.model || '';
            document.getElementById('temperature').value = config.temperature || 0.9;
            document.getElementById('system-prompt').value = config.system_prompt || '';
        }
        
        resp = await fetch('/api/settings/chat');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('intro-text').value = settings.intro_text || '';
            document.getElementById('max-messages').value = settings.max_messages || 30;
            document.getElementById('enable-limit').checked = settings.enable_limit || false;
            document.getElementById('persistent-history').checked = settings.persistent_history || false;
            document.getElementById('history-file').value = settings.history_file || '';
        }
        
        resp = await fetch('/api/settings/ui');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('show-chat-box').checked = settings.show_chat_box || false;
            document.getElementById('show-model').checked = settings.show_model || true;
            document.getElementById('model-scale').value = settings.model_scale || 2.3;
            document.getElementById('subtitle-user').value = settings.subtitle_user || '用户';
            document.getElementById('subtitle-ai').value = settings.subtitle_ai || 'AI';
        }
        
        resp = await fetch('/api/settings/autochat');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('auto-chat-enabled').checked = settings.enabled || false;
            document.getElementById('idle-time').value = settings.idle_time || 30;
            document.getElementById('auto-chat-prompt').value = settings.prompt || '';
            document.getElementById('mood-chat-enabled').checked = settings.mood_chat_enabled || false;
        }

        // 加载动态主动对话配置
        resp = await fetch('/api/settings/mood-chat');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('mood-chat-enabled').checked = settings.enabled || false;
            document.getElementById('mood-chat-prompt').value = settings.prompt || '';
        }
        
        resp = await fetch('/api/settings/advanced');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('vision-enabled').checked = settings.vision_enabled || false;
            document.getElementById('auto-screenshot').checked = settings.auto_screenshot || false;
            document.getElementById('use-vision-model').checked = settings.use_vision_model || false;
            document.getElementById('auto-close-services').checked = settings.auto_close_services || false;
        }

        // 加载基础配置
        loadBasicConfig();

        // 加载对话配置
        loadDialogConfig();

        resp = await fetch('/api/settings/tools');
        if (resp.ok) {
            const settings = await resp.json();
            // 工具开关已在基础配置中加载，这里只保留 MCP 配置（如果需要）
        }
        
        resp = await fetch('/api/settings/voice');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('tts-enabled').checked = settings.tts?.enabled || false;
            document.getElementById('tts-url').value = settings.tts?.url || '';
            document.getElementById('tts-language').value = settings.tts?.language || 'zh';
            document.getElementById('asr-enabled').checked = settings.asr?.enabled || false;
            document.getElementById('vad-url').value = settings.asr?.vad_url || '';
            document.getElementById('voice-barge-in').checked = settings.asr?.voice_barge_in || false;
            document.getElementById('cloud-tts-enabled').checked = settings.cloud_tts?.enabled || false;
            document.getElementById('cloud-tts-api-key').value = settings.cloud_tts?.api_key || '';
            document.getElementById('cloud-tts-model').value = settings.cloud_tts?.model || '';
            document.getElementById('cloud-tts-voice').value = settings.cloud_tts?.voice || '';
            document.getElementById('baidu-asr-enabled').checked = settings.baidu_asr?.enabled || false;
            document.getElementById('baidu-appid').value = settings.baidu_asr?.appid || '';
            document.getElementById('baidu-appkey').value = settings.baidu_asr?.appkey || '';
        }
        
        resp = await fetch('/api/settings/bilibili');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('bilibili-enabled').checked = settings.enabled || false;
            document.getElementById('bilibili-room-id').value = settings.roomId || '';
            document.getElementById('bilibili-check-interval').value = settings.checkInterval || 5000;
            document.getElementById('bilibili-max-messages').value = settings.maxMessages || 50;
        }
        
        resp = await fetch('/api/settings/game');
        if (resp.ok) {
            const settings = await resp.json();
            document.getElementById('minecraft-enabled').checked = settings.Minecraft?.enabled || false;
            document.getElementById('minecraft-server-url').value = settings.Minecraft?.server_url || '';
            document.getElementById('minecraft-agent-name').value = settings.Minecraft?.agent_name || '';
        }
    } catch (error) {
        console.error('加载配置失败:', error);
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

// 页面加载完成后初始化
window.onload = function() {
    checkServiceStatus();
    // 每 5 秒检查一次状态
    setInterval(checkServiceStatus, 5000);
    loadConfigs();
    loadPlugins();  // 加载插件列表
    refreshAllTools();  // 修改为刷新所有工具
    refreshModelList();

    // 重置日志计数器
    lastPetLogCount = 0;
    lastToolLogCount = 0;

    // 加载系统信息
    loadSystemInfo();
    // 每秒更新一次运行时间
    setInterval(updateUptime, 1000);

    // 加载心情分
    loadMoodStatus();

    // 启动日志轮询
    startLogPolling();
    // 启动心情分轮询
    startMoodPolling();

    addLog('WebUI 控制面板已就绪', 'success', 'system');
};

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

// 加载插件列表
async function loadPlugins() {
    try {
        const response = await fetch('/api/plugins/list');
        if (response.ok) {
            const plugins = await response.json();
            renderPlugins(plugins);
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
    card.dataset.pluginName = plugin.name;
    
    const statusIcon = plugin.enabled ? '●' : '○';
    const statusText = plugin.enabled ? '已启用' : '已禁用';
    const categoryLabel = plugin.category === 'built-in' ? '内置' : '社区';
    
    card.innerHTML = `
        <div class="plugin-card-header">
            <div>
                <h4>${plugin.display_name} <span style="font-size: 12px; opacity: 0.6;">v${plugin.version}</span></h4>
                <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">作者：${plugin.author} | 类别：${categoryLabel}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}">
                    ${statusIcon} ${statusText}
                </span>
            </div>
        </div>
        <p class="plugin-description">${plugin.description}</p>
        <div class="plugin-actions">
            <button class="btn-plugin-toggle" onclick="togglePlugin('${plugin.name}')">
                ${plugin.enabled ? '禁用' : '启用'}
            </button>
            <button class="btn-open-config" onclick="openPluginConfig('${plugin.name}')">
                打开配置
            </button>
        </div>
    `;
    
    return card;
}

// 切换插件启用状态
async function togglePlugin(pluginName) {
    try {
        const response = await fetch(`/api/plugins/${pluginName}/toggle`, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            const newEnabled = result.enabled;
            const card = document.querySelector(`.plugin-card[data-plugin-name="${pluginName}"]`);
            const statusEl = card.querySelector('.plugin-status');
            const toggleBtn = card.querySelector('.btn-plugin-toggle');
            
            statusEl.className = `plugin-status ${newEnabled ? 'enabled' : 'disabled'}`;
            statusEl.innerHTML = `${newEnabled ? '●' : '○'} ${newEnabled ? '已启用' : '已禁用'}`;
            toggleBtn.textContent = newEnabled ? '禁用' : '启用';
            
            addLog(`插件 ${pluginName} 已${newEnabled ? '启用' : '禁用'}`, 'success', 'system');
            
            // 重新加载插件列表
            loadPlugins();
        } else {
            addLog('切换插件状态失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换插件状态时出错：' + error.message, 'error', 'system');
    }
}

// 打开插件配置
async function openPluginConfig(pluginName) {
    try {
        const response = await fetch(`/api/plugins/${pluginName}/open-config`, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            addLog(result.message, 'success', 'system');
        } else {
            addLog('打开配置失败：' + (result.error || '未知错误'), 'error', 'system');
            if (result.config_path) {
                addLog(`配置路径：${result.config_path}`, 'info', 'system');
            }
        }
    } catch (error) {
        addLog('打开配置时出错：' + error.message, 'error', 'system');
    }
}

// 保存基础配置
async function saveBasicSettings() {
    try {
        const config = {
            vision_enabled: document.getElementById('vision-enabled').checked,
            auto_screenshot: document.getElementById('auto-screenshot').checked,
            use_vision_model: document.getElementById('use-vision-model').checked,
            auto_close_services: document.getElementById('auto-close-services').checked,
            show_chat_box: document.getElementById('show-chat-box').checked,
            show_model: document.getElementById('show-model').checked,
            voice_barge_in: document.getElementById('voice-barge-in').checked,
            tools_enabled: document.getElementById('tools-enabled').checked,
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
            addLog('基础配置已保存', 'success', 'system');
        } else {
            addLog('保存基础配置失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存基础配置时出错：' + error.message, 'error', 'system');
    }
}

// 加载基础配置
async function loadBasicConfig() {
    try {
        const response = await fetch('/api/settings/advanced');
        if (response.ok) {
            const config = await response.json();
            document.getElementById('vision-enabled').checked = config.vision_enabled || false;
            document.getElementById('auto-screenshot').checked = config.auto_screenshot || false;
            document.getElementById('use-vision-model').checked = config.use_vision_model || false;
            document.getElementById('auto-close-services').checked = config.auto_close_services || false;
            document.getElementById('show-chat-box').checked = config.show_chat_box || true;
            document.getElementById('show-model').checked = config.show_model || true;
            document.getElementById('voice-barge-in').checked = config.voice_barge_in || true;
            document.getElementById('tools-enabled').checked = config.tools_enabled || true;
            document.getElementById('mcp-enabled').checked = config.mcp_enabled || true;
            
            // 加载视觉模型配置
            if (config.vision_model) {
                document.getElementById('vision-model-api-key').value = config.vision_model.api_key || '';
                document.getElementById('vision-model-api-url').value = config.vision_model.api_url || '';
                document.getElementById('vision-model-name').value = config.vision_model.model || '';
            }
        }
    } catch (error) {
        console.error('加载基础配置失败:', error);
    }
}

// 保存对话配置
async function saveDialogSettings() {
    try {
        const config = {
            intro_text: document.getElementById('intro-text').value,
            max_messages: parseInt(document.getElementById('max-messages').value) || 30,
            enable_limit: document.getElementById('enable-limit').checked,
            persistent_history: document.getElementById('persistent-history').checked,
            tts_enabled: document.getElementById('tts-enabled').checked,
            asr_enabled: document.getElementById('asr-enabled').checked
        };
        
        const response = await fetch('/api/settings/dialog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            addLog('对话配置已保存', 'success', 'system');
        } else {
            addLog('保存对话配置失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存对话配置时出错：' + error.message, 'error', 'system');
    }
}

// 加载对话配置
async function loadDialogConfig() {
    try {
        const response = await fetch('/api/settings/dialog');
        if (response.ok) {
            const config = await response.json();
            document.getElementById('intro-text').value = config.intro_text || '你好啊';
            document.getElementById('max-messages').value = config.max_messages || 30;
            document.getElementById('enable-limit').checked = config.enable_limit || false;
            document.getElementById('persistent-history').checked = config.persistent_history || false;
            document.getElementById('tts-enabled').checked = config.tts_enabled || true;
            document.getElementById('asr-enabled').checked = config.asr_enabled || true;
        }
    } catch (error) {
        console.error('加载对话配置失败:', error);
    }
}

// 保存 UI 设置
async function saveUISettings() {
    try {
        const config = {
            subtitle_enabled: document.getElementById('subtitle-enabled').checked,
            model_scale: parseFloat(document.getElementById('model-scale').value) || 2.3,
            subtitle_user: document.getElementById('subtitle-user').value,
            subtitle_ai: document.getElementById('subtitle-ai').value
        };
        
        const response = await fetch('/api/settings/ui', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            addLog('UI 设置已保存', 'success', 'system');
        } else {
            addLog('保存 UI 设置失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存 UI 设置时出错：' + error.message, 'error', 'system');
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
            addLog(`Live2D 模型已切换为：${modelName}`, 'success', 'system');
        } else {
            addLog('切换模型失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换模型时出错：' + error.message, 'error', 'system');
    }
}

// 页面可见性改变时也检查状态
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        checkServiceStatus();
    }
});
