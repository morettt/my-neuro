// My Neuro WebUI - 前端 JavaScript v3.3

const serviceStates = {};
let currentLogTab = 'system-log';
let logPollingInterval = null;
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
    
    // 同步到第二个面板
    syncLogToPanel2();
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
}

// 清空第二个面板的当前日志
function clearCurrentLog2() {
    // 获取第一个面板当前的 tab 状态
    let outputId;
    const activeTab = document.querySelector('#logPanelContainer1 .log-tab.active');
    const tabName = activeTab ? activeTab.textContent : '系统日志';
    
    if (tabName === '桌宠日志') {
        outputId = 'pet-log-output2';
    } else if (tabName === '工具日志') {
        outputId = 'tool-log-output2';
    } else {
        outputId = 'system-log-output2';
    }
    
    const logOutput = document.getElementById(outputId);
    logOutput.innerHTML = '<div class="log-entry log-info">日志已清空</div>';
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
    
    // 同步滚动位置
    const activePanel1 = document.querySelector('#logPanelContainer1 .log-panel.active .log-container');
    const activePanel2 = document.querySelector('#logPanelContainer2 .log-panel.active .log-container');
    if (activePanel1 && activePanel2) {
        activePanel2.scrollTop = activePanel1.scrollTop;
    }
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
                buttonHTML = '<button class="config-save-button save-basic" onclick="saveBasicSettings()">保存基础配置</button>';
                break;
            case 'dialog-config':
                buttonHTML = '<button class="config-save-button save-dialog" onclick="saveDialogSettings()">保存对话配置</button>';
                break;
            case 'llm-config':
                buttonHTML = '<button class="config-save-button save-llm" onclick="saveLLMConfig()">保存 LLM 配置</button>';
                break;
            case 'voice-settings':
                buttonHTML = '<button class="config-save-button save-cloud" onclick="saveCloudSettings()">保存云端配置</button>';
                break;
            case 'ui-settings':
                buttonHTML = '<button class="config-save-button save-ui" onclick="saveUISettings()">保存 UI 设置</button>';
                break;
            default:
                // 无保存按钮的页面显示空占位，保持布局稳定
                buttonHTML = '<div class="config-save-placeholder"></div>';
                break;
        }
        configSaveButtons.innerHTML = buttonHTML;
    }

    // 切换选项卡时重新加载对应配置
    loadConfigForTab(tabName);
}

// 根据选项卡加载对应配置
function loadConfigForTab(tabName) {
    switch(tabName) {
        case 'basic-config':
            loadBasicConfig();
            break;
        case 'dialog-config':
            loadDialogConfig();
            break;
        case 'llm-config':
            loadLLMConfig();
            break;
        case 'voice-settings':
            loadCloudSettings();
            break;
        case 'ui-settings':
            loadUISettings();
            break;
        // 其他选项卡不需要加载配置
    }
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
    await saveConfig('/api/settings/chat', settings, '对话设置保存成功');
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
    await saveConfig('/api/settings/voice', data, '云端配置保存成功');
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
        alert('请先选择模型文件（pth）');
        return;
    }
    if (!selectedAudioFile) {
        alert('请先选择参考音频（wav）');
        return;
    }
    if (!roleName) {
        alert('请输入角色名称');
        return;
    }
    if (!text) {
        alert('请输入参考音频的文本内容');
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
            statusEl.textContent = '状态：' + result.message;
            statusEl.classList.add('has-file');
            alert(result.message);
        } else {
            statusEl.textContent = '状态：生成失败 - ' + (result.error || '未知错误');
            alert('生成失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        const statusEl = document.getElementById('voice-clone-status');
        statusEl.textContent = '状态：生成失败 - ' + error.message;
        alert('生成时出错：' + error.message);
    }
}

