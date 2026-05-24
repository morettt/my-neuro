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

// Global State
let allMemories = [];
let currentPage = 1;
let itemsPerPage = 20;
let network = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSystemStatus();
    initMemoryList();
    initOperations();
    initGraph();
    
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
        document.getElementById('dash-avg-importance').textContent = 
            stats.avg_importance ? `${(stats.avg_importance * 100).toFixed(0)}%` : 'N/A';
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

    // Modal close
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-edit').addEventListener('click', closeModal);
    document.getElementById('btn-save-edit').addEventListener('click', saveMemoryEdit);
}

async function loadMemories() {
    const data = await API.getMemories(500);
    if (data && data.memories) {
        allMemories = data.memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderMemoryList();
    } else {
        document.getElementById('memory-list-container').innerHTML = '<div class="loading-text">加载失败</div>';
    }
}

function renderMemoryList() {
    const typeFilter = document.getElementById('filter-type').value;
    const keyword = document.getElementById('search-keyword').value.toLowerCase();

    let filtered = allMemories;
    if (typeFilter) {
        filtered = filtered.filter(m => m.memory_type === typeFilter);
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
            
            const tagsHtml = (mem.tags || []).map(t => `<span class="tag">🏷️ ${t}</span>`).join('');

            const card = document.createElement('div');
            card.className = 'memory-card';
            card.innerHTML = `
                <div class="memory-header">
                    <div>
                        <strong>#${globalIndex}</strong>
                        <span class="memory-type" style="margin-left: 10px;">${emoji} ${label}</span>
                    </div>
                    <span class="memory-id">ID: ${mem.id}</span>
                </div>
                <div class="memory-content">${mem.content}</div>
                ${tagsHtml ? `<div class="memory-tags">${tagsHtml}</div>` : ''}
                <div class="memory-footer">
                    <div>重要度 ${imp.toFixed(0)}% | ${timeStr}</div>
                    <div class="memory-actions">
                        <button class="cyber-btn" onclick="openEditModal('${mem.id}')">✏️ 修改</button>
                        <button class="cyber-btn danger" onclick="deleteMemory('${mem.id}')">🗑️ 删除</button>
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
        <button class="cyber-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(1)">首页</button>
        <button class="cyber-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">上页</button>
        <span style="display: flex; align-items: center; padding: 0 10px;">${currentPage} / ${totalPages}</span>
        <button class="cyber-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">下页</button>
        <button class="cyber-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${totalPages})">末页</button>
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
            loadDashboardData();
        } else {
            showToast('删除失败', 'error');
        }
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

        const btn = document.getElementById('btn-ops-search');
        btn.disabled = true;
        btn.textContent = '检索中...';

        const result = await API.searchMemories(query, topK, useGraph, threshold);
        
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
                
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `
                    <div style="margin-bottom: 5px;">
                        <strong>#${i+1}</strong> ${emoji}
                    </div>
                    <div style="margin-bottom: 8px;">${m.content}</div>
                    <div class="sim-score">相似度: ${sim.toFixed(1)}%</div>
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
        
        const btn = document.getElementById('btn-ops-add');
        btn.disabled = true;
        btn.textContent = '添加中...';

        const success = await API.addMemory(content, imp);
        
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

    // Knowledge Base Import
    const btnKbImport = document.getElementById('btn-kb-import');
    if (btnKbImport) {
        btnKbImport.addEventListener('click', async () => {
            const source = document.getElementById('kb-import-source').value;
            if (!source) return;

            const extractEntities = document.getElementById('kb-extract-entities').checked;
            
            btnKbImport.disabled = true;
            btnKbImport.textContent = '导入中...';

            const result = await API.importDocument(source, extractEntities);
            
            btnKbImport.disabled = false;
            btnKbImport.textContent = '开始导入';

            const container = document.getElementById('kb-import-result');
            container.innerHTML = '';

            if (result && result.status === 'success') {
                showToast(`导入成功: ${result.imported_count} 条块`, 'success');
                container.innerHTML = `
                    <div class="search-result-item" style="border-color: var(--green);">
                        <div style="color: var(--green); margin-bottom: 5px;">✅ 导入成功</div>
                        <div>源: ${result.source}</div>
                        <div>总块数: ${result.chunks_count} | 导入数: ${result.imported_count}</div>
                    </div>
                `;
                loadMemories();
                loadDashboardData();
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