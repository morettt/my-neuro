# memos_webui_v2.py - MemOS 记忆中心 WebUI v2.0 (支持知识图谱)
import streamlit as st
import requests
import json
from datetime import datetime

# API 配置
MEMOS_API_URL = "http://127.0.0.1:8003"

# 页面配置
st.set_page_config(
    page_title="MEMOS v2.0 | 记忆中心",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 复用原 CSS（简化）
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&display=swap');

:root {
    --primary-color: #00d4ff;
    --secondary-color: #7b2cbf;
    --accent-color: #00ff88;
    --bg-dark: #0a0e17;
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
}

.stApp {
    background: linear-gradient(135deg, #0a0e17 0%, #1a1f35 50%, #0d1321 100%);
}

h1, h2, h3 {
    font-family: 'Noto Sans SC', sans-serif !important;
    color: var(--primary-color) !important;
}

.stat-card {
    background: linear-gradient(145deg, rgba(0, 212, 255, 0.1), rgba(123, 44, 191, 0.1));
    border: 1px solid rgba(0, 212, 255, 0.3);
    border-radius: 16px;
    padding: 20px;
    text-align: center;
}

.stat-number {
    font-family: 'Orbitron', monospace !important;
    font-size: 2em;
    font-weight: 700;
    background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.stat-label {
    color: var(--text-secondary);
    font-size: 0.85em;
    margin-top: 5px;
}

.memory-card {
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
    border: 1px solid rgba(0, 212, 255, 0.2);
    border-radius: 12px;
    padding: 15px;
    margin: 10px 0;
}

.entity-card {
    background: linear-gradient(145deg, rgba(123, 44, 191, 0.1), rgba(0, 212, 255, 0.1));
    border: 1px solid rgba(123, 44, 191, 0.3);
    border-radius: 12px;
    padding: 15px;
    margin: 10px 0;
}

.relation-badge {
    display: inline-block;
    background: linear-gradient(135deg, #00d4ff, #7b2cbf);
    color: white;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.85em;
    margin: 3px;
}

.status-online {
    color: #00ff88;
}

.status-offline {
    color: #ff5252;
}
</style>
""", unsafe_allow_html=True)


def check_service():
    """检查服务状态"""
    try:
        r = requests.get(f"{MEMOS_API_URL}/health", timeout=2)
        return r.status_code == 200, r.json() if r.status_code == 200 else {}
    except:
        return False, {}


def render_memory_card(mem, idx):
    """渲染记忆卡片"""
    content = mem.get('content', '')[:200]
    importance = mem.get('importance', 0.5)
    similarity = mem.get('similarity')
    
    sim_html = f'<span style="color: #00ff88;">相似度: {similarity:.0%}</span>' if similarity else ''
    
    return f"""
    <div class="memory-card">
        <div style="color: var(--primary-color); font-weight: 600;">#{idx}</div>
        <div style="color: var(--text-primary); margin: 10px 0;">{content}</div>
        <div style="color: var(--text-secondary); font-size: 0.85em;">
            重要度: {importance:.0%} {sim_html}
        </div>
    </div>
    """


def render_entity_card(entity):
    """渲染实体卡片"""
    name = entity.get('name', '')
    etype = entity.get('entity_type', '')
    props = entity.get('properties', {})
    eid = entity.get('id', '')[:8]
    
    props_str = ', '.join([f"{k}: {v}" for k, v in props.items()][:3]) if props else '无'
    
    return f"""
    <div class="entity-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--primary-color); font-weight: 600; font-size: 1.1em;">{name}</span>
            <span style="background: rgba(123, 44, 191, 0.3); padding: 2px 10px; border-radius: 10px; font-size: 0.8em;">{etype}</span>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.85em; margin-top: 8px;">
            ID: {eid}... | 属性: {props_str}
        </div>
    </div>
    """


# ═══════════════════════════════════════════════════════════════
#                        侧边栏
# ═══════════════════════════════════════════════════════════════

with st.sidebar:
    st.markdown("""
    <div style="text-align: center; padding: 20px 0;">
        <div style="font-size: 2.5em;">🧠</div>
        <div style="font-family: Orbitron, sans-serif; font-size: 1.3em; color: #00d4ff;">MEMOS v2.0</div>
        <div style="color: #64748b; font-size: 0.75em;">MEMORY + KNOWLEDGE GRAPH</div>
    </div>
    """, unsafe_allow_html=True)
    
    # 服务状态
    online, health = check_service()
    if online:
        st.markdown(f"""
        <div style="padding: 10px; background: rgba(0, 255, 136, 0.1); border-radius: 8px; margin-bottom: 15px;">
            <span class="status-online">● 系统在线</span>
            <span style="color: #64748b; font-size: 0.8em;"> | 记忆: {health.get('memory_count', 0)}</span>
        </div>
        """, unsafe_allow_html=True)
        
        graph_status = "已启用" if health.get('neo4j_available') else "未启用"
        st.markdown(f'<span style="color: #64748b; font-size: 0.8em;">图谱: {graph_status}</span>', unsafe_allow_html=True)
    else:
        st.markdown("""
        <div style="padding: 10px; background: rgba(255, 82, 82, 0.1); border-radius: 8px; margin-bottom: 15px;">
            <span class="status-offline">● 系统离线</span>
        </div>
        """, unsafe_allow_html=True)
    
    st.markdown("---")
    
    # 导航
    page = st.radio(
        "导航",
        ["📊 总览", "📋 记忆库", "🔍 搜索", "✏️ 添加记忆", 
         "🕸️ 知识图谱", "➕ 添加实体", "🔗 添加关系", "⚙️ 设置"],
        label_visibility="collapsed"
    )


# ═══════════════════════════════════════════════════════════════
#                        主页面
# ═══════════════════════════════════════════════════════════════

st.markdown("<h1 style='text-align: center;'>M E M O S</h1>", unsafe_allow_html=True)
st.markdown("<p style='text-align: center; color: #64748b;'>Memory Operating System v2.0 | 记忆 + 知识图谱</p>", unsafe_allow_html=True)

# ═══ 总览页面 ═══
if page == "📊 总览":
    try:
        stats = requests.get(f"{MEMOS_API_URL}/stats", timeout=5).json()
        graph_stats = requests.get(f"{MEMOS_API_URL}/graph/stats", timeout=5).json()
        
        st.markdown("### 📊 核心指标")
        
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.markdown(f'<div class="stat-card"><div class="stat-number">{stats.get("total_count", 0)}</div><div class="stat-label">总记忆数</div></div>', unsafe_allow_html=True)
        with col2:
            st.markdown(f'<div class="stat-card"><div class="stat-number">{graph_stats.get("entity_count", 0)}</div><div class="stat-label">实体数</div></div>', unsafe_allow_html=True)
        with col3:
            st.markdown(f'<div class="stat-card"><div class="stat-number">{graph_stats.get("relation_count", 0)}</div><div class="stat-label">关系数</div></div>', unsafe_allow_html=True)
        with col4:
            avg_imp = stats.get('avg_importance', 0)
            st.markdown(f'<div class="stat-card"><div class="stat-number">{avg_imp:.0%}</div><div class="stat-label">平均重要度</div></div>', unsafe_allow_html=True)
        
        st.markdown("---")
        
        # 系统状态
        col1, col2 = st.columns(2)
        with col1:
            st.markdown("### 💾 存储状态")
            st.info(f"Qdrant: {'✅ 已启用' if stats.get('storage_type') == 'qdrant' else '❌ 未启用'}")
            st.info(f"图数据库: {'✅ 已启用' if stats.get('graph_enabled') else '⚠️ 未启用'}")
        
        with col2:
            st.markdown("### 📈 v2.0 新功能")
            st.success("✅ Qdrant 向量库")
            st.success("✅ 知识图谱")
            st.success("✅ 重要度加权搜索")
            st.success("✅ 智能去重合并")
            
    except Exception as e:
        st.error(f"获取数据失败: {e}")

# ═══ 记忆库页面 ═══
elif page == "📋 记忆库":
    st.markdown("### 📋 记忆库")
    
    try:
        data = requests.get(f"{MEMOS_API_URL}/list", timeout=10).json()
        memories = data.get('memories', [])
        
        if memories:
            st.info(f"共 {len(memories)} 条记忆")
            for i, mem in enumerate(memories[:50]):  # 最多显示50条
                st.markdown(render_memory_card(mem, i+1), unsafe_allow_html=True)
                
                col1, col2 = st.columns([4, 1])
                with col2:
                    if st.button("🗑️", key=f"del_{i}"):
                        mid = mem.get('id')
                        requests.delete(f"{MEMOS_API_URL}/delete/{mid}")
                        st.rerun()
        else:
            st.warning("记忆库为空")
    except Exception as e:
        st.error(f"加载失败: {e}")

# ═══ 搜索页面 ═══
elif page == "🔍 搜索":
    st.markdown("### 🔍 智能搜索")
    
    query = st.text_input("", placeholder="输入搜索内容...")
    col1, col2 = st.columns([3, 1])
    with col1:
        threshold = st.slider("相似度阈值", 0.1, 0.9, 0.3, 0.1)
    with col2:
        top_k = st.selectbox("结果数", [3, 5, 10], index=1)
    
    if st.button("🚀 搜索", type="primary"):
        if query:
            try:
                result = requests.post(f"{MEMOS_API_URL}/search", json={
                    "query": query,
                    "top_k": top_k,
                    "similarity_threshold": threshold
                }, timeout=10).json()
                
                memories = result.get('memories', [])
                if memories:
                    st.success(f"找到 {len(memories)} 条相关记忆")
                    for i, mem in enumerate(memories):
                        st.markdown(render_memory_card(mem, i+1), unsafe_allow_html=True)
                else:
                    st.warning("未找到相关记忆")
            except Exception as e:
                st.error(f"搜索失败: {e}")

# ═══ 添加记忆页面 ═══
elif page == "✏️ 添加记忆":
    st.markdown("### ✏️ 添加记忆")
    
    mode = st.radio("模式", ["直接存储", "LLM 加工"], horizontal=True)
    content = st.text_area("内容", height=150)
    importance = st.slider("重要度", 0.0, 1.0, 0.8, 0.1)
    
    if st.button("💾 保存", type="primary"):
        if content:
            try:
                if mode == "直接存储":
                    r = requests.post(f"{MEMOS_API_URL}/add_raw", json={
                        "messages": [{"content": content, "importance": importance}]
                    })
                else:
                    r = requests.post(f"{MEMOS_API_URL}/add", json={
                        "messages": [{"role": "user", "content": content}]
                    })
                
                if r.status_code == 200:
                    st.success("✅ 保存成功！")
                    st.balloons()
                else:
                    st.error(f"保存失败: {r.text}")
            except Exception as e:
                st.error(f"保存出错: {e}")

# ═══ 知识图谱页面 ═══
elif page == "🕸️ 知识图谱":
    st.markdown("### 🕸️ 知识图谱")
    
    try:
        stats = requests.get(f"{MEMOS_API_URL}/graph/stats", timeout=5).json()
        
        col1, col2 = st.columns(2)
        with col1:
            st.metric("实体数", stats.get('entity_count', 0))
        with col2:
            st.metric("关系数", stats.get('relation_count', 0))
        
        st.markdown("---")
        st.markdown("### 📋 实体列表")
        
        entities = requests.get(f"{MEMOS_API_URL}/graph/entities", timeout=5).json()
        entity_list = entities.get('entities', [])
        
        if entity_list:
            for entity in entity_list:
                st.markdown(render_entity_card(entity), unsafe_allow_html=True)
                
                # 查看关系按钮
                with st.expander(f"查看 {entity.get('name')} 的关系"):
                    eid = entity.get('id')
                    relations = requests.get(f"{MEMOS_API_URL}/graph/entity/{eid}/relations", timeout=5).json()
                    rels = relations.get('relations', [])
                    
                    if rels:
                        for rel in rels:
                            direction = "→" if rel.get('direction') == 'out' else "←"
                            target = rel.get('target') if rel.get('direction') == 'out' else rel.get('source')
                            st.markdown(f'<span class="relation-badge">{direction} [{rel.get("relation_type")}] {target[:8]}...</span>', unsafe_allow_html=True)
                    else:
                        st.info("暂无关系")
                
                # 删除按钮
                if st.button("🗑️ 删除", key=f"del_entity_{entity.get('id')}"):
                    requests.delete(f"{MEMOS_API_URL}/graph/entity/{entity.get('id')}")
                    st.rerun()
                
                st.markdown("---")
        else:
            st.info("暂无实体，请先添加")
            
    except Exception as e:
        st.error(f"加载图谱失败: {e}")

# ═══ 添加实体页面 ═══
elif page == "➕ 添加实体":
    st.markdown("### ➕ 添加实体")
    
    name = st.text_input("实体名称", placeholder="如：张三、四川火锅、蓝色...")
    
    entity_type = st.selectbox("实体类型", [
        "person (人物)", "food (食物)", "place (地点)", 
        "hobby (爱好)", "profession (职业)", "color (颜色)",
        "concept (概念)", "item (物品)", "event (事件)", "other (其他)"
    ])
    etype = entity_type.split(" ")[0]
    
    st.markdown("#### 属性（可选）")
    prop_key = st.text_input("属性名", placeholder="如：age, city...")
    prop_value = st.text_input("属性值", placeholder="如：25, 北京...")
    
    if st.button("➕ 创建实体", type="primary"):
        if name:
            try:
                props = {prop_key: prop_value} if prop_key and prop_value else {}
                r = requests.post(f"{MEMOS_API_URL}/graph/entity", json={
                    "name": name,
                    "entity_type": etype,
                    "properties": props
                })
                
                if r.status_code == 200:
                    result = r.json()
                    st.success(f"✅ 实体创建成功！ID: {result.get('entity_id', '')[:8]}...")
                    st.balloons()
                else:
                    st.error(f"创建失败: {r.text}")
            except Exception as e:
                st.error(f"创建出错: {e}")
        else:
            st.warning("请输入实体名称")

# ═══ 添加关系页面 ═══
elif page == "🔗 添加关系":
    st.markdown("### 🔗 添加关系")
    
    try:
        # 获取所有实体供选择
        entities = requests.get(f"{MEMOS_API_URL}/graph/entities", timeout=5).json()
        entity_list = entities.get('entities', [])
        
        if len(entity_list) < 2:
            st.warning("需要至少 2 个实体才能创建关系，请先添加实体")
        else:
            entity_options = {f"{e.get('name')} ({e.get('entity_type')})": e.get('id') for e in entity_list}
            
            source = st.selectbox("源实体", list(entity_options.keys()))
            
            relation_type = st.selectbox("关系类型", [
                "likes (喜欢)", "dislikes (不喜欢)", "prefers (偏好)",
                "works_as (职业是)", "lives_in (居住在)", "knows (认识)",
                "owns (拥有)", "interested_in (感兴趣)", "related_to (相关)"
            ])
            rtype = relation_type.split(" ")[0]
            
            target = st.selectbox("目标实体", list(entity_options.keys()))
            
            # 预览
            st.markdown(f"""
            <div style="text-align: center; padding: 20px; background: rgba(0, 212, 255, 0.1); border-radius: 12px; margin: 20px 0;">
                <span style="color: #00d4ff; font-weight: 600;">{source.split(' ')[0]}</span>
                <span style="color: #64748b;"> —[</span>
                <span style="color: #00ff88;">{rtype}</span>
                <span style="color: #64748b;">]→ </span>
                <span style="color: #7b2cbf; font-weight: 600;">{target.split(' ')[0]}</span>
            </div>
            """, unsafe_allow_html=True)
            
            if st.button("🔗 创建关系", type="primary"):
                if source != target:
                    try:
                        r = requests.post(f"{MEMOS_API_URL}/graph/relation", json={
                            "source_id": entity_options[source],
                            "target_id": entity_options[target],
                            "relation_type": rtype
                        })
                        
                        if r.status_code == 200:
                            st.success("✅ 关系创建成功！")
                            st.balloons()
                        else:
                            st.error(f"创建失败: {r.text}")
                    except Exception as e:
                        st.error(f"创建出错: {e}")
                else:
                    st.warning("源实体和目标实体不能相同")
                    
    except Exception as e:
        st.error(f"加载实体列表失败: {e}")

# ═══ 设置页面 ═══
elif page == "⚙️ 设置":
    st.markdown("### ⚙️ 系统设置")
    
    st.markdown("#### API 地址")
    st.code(MEMOS_API_URL)
    
    st.markdown("#### 快捷操作")
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("🔄 刷新页面", use_container_width=True):
            st.rerun()
    with col2:
        if st.button("📊 查看 API 文档", use_container_width=True):
            st.info("访问 http://127.0.0.1:8003/docs")
    
    st.markdown("---")
    st.markdown("#### 去重合并")
    
    threshold = st.slider("相似度阈值", 0.80, 0.99, 0.90, 0.01)
    
    if st.button("🔄 执行去重", type="primary"):
        try:
            r = requests.post(f"{MEMOS_API_URL}/deduplicate", params={"threshold": threshold}, timeout=60)
            if r.status_code == 200:
                data = r.json()
                st.success(f"✅ 合并了 {data.get('merged_count', 0)} 条记忆")
            else:
                st.error(f"去重失败: {r.text}")
        except Exception as e:
            st.error(f"去重出错: {e}")


# 页脚
st.markdown("---")
st.markdown("""
<div style="text-align: center; padding: 15px; color: #64748b;">
    <span style="font-family: Orbitron, sans-serif;">MEMOS v2.0</span> | Memory + Knowledge Graph
</div>
""", unsafe_allow_html=True)
