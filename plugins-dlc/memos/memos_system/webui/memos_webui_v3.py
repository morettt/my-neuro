# memos_webui_v3.py - MemOS 记忆中心 WebUI v3.0 (单文件 Tabs 版本)
# 运行方式: streamlit run memos_webui_v3.py

import streamlit as st
import requests
import json
import base64
import os
import tempfile
from datetime import datetime

# 尝试导入 pyvis
try:
    from pyvis.network import Network
    import streamlit.components.v1 as components
    PYVIS_AVAILABLE = True
except ImportError:
    PYVIS_AVAILABLE = False

# ═══════════════════════════════════════════════════════════════
#                        配置和常量
# ═══════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="MEMOS v3.0 | 记忆中心",
    page_icon="🧠",
    layout="wide"
)

# 深色科技风样式
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');

/* 隐藏默认元素 */
footer {visibility: hidden;}
#MainMenu {visibility: hidden;}
header[data-testid="stHeader"] {background: transparent !important;}

/* 主应用背景 */
.stApp {
    background: linear-gradient(135deg, #0a0e17 0%, #1a1f35 50%, #0d1321 100%);
}

/* 侧边栏 */
[data-testid="stSidebar"] {
    background: linear-gradient(180deg, rgba(10, 14, 23, 0.98) 0%, rgba(26, 31, 53, 0.98) 100%);
    border-right: 1px solid rgba(0, 212, 255, 0.2);
}

/* 标题样式 */
h1, h2, h3, h4 {
    color: #00d4ff !important;
    text-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
}
h1 {
    font-family: 'Orbitron', sans-serif !important;
    letter-spacing: 3px;
}

/* 全局文字颜色 */
p, span, div, label {
    color: #e2e8f0 !important;
}
.stMarkdown {
    color: #e2e8f0 !important;
}
/* caption 文字稍暗 */
[data-testid="stCaptionContainer"] {
    color: #94a3b8 !important;
}
[data-testid="stCaptionContainer"] p {
    color: #94a3b8 !important;
}

/* Tabs 样式 */
.stTabs [data-baseweb="tab-list"] {
    gap: 4px;
    background: rgba(0, 0, 0, 0.3);
    padding: 8px;
    border-radius: 12px;
    border: 1px solid rgba(0, 212, 255, 0.2);
}
.stTabs [data-baseweb="tab"] {
    background: rgba(0, 212, 255, 0.05);
    border-radius: 8px;
    padding: 10px 20px;
    border: 1px solid transparent;
    transition: all 0.3s ease;
}
.stTabs [data-baseweb="tab"]:hover {
    background: rgba(0, 212, 255, 0.15);
    border-color: rgba(0, 212, 255, 0.3);
}
.stTabs [aria-selected="true"] {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(123, 44, 191, 0.2) 100%);
    border-color: #00d4ff;
    box-shadow: 0 0 15px rgba(0, 212, 255, 0.3);
}

/* 容器/卡片样式 */
[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"] {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(0, 212, 255, 0.4);
    border-radius: 12px;
    box-shadow: 0 0 15px rgba(0, 212, 255, 0.15), 0 4px 20px rgba(0, 0, 0, 0.4);
}
[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"]:hover {
    border-color: rgba(0, 212, 255, 0.6);
    box-shadow: 0 0 25px rgba(0, 212, 255, 0.25), 0 4px 25px rgba(0, 0, 0, 0.5);
}

/* 下拉菜单样式 */
[data-baseweb="select"] > div {
    background: rgba(10, 14, 23, 0.9) !important;
    border-color: rgba(0, 212, 255, 0.3) !important;
}
/* 下拉菜单弹出层 */
[data-baseweb="popover"],
[data-baseweb="menu"],
div[data-baseweb="popover"] > div,
ul[role="listbox"],
div[data-testid="stSelectboxVirtualDropdown"] {
    background: #0d1321 !important;
    background-color: #0d1321 !important;
    border: 1px solid rgba(0, 212, 255, 0.3) !important;
}
/* 下拉菜单选项 */
[data-baseweb="menu"] li,
li[role="option"],
div[role="option"],
[data-testid="stSelectboxVirtualDropdown"] > div {
    color: #e2e8f0 !important;
    background: transparent !important;
}
li[role="option"]:hover,
div[role="option"]:hover,
[data-baseweb="menu"] li:hover {
    background: rgba(0, 212, 255, 0.2) !important;
    color: #00d4ff !important;
}
li[aria-selected="true"],
div[aria-selected="true"] {
    background: rgba(0, 212, 255, 0.3) !important;
    color: #00d4ff !important;
}

