// Utilities
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

const TYPE_EMOJI = {
    'general': '📝', 'preference': '💜', 'fact': '💡',
    'semantic': '🧠', 'episodic': '📅', 'procedural': '⚙️',
    'document': '📄', 'image': '🖼️', 'tool': '🔧'
};

const TYPE_LABEL = {
    'general': '通用', 'preference': '偏好', 'fact': '事实',
    'semantic': '语义', 'episodic': '情景', 'procedural': '程序性',
    'document': '文档', 'image': '图片', 'tool': '工具'
};

const LAYER_LABEL = {
    'WorkingMemory': '工作记忆',
    'LongTermMemory': '长期记忆',
    'UserMemory': '用户记忆'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function shortId(value, size = 8) {
    const text = String(value || '');
    return text.length > size ? `${text.slice(0, size)}...` : text;
}

function jsString(value) {
    return escapeHtml(String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n'));
}

function parseCsvInput(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function formatLayerLabel(layer) {
    return LAYER_LABEL[layer] || layer || '未分层';
}

function formatEvolutionPhase(phase) {
    return {
        initial_catch_up: '启动补跑',
        due: '已到期',
        waiting: '等待中',
        queued: '已排队',
        running: '执行中'
    }[phase] || '未知';
}

function formatRemaining(seconds) {
    if (seconds == null) return '--';
    const total = Math.max(Number(seconds) || 0, 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function collectSelectedSearchLayers() {
    return Array.from(document.querySelectorAll('#ops-search-layers input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
}

// Global State
let allMemories = [];
let archivedMemories = [];
let currentPage = 1;
let itemsPerPage = 20;
let network = null;
let currentKbFilter = '';

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSystemStatus();
    initMemoryList();
    initOperations();
    initGraph();
    initKnowledgeBase();
    initToolMemory();

    // Load initial data
    loadDashboardData();
    loadMemories();
});

// Tab Switching
function initTabs() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            // Special actions on tab switch
            if (targetId === 'knowledge-graph') {
                if (network) network.fit();
                else renderGraph();
            } else if (targetId === 'image-memory') {
                loadImages(false);
            } else if (targetId === 'knowledge-base') {
                loadKnowledgeBases();
                loadKbDocs(currentKbFilter);
            } else if (targetId === 'tool-memory') {
                loadToolMemory();
            } else if (targetId === 'archive-list') {
                loadArchivedMemories();
            }
        });
    });
}

// System Status
async function initSystemStatus() {
    const dot = document.getElementById('api-status-dot');
    const text = document.getElementById('api-status-text');
    const sidebarTotal = document.getElementById('sidebar-total-memory');

    const updateStatus = async () => {
        const { status, data } = await API.checkHealth();
        if (status) {
            dot.className = 'status-dot online';
            text.textContent = '系统在线';
            sidebarTotal.textContent = data.memory_count || 0;
        } else {
            dot.className = 'status-dot offline';
            text.textContent = '系统离线';
        }
    };

    updateStatus();
    setInterval(updateStatus, 10000);
}

// Dashboard
async function loadDashboardData() {
    const stats = await API.getStats();
    const graphStats = await API.getGraphStats();

    if (stats) {
        document.getElementById('dash-total-memory').textContent = stats.total_count || 0;
        document.getElementById('dash-today-count').textContent = stats.today_count || 0;
        document.getElementById('dash-week-count').textContent = stats.week_count || 0;
        document.getElementById('dash-archived-count').textContent = stats.archived_count || 0;
        document.getElementById('dash-avg-importance').textContent =
            stats.avg_importance ? `${(stats.avg_importance * 100).toFixed(0)}%` : 'N/A';
        if (stats.evolution) {
            document.getElementById('dash-evolution-phase').textContent = formatEvolutionPhase(stats.evolution.phase);
            document.getElementById('dash-evolution-remaining').textContent = formatRemaining(stats.evolution.seconds_until_next_run);
        }
    }

    if (graphStats) {
        document.getElementById('dash-entity-count').textContent = graphStats.entity_count || 0;
        document.getElementById('dash-graph-status').textContent = '已启用';
    } else {
        document.getElementById('dash-graph-status').textContent = '未启用';
    }
}

// Memory List
function initMemoryList() {
    document.getElementById('btn-search').addEventListener('click', () => {
        currentPage = 1;
        renderMemoryList();
    });

    document.getElementById('filter-limit').addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;
        renderMemoryList();
    });

    const layerFilter = document.getElementById('filter-layer');
    if (layerFilter) {
        layerFilter.addEventListener('change', () => {
            currentPage = 1;
            renderMemoryList();
        });
    }

    const archiveRefreshBtn = document.getElementById('btn-archive-refresh');
    if (archiveRefreshBtn) archiveRefreshBtn.addEventListener('click', loadArchivedMemories);
    const archiveLayerFilter = document.getElementById('archive-filter-layer');
    if (archiveLayerFilter) archiveLayerFilter.addEventListener('change', loadArchivedMemories);

    // Modal close
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-edit').addEventListener('click', closeModal);
    document.getElementById('btn-save-edit').addEventListener('click', saveMemoryEdit);
}

async function loadMemories() {
    const container = document.getElementById('memory-list-container');
    container.innerHTML = '<div class="loading-text">加载记忆中...</div>';

    const data = await API.getMemories({ status: 'active', limit: 0 });
    if (data && data.memories) {
        allMemories = data.memories.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        renderMemoryList();
    } else {
        container.innerHTML = '<div class="loading-text">加载失败</div>';
    }
}

async function loadArchivedMemories() {
    const container = document.getElementById('archive-list-container');
    if (!container) return;
    container.innerHTML = '<div class="loading-text">加载归档记忆中...</div>';

    const layer = document.getElementById('archive-filter-layer')?.value || '';
    const data = await API.getMemories({ status: 'archived', layer, limit: 0 });
    if (data && data.memories) {
        archivedMemories = data.memories.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        renderArchivedMemoryList();
    } else {
        container.innerHTML = '<div class="loading-text">加载失败</div>';
    }
}

function renderMemoryList() {
    const typeFilter = document.getElementById('filter-type').value;
    const layerFilter = document.getElementById('filter-layer')?.value || '';
    const keyword = document.getElementById('search-keyword').value.toLowerCase();

    let filtered = allMemories;
    if (typeFilter) {
        filtered = filtered.filter(m => m.memory_type === typeFilter);
    }
    if (layerFilter) {
        filtered = filtered.filter(m => m.layer === layerFilter);
    }
    if (keyword) {
        filtered = filtered.filter(m => (m.content || '').toLowerCase().includes(keyword));
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const container = document.getElementById('memory-list-container');
    container.innerHTML = '';

    if (paginated.length === 0) {
        container.innerHTML = '<div class="loading-text">没有找到匹配的记忆</div>';
    } else {
        paginated.forEach((mem, index) => {
            const globalIndex = start + index + 1;
            const mtype = mem.memory_type || 'general';
            const emoji = TYPE_EMOJI[mtype] || '📝';
            const label = TYPE_LABEL[mtype] || mtype;
            const imp = (mem.importance || 0.5) * 100;
            const timeStr = mem.created_at ? new Date(mem.created_at).toLocaleString('zh-CN', {hour12: false}) : '';

            const tagsHtml = (mem.tags || []).map(t => `<span class="tag">🏷️ ${escapeHtml(t)}</span>`).join('');
            const payload = mem.payload || {};
            const sourceHtml = payload.scope === 'kb' || mem.memory_type === 'document'
                ? `<div class="memory-source">知识库: ${escapeHtml(payload.kb_id || 'default')} | 文档: ${escapeHtml(payload.title || payload.doc_id || payload.source || '')}</div>`
                : '';

            const layerLabel = formatLayerLabel(mem.layer);
            const accessCount = mem.access_count ?? 0;
            const card = document.createElement('div');
            card.className = 'memory-card';
            card.innerHTML = `
                <div class="memory-header">
                    <div>
                        <strong>#${globalIndex}</strong>
                        <span class="memory-type memory-type-inline">${emoji} ${label}</span>
                    </div>
                    <span class="memory-id">ID: ${escapeHtml(mem.id)}</span>
                </div>
                <div class="memory-content">${escapeHtml(mem.content)}</div>
                ${sourceHtml}
                ${tagsHtml ? `<div class="memory-tags">${tagsHtml}</div>` : ''}
                <div class="memory-footer">
                    <div>重要度 ${imp.toFixed(0)}% | ${timeStr} | 层级 ${escapeHtml(layerLabel)} | 命中 ${accessCount} 次</div>
                    <div class="memory-actions">
                        <button type="button" class="cyber-btn" onclick="openEditModal('${mem.id}')">✏️ 修改</button>
                        <button type="button" class="cyber-btn" onclick="archiveMemoryFromList('${mem.id}')">🗄️ 归档</button>
                        <button type="button" class="cyber-btn danger" onclick="deleteMemory('${mem.id}')">🗑️ 删除</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    container.innerHTML = `
        <button type="button" class="cyber-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(1)">首页</button>
        <button type="button" class="cyber-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">上页</button>
        <span class="pagination-status">${currentPage} / ${totalPages}</span>
        <button type="button" class="cyber-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">下页</button>
        <button type="button" class="cyber-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${totalPages})">末页</button>
    `;
}

window.changePage = function(page) {
    currentPage = page;
    renderMemoryList();
};

window.deleteMemory = async function(id) {
    if (confirm('确定要删除这条记忆吗？')) {
        const success = await API.deleteMemory(id);
        if (success) {
            showToast('删除成功', 'success');
            loadMemories();
            loadArchivedMemories();
            loadDashboardData();
        } else {
            showToast('删除失败', 'error');
        }
    }
};

window.archiveMemoryFromList = async function(id) {
    if (!confirm('确定要归档这条记忆吗？归档后默认不参与检索，但可恢复。')) return;
    const result = await API.archiveMemory(id, 'cyberpunk_ui_archive');
    if (result && result.status === 'success') {
        showToast('归档成功', 'success');
        loadMemories();
        loadArchivedMemories();
        loadDashboardData();
    } else {
        showToast('归档失败', 'error');
    }
};

window.openEditModal = function(id) {
    const mem = allMemories.find(m => m.id === id);
    if (mem) {
        document.getElementById('edit-memory-id').value = id;
        document.getElementById('edit-memory-content').value = mem.content || '';
        document.getElementById('edit-modal').classList.add('active');
    }
};

function closeModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

function renderArchivedMemoryList() {
    const container = document.getElementById('archive-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (!archivedMemories.length) {
        container.innerHTML = '<div class="loading-text">暂无归档记忆</div>';
        return;
    }

    archivedMemories.forEach((mem, index) => {
        const mtype = mem.memory_type || 'general';
        const emoji = TYPE_EMOJI[mtype] || '📝';
        const label = TYPE_LABEL[mtype] || mtype;
        const imp = (mem.importance || 0.5) * 100;
        const timeStr = mem.updated_at || mem.created_at ? new Date(mem.updated_at || mem.created_at).toLocaleString('zh-CN', {hour12: false}) : '';
        const tagsHtml = (mem.tags || []).map(t => `<span class="tag">🏷️ ${escapeHtml(t)}</span>`).join('');
        const layerLabel = formatLayerLabel(mem.layer);

        const card = document.createElement('div');
        card.className = 'memory-card';
        card.innerHTML = `
            <div class="memory-header">
                <div>
                    <strong>#${index + 1}</strong>
                    <span class="memory-type memory-type-inline">${emoji} ${label}</span>
                </div>
                <span class="memory-id">ID: ${escapeHtml(mem.id)}</span>
            </div>
            <div class="memory-content">${escapeHtml(mem.content)}</div>
            ${tagsHtml ? `<div class="memory-tags">${tagsHtml}</div>` : ''}
            <div class="memory-footer">
                <div>重要度 ${imp.toFixed(0)}% | ${timeStr} | 层级 ${escapeHtml(layerLabel)} | 状态 archived</div>
                <div class="memory-actions">
                    <button type="button" class="cyber-btn success" onclick="restoreArchivedMemory('${mem.id}')">♻️ 恢复</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

window.restoreArchivedMemory = async function(id) {
    const result = await API.restoreMemory(id);
    if (result && result.status === 'success') {
        showToast('恢复成功', 'success');
        loadArchivedMemories();
        loadMemories();
        loadDashboardData();
    } else {
        showToast('恢复失败', 'error');
    }
};

async function saveMemoryEdit() {
    const id = document.getElementById('edit-memory-id').value;
    const newContent = document.getElementById('edit-memory-content').value;

    document.getElementById('btn-save-edit').disabled = true;
    const success = await API.editMemory(id, newContent);
    document.getElementById('btn-save-edit').disabled = false;

    if (success) {
        showToast('修改成功', 'success');
        closeModal();
        loadMemories();
    } else {
        showToast('修改失败', 'error');
    }
}

// Operations
function initOperations() {
    // Sync range values
    const syncRange = (id) => {
        const input = document.getElementById(id);
        const val = document.getElementById(`${id}-val`);
        input.addEventListener('input', () => val.textContent = input.value);
    };
    syncRange('ops-topk');
    syncRange('ops-threshold');
    syncRange('ops-add-imp');
    syncRange('ops-dedup-threshold');

    // Search
    document.getElementById('btn-ops-search').addEventListener('click', async () => {
        const query = document.getElementById('ops-search-query').value;
        if (!query) return;

        const topK = parseInt(document.getElementById('ops-topk').value);
        const threshold = parseFloat(document.getElementById('ops-threshold').value);
        const useGraph = document.getElementById('ops-use-graph').checked;
        const useBm25 = document.getElementById('ops-use-bm25')?.checked;
        const selectedType = document.getElementById('ops-search-type')?.value;
        const tags = parseCsvInput(document.getElementById('ops-search-tags')?.value);
        const layers = collectSelectedSearchLayers();
        if (!layers.length) {
            showToast('请至少选择一个检索层级', 'error');
            return;
        }

        const btn = document.getElementById('btn-ops-search');
        btn.disabled = true;
        btn.textContent = '检索中...';

        const result = await API.searchMemories(query, topK, useGraph, threshold, {
            use_bm25: useBm25,
            memory_types: selectedType ? [selectedType] : null,
            tags: tags.length ? tags : null,
            layers
        });

        btn.disabled = false;
        btn.textContent = '开始检索';

        const container = document.getElementById('ops-search-results');
        container.innerHTML = '';

        if (result && result.memories && result.memories.length > 0) {
            showToast(`找到 ${result.memories.length} 条相关记忆`, 'success');
            result.memories.forEach((m, i) => {
                const mtype = m.memory_type || 'general';
                const emoji = TYPE_EMOJI[mtype] || '📝';
                const sim = (m.similarity || 0) * 100;
                const finalScore = typeof m.final_score === 'number' ? m.final_score.toFixed(4) : 'N/A';
                const coarseScore = typeof m.coarse_score === 'number' ? m.coarse_score.toFixed(4) : 'N/A';
                const rerankScore = typeof m.rerank_score === 'number' ? m.rerank_score.toFixed(4) : 'N/A';
                const matchedEntities = (m.matched_entities || []).map(e => escapeHtml(e.name || e.id)).join('、');
                const graphReason = m.graph_boost_reason ? `<div class="explain-line">图谱原因: ${escapeHtml(m.graph_boost_reason)} | 加分: ${(m.graph_boost || 0).toFixed(2)}</div>` : '';
                const sourceLine = m.source || m.source_type ? `<div class="explain-line">来源: ${escapeHtml(m.source_type || '未知')} ${escapeHtml(m.source || '')}</div>` : '';
                const entityLine = matchedEntities ? `<div class="explain-line">命中实体: ${matchedEntities}</div>` : '';
                const scoreLine = `<div class="explain-line">最终分: ${finalScore} | 粗排: ${coarseScore} | 精排: ${rerankScore}${m.bm25_score !== undefined ? ` | 向量: ${(m.vector_score || 0).toFixed(2)} | BM25: ${(m.bm25_score || 0).toFixed(2)}` : ''}</div>`;
                const metaLine = `<div class="explain-line">层级: ${escapeHtml(formatLayerLabel(m.layer))} | 状态: ${escapeHtml(m.status || 'active')} | 访问: ${m.access_count ?? 0} 次</div>`;

                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `
                    <div class="search-result-header">
                        <strong>#${i+1}</strong> ${emoji}
                    </div>
                    <div class="search-result-content">${escapeHtml(m.content)}</div>
                    <div class="sim-score">相似度: ${sim.toFixed(1)}%</div>
                    <div class="explain-box">
                        ${metaLine}
                        ${scoreLine}
                        ${graphReason}
                        ${entityLine}
                        ${sourceLine}
                    </div>
                `;
                container.appendChild(item);
            });
        } else {
            container.innerHTML = '<div class="loading-text">未找到相关记忆</div>';
        }
    });

    // Add Memory
    document.getElementById('btn-ops-add').addEventListener('click', async () => {
        const content = document.getElementById('ops-add-content').value;
        if (!content) return;

        const imp = parseFloat(document.getElementById('ops-add-imp').value);
        const memoryType = document.getElementById('ops-add-type')?.value || 'general';
        const tags = parseCsvInput(document.getElementById('ops-add-tags')?.value);
        const extractEntities = document.getElementById('ops-add-extract-entities')?.checked;

        const btn = document.getElementById('btn-ops-add');
        btn.disabled = true;
        btn.textContent = '添加中...';

        const success = await API.addMemory(content, imp, {
            memory_type: memoryType,
            tags,
            extract_entities: extractEntities
        });

        btn.disabled = false;
        btn.textContent = '添加记忆';

        if (success) {
            showToast('添加成功', 'success');
            document.getElementById('ops-add-content').value = '';
            loadMemories();
            loadDashboardData();
        } else {
            showToast('添加失败', 'error');
        }
    });

    // Deduplicate
    document.getElementById('btn-ops-dedup').addEventListener('click', async () => {
        const threshold = parseFloat(document.getElementById('ops-dedup-threshold').value);

        const btn = document.getElementById('btn-ops-dedup');
        btn.disabled = true;
        btn.textContent = '去重合并中... (可能需要较长时间)';

        const result = await API.deduplicateMemories(threshold);

        btn.disabled = false;
        btn.textContent = '开始全局去重';

        const container = document.getElementById('ops-dedup-results');
        container.innerHTML = '';

        if (result && result.status === 'success') {
            showToast(`去重完成，合并了 ${result.merged_count} 条记忆`, 'success');

            if (result.merge_details && result.merge_details.length > 0) {
                result.merge_details.forEach((detail, i) => {
                    const item = document.createElement('div');
                    item.className = 'search-result-item';
                    item.innerHTML = `
                        <div style="margin-bottom: 5px; color: var(--accent);">
                            <strong>合并 #${i+1}</strong> (相似度: ${detail.similarity}%)
                        </div>
                        <div style="margin-bottom: 8px; font-size: 12px; color: var(--text-secondary);">
                            <strong>记忆 1:</strong> ${detail.memory_1}<br>
                            <strong>记忆 2:</strong> ${detail.memory_2}
                        </div>
                        <div style="padding: 8px; background: rgba(0, 240, 255, 0.1); border-radius: 4px;">
                            <strong>合并结果:</strong> ${detail.result}
                        </div>
                    `;
                    container.appendChild(item);
                });
            } else {
                container.innerHTML = '<div class="loading-text">没有找到需要合并的记忆</div>';
            }

            loadMemories();
            loadDashboardData();
        } else {
            showToast('去重失败', 'error');
            container.innerHTML = '<div class="loading-text" style="color: var(--red);">去重操作失败</div>';
        }
    });

    const recoverBtn = document.getElementById('btn-ops-recover');
    if (recoverBtn) {
        recoverBtn.addEventListener('click', async () => {
            const memoryId = document.getElementById('ops-recover-memory-id').value.trim();
            const recordId = document.getElementById('ops-recover-record-id').value.trim();
            const container = document.getElementById('ops-recover-result');

            if (!memoryId && !recordId) {
                showToast('请输入记忆 ID 或删除记录 ID', 'error');
                return;
            }

            recoverBtn.disabled = true;
            recoverBtn.textContent = '恢复中...';
            const result = await API.recoverMemory(memoryId, recordId);
            recoverBtn.disabled = false;
            recoverBtn.textContent = '恢复记忆';

            if (result && result.status === 'success') {
                showToast('恢复成功', 'success');
                container.innerHTML = `<div class="search-result-item" style="border-color: var(--green);">已恢复记忆: ${escapeHtml(result.memory_id)}</div>`;
                loadMemories();
                loadDashboardData();
            } else {
                showToast('恢复失败', 'error');
                container.innerHTML = '<div class="search-result-item" style="border-color: var(--red);">未找到可恢复记忆或恢复失败</div>';
            }
        });
    }

    // Knowledge Base Import
    const btnKbImport = document.getElementById('btn-kb-import');
    if (btnKbImport) {
        btnKbImport.addEventListener('click', async () => {
            const source = document.getElementById('kb-import-source').value;
            if (!source) return;

            const extractEntities = document.getElementById('kb-extract-entities').checked;
            const kbId = document.getElementById('kb-import-kb-id')?.value.trim() || 'default';
            const title = document.getElementById('kb-import-title')?.value.trim() || null;

            btnKbImport.disabled = true;
            btnKbImport.textContent = '导入中...';

            const result = await API.importDocument(source, extractEntities, { kb_id: kbId, title });

            btnKbImport.disabled = false;
            btnKbImport.textContent = '开始导入';

            const container = document.getElementById('kb-import-result');
            container.innerHTML = '';

            if (result && result.status === 'success') {
                showToast(`导入成功: ${result.imported_count} 条块`, 'success');
                container.innerHTML = `
                    <div class="search-result-item" style="border-color: var(--green);">
                        <div style="color: var(--green); margin-bottom: 5px;">✅ 导入成功</div>
                        <div>知识库: ${escapeHtml(result.kb_id || kbId)} | 文档: ${escapeHtml(result.title || '')}</div>
                        <div>源: ${escapeHtml(result.source)}</div>
                        <div>总块数: ${result.chunks_count} | 导入数: ${result.imported_count}</div>
                        <div>实体: ${result.entities_extracted || 0} | 关系: ${result.relations_extracted || 0}</div>
                        <div class="memory-id">doc_id: ${escapeHtml(result.doc_id || '')}</div>
                    </div>
                `;
                loadMemories();
                loadDashboardData();
                loadKnowledgeBases();
                loadKbDocs(kbId);
            } else {
                showToast('导入失败', 'error');
                container.innerHTML = `
                    <div class="search-result-item" style="border-color: var(--red);">
                        <div style="color: var(--red); margin-bottom: 5px;">❌ 导入失败</div>
                        <div>${result?.message || '未知错误'}</div>
                    </div>
                `;
            }
        });
    }
}

// Knowledge Base
function initKnowledgeBase() {
    const refreshBtn = document.getElementById('btn-kb-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadKnowledgeBases();
            loadKbDocs(currentKbFilter);
        });
    }
}

async function loadKnowledgeBases() {
    const container = document.getElementById('kb-list-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-text">加载知识库中...</div>';
    const data = await API.getKnowledgeBases();

    if (!data || !data.knowledge_bases || data.knowledge_bases.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无知识库，先导入一篇文档</div>';
        return;
    }

    container.innerHTML = data.knowledge_bases.map(kb => `
        <div class="kb-card ${currentKbFilter === kb.kb_id ? 'active' : ''}">
            <div class="kb-card-main">
                <strong>${escapeHtml(kb.kb_id)}</strong>
                <span>${kb.doc_count || 0} 文档 / ${kb.chunk_count || 0} chunks</span>
            </div>
            <div class="kb-card-meta">最近导入: ${escapeHtml(kb.last_imported_at || '未知')}</div>
            <div class="memory-tags">${(kb.tags || []).slice(0, 6).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
            <div class="kb-actions">
                <button class="cyber-btn full-width" onclick="selectKnowledgeBase('${jsString(kb.kb_id)}')">查看文档</button>
                <button class="cyber-btn full-width" onclick="renameKnowledgeBaseUi('${jsString(kb.kb_id)}')">重命名</button>
            </div>
        </div>
    `).join('');
}

window.selectKnowledgeBase = function(kbId) {
    currentKbFilter = kbId;
    document.getElementById('kb-docs-filter-label').textContent = `当前知识库: ${kbId}`;
    loadKnowledgeBases();
    loadKbDocs(kbId);
};

window.renameKnowledgeBaseUi = async function(oldKbId) {
    const nextName = prompt(`将知识库 "${oldKbId}" 重命名为：`, oldKbId);
    if (!nextName) return;

    const newKbId = nextName.trim();
    if (!newKbId || newKbId === oldKbId) return;

    if (!confirm(`确认把知识库 "${oldKbId}" 重命名为 "${newKbId}"？这会迁移该知识库下所有文档 chunk。`)) return;

    const result = await API.renameKnowledgeBase(oldKbId, newKbId);
    if (result && result.status === 'success') {
        showToast(`知识库已重命名为 ${newKbId}`, 'success');
        currentKbFilter = newKbId;
        document.getElementById('kb-docs-filter-label').textContent = `当前知识库: ${newKbId}`;
        loadKnowledgeBases();
        loadKbDocs(newKbId);
        loadMemories();
        loadDashboardData();
    } else {
        showToast(result?.detail || '重命名失败', 'error');
    }
};

async function loadKbDocs(kbId = '') {
    const container = document.getElementById('kb-docs-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-text">加载文档中...</div>';
    const data = await API.getKbDocs(kbId);

    if (!data || !data.documents || data.documents.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无文档</div>';
        return;
    }

    container.innerHTML = data.documents.map(doc => `
        <div class="doc-row">
            <div class="doc-main">
                <strong>${escapeHtml(doc.title || doc.doc_id)}</strong>
                <span class="memory-id">${escapeHtml(shortId(doc.doc_id, 18))}</span>
                <div class="doc-meta">知识库: ${escapeHtml(doc.kb_id)} | chunks: ${doc.chunk_count || 0} | 导入: ${escapeHtml(doc.imported_at || '未知')}</div>
                <div class="doc-meta">来源: ${escapeHtml(doc.source_uri || '')}</div>
            </div>
            <div class="doc-actions">
                <button class="cyber-btn" onclick="viewKbDoc('${jsString(doc.doc_id)}')">查看</button>
                <button class="cyber-btn" onclick="reindexKbDoc('${jsString(doc.doc_id)}')">重建索引</button>
                <button class="cyber-btn danger" onclick="deleteKbDoc('${jsString(doc.doc_id)}')">删除</button>
            </div>
        </div>
    `).join('');
}

window.viewKbDoc = async function(docId) {
    const container = document.getElementById('kb-doc-detail-container');
    container.innerHTML = '<div class="loading-text">加载文档详情中...</div>';
    const data = await API.getKbDoc(docId);

    if (!data || !data.chunks) {
        container.innerHTML = '<div class="loading-text">文档详情加载失败</div>';
        return;
    }

    container.innerHTML = data.chunks.map((chunk, index) => {
        const payload = chunk.payload || {};
        return `
            <div class="chunk-card">
                <div class="chunk-header">Chunk #${payload.chunk_index ?? index} <span class="memory-id">${escapeHtml(shortId(chunk.id, 18))}</span></div>
                <div class="memory-content">${escapeHtml(chunk.content || payload.content || '')}</div>
                <div class="doc-meta">实体数: ${(payload.entity_ids || []).length} | 来源类型: ${escapeHtml(payload.source_type || '')}</div>
            </div>
        `;
    }).join('');
};

window.deleteKbDoc = async function(docId) {
    if (!confirm('确定要删除这篇文档的所有 chunk 吗？默认是软删除，可由后端恢复。')) return;

    const result = await API.deleteKbDoc(docId, false);
    if (result && result.status === 'success') {
        showToast(`已删除 ${result.deleted_chunks} 个 chunk`, 'success');
        loadKnowledgeBases();
        loadKbDocs(currentKbFilter);
        document.getElementById('kb-doc-detail-container').innerHTML = '<div class="loading-text">文档已删除</div>';
        loadMemories();
    } else {
        showToast('删除文档失败', 'error');
    }
};

window.reindexKbDoc = async function(docId) {
    const result = await API.reindexKbDoc(docId);
    if (result && result.status === 'success') {
        showToast(`已重建 ${result.reindexed_chunks} 个 chunk 的索引`, 'success');
    } else {
        showToast('重建索引失败', 'error');
    }
};

// Tool Memory
function initToolMemory() {
    const refreshBtn = document.getElementById('btn-tool-refresh');
    const categorySelect = document.getElementById('tool-category-filter');
    const suggestBtn = document.getElementById('btn-tool-suggest');
    const recentName = document.getElementById('tool-recent-name');
    const recentLimit = document.getElementById('tool-recent-limit');

    if (refreshBtn) refreshBtn.addEventListener('click', loadToolMemory);
    if (categorySelect) categorySelect.addEventListener('change', loadToolFrequent);
    if (suggestBtn) suggestBtn.addEventListener('click', loadToolSuggestions);
    if (recentName) recentName.addEventListener('change', loadToolRecent);
    if (recentLimit) recentLimit.addEventListener('change', loadToolRecent);
}

async function loadToolMemory() {
    await Promise.all([loadToolStats(), loadToolFrequent(), loadToolRecent()]);
}

async function loadToolStats() {
    const stats = await API.getToolStats();
    if (!stats || stats.status === 'disabled') {
        document.getElementById('tool-total-usage').textContent = '0';
        document.getElementById('tool-total-tools').textContent = '0';
        document.getElementById('tool-success-rate').textContent = '未启用';
        return;
    }
    document.getElementById('tool-total-usage').textContent = stats.total_usage || 0;
    document.getElementById('tool-total-tools').textContent = stats.total_tools || 0;
    document.getElementById('tool-success-rate').textContent = `${((stats.overall_success_rate || 0) * 100).toFixed(0)}%`;
}

async function loadToolFrequent() {
    const container = document.getElementById('tool-frequent-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-text">加载常用工具中...</div>';
    const category = document.getElementById('tool-category-filter')?.value || '';
    const data = await API.getFrequentlyUsedTools(category, 20);

    if (!data || !data.tools || data.tools.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无工具使用统计</div>';
        return;
    }

    container.innerHTML = data.tools.map(tool => `
        <div class="tool-card">
            <div class="tool-card-main">
                <strong>${escapeHtml(tool.tool_name)}</strong>
                <span class="tag">${escapeHtml(tool.category || 'other')}</span>
            </div>
            <div class="doc-meta">使用 ${tool.use_count || 0} 次 | 成功率 ${((tool.success_rate || 0) * 100).toFixed(0)}% | 最近: ${escapeHtml(tool.last_used || '未知')}</div>
            <button class="cyber-btn full-width" onclick="selectToolForSuggestion('${jsString(tool.tool_name)}')">查看参数建议</button>
        </div>
    `).join('');
}

window.selectToolForSuggestion = function(toolName) {
    document.getElementById('tool-suggest-name').value = toolName;
    loadToolSuggestions();
};

async function loadToolSuggestions() {
    const toolName = document.getElementById('tool-suggest-name')?.value.trim();
    const container = document.getElementById('tool-suggest-container');
    if (!container) return;

    if (!toolName) {
        showToast('请输入工具名称', 'error');
        return;
    }

    container.innerHTML = '<div class="loading-text">加载参数建议中...</div>';
    const data = await API.getToolSuggestions(toolName);
    const suggestions = data?.suggestions || {};
    const entries = Object.entries(suggestions);

    if (entries.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无参数建议</div>';
        return;
    }

    container.innerHTML = entries.map(([key, values]) => `
        <div class="search-result-item">
            <div style="color: var(--accent); margin-bottom: 6px;">${escapeHtml(key)}</div>
            <div class="memory-tags">${(values || []).map(v => `<span class="tag">${escapeHtml(JSON.stringify(v))}</span>`).join('')}</div>
        </div>
    `).join('');
}

async function loadToolRecent() {
    const container = document.getElementById('tool-recent-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-text">加载最近使用记录中...</div>';
    const toolName = document.getElementById('tool-recent-name')?.value.trim() || '';
    const limit = parseInt(document.getElementById('tool-recent-limit')?.value || '20');
    const data = await API.getRecentToolUsage(toolName, limit);

    if (!data || !data.records || data.records.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无工具使用记录</div>';
        return;
    }

    container.innerHTML = data.records.map(record => `
        <div class="tool-record-row">
            <div class="doc-main">
                <strong>${escapeHtml(record.tool_name)}</strong>
                <span class="tag ${record.success ? '' : 'danger-tag'}">${record.success ? '成功' : '失败'}</span>
                <div class="doc-meta">类别: ${escapeHtml(record.category || 'other')} | 时间: ${escapeHtml(record.used_at || '')}</div>
                ${record.user_intent ? `<div class="doc-meta">意图: ${escapeHtml(record.user_intent)}</div>` : ''}
                ${record.result_summary ? `<div class="memory-content compact">${escapeHtml(record.result_summary)}</div>` : ''}
            </div>
            <div class="doc-actions">
                <button class="cyber-btn" onclick="selectToolForSuggestion('${jsString(record.tool_name)}')">参数建议</button>
                <button class="cyber-btn danger" onclick="deleteToolRecord('${jsString(record.id)}')">删除</button>
            </div>
        </div>
    `).join('');
}

window.deleteToolRecord = async function(recordId) {
    if (!confirm('确定要删除这条工具使用记录吗？')) return;
    const success = await API.deleteToolRecord(recordId);
    if (success) {
        showToast('工具记录已删除', 'success');
        loadToolMemory();
    } else {
        showToast('删除工具记录失败', 'error');
    }
};

// Image Memory
let imagesLoaded = false;

async function loadImages(forceReload = false) {
    const container = document.getElementById('image-gallery-container');
    if (!container) return;

    if (imagesLoaded && !forceReload) return;

    container.innerHTML = '<div class="loading-text">加载图片中...</div>';

    const data = await API.getImages(50);
    container.innerHTML = '';

    if (!data || !data.images || data.images.length === 0) {
        container.innerHTML = '<div class="loading-text">没有找到图片记忆或图片记忆服务未启用</div>';
        imagesLoaded = true;
        return;
    }

    data.images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'memory-card';
        card.style.padding = '10px';

        const timeStr = img.created_at ? new Date(img.created_at).toLocaleString('zh-CN', {hour12: false}) : '';
        const imgElementId = `img-thumb-${img.id}`;

        card.innerHTML = `
            <div style="width: 100%; height: 180px; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative;">
                <div class="img-loading-spinner" style="color: var(--text-muted); font-size: 12px;">加载中...</div>
                <img id="${imgElementId}" style="display: none; max-width: 100%; max-height: 100%; object-fit: contain;" alt="${img.original_name || ''}">
            </div>
            <div style="font-size: 14px; margin-bottom: 5px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${img.original_name || ''}">
                ${img.original_name || '未命名图片'}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; height: 36px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${img.description || ''}">
                ${img.description || '暂无描述'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span>${img.image_type || 'other'}</span>
                <span>${timeStr}</span>
            </div>
            <button class="cyber-btn danger" style="width: 100%; padding: 4px 8px; font-size: 12px;" onclick="deleteImageById('${img.id}')">🗑️ 删除</button>
        `;
        container.appendChild(card);

        loadThumbnail(img.id, imgElementId, card);
    });

    imagesLoaded = true;
}

async function loadThumbnail(imageId, elementId, cardElement) {
    const base64Data = await API.getImageData(imageId, true);
    const imgEl = document.getElementById(elementId);
    if (!imgEl) return;

    const spinner = imgEl.parentElement.querySelector('.img-loading-spinner');

    if (base64Data) {
        const src = base64Data.startsWith('data:')
            ? base64Data
            : `data:image/jpeg;base64,${base64Data}`;
        imgEl.src = src;
        imgEl.style.display = 'block';
        if (spinner) spinner.style.display = 'none';
    } else {
        if (spinner) {
            spinner.textContent = '图片加载失败';
            spinner.style.color = 'var(--red)';
        }
    }
}

window.deleteImageById = async function(imageId) {
    if (!confirm('确定要删除这张图片吗？')) return;

    const success = await API.deleteImage(imageId);
    if (success) {
        showToast('图片已删除', 'success');
        imagesLoaded = false;
        loadImages(true);
    } else {
        showToast('删除失败', 'error');
    }
};

// Knowledge Graph
function initGraph() {
    document.getElementById('btn-refresh-graph').addEventListener('click', renderGraph);
}

async function renderGraph() {
    const container = document.getElementById('graph-network');
    container.innerHTML = '<div class="loading-text" style="padding: 20px;">加载图谱数据中...</div>';

    const data = await API.getGraphData();
    if (!data || !data.nodes || data.nodes.length === 0) {
        container.innerHTML = '<div class="loading-text" style="padding: 20px;">无法获取图谱数据或图谱为空 (当前 API 服务可能不支持图谱功能)</div>';
        document.getElementById('graph-stats-info').textContent = `实体: 0 | 关系: 0`;
        return;
    }

    document.getElementById('graph-stats-info').textContent = `实体: ${data.nodes.length} | 关系: ${data.edges.length}`;

    // Map data to vis format
    const nodes = new vis.DataSet(data.nodes.map(n => ({
        id: n.id,
        label: n.label,
        title: `类型: ${n.type || '未知'}`,
        color: {
            background: 'rgba(10, 15, 31, 0.9)',
            border: '#00f0ff',
            highlight: { background: 'rgba(0, 240, 255, 0.2)', border: '#00f0ff' }
        },
        font: { color: '#e0f2fe' }
    })));

    const edges = new vis.DataSet(data.edges.map(e => ({
        from: e.source,
        to: e.target,
        label: e.label,
        color: { color: 'rgba(0, 240, 255, 0.3)', highlight: '#00f0ff' },
        font: { color: '#7df5ff', size: 10, background: 'none' },
        arrows: 'to'
    })));

    const options = {
        nodes: {
            shape: 'dot',
            size: 16,
            borderWidth: 2,
            shadow: { enabled: true, color: 'rgba(0, 240, 255, 0.4)', size: 10 }
        },
        edges: {
            width: 1,
            smooth: { type: 'continuous' }
        },
        physics: {
            forceAtlas2Based: {
                gravitationalConstant: -50,
                centralGravity: 0.01,
                springLength: 100,
                springConstant: 0.08
            },
            maxVelocity: 50,
            solver: 'forceAtlas2Based',
            timestep: 0.35,
            stabilization: { iterations: 150 }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200
        }
    };

    network = new vis.Network(container, { nodes, edges }, options);
}
