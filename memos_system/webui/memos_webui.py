# memos_webui.py - MemOS 记忆中心 WebUI (科技感版本)
import streamlit as st
import requests
import json
from datetime import datetime

# API 配置
MEMOS_API_URL = "http://127.0.0.1:8003"

# 页面配置
st.set_page_config(
    page_title="MEMOS | 记忆中心",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ═══════════════════════════════════════════════════════════════
#                        自定义CSS样式
# ═══════════════════════════════════════════════════════════════
st.markdown("""
<style>
/* ═══ 全局样式 ═══ */
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&display=swap');

:root {
    --primary-color: #00d4ff;
    --secondary-color: #7b2cbf;
    --accent-color: #00ff88;
    --bg-dark: #0a0e17;
    --bg-card: rgba(15, 23, 42, 0.8);
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
    --border-glow: rgba(0, 212, 255, 0.3);
}

/* 主背景 */
.stApp {
    background: linear-gradient(135deg, #0a0e17 0%, #1a1f35 50%, #0d1321 100%);
    background-attachment: fixed;
}

/* 添加动态网格背景 */
.stApp::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image: 
        linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px);
    background-size: 50px 50px;
    pointer-events: none;
    z-index: 0;
}

/* ═══ 侧边栏样式 ═══ */
[data-testid="stSidebar"] {
    background: linear-gradient(180deg, rgba(10, 14, 23, 0.95) 0%, rgba(26, 31, 53, 0.95) 100%);
    border-right: 1px solid rgba(0, 212, 255, 0.2);
}

[data-testid="stSidebar"]::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 2px;
    height: 100%;
    background: linear-gradient(180deg, transparent, var(--primary-color), transparent);
    animation: sidebarGlow 3s ease-in-out infinite;
}

@keyframes sidebarGlow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.8; }
}

/* ═══ 标题样式 ═══ */
h1 {
    font-family: 'Orbitron', 'Noto Sans SC', sans-serif !important;
    background: linear-gradient(90deg, #00d4ff, #7b2cbf, #00ff88);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-shadow: 0 0 30px rgba(0, 212, 255, 0.5);
    letter-spacing: 2px;
    animation: titlePulse 2s ease-in-out infinite;
}

@keyframes titlePulse {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.2); }
}

h2, h3 {
    font-family: 'Noto Sans SC', sans-serif !important;
    color: var(--primary-color) !important;
    border-left: 3px solid var(--primary-color);
    padding-left: 15px;
    text-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
}

/* ═══ 文本样式 ═══ */
p, span, label, .stMarkdown {
    font-family: 'Noto Sans SC', sans-serif !important;
    color: var(--text-primary) !important;
}

/* ═══ 卡片容器 ═══ */
.memory-card {
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
    border: 1px solid rgba(0, 212, 255, 0.2);
    border-radius: 12px;
    padding: 20px;
    margin: 15px 0;
    backdrop-filter: blur(10px);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.memory-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--primary-color), transparent);
}

.memory-card:hover {
    border-color: var(--primary-color);
    box-shadow: 0 0 30px rgba(0, 212, 255, 0.2);
    transform: translateY(-2px);
}

/* ═══ 统计卡片 ═══ */
.stat-card {
    background: linear-gradient(145deg, rgba(0, 212, 255, 0.1), rgba(123, 44, 191, 0.1));
    border: 1px solid rgba(0, 212, 255, 0.3);
    border-radius: 16px;
    padding: 25px;
    text-align: center;
    position: relative;
    overflow: hidden;
}

.stat-card::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 3px;
    background: linear-gradient(90deg, transparent, var(--accent-color), transparent);
}

.stat-number {
    font-family: 'Orbitron', monospace !important;
    font-size: 2.5em;
    font-weight: 700;
    background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
}

.stat-label {
    color: var(--text-secondary);
    font-size: 0.9em;
    margin-top: 8px;
    text-transform: uppercase;
    letter-spacing: 2px;
}

/* ═══ 按钮样式 ═══ */
.stButton > button {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.2), rgba(123, 44, 191, 0.2)) !important;
    border: 1px solid var(--primary-color) !important;
    color: var(--primary-color) !important;
    font-family: 'Noto Sans SC', sans-serif !important;
    font-weight: 500;
    padding: 10px 25px;
    border-radius: 8px;
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.stButton > button:hover {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.4), rgba(123, 44, 191, 0.4)) !important;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
    transform: translateY(-2px);
}

/* 主要按钮 */
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)) !important;
    color: white !important;
    border: none !important;
}

/* ═══ 输入框样式 ═══ */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background: rgba(15, 23, 42, 0.8) !important;
    border: 1px solid rgba(0, 212, 255, 0.3) !important;
    border-radius: 8px !important;
    color: var(--text-primary) !important;
    font-family: 'Noto Sans SC', sans-serif !important;
}

.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: var(--primary-color) !important;
    box-shadow: 0 0 15px rgba(0, 212, 255, 0.3) !important;
}

/* ═══ 滑块样式 ═══ */
.stSlider > div > div > div {
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color)) !important;
}

/* ═══ 单选按钮样式 ═══ */
.stRadio > div {
    background: rgba(15, 23, 42, 0.5);
    border-radius: 10px;
    padding: 10px;
}

/* ═══ 展开器样式 ═══ */
.streamlit-expanderHeader {
    background: rgba(0, 212, 255, 0.1) !important;
    border: 1px solid rgba(0, 212, 255, 0.2) !important;
    border-radius: 8px !important;
}

/* ═══ 成功/警告/错误提示 ═══ */
.stSuccess {
    background: rgba(0, 255, 136, 0.1) !important;
    border-left: 3px solid var(--accent-color) !important;
}

.stWarning {
    background: rgba(255, 193, 7, 0.1) !important;
    border-left: 3px solid #ffc107 !important;
}

.stError {
    background: rgba(255, 82, 82, 0.1) !important;
    border-left: 3px solid #ff5252 !important;
}

.stInfo {
    background: rgba(0, 212, 255, 0.1) !important;
    border-left: 3px solid var(--primary-color) !important;
}

/* ═══ 指标样式 ═══ */
[data-testid="stMetric"] {
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
    border: 1px solid rgba(0, 212, 255, 0.2);
    border-radius: 12px;
    padding: 20px;
}

[data-testid="stMetricValue"] {
    font-family: 'Orbitron', monospace !important;
    color: var(--primary-color) !important;
}

/* ═══ 分隔线 ═══ */
hr {
    border: none;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.5), transparent);
    margin: 25px 0;
}

/* ═══ 滚动条 ═══ */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.5);
}

::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--primary-color), var(--secondary-color));
    border-radius: 4px;
}

/* ═══ 导航菜单项 ═══ */
.nav-item {
    background: rgba(0, 212, 255, 0.05);
    border: 1px solid rgba(0, 212, 255, 0.1);
    border-radius: 8px;
    padding: 12px 15px;
    margin: 8px 0;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 10px;
}

.nav-item:hover {
    background: rgba(0, 212, 255, 0.15);
    border-color: var(--primary-color);
    transform: translateX(5px);
}

.nav-item.active {
    background: linear-gradient(90deg, rgba(0, 212, 255, 0.2), transparent);
    border-left: 3px solid var(--primary-color);
}

/* ═══ Logo动画 ═══ */
.logo-container {
    text-align: center;
    padding: 20px 0;
    margin-bottom: 20px;
}

.logo-text {
    font-family: 'Orbitron', sans-serif;
    font-size: 1.5em;
    font-weight: 700;
    background: linear-gradient(90deg, #00d4ff, #7b2cbf);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: logoGlow 2s ease-in-out infinite;
}

@keyframes logoGlow {
    0%, 100% { filter: drop-shadow(0 0 5px rgba(0, 212, 255, 0.5)); }
    50% { filter: drop-shadow(0 0 20px rgba(0, 212, 255, 0.8)); }
}

/* ═══ 状态指示器 ═══ */
.status-indicator {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 8px;
    animation: statusPulse 1.5s ease-in-out infinite;
}

.status-online {
    background: var(--accent-color);
    box-shadow: 0 0 10px var(--accent-color);
}

.status-offline {
    background: #ff5252;
    box-shadow: 0 0 10px #ff5252;
}

@keyframes statusPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* ═══ 记忆内容样式 ═══ */
.memory-content {
    font-size: 1.05em;
    line-height: 1.8;
    color: var(--text-primary);
    padding: 10px 0;
}

.memory-meta {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    color: var(--text-secondary);
    font-size: 0.85em;
    padding-top: 10px;
    border-top: 1px solid rgba(0, 212, 255, 0.1);
    margin-top: 10px;
}

.meta-item {
    display: flex;
    align-items: center;
    gap: 5px;
}

/* ═══ 搜索结果高亮 ═══ */
.search-result {
    position: relative;
    padding-left: 15px;
}

.search-result::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: 3px;
    background: linear-gradient(180deg, var(--primary-color), var(--secondary-color));
}

/* ═══ 重要度指示 ═══ */
.importance-high { border-left-color: #00ff88 !important; }
.importance-medium { border-left-color: #00d4ff !important; }
.importance-low { border-left-color: #64748b !important; }

</style>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════
#                        辅助函数
# ═══════════════════════════════════════════════════════════════

def check_service_status():
    """检查服务状态"""
    try:
        response = requests.get(f"{MEMOS_API_URL}/health", timeout=2)
        return response.status_code == 200
    except:
        return False

def render_memory_card(mem, index, show_actions=True):
    """渲染单个记忆卡片"""
    content = mem.get('content', '')
    created_at = mem.get('created_at') or mem.get('timestamp', '')
    updated_at = mem.get('updated_at', '')
    importance = mem.get('importance', 0.5)
    merge_count = mem.get('merge_count', 0)
    similarity = mem.get('similarity')
    
    # 重要度等级
    if importance >= 0.8:
        importance_class = "importance-high"
        importance_icon = "🔥"
    elif importance >= 0.5:
        importance_class = "importance-medium"
        importance_icon = "⚡"
    else:
        importance_class = "importance-low"
        importance_icon = "💫"
    
    # 构建卡片HTML
    card_html = f"""
    <div class="memory-card {importance_class}">
        <div class="memory-content">
            <span style="color: var(--primary-color); font-weight: 600;">#{index}</span> &nbsp;
            {content[:300] + '...' if len(content) > 300 else content}
        </div>
        <div class="memory-meta">
    """
    
    # 时间信息
    if created_at:
        try:
            dt = datetime.fromisoformat(created_at)
            time_str = dt.strftime("%Y-%m-%d %H:%M")
            card_html += f'<div class="meta-item">📅 {time_str}</div>'
        except:
            pass
    
    # 更新时间
    if updated_at and updated_at != created_at:
        try:
            dt = datetime.fromisoformat(updated_at)
            time_str = dt.strftime("%m-%d %H:%M")
            card_html += f'<div class="meta-item">🔄 更新于 {time_str}</div>'
        except:
            pass
    
    # 重要度
    card_html += f'<div class="meta-item">{importance_icon} 重要度 {importance:.0%}</div>'
    
    # 相似度（搜索结果）
    if similarity is not None:
        card_html += f'<div class="meta-item">🎯 相似度 {similarity:.0%}</div>'
    
    # 合并次数
    if merge_count > 0:
        card_html += f'<div class="meta-item">🔗 合并 {merge_count}次</div>'
    
    card_html += "</div></div>"
    
    return card_html

# ═══════════════════════════════════════════════════════════════
#                        侧边栏
# ═══════════════════════════════════════════════════════════════

with st.sidebar:
    # Logo
    st.markdown("""
    <div class="logo-container">
        <div style="font-size: 3em; margin-bottom: 10px;">🧠</div>
        <div class="logo-text">MEMOS</div>
        <div style="color: #64748b; font-size: 0.8em; margin-top: 5px;">MEMORY CENTER</div>
    </div>
    """, unsafe_allow_html=True)
    
    # 服务状态
    status_ok = check_service_status()
    if status_ok:
        st.markdown("""
        <div style="display: flex; align-items: center; padding: 10px; background: rgba(0, 255, 136, 0.1); border-radius: 8px; margin-bottom: 20px;">
            <div class="status-indicator status-online"></div>
            <span style="color: #00ff88;">系统在线</span>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div style="display: flex; align-items: center; padding: 10px; background: rgba(255, 82, 82, 0.1); border-radius: 8px; margin-bottom: 20px;">
            <div class="status-indicator status-offline"></div>
            <span style="color: #ff5252;">系统离线</span>
        </div>
        """, unsafe_allow_html=True)
    
    st.markdown("---")
    
    # 导航菜单
    st.markdown('<p style="color: #64748b; font-size: 0.8em; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">导航菜单</p>', unsafe_allow_html=True)
    
    page = st.radio(
        "选择页面",
        ["📊 数据总览", "📋 记忆库", "🔍 智能检索", "✏️ 新增记忆", "🔄 去重合并", "📥 数据导入", "⚙️ 系统设置"],
        label_visibility="collapsed"
    )
    
    st.markdown("---")
    
    # 快捷操作
    st.markdown('<p style="color: #64748b; font-size: 0.8em; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">快捷操作</p>', unsafe_allow_html=True)
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 刷新", use_container_width=True):
            st.rerun()
    with col2:
        if st.button("📤 备份", use_container_width=True):
            st.info("备份功能开发中")

# ═══════════════════════════════════════════════════════════════
#                        主内容区域
# ═══════════════════════════════════════════════════════════════

# 页面标题
st.markdown("""
<h1 style="text-align: center; margin-bottom: 10px;">M E M O S</h1>
<p style="text-align: center; color: #64748b; font-size: 1.1em; letter-spacing: 3px; margin-bottom: 8px;">
    MEMORY OPERATING SYSTEM | 记忆中心
</p>
<p style="text-align: center; font-size: 0.85em; margin-bottom: 40px;">
    <span style="color: #475569;">Developed by</span>
    <span style="background: linear-gradient(90deg, #00d4ff, #7b2cbf); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 600;">爱熬夜的人形兔</span>
    <span style="margin-left: 5px;">🐰</span>
</p>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════
#                        数据总览页面
# ═══════════════════════════════════════════════════════════════

if page == "📊 数据总览":
    try:
        response = requests.get(f"{MEMOS_API_URL}/stats", timeout=5)
        if response.status_code == 200:
            stats = response.json()
            
            # 主要统计指标
            st.markdown("### 📊 核心指标")
            
            col1, col2, col3, col4 = st.columns(4)
            
            with col1:
                st.markdown(f"""
                <div class="stat-card">
                    <div class="stat-number">{stats.get('total_count', 0)}</div>
                    <div class="stat-label">总记忆数</div>
                </div>
                """, unsafe_allow_html=True)
            
            with col2:
                st.markdown(f"""
                <div class="stat-card">
                    <div class="stat-number">{stats.get('today_count', 0)}</div>
                    <div class="stat-label">今日新增</div>
                </div>
                """, unsafe_allow_html=True)
            
            with col3:
                st.markdown(f"""
                <div class="stat-card">
                    <div class="stat-number">{stats.get('week_count', 0)}</div>
                    <div class="stat-label">本周新增</div>
                </div>
                """, unsafe_allow_html=True)
            
            with col4:
                avg_imp = stats.get('avg_importance', 0)
                st.markdown(f"""
                <div class="stat-card">
                    <div class="stat-number">{avg_imp:.0%}</div>
                    <div class="stat-label">平均重要度</div>
                </div>
                """, unsafe_allow_html=True)
            
            st.markdown("---")
            
            # 系统信息
            st.markdown("### 💻 系统状态")
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("""
                <div class="memory-card">
                    <h4 style="color: var(--primary-color); margin-bottom: 15px;">🗄️ 存储信息</h4>
                    <p><strong>存储路径:</strong> <code>memos_system/data/</code></p>
                    <p><strong>Embedding模型:</strong> <code>./RAG-model</code></p>
                    <p><strong>服务端口:</strong> <code>8003</code></p>
                </div>
                """, unsafe_allow_html=True)
            
            with col2:
                st.markdown(f"""
                <div class="memory-card">
                    <h4 style="color: var(--primary-color); margin-bottom: 15px;">⚡ 性能指标</h4>
                    <p><strong>服务状态:</strong> <span style="color: #00ff88;">● 运行中</span></p>
                    <p><strong>记忆容量:</strong> {stats.get('total_count', 0)} 条</p>
                    <p><strong>向量维度:</strong> 768</p>
                </div>
                """, unsafe_allow_html=True)
            
            # 记忆增长图表
            st.markdown("---")
            st.markdown("### 📈 数据趋势")
            
            growth_data = {
                "今日": stats.get('today_count', 0),
                "本周": stats.get('week_count', 0),
                "总计": stats.get('total_count', 0)
            }
            st.bar_chart(growth_data, use_container_width=True)
            
        else:
            st.error("获取统计数据失败")
    except Exception as e:
        st.error("❌ 无法连接 MEMOS 服务")
        st.info("💡 请先启动 MEMOS-API.bat")

# ═══════════════════════════════════════════════════════════════
#                        记忆库页面
# ═══════════════════════════════════════════════════════════════

elif page == "📋 记忆库":
    st.markdown("### 📋 记忆库")
    st.markdown('<p style="color: #64748b;">查看和管理所有存储的记忆数据</p>', unsafe_allow_html=True)
    
    try:
        response = requests.get(f"{MEMOS_API_URL}/list", params={"limit": 100}, timeout=5)
        if response.status_code == 200:
            data = response.json()
            memories = data.get('memories', [])
            count = data.get('count', 0)
            
            if count == 0:
                st.markdown("""
                <div class="memory-card" style="text-align: center; padding: 40px;">
                    <div style="font-size: 3em; margin-bottom: 15px;">📭</div>
                    <h3 style="color: var(--primary-color);">记忆库为空</h3>
                    <p style="color: #64748b;">开始对话或导入旧记忆以填充记忆库</p>
                </div>
                """, unsafe_allow_html=True)
            else:
                # 统计栏
                st.markdown(f"""
                <div style="display: flex; gap: 20px; margin-bottom: 25px;">
                    <div style="background: rgba(0, 212, 255, 0.1); padding: 10px 20px; border-radius: 8px;">
                        <span style="color: var(--primary-color); font-weight: 600;">{count}</span>
                        <span style="color: #64748b;"> 条记忆</span>
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
                # 记忆列表
                for i, mem in enumerate(memories):
                    mem_id = mem.get('id', '')
                    content = mem.get('content', '')
                    importance = mem.get('importance', 0.5)
                    is_editing = st.session_state.get(f'editing_{mem_id}', False)
                    
                    # 使用容器包裹每条记忆
                    with st.container():
                        if not is_editing:
                            # 正常显示模式
                            col1, col2 = st.columns([6, 1])
                            
                            with col1:
                                st.markdown(render_memory_card(mem, i+1), unsafe_allow_html=True)
                            
                            with col2:
                                st.write("")  # 对齐
                                st.write("")
                                
                                col_edit, col_del = st.columns(2)
                                with col_edit:
                                    if st.button("✏️", key=f"edit_{i}", help="编辑"):
                                        st.session_state[f'editing_{mem_id}'] = True
                                        st.rerun()
                                
                                with col_del:
                                    if st.button("🗑️", key=f"del_{i}", help="删除"):
                                        try:
                                            del_response = requests.delete(f"{MEMOS_API_URL}/delete/{mem_id}")
                                            if del_response.status_code == 200:
                                                st.toast("✅ 已删除", icon="✅")
                                                st.rerun()
                                            else:
                                                st.toast("❌ 删除失败", icon="❌")
                                        except Exception as e:
                                            st.toast(f"❌ 删除出错", icon="❌")
                        
                        else:
                            # 编辑模式
                            st.markdown(f"""
                            <div class="memory-card" style="border-color: var(--primary-color);">
                                <div style="color: var(--primary-color); font-weight: 600; margin-bottom: 15px;">
                                    ✏️ 编辑记忆 #{i+1}
                                </div>
                            </div>
                            """, unsafe_allow_html=True)
                            
                            new_content = st.text_area(
                                "修改内容", 
                                value=content, 
                                height=120, 
                                key=f"edit_content_{i}",
                                label_visibility="collapsed"
                            )
                            
                            new_importance = st.slider(
                                "重要度", 
                                0.0, 1.0, 
                                float(importance), 
                                0.1, 
                                key=f"edit_imp_{i}"
                            )
                            
                            col_save, col_cancel = st.columns(2)
                            with col_save:
                                if st.button("💾 保存", key=f"save_{i}", type="primary", use_container_width=True):
                                    try:
                                        update_response = requests.put(
                                            f"{MEMOS_API_URL}/update/{mem_id}",
                                            params={"content": new_content, "importance": new_importance}
                                        )
                                        if update_response.status_code == 200:
                                            if f'editing_{mem_id}' in st.session_state:
                                                del st.session_state[f'editing_{mem_id}']
                                            st.toast("✅ 更新成功", icon="✅")
                                            st.rerun()
                                        else:
                                            st.toast("❌ 更新失败", icon="❌")
                                    except Exception as e:
                                        st.toast(f"❌ 更新出错", icon="❌")
                            
                            with col_cancel:
                                if st.button("❌ 取消", key=f"cancel_{i}", use_container_width=True):
                                    if f'editing_{mem_id}' in st.session_state:
                                        del st.session_state[f'editing_{mem_id}']
                                    st.rerun()
                            
                            st.markdown("---")
        else:
            st.error(f"获取记忆列表失败: {response.status_code}")
    except Exception as e:
        st.error("❌ 无法连接 MEMOS 服务")
        st.info("💡 请先启动 MEMOS-API.bat")

# ═══════════════════════════════════════════════════════════════
#                        智能检索页面
# ═══════════════════════════════════════════════════════════════

elif page == "🔍 智能检索":
    st.markdown("### 🔍 智能检索")
    st.markdown('<p style="color: #64748b;">基于语义相似度的智能记忆搜索</p>', unsafe_allow_html=True)
    
    # 搜索框
    col1, col2 = st.columns([4, 1])
    with col1:
        query = st.text_input("", placeholder="输入关键词或问题进行语义搜索...", label_visibility="collapsed")
    with col2:
        top_k = st.selectbox("结果数", [3, 5, 10], index=0, label_visibility="collapsed")
    
    if st.button("🚀 开始检索", type="primary", use_container_width=True):
        if query:
            with st.spinner("正在进行语义检索..."):
                try:
                    response = requests.post(
                        f"{MEMOS_API_URL}/search",
                        json={"query": query, "top_k": top_k, "user_id": "feiniu_default"},
                        timeout=5
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        memories = data.get('memories', [])
                        
                        if memories:
                            st.markdown(f"""
                            <div style="margin: 25px 0; padding: 15px; background: rgba(0, 255, 136, 0.1); border-radius: 8px; border-left: 3px solid #00ff88;">
                                🎯 找到 <strong>{len(memories)}</strong> 条相关记忆
                            </div>
                            """, unsafe_allow_html=True)
                            
                            for i, mem in enumerate(memories):
                                if isinstance(mem, str):
                                    st.markdown(f"""
                                    <div class="memory-card search-result">
                                        <div class="memory-content">
                                            <span style="color: var(--primary-color); font-weight: 600;">#{i+1}</span> &nbsp;
                                            {mem}
                                        </div>
                                    </div>
                                    """, unsafe_allow_html=True)
                                else:
                                    st.markdown(render_memory_card(mem, i+1), unsafe_allow_html=True)
                        else:
                            st.markdown("""
                            <div class="memory-card" style="text-align: center; padding: 30px;">
                                <div style="font-size: 2em; margin-bottom: 10px;">🔍</div>
                                <p style="color: #64748b;">未找到相关记忆，请尝试其他关键词</p>
                            </div>
                            """, unsafe_allow_html=True)
                    else:
                        st.error(f"搜索失败: {response.status_code}")
                except Exception as e:
                    st.error(f"搜索出错: {e}")
        else:
            st.warning("请输入搜索内容")

# ═══════════════════════════════════════════════════════════════
#                        新增记忆页面
# ═══════════════════════════════════════════════════════════════

elif page == "✏️ 新增记忆":
    st.markdown("### ✏️ 新增记忆")
    st.markdown('<p style="color: #64748b;">手动添加新的记忆条目</p>', unsafe_allow_html=True)
    
    # 模式选择
    mode = st.radio(
        "添加模式",
        ["🤖 智能加工", "✏️ 直接存储"],
        horizontal=True,
        help="智能加工会使用LLM提取关键信息，直接存储则原样保存"
    )
    
    st.markdown("---")
    
    if mode == "✏️ 直接存储":
        st.info("💡 直接存储模式：内容将原样保存，不经过 LLM 加工")
        
        content = st.text_area("记忆内容", height=150, placeholder="输入要记住的内容...")
        importance = st.slider("重要度", 0.0, 1.0, 0.8, 0.1, help="重要度越高，越容易被召回")
        
        if st.button("💾 保存记忆", type="primary"):
            if content:
                try:
                    response = requests.post(
                        f"{MEMOS_API_URL}/add_raw",
                        json={
                            "messages": [{"content": content, "role": "user", "importance": importance}],
                            "user_id": "feiniu_default"
                        },
                        timeout=10
                    )
                    if response.status_code == 200:
                        st.success("✅ 记忆已保存！")
                        st.balloons()
                    else:
                        st.error(f"保存失败: {response.text}")
                except Exception as e:
                    st.error(f"保存出错: {e}")
            else:
                st.warning("请输入内容")
    
    else:  # 智能加工模式
        st.info("🤖 智能加工模式：使用 LLM 自动提取关键信息")
        
        content = st.text_area(
            "对话内容或原始文本",
            height=200,
            placeholder="输入完整的对话或要记住的内容...\n\n例如：\n用户：我今天去踢足球了\nAI：不错啊，运动很重要\n\n系统会自动提取关键信息"
        )
        
        if st.button("🤖 智能加工并保存", type="primary"):
            if content:
                with st.spinner("正在使用 LLM 加工记忆..."):
                    try:
                        response = requests.post(
                            f"{MEMOS_API_URL}/add",
                            json={"messages": [{"role": "user", "content": content}], "user_id": "feiniu_default"},
                            timeout=30
                        )
                        if response.status_code == 200:
                            data = response.json()
                            st.success("✅ 记忆已保存！")
                            if data.get('added', 0) > 0:
                                st.info(f"📝 新增 {data['added']} 条记忆")
                            if data.get('merged', 0) > 0:
                                st.warning(f"🔗 合并 {data['merged']} 条相似记忆")
                            st.balloons()
                        else:
                            st.error(f"保存失败: {response.text}")
                    except Exception as e:
                        st.error(f"保存出错: {e}")
            else:
                st.warning("请输入内容")

# ═══════════════════════════════════════════════════════════════
#                        去重合并页面
# ═══════════════════════════════════════════════════════════════

elif page == "🔄 去重合并":
    st.markdown("### 🔄 记忆去重合并")
    st.markdown('<p style="color: #64748b;">智能识别并合并相似记忆，优化存储效率</p>', unsafe_allow_html=True)
    
    st.markdown("---")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        threshold = st.slider(
            "相似度阈值",
            0.80, 0.99, 0.90, 0.01,
            help="相似度高于此值的记忆会被合并"
        )
        
        if threshold >= 0.95:
            st.caption("🎯 高阈值：仅合并几乎完全相同的记忆")
        elif threshold >= 0.90:
            st.caption("⚖️ 推荐阈值：合并高度相似的记忆")
        else:
            st.caption("🌐 低阈值：会合并较多记忆，请谨慎使用")
    
    with col2:
        try:
            response = requests.get(f"{MEMOS_API_URL}/stats", timeout=5)
            if response.status_code == 200:
                stats = response.json()
                st.metric("当前记忆数", stats.get('total_count', 0))
        except:
            st.metric("当前记忆数", "?")
    
    st.markdown("---")
    
    if st.button("🔄 开始去重合并", type="primary", use_container_width=True):
        with st.spinner("正在扫描和合并相似记忆..."):
            try:
                response = requests.post(
                    f"{MEMOS_API_URL}/deduplicate",
                    params={"threshold": threshold},
                    timeout=300
                )
                
                if response.status_code == 200:
                    data = response.json()
                    merged = data.get('merged_count', 0)
                    remaining = data.get('remaining_count', 0)
                    merge_details = data.get('merge_details', [])
                    
                    if merged > 0:
                        st.success(f"✅ 去重完成！合并了 {merged} 条相似记忆")
                        st.info(f"📚 剩余 {remaining} 条记忆")
                        st.balloons()
                        
                        st.markdown("---")
                        st.markdown("### 📋 合并详情")
                        
                        for i, detail in enumerate(merge_details):
                            with st.expander(f"合并 {i+1}: 相似度 {detail['similarity']}%"):
                                st.markdown(f"""
                                <div style="margin-bottom: 20px;">
                                    <div style="color: #ff6b6b; font-weight: 600; margin-bottom: 8px;">🔴 被删除的记忆：</div>
                                    <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 8px; padding: 15px; color: #e2e8f0; line-height: 1.6;">
                                        {detail['memory_2']}
                                    </div>
                                </div>
                                
                                <div style="margin-bottom: 20px;">
                                    <div style="color: #ffd93d; font-weight: 600; margin-bottom: 8px;">🟡 原记忆：</div>
                                    <div style="background: rgba(255, 217, 61, 0.1); border: 1px solid rgba(255, 217, 61, 0.3); border-radius: 8px; padding: 15px; color: #e2e8f0; line-height: 1.6;">
                                        {detail['memory_1']}
                                    </div>
                                </div>
                                
                                <div style="margin-bottom: 10px;">
                                    <div style="color: #00ff88; font-weight: 600; margin-bottom: 8px;">🟢 合并后：</div>
                                    <div style="background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 8px; padding: 15px; color: #e2e8f0; line-height: 1.6;">
                                        {detail['result']}
                                    </div>
                                </div>
                                """, unsafe_allow_html=True)
                    else:
                        st.success("✅ 扫描完成，未发现需要合并的记忆")
                else:
                    st.error(f"去重失败: {response.text}")
            except Exception as e:
                st.error(f"去重出错: {e}")

# ═══════════════════════════════════════════════════════════════
#                        数据导入页面
# ═══════════════════════════════════════════════════════════════

elif page == "📥 数据导入":
    st.markdown("### 📥 数据导入")
    st.markdown('<p style="color: #64748b;">从旧记忆库导入数据到 MEMOS 系统</p>', unsafe_allow_html=True)
    
    st.markdown("---")
    
    st.markdown("""
    <div class="memory-card">
        <h4 style="color: var(--primary-color);">📂 导入旧记忆库</h4>
        <p style="color: #64748b;">将现有的 <code>AI记录室/记忆库.txt</code> 文件导入到 MEMOS</p>
    </div>
    """, unsafe_allow_html=True)
    
    file_path = st.text_input("记忆库文件路径", value="./AI记录室/记忆库.txt")
    
    if st.button("🚀 一键导入", type="primary"):
        if file_path:
            with st.spinner("正在导入记忆..."):
                try:
                    response = requests.post(
                        f"{MEMOS_API_URL}/migrate",
                        json={"file_path": file_path},
                        timeout=60
                    )
                    if response.status_code == 200:
                        data = response.json()
                        st.success(f"✅ 成功导入 {data.get('imported_count', 0)} 条记忆！")
                        st.balloons()
                    else:
                        st.error(f"导入失败: {response.text}")
                except Exception as e:
                    st.error(f"导入出错: {e}")
    
    st.markdown("---")
    
    # 批量加工功能
    st.markdown("""
    <div class="memory-card">
        <h4 style="color: var(--primary-color);">🔧 批量加工现有记忆</h4>
        <p style="color: #64748b;">使用 LLM 提取关键信息，让记忆更精炼、检索更准确</p>
    </div>
    """, unsafe_allow_html=True)
    
    st.warning("⚠️ 此操作会使用 LLM 加工所有未处理的记忆，可能需要较长时间和 API 费用")
    
    if st.button("🔧 开始批量加工", type="secondary"):
        with st.spinner("正在加工记忆，请稍候..."):
            try:
                response = requests.post(
                    f"{MEMOS_API_URL}/reprocess",
                    timeout=300  # 5分钟超时
                )
                
                if response.status_code == 200:
                    data = response.json()
                    processed = data.get('processed_count', 0)
                    failed = data.get('failed_count', 0)
                    st.success(f"✅ 加工完成！成功: {processed} 条, 失败: {failed} 条")
                    st.balloons()
                else:
                    st.error(f"加工失败: {response.text}")
            except Exception as e:
                st.error(f"加工出错: {e}")

# ═══════════════════════════════════════════════════════════════
#                        系统设置页面
# ═══════════════════════════════════════════════════════════════

elif page == "⚙️ 系统设置":
    st.markdown("### ⚙️ 系统设置")
    st.markdown('<p style="color: #64748b;">配置记忆召回策略和系统参数</p>', unsafe_allow_html=True)
    
    st.markdown("---")
    
    st.markdown("#### 🎯 快捷预设")
    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button("🎯 精准模式", use_container_width=True):
            st.info("相似度阈值: 0.8, 返回数量: 3")
    with col2:
        if st.button("⚖️ 平衡模式", use_container_width=True):
            st.info("相似度阈值: 0.7, 返回数量: 5")
    with col3:
        if st.button("🌐 宽松模式", use_container_width=True):
            st.info("相似度阈值: 0.5, 返回数量: 8")
    
    st.markdown("---")
    st.markdown("#### 🔧 高级设置")
    
    top_k = st.slider("返回记忆数量", 1, 10, 5)
    similarity = st.slider("相似度阈值", 0.0, 1.0, 0.7, 0.05)
    
    st.markdown("---")
    
    if st.button("💾 保存设置", type="primary"):
        st.success("✅ 设置已保存")

# ═══════════════════════════════════════════════════════════════
#                        页脚
# ═══════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown("""
<div style="text-align: center; padding: 20px; color: #64748b;">
    <p style="font-family: 'Orbitron', sans-serif; letter-spacing: 2px;">MEMOS</p>
    <p style="font-size: 0.8em;">Memory Operating System | 肥牛AI 集成版本</p>
</div>
""", unsafe_allow_html=True)