/* 按钮样式 */
.stButton > button {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(123, 44, 191, 0.2) 100%);
    border: 1px solid rgba(0, 212, 255, 0.4);
    color: #00d4ff;
    border-radius: 8px;
    transition: all 0.3s ease;
}
.stButton > button:hover {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.3) 0%, rgba(123, 44, 191, 0.3) 100%);
    border-color: #00d4ff;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
    transform: translateY(-2px);
}
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #00d4ff 0%, #7b2cbf 100%);
    color: white;
}

/* 输入框样式 */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea,
.stSelectbox > div > div {
    background: rgba(10, 14, 23, 0.8) !important;
    border: 1px solid rgba(0, 212, 255, 0.3) !important;
    border-radius: 8px !important;
    color: #e2e8f0 !important;
}
.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: #00d4ff !important;
    box-shadow: 0 0 10px rgba(0, 212, 255, 0.3) !important;
}

/* Metric 样式 */
[data-testid="stMetric"] {
    background: rgba(0, 212, 255, 0.05);
    border: 1px solid rgba(0, 212, 255, 0.2);
    border-radius: 12px;
    padding: 15px;
}
[data-testid="stMetricValue"] {
    color: #00d4ff !important;
    font-family: 'Orbitron', sans-serif !important;
}

/* 滑块样式 */
.stSlider > div > div > div > div {
    background: linear-gradient(90deg, #00d4ff, #7b2cbf) !important;
}

/* 成功/错误/警告/信息提示 */
.stSuccess, .stError, .stWarning, .stInfo {
    border-radius: 8px;
}

/* 分隔线 */
hr {
    border-color: rgba(0, 212, 255, 0.2) !important;
}

/* 滚动条 */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
::-webkit-scrollbar-track {
    background: #0a0e17;
}
::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #00d4ff, #7b2cbf);
    border-radius: 4px;
}
</style>
""", unsafe_allow_html=True)

MEMOS_API_URL = "http://127.0.0.1:8003"

MEMORY_TYPE_LABELS = {
    'general': '通用', 'preference': '偏好', 'fact': '事实',
    'semantic': '语义', 'episodic': '情景', 'procedural': '程序性',
    'document': '文档', 'image': '图片', 'tool': '工具'
}

MEMORY_TYPE_EMOJI = {
    'general': '📝', 'preference': '💜', 'fact': '💡',
    'semantic': '🧠', 'episodic': '📅', 'procedural': '⚙️',
    'document': '📄', 'image': '🖼️', 'tool': '🔧'
}

# ═══════════════════════════════════════════════════════════════
#                        API 函数
# ═══════════════════════════════════════════════════════════════

def check_service_status():
    try:
        r = requests.get(f"{MEMOS_API_URL}/health", timeout=2)
        return r.status_code == 200, r.json() if r.status_code == 200 else {}
    except:
        return False, {}

def api_get(endpoint, params=None, timeout=5):
    try:
        r = requests.get(f"{MEMOS_API_URL}{endpoint}", params=params, timeout=timeout)
        return r.json() if r.status_code == 200 else None
    except:
        return None

def api_post(endpoint, data=None, timeout=10):
    try:
        r = requests.post(f"{MEMOS_API_URL}{endpoint}", json=data, timeout=timeout)
        return r.status_code, r.json() if r.status_code == 200 else r.text
    except Exception as e:
        return 500, str(e)

def api_put(endpoint, data=None, timeout=10):
    try:
        r = requests.put(f"{MEMOS_API_URL}{endpoint}", json=data, timeout=timeout)
        return r.status_code, r.json() if r.status_code == 200 else r.text
    except Exception as e:
        return 500, str(e)

def api_delete(endpoint, timeout=5):
    try:
        r = requests.delete(f"{MEMOS_API_URL}{endpoint}", timeout=timeout)
        return r.status_code == 200
    except:
        return False

def get_type_label(t):
    return MEMORY_TYPE_LABELS.get(t, t)

def get_type_emoji(t):
    return MEMORY_TYPE_EMOJI.get(t, '📝')

# ═══════════════════════════════════════════════════════════════
#                        侧边栏
# ═══════════════════════════════════════════════════════════════

with st.sidebar:
    st.markdown("### 🧠 MEMOS v3.0")
    st.caption("Memory Operating System")
    st.markdown("---")
    
    status_ok, health = check_service_status()
    if status_ok:
        mem_count = health.get('memory_count', 0)
        st.success(f"✅ 系统在线")
        st.metric("记忆总数", mem_count)
    else:
        st.error("❌ 系统离线")
    
    st.markdown("---")
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 刷新", use_container_width=True):
            st.rerun()
    with col2:
        if st.button("📖 API", use_container_width=True):
            st.info("http://127.0.0.1:8003/docs")
    
    st.markdown("---")
    st.caption("© 2024 MemOS | Powered by AI")

# ═══════════════════════════════════════════════════════════════
#                        主内容 - Tabs
# ═══════════════════════════════════════════════════════════════

tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
    "🏠 首页", "📊 数据总览", "📋 记忆管理", "🔧 记忆操作",
    "🖼️ 图片记忆", "🕸️ 知识图谱", "📥 知识库"
])

# ═══════════════════════════════════════════════════════════════
#                        Tab 1: 首页
# ═══════════════════════════════════════════════════════════════

with tab1:
    st.markdown("# 🧠 M E M O S")
    st.markdown("##### Memory Operating System | 全功能记忆中心")
    st.markdown("---")
    
    st.markdown("### 🚀 快速入口")
    col1, col2, col3 = st.columns(3)
    with col1:
        with st.container(border=True):
            st.markdown("#### 📊 数据总览")
            st.caption("查看系统统计和状态")
            st.caption("实时监控记忆存储")
    with col2:
        with st.container(border=True):
            st.markdown("#### 📋 记忆管理")
            st.caption("浏览和管理所有记忆")
            st.caption("筛选、编辑、删除")
    with col3:
        with st.container(border=True):
            st.markdown("#### 🔧 记忆操作")
            st.caption("智能检索、新增、修正")
            st.caption("AI 驱动的记忆处理")
    
    col4, col5, col6 = st.columns(3)
    with col4:
        with st.container(border=True):
            st.markdown("#### 🖼️ 图片记忆")
            st.caption("管理视觉记忆")
    with col5:
        with st.container(border=True):
            st.markdown("#### 🕸️ 知识图谱")
            st.caption("实体关系网络")
    with col6:
        with st.container(border=True):
            st.markdown("#### 📥 知识库")
            st.caption("导入外部知识")
    
    st.markdown("---")
    st.markdown("### 📡 系统状态")
    if status_ok:
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.metric("API 服务", "🟢 在线")
        with c2:
            st.metric("记忆总数", health.get('memory_count', 0))
        with c3:
            st.metric("向量引擎", "Qdrant")
        with c4:
            st.metric("API 端口", "8003")
    else:
        st.error("API 服务不可用")

# ═══════════════════════════════════════════════════════════════
#                        Tab 2: 数据总览
# ═══════════════════════════════════════════════════════════════

with tab2:
    st.header("📊 数据总览")
    st.divider()
    
    stats = api_get("/stats")
    graph_stats = api_get("/graph/stats")
    
    if stats:
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.metric("总记忆数", stats.get("total_count", 0))
        with c2:
            entity_count = graph_stats.get('entity_count', 0) if graph_stats else 0
            st.metric("实体数", entity_count)
        with c3:
            st.metric("今日新增", stats.get('today_count', 0))
        with c4:
            st.metric("本周新增", stats.get('week_count', 0))
        
        st.divider()
        c1, c2 = st.columns(2)
        with c1:
            st.subheader("存储状态")
            with st.container(border=True):
                avg_imp = stats.get('avg_importance', 0)
                st.write(f"平均重要度: {avg_imp:.0%}" if avg_imp else "平均重要度: N/A")
                st.write("向量数据库: Qdrant")
        with c2:
            st.subheader("功能状态")
            with st.container(border=True):
                st.write("知识图谱: " + ("已启用" if graph_stats else "未启用"))
                st.write("图片记忆: 已启用")
    else:
        st.error("无法连接服务")

# ═══════════════════════════════════════════════════════════════
#                        Tab 3: 记忆管理
# ═══════════════════════════════════════════════════════════════

with tab3:
    st.header("📋 记忆管理")
    st.divider()
    
    # 筛选
    fc1, fc2, fc3 = st.columns([2, 2, 1])
    with fc1:
        type_opts = ["全部", "偏好", "事实", "情景", "语义", "通用", "文档", "工具", "图片"]
        type_map = {"全部": None, "偏好": "preference", "事实": "fact", 
                    "情景": "episodic", "语义": "semantic", "通用": "general", 
                    "文档": "document", "工具": "tool", "图片": "image"}
        type_filter = st.selectbox("类型筛选", type_opts, key="t3_type")
    with fc2:
        search_kw = st.text_input("关键词", placeholder="搜索...", key="t3_kw")
    with fc3:
        per_page = st.selectbox("每页", [10, 20, 50], key="t3_pp")
    
    # 分页状态
    if 't3_page' not in st.session_state:
        st.session_state.t3_page = 1
    
    # 获取数据
    data = api_get("/list", {"limit": 500})
    if data:
        memories = data.get('memories', [])
        memories.sort(key=lambda x: x.get('created_at') or '', reverse=True)
        
        # 筛选
        sel_type = type_map.get(type_filter)
        if sel_type:
            memories = [m for m in memories if m.get('memory_type') == sel_type]
        if search_kw:
            memories = [m for m in memories if search_kw.lower() in m.get('content', '').lower()]
        
        total = len(memories)
        total_pages = max(1, (total + per_page - 1) // per_page)
        st.session_state.t3_page = min(st.session_state.t3_page, total_pages)
        
        st.info(f"共 {total} 条 | 第 {st.session_state.t3_page}/{total_pages} 页")
        
        # 分页按钮
        pc1, pc2, pc3, pc4 = st.columns(4)
        with pc1:
            if st.button("首页", key="t3_first", disabled=st.session_state.t3_page <= 1):
                st.session_state.t3_page = 1
                st.rerun()
        with pc2:
            if st.button("上页", key="t3_prev", disabled=st.session_state.t3_page <= 1):
                st.session_state.t3_page -= 1
                st.rerun()
        with pc3:
            if st.button("下页", key="t3_next", disabled=st.session_state.t3_page >= total_pages):
                st.session_state.t3_page += 1
                st.rerun()
        with pc4:
            if st.button("末页", key="t3_last", disabled=st.session_state.t3_page >= total_pages):
                st.session_state.t3_page = total_pages
                st.rerun()
        
        st.divider()
        
        # 显示记忆
        start = (st.session_state.t3_page - 1) * per_page
        for i, mem in enumerate(memories[start:start+per_page]):
            idx = start + i + 1
            mem_id = mem.get('id', '')
            content = mem.get('content', '')
            mtype = mem.get('memory_type', 'general')
            imp = mem.get('importance', 0.5)
            created = mem.get('created_at', '')
            tags = mem.get('tags', [])  # 获取标签
            
            time_str = ''
            if created:
                try:
                    time_str = datetime.fromisoformat(created).strftime("%Y-%m-%d %H:%M")
                except:
                    pass
            
            with st.container(border=True):
                c1, c2 = st.columns([4, 1])
                with c1:
                    st.write(f"**#{idx}**")
                with c2:
                    st.caption(f"{get_type_emoji(mtype)} {get_type_label(mtype)}")
                
                st.write(content)
                
                # 显示标签
                if tags and len(tags) > 0:
                    tags_html = " ".join([f"<span style='background: rgba(0,212,255,0.2); padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-right: 4px;'>🏷️ {tag}</span>" for tag in tags])
                    st.markdown(f"<div style='margin: 8px 0;'>{tags_html}</div>", unsafe_allow_html=True)
                
                # 显示基本信息和完整 ID
                st.markdown(f"""
                <div style="font-size: 0.85em; color: #94a3b8;">
                    重要度 {imp:.0%} | {time_str}<br/>
                    <span style="color: #00d4ff; font-family: monospace; background: rgba(0,212,255,0.1); padding: 2px 6px; border-radius: 4px;">ID: {mem_id}</span>
                </div>
                """, unsafe_allow_html=True)
                
                bc1, bc2, bc3 = st.columns([1, 1, 3])
                with bc1:
                    if st.button("✏️ 修改", key=f"edit_{mem_id}"):
                        st.session_state[f"editing_{mem_id}"] = True
                with bc2:
                    if st.button("🗑️ 删除", key=f"del_{mem_id}"):
                        if api_delete(f"/delete/{mem_id}"):
                            st.toast("已删除")
                            st.rerun()
                
                # 编辑模式
                if st.session_state.get(f"editing_{mem_id}", False):
                    st.markdown("---")
                    new_content = st.text_area("修改内容", value=content, key=f"edit_content_{mem_id}", height=100)
                    new_imp = st.slider("重要度", 0.0, 1.0, imp, 0.1, key=f"edit_imp_{mem_id}")
                    
                    ec1, ec2 = st.columns(2)
                    with ec1:
                        if st.button("💾 保存", key=f"save_{mem_id}", type="primary"):
                            status, res = api_post("/memory/feedback", {
                                "memory_id": mem_id,
                                "feedback_type": "correct",
                                "correction": new_content
                            })
                            if status == 200:
                                st.session_state[f"editing_{mem_id}"] = False
                                st.toast("修改成功")
                                st.rerun()
                            else:
                                st.error(f"修改失败: {res}")
                    with ec2:
                        if st.button("❌ 取消", key=f"cancel_{mem_id}"):
                            st.session_state[f"editing_{mem_id}"] = False
                            st.rerun()
    else:
        st.error("获取数据失败")

# ═══════════════════════════════════════════════════════════════
#                        Tab 4: 记忆操作
# ═══════════════════════════════════════════════════════════════

with tab4:
    st.header("🔧 记忆操作")
    st.divider()
    
    op_tab1, op_tab2, op_tab3, op_tab4 = st.tabs(["智能检索", "新增记忆", "去重合并", "批量操作"])
    
    with op_tab1:
        st.subheader("智能检索")
        query = st.text_input("搜索", placeholder="输入关键词...", key="t4_query")
        
        c1, c2 = st.columns(2)
        with c1:
            top_k = st.slider("结果数量", 3, 20, 5, key="t4_topk")
        with c2:
            use_graph = st.checkbox("启用图谱增强", value=True, key="t4_graph")
        
        threshold = st.slider("相似度阈值", 0.3, 0.9, 0.5, 0.1, key="t4_threshold")
        
        if st.button("开始检索", type="primary", key="t4_search"):
            if query:
                with st.spinner("检索中..."):
                    status, result = api_post("/search", {
                        "query": query, 
                        "top_k": top_k,
                        "use_graph": use_graph,
                        "similarity_threshold": threshold
                    })
                    if status == 200:
                        mems = result.get('memories', [])
                        if mems:
                            st.success(f"找到 {len(mems)} 条")
                            for i, m in enumerate(mems):
                                with st.container(border=True):
                                    st.write(f"**#{i+1}** {get_type_emoji(m.get('memory_type', 'general'))}")
                                    st.write(m.get('content', ''))
                                    sim = m.get('similarity', 0)
                                    st.caption(f"相似度 {sim:.0%}")
                        else:
                            st.warning("未找到")
                    else:
                        st.error(f"失败: {result}")
    
    with op_tab2:
        st.subheader("新增记忆")
        content = st.text_area("内容", height=150, key="t4_content", 
                               placeholder="输入要保存的记忆内容...\n例如：用户今天说他喜欢吃火锅。")
        
        # 添加模式选择
        add_mode = st.radio(
            "添加模式",
            ["🤖 智能添加 (LLM 自动分类总结)", "📝 原始添加 (直接保存)"],
            key="t4_add_mode",
            horizontal=True
        )
        
        c1, c2 = st.columns(2)
        with c1:
            importance = st.slider("重要度", 0.0, 1.0, 0.8, 0.1, key="t4_imp")
        with c2:
            type_opts = {"通用": "general", "事实": "fact", "偏好": "preference", "情景": "episodic", "语义": "semantic", "程序性": "procedural"}
            sel = st.selectbox("类型 (原始添加时生效)", list(type_opts.keys()), key="t4_mtype",
                              disabled="智能添加" in add_mode)
        
        if "智能添加" in add_mode:
            st.caption("💡 智能添加会通过 LLM 自动：1) 提取关键信息 2) 分类记忆类型 3) 生成标签 4) 提取知识图谱实体")
        else:
            st.caption("📝 原始添加会直接保存内容，使用你选择的类型和重要度")
        
        if st.button("保存记忆", type="primary", key="t4_save"):
            if content:
                with st.spinner("处理中..."):
                    if "智能添加" in add_mode:
                        # 使用 /add 端点（LLM 加工版）
                        status, result = api_post("/add", {
                            "messages": [{"content": content, "role": "user"}],
                            "user_id": "default_user"
                        }, timeout=60)
                        if status == 200:
                            added = result.get('added', 0)
                            merged = result.get('merged', 0)
                            entities = result.get('entities_extracted', 0)
                            msg = result.get('message', '处理完成')
                            st.success(f"✅ {msg}")
                            if added > 0 or merged > 0 or entities > 0:
                                st.info(f"📊 新增: {added} | 合并: {merged} | 实体: {entities}")
                            st.balloons()
                        else:
                            st.error(f"失败: {result}")
                    else:
                        # 使用 /add_raw 端点（直接保存）
                        status, result = api_post("/add_raw", {
                            "messages": [{"content": content, "importance": importance, "memory_type": type_opts[sel]}]
                        })
                        if status == 200:
                            st.success("✅ 已保存")
                            st.balloons()
                        else:
                            st.error(f"失败: {result}")
            else:
                st.warning("请输入记忆内容")
    
    with op_tab3:
        st.subheader("去重合并")
        threshold = st.slider("相似度阈值", 0.80, 0.99, 0.90, 0.01, key="t4_dedup")
        by_type = st.checkbox("按记忆类型分组去重（推荐）", value=True, key="t4_by_type")
        
        if by_type:
            st.caption("只在同类型记忆中进行去重，避免误合并不同类型的记忆")
        
        if st.button("开始去重", type="primary", key="t4_dedup_btn"):
            with st.spinner("处理中..."):
                try:
                    r = requests.post(f"{MEMOS_API_URL}/deduplicate", params={"threshold": threshold, "by_type": by_type}, timeout=300)
                    if r.status_code == 200:
                        d = r.json()
                        st.success(f"合并 {d.get('merged_count', 0)} 条，剩余 {d.get('remaining_count', 0)} 条")
                    else:
                        st.error(r.text)
                except Exception as e:
                    st.error(str(e))
    
    with op_tab4:
        st.subheader("批量操作")
        if st.button("重新分类所有记忆", key="t4_reclassify"):
            with st.spinner("处理中..."):
                try:
                    r = requests.post(f"{MEMOS_API_URL}/reclassify", timeout=3600)
                    if r.status_code == 200:
                        st.success("完成")
                        st.json(r.json())
                except Exception as e:
                    st.error(str(e))

# ═══════════════════════════════════════════════════════════════
#                        Tab 5: 图片记忆
# ═══════════════════════════════════════════════════════════════

with tab5:
    st.header("🖼️ 图片记忆")
    st.divider()
    
    # 显示图片存储路径提示和工具
    with st.expander("🔧 图片工具", expanded=False):
        st.markdown("""
        **本地存储路径**: `memos_system/data/images/`
        - 原图: `originals/` 文件夹
        - 缩略图: `thumbnails/` 文件夹
        """)
        
        st.markdown("---")
        st.markdown("**批量生成描述**")
        st.caption("为没有描述的图片使用 AI 自动生成描述")
        
        force_regen = st.checkbox("强制重新生成所有描述", value=False, key="force_regen_desc")
        
        if st.button("🤖 生成图片描述", type="primary", key="regen_desc_btn"):
            with st.spinner("正在生成描述，这可能需要一些时间..."):
                try:
                    r = requests.post(
                        f"{MEMOS_API_URL}/images/regenerate-descriptions",
                        params={"force": force_regen},
                        timeout=300
                    )
                    if r.status_code == 200:
                        result = r.json()
                        st.success(f"✅ {result.get('message', '完成')}")
                        st.rerun()
                    else:
                        st.error(f"失败: {r.text}")
                except Exception as e:
                    st.error(f"请求失败: {e}")
    
    img_tab1, img_tab2 = st.tabs(["图片库", "上传图片"])
    
    with img_tab1:
        # 分页控制
        if 'img_page' not in st.session_state:
            st.session_state.img_page = 1
        img_per_page = st.selectbox("每页显示", [6, 12, 24], key="img_per_page")
        
        images = api_get("/images", {"limit": 100})
        if images:
            imgs = images.get('images', [])
            if imgs:
                total_imgs = len(imgs)
                total_pages = max(1, (total_imgs + img_per_page - 1) // img_per_page)
                st.session_state.img_page = min(st.session_state.img_page, total_pages)
                
                st.info(f"共 {total_imgs} 张图片 | 第 {st.session_state.img_page}/{total_pages} 页")
                
                # 分页按钮
                pc1, pc2, pc3, pc4 = st.columns(4)
                with pc1:
                    if st.button("首页", key="img_first", disabled=st.session_state.img_page <= 1):
                        st.session_state.img_page = 1
                        st.rerun()
                with pc2:
                    if st.button("上页", key="img_prev", disabled=st.session_state.img_page <= 1):
                        st.session_state.img_page -= 1
                        st.rerun()
                with pc3:
                    if st.button("下页", key="img_next", disabled=st.session_state.img_page >= total_pages):
                        st.session_state.img_page += 1
                        st.rerun()
                with pc4:
                    if st.button("末页", key="img_last", disabled=st.session_state.img_page >= total_pages):
                        st.session_state.img_page = total_pages
                        st.rerun()
                
                st.divider()
                
                # 显示当前页的图片
                start_idx = (st.session_state.img_page - 1) * img_per_page
                page_imgs = imgs[start_idx:start_idx + img_per_page]
                
                cols = st.columns(3)
                for i, img in enumerate(page_imgs):
                    with cols[i % 3]:
                        with st.container(border=True):
                            img_id = img.get('id', '')
                            desc = img.get('description') or '无描述'
                            img_type = img.get('image_type') or 'other'
                            created = img.get('created_at', '')
                            
                            # 显示图片（获取缩略图）
                            try:
                                img_data_resp = api_get(f"/images/{img_id}/data?thumbnail=true", timeout=10)
                                if img_data_resp and img_data_resp.get('data'):
                                    img_b64 = img_data_resp.get('data')
                                    st.image(f"data:image/jpeg;base64,{img_b64}", use_container_width=True)
                                else:
                                    st.markdown("🖼️ *图片加载失败*")
                            except Exception as e:
                                st.markdown(f"🖼️ *图片加载失败*")
                            
                            # 显示完整描述
                            if desc == '无描述' or not desc or desc.strip() == '':
                                st.markdown("*⚠️ 无描述*")
                            elif len(desc) > 50:
                                with st.expander(f"📝 {desc[:50]}..."):
                                    st.write(desc)
                            else:
                                st.write(f"**{desc}**")
                            
                            st.caption(f"类型: {img_type}")
                            
                            # 格式化时间
                            if created:
                                try:
                                    time_str = datetime.fromisoformat(created).strftime("%Y-%m-%d %H:%M")
                                    st.caption(f"时间: {time_str}")
                                except:
                                    pass
                            
                            # 操作按钮
                            bc1, bc2 = st.columns(2)
                            with bc1:
                                if st.button("🔍 查看原图", key=f"view_img_{img_id}"):
                                    st.session_state[f"show_full_{img_id}"] = True
                            with bc2:
                                # 使用确认机制避免误删
                                if st.session_state.get(f"confirm_del_img_{img_id}", False):
                                    st.warning("确定删除？")
                                    dc1, dc2 = st.columns(2)
                                    with dc1:
                                        if st.button("✅ 确定", key=f"confirm_yes_{img_id}"):
                                            if api_delete(f"/images/{img_id}"):
                                                st.toast("✅ 已删除")
                                                st.session_state[f"confirm_del_img_{img_id}"] = False
                                                st.rerun()
                                            else:
                                                st.error("删除失败")
                                    with dc2:
                                        if st.button("❌ 取消", key=f"confirm_no_{img_id}"):
                                            st.session_state[f"confirm_del_img_{img_id}"] = False
                                            st.rerun()
                                else:
                                    if st.button("🗑️ 删除", key=f"del_img_{img_id}"):
                                        st.session_state[f"confirm_del_img_{img_id}"] = True
                                        st.rerun()
                            
                            # 显示原图对话框
                            if st.session_state.get(f"show_full_{img_id}", False):
                                try:
                                    full_img_resp = api_get(f"/images/{img_id}/data?thumbnail=false", timeout=15)
                                    if full_img_resp and full_img_resp.get('data'):
                                        st.image(f"data:image/jpeg;base64,{full_img_resp.get('data')}", caption="原图")
                                    if st.button("关闭", key=f"close_img_{img_id}"):
                                        st.session_state[f"show_full_{img_id}"] = False
                                        st.rerun()
                                except Exception as e:
                                    st.error(f"加载原图失败: {e}")
            else:
                st.info("暂无图片")
        else:
            st.warning("图片功能未启用或服务不可用")
    
    with img_tab2:
        uploaded = st.file_uploader("选择图片", type=['png', 'jpg', 'jpeg', 'gif', 'webp'])
        if uploaded:
            st.image(uploaded, width=300)
            
            # 图片类型选择
            img_type_opts = {
                "照片": "photo", 
                "对话截图": "conversation", 
                "文档": "document", 
                "截图": "screenshot",
                "头像": "avatar",
                "参考图": "reference",
                "其他": "other"
            }
            img_type_sel = st.selectbox("图片类型", list(img_type_opts.keys()), key="t5_img_type")
            
            desc = st.text_input("描述 (可选，留空则自动生成)", key="t5_desc", placeholder="输入图片描述，或留空让 AI 自动生成...")
            auto_desc = st.checkbox("自动生成描述 (使用 LLM)", value=True, key="t5_auto_desc")
            
            if st.button("上传图片", type="primary", key="t5_upload"):
                with st.spinner("上传中..." + (" (正在生成描述...)" if auto_desc and not desc else "")):
                    # 重置文件指针
                    uploaded.seek(0)
                    img_b64 = base64.b64encode(uploaded.read()).decode()
                    
                    upload_data = {
                        "image_base64": img_b64, 
                        "image_type": img_type_opts[img_type_sel],
                        "auto_describe": auto_desc and not desc  # 只有留空描述且勾选自动生成时才自动生成
                    }
                    
                    # 如果有手动输入的描述，使用手动描述
                    if desc:
                        upload_data["description"] = desc
                    
                    status, result = api_post("/images/upload", upload_data, timeout=60)
                    
                    if status == 200:
                        gen_desc = result.get('description', '')
                        st.success(f"✅ 上传成功!")
                        if gen_desc:
                            st.info(f"📝 图片描述: {gen_desc}")
                        st.balloons()
                    else:
                        st.error(f"上传失败: {result}")

# ═══════════════════════════════════════════════════════════════
#                        Tab 6: 知识图谱
# ═══════════════════════════════════════════════════════════════

with tab6:
    st.header("🕸️ 知识图谱")
    st.divider()
    
    kg_tab1, kg_tab2, kg_tab3 = st.tabs(["图谱可视化", "实体列表", "添加实体"])
    
    with kg_tab1:
        entities = api_get("/graph/entities", {"limit": 500})
        relations = api_get("/graph/relations", {"limit": 1000})
        
        if entities and PYVIS_AVAILABLE:
            elist = entities.get('entities', [])
            rlist = relations.get('relations', []) if relations else []
            
            if elist:
                st.info(f"{len(elist)} 个实体, {len(rlist)} 条关系")
                
                # 创建图谱
                net = Network(height="500px", width="100%", bgcolor="#1a1a2e", font_color="white", directed=True)
                net.barnes_hut(gravity=-3000, spring_length=150)
                
                colors = {'person': '#ff6b6b', 'food': '#ffd93d', 'place': '#00d4ff', 'hobby': '#00ff88'}
                id_map = {}
                
                for e in elist:
                    eid = e.get('id', '')
                    name = e.get('name', '?')
                    etype = e.get('entity_type', 'other')
                    id_map[eid] = name
                    net.add_node(eid, label=name, color=colors.get(etype, '#64748b'), size=25)
                
                for r in rlist:
                    src, tgt = r.get('source_id', ''), r.get('target_id', '')
                    if src in id_map and tgt in id_map:
                        net.add_edge(src, tgt, title=r.get('relation_type', ''), arrows='to')
                
                with tempfile.NamedTemporaryFile(delete=False, suffix='.html', mode='w', encoding='utf-8') as f:
                    temp_path = f.name
                net.save_graph(temp_path)
                with open(temp_path, 'r', encoding='utf-8') as rf:
                    html_content = rf.read()
                components.html(html_content, height=520)
                try:
                    os.unlink(temp_path)
                except:
                    pass  # Windows 文件锁定，忽略删除错误
            else:
                st.info("暂无实体")
        else:
            st.warning("知识图谱未启用或 pyvis 未安装")
    
    with kg_tab2:
        entities = api_get("/graph/entities", {"limit": 500})
        if entities:
            for e in entities.get('entities', []):
                with st.container(border=True):
                    st.write(f"**{e.get('name')}** ({e.get('entity_type')})")
                    st.caption(f"ID: {e.get('id', '')[:16]}...")
    
    with kg_tab3:
        name = st.text_input("实体名称", key="t6_name")
        etype = st.selectbox("类型", ["person", "food", "place", "hobby", "concept", "other"], key="t6_type")
        if st.button("创建", type="primary", key="t6_create"):
            if name:
                status, result = api_post("/graph/entities", {"name": name, "entity_type": etype})
                if status == 200:
                    st.success("创建成功")
                else:
                    st.error(f"失败: {result}")

# ═══════════════════════════════════════════════════════════════
#                        Tab 7: 知识库
# ═══════════════════════════════════════════════════════════════

with tab7:
    st.header("📥 知识库操作")
    st.divider()
    
    kb_tab1, kb_tab2 = st.tabs(["导入网页", "导入文档"])
    
    with kb_tab1:
        url = st.text_input("网页 URL", placeholder="https://...", key="t7_url")
        tags = st.text_input("标签（逗号分隔）", key="t7_tags")
        if st.button("导入", type="primary", key="t7_import"):
            if url:
                with st.spinner("导入中..."):
                    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
                    status, result = api_post("/kb/import", {"source": url, "tags": tag_list}, timeout=60)
                    if status == 200:
                        st.success(f"导入成功: {result.get('imported_count', 0)} 条")
                    else:
                        st.error(f"失败: {result}")
    
    with kb_tab2:
        path = st.text_input("文档路径", placeholder="C:/docs/file.pdf", key="t7_path")
        if st.button("导入文档", type="primary", key="t7_doc"):
            if path:
                with st.spinner("处理中..."):
                    status, result = api_post("/kb/import", {"source": path}, timeout=120)
                    if status == 200:
                        st.success(f"导入成功: {result.get('imported_count', 0)} 条")
                    else:
                        st.error(f"失败: {result}")