// 页面加载完成后初始化（主初始化入口）
document.addEventListener('DOMContentLoaded', function() {
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

    addLog('WebUI 控制面板已就绪', 'success', 'system');

    console.log('My Neuro WebUI 初始化完成');

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
        subtitle_labels: {
            enabled: document.getElementById('subtitle-enabled').checked,
            user: document.getElementById('subtitle-user').value,
            ai: document.getElementById('subtitle-ai').value
        }
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
    
    try {
        const response = await fetch('/api/tools/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: toolName,
                type: toolType
            })
        });

        const result = await response.json();
        
        if (response.ok && result.success) {
            const newEnabled = result.enabled;
            
            // 更新按钮文本
            toggleBtn.textContent = newEnabled ? '禁用' : '启用';
            
            // 更新状态显示 - 修复：使用正确的选择器查找状态元素
            const statusEl = card.querySelector('.tool-status-inline');
            if (statusEl) {
                const statusIcon = newEnabled ? '●' : '○';
                const statusText = newEnabled ? '已启用' : '已禁用';
                statusEl.className = `tool-status-inline ${newEnabled ? 'enabled' : 'disabled'}`;
                statusEl.textContent = `${statusIcon} ${statusText}`;
            }
            
            addLog(`工具 ${toolName} 已${newEnabled ? '启用' : '禁用'}`, 'success', 'system');
            
            // 刷新工具列表以获取最新状态
            if (toolType === 'fc') {
                refreshFCTools();
            } else {
                refreshMCPTools();
            }
        } else {
            addLog(`工具切换失败：${result.error || '未知错误'}`, 'error', 'system');
        }
    } catch (error) {
        addLog(`工具切换异常：${error.message}`, 'error', 'system');
    }
}
// 刷新模型列表
async function refreshModelList() {
    try {
        const response = await fetch('/api/models/list');
        
        if (response.ok) {
            const models = await response.json();
            const modelSelect = document.getElementById('live2d-model-select');

            // 如果元素不存在，跳过
            if (!modelSelect) {
                return;
            }

            // 清空选项
            modelSelect.innerHTML = '';
            
            // 添加模型到下拉框
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
            
            // 读取当前模型并选中
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

// ============ 游戏中心 ============

// 启动 Minecraft 游戏
async function startMinecraftGame() {
    try {
        const response = await fetch('/api/game/minecraft/start', { method: 'POST' });
        const result = await response.json();
        
        if (response.ok && result.success) {
            alert('Minecraft 游戏已启动！');
        } else {
            const errorMsg = result.error || '启动失败';
            if (errorMsg.includes('开启游戏终端.bat')) {
                alert('启动脚本不存在：开启游戏终端.bat');
            } else {
                alert('启动失败：' + errorMsg);
            }
        }
    } catch (error) {
        alert('启动时出错：' + error.message);
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

    card.innerHTML = `
        <div class="plugin-card-header">
            <div>
                <h4>${plugin.display_name} <span style="font-size: 12px; opacity: 0.6;">v${plugin.version}</span></h4>
                <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">作者：${plugin.author}</p>
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
            const action = result.action;
            const newEnabled = action === 'enabled';
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
        // 首先检查插件是否有配置文件
        const pluginsResponse = await fetch('/api/plugins/list');
        if (!pluginsResponse.ok) {
            throw new Error('无法获取插件列表');
        }
        
        const plugins = await pluginsResponse.json();
        const plugin = plugins.find(p => p.name === pluginName);
        
        if (!plugin || !plugin.has_own_config) {
            // 如果没有配置文件，使用原来的打开目录逻辑
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
            return;
        }
        
        // 如果有配置文件，打开配置模态框
        openPluginConfigModal(pluginName);
    } catch (error) {
        addLog('打开配置时出错：' + error.message, 'error', 'system');
    }
}

// 打开插件配置模态框
function openPluginConfigModal(pluginName) {
    // 设置模态框标题
    document.getElementById('pluginConfigModalTitle').textContent = `插件配置 - ${pluginName}`;
    
    // 显示加载状态
    document.getElementById('pluginConfigLoading').style.display = 'block';
    document.getElementById('pluginConfigError').style.display = 'none';
    document.getElementById('pluginConfigForm').style.display = 'none';
    
    // 显示模态框
    document.getElementById('pluginConfigModal').style.display = 'block';
    
    // 加载配置数据
    loadPluginConfig(pluginName);
}

// 关闭插件配置模态框
function closePluginConfigModal() {
    document.getElementById('pluginConfigModal').style.display = 'none';
}

// 加载插件配置
async function loadPluginConfig(pluginName) {
    try {
        const response = await fetch(`/api/plugins/${pluginName}/config`);
        const result = await response.json();
        
        if (response.ok && result.success) {
            // 隐藏加载状态，显示表单
            document.getElementById('pluginConfigLoading').style.display = 'none';
            document.getElementById('pluginConfigForm').style.display = 'block';
            
            // 渲染配置表单
            renderPluginConfigForm(result.config, pluginName);
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

// 渲染插件配置表单
function renderPluginConfigForm(config, pluginName) {
    const fieldsContainer = document.getElementById('pluginConfigFields');
    fieldsContainer.innerHTML = '';
    
    // 保存原始配置用于重置
    window.currentPluginConfig = JSON.parse(JSON.stringify(config));
    window.currentPluginName = pluginName;
    
    // 遍历所有配置字段
    for (const [key, field] of Object.entries(config)) {
        const fieldElement = createConfigField(key, field, pluginName);
        fieldsContainer.appendChild(fieldElement);
    }
}

// 创建配置字段元素
function createConfigField(key, field, pluginName) {
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
                const nestedFieldElement = createConfigField(nestedKey, nestedField, pluginName);
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
    if (!window.currentPluginConfig || !window.currentPluginName) {
        return;
    }
    
    const config = JSON.parse(JSON.stringify(window.currentPluginConfig));
    
    // 遍历所有字段，重置为默认值
    for (const [key, field] of Object.entries(config)) {
        resetFieldToDefault(key, field);
    }
    
    addLog('配置已重置为默认值', 'info', 'system');
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

// 保存插件配置
async function savePluginConfig() {
    if (!window.currentPluginConfig || !window.currentPluginName) {
        return;
    }
    
    try {
        // 收集表单数据
        const updatedConfig = collectConfigFormData(window.currentPluginConfig);
        
        // 发送保存请求
        const response = await fetch(`/api/plugins/${window.currentPluginName}/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedConfig)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            addLog('插件配置保存成功', 'success', 'system');
            closePluginConfigModal();
            // 重新加载插件列表以更新状态
            loadPlugins();
        } else {
            addLog('保存配置失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('保存配置时出错：' + error.message, 'error', 'system');
    }
}

// 收集表单数据
function collectConfigFormData(originalConfig) {
    const updatedConfig = JSON.parse(JSON.stringify(originalConfig));
    
    for (const [key, field] of Object.entries(updatedConfig)) {
        updateFieldFromForm(key, field);
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

// 更新插件卡片按钮状态
function updatePluginCardButtons(plugins) {
    plugins.forEach(plugin => {
        const card = document.querySelector(`.plugin-card[data-plugin-name="${plugin.name}"]`);
        if (card) {
            const configBtn = card.querySelector('.btn-open-config');
            if (configBtn) {
                if (plugin.has_own_config) {
                    configBtn.textContent = '配置';
                    configBtn.disabled = false;
                    configBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
                } else {
                    configBtn.textContent = '无配置';
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
            vision_enabled: document.getElementById('vision-enabled').checked,
            auto_screenshot: document.getElementById('auto-screenshot').checked,
            use_vision_model: document.getElementById('use-vision-model').checked,
            show_chat_box: document.getElementById('show-chat-box').checked,
            show_model: !document.getElementById('hide-model').checked,  // 勾选表示隐藏，所以取反
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
            _setChk('vision-enabled', config.vision_enabled === true);
            _setChk('auto-screenshot', config.auto_screenshot === true);
            _setChk('use-vision-model', config.use_vision_model === true);
            _setChk('auto-close-services', config.auto_close_services === true);
            _setChk('show-chat-box', config.show_chat_box === true);
            _setChk('show-model', config.show_model === true);
            _setChk('voice-barge-in', config.voice_barge_in === true);
            _setChk('tools-enabled', config.tools_enabled === true);
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
            _setVal('model-scale', data.model_scale || 2.3);
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
            
            // 自动刷新动作和表情配置
            await loadExpressionConfig();
            await loadAllMotions();
            
            addLog('已重新加载动作和表情配置', 'info', 'system');
        } else {
            addLog('切换模型失败：' + (result.error || '未知错误'), 'error', 'system');
        }
    } catch (error) {
        addLog('切换模型时出错：' + error.message, 'error', 'system');
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
            addLog('皮套位置已复位', 'success', 'system');
            alert('皮套位置已复位，请重启桌宠生效');
        } else {
            addLog('复位皮套位置失败：' + (result.error || '未知错误'), 'error', 'system');
            alert('复位失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        addLog('复位皮套位置时出错：' + error.message, 'error', 'system');
        alert('复位出错：' + error.message);
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
                    alert('请在 LLM 配置中保存');
                } else {
                    alert('应用失败：' + (res.error || '未知错误'));
                }
            }
        }
    } catch (error) {
        alert('应用时出错：' + error.message);
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
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载���败') + '</div>';
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
            alert(`工具 ${toolName} 已下载！`);
        } else {
            alert('下载失败：' + (res.error || '未知错误'));
        }
    } catch (error) {
        alert('下载时出错：' + error.message);
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
            alert(`FC 工具 ${toolName} 已下载！`);
        } else {
            alert('下载失败：' + (res.error || '未知错误'));
        }
    } catch (error) {
        alert('下载时出错：' + error.message);
    }
}

// 刷新插件广场
async function refreshPluginMarket() {
    try {
        const listElement = document.getElementById('plugin-market-list');
        listElement.innerHTML = '<div class="log-entry log-info">正在加载插件列表...</div>';

        const response = await fetch('/api/market/plugins');
        const data = await response.json();

        if (data.success && data.plugins && data.plugins.length > 0) {
            listElement.innerHTML = '';
            data.plugins.forEach((plugin) => {
                const card = createPluginMarketCard(plugin);
                listElement.appendChild(card);
            });
        } else if (data.success) {
            listElement.innerHTML = '<div class="log-entry log-info">暂无插件</div>';
        } else {
            listElement.innerHTML = '<div class="log-entry log-error">' + (data.error || '加载��败') + '</div>';
        }
    } catch (error) {
        document.getElementById('plugin-market-list').innerHTML =
            '<div class="log-entry log-error">加载出错：' + error.message + '</div>';
    }
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
    const downloadUrl = plugin.download_url || repo + '/archive/refs/heads/main.zip';
    const installed = plugin.installed || false;
    const installing = plugin.installing || false;

    // 根据状态设置按钮文本和样式（installed 优先于 installing）
    let btnText, btnDisabled;
    if (installed) {
        // 已安装状态优先
        btnText = '✓ 已安装';
        btnDisabled = 'disabled';
    } else if (installing) {
        // 正在安装
        btnText = '⏳ 安装中...';
        btnDisabled = 'disabled';
    } else {
        // 未安装
        btnText = '⬇ 安装';
        btnDisabled = '';
    }

    const html = `<div class="market-card-header">
        <h4 class="market-card-title">🧩 ${displayName}</h4>
        <p class="market-card-author">作者：${author}</p>
        <p class="market-card-summary">${desc}</p>
        <div class="install-progress" id="progress-${pluginName}" style="display: none;">
            <div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>
            <span class="progress-text">准备中...</span>
        </div>
    </div>
    <button onclick="installPlugin('${pluginName.replace(/'/g, "\\'")}', '${downloadUrl.replace(/'/g, "\\'")}')" 
        class="btn-sm" style="margin-top: 10px;" ${btnDisabled}>${btnText}</button>`;

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
            body: JSON.stringify({ plugin_name: pluginName, download_url: downloadUrl })
        });
        const res = await result.json();
        
        if (res.success) {
            // 开始轮询检测插件目录
            pollPluginInstalled(pluginName);
        } else {
            alert('安装失败：' + (res.error || '未知错误'));
            // 恢复按钮状态
            restoreInstallButton(pluginName, '⬇ 安装');
        }
    } catch (error) {
        alert('安装时出错：' + error.message);
        restoreInstallButton(pluginName, '⬇ 安装');
    }
}

// 恢复安装按钮状态
function restoreInstallButton(pluginName, text) {
    const card = document.querySelector(`.market-card[data-plugin-name="${pluginName}"]`);
    if (card) {
        const btn = card.querySelector('button');
        btn.disabled = false;
        btn.textContent = text;
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
                if (progressText) progressText.textContent = '✓ 安装完成';
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
                if (progressText) progressText.textContent = '安装超时，请重试';
                restoreInstallButton(pluginName, '⬇ 安装');
            }
        } catch (error) {
            console.error('轮询安装状态失败:', error);
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
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

// 开始唱歌
async function startSinging() {
    try {
        const response = await fetch('/api/live2d/singing/start', { method: 'POST' });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            alert('启动失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('启动时出错：' + error.message);
    }
}

// 停止唱歌
async function stopSinging() {
    try {
        const response = await fetch('/api/live2d/singing/stop', { method: 'POST' });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            alert('停止失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('停止时出错：' + error.message);
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
            alert('动作配置已还原');
            // 重新加载配置
            await loadAllMotions();
        } else {
            alert('复位失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('复位时出错：' + error.message);
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
    try {
        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: motionName })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
    }
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
        alert('该动作已绑定到此情绪');
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
    try {
        const response = await fetch('/api/live2d/motion/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motion: filePath })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
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
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
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
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
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
        } else {
            alert('保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('保存时出错：' + error.message);
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
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
    }
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
        alert('该表情已绑定到此情绪');
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
        
        const response = await fetch('/api/live2d/expression/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: fullExpressionName })
        });
        const result = await response.json();
        if (!(response.ok && result.success)) {
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
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
            alert('预览失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('预览时出错：' + error.message);
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
        } else {
            alert('保存失败：' + (result.error || '未知错误'));
        }
    } catch (error) {
        alert('保存时出错：' + error.message);
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
