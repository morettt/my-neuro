import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_CONFIG_PATH = os.path.join(BASE, '..', '..', 'live-2d', 'plugins', 'built-in', 'memos', 'plugin_config.json')
BACKEND_CONFIG_PATH = os.path.join(BASE, 'memos_system', 'config', 'memos_config.json')

def get_val(obj, key):
    field = obj.get(key, {})
    if isinstance(field, dict) and 'value' in field:
        return field['value']
    return field

def get_fields(obj, key):
    field = obj.get(key, {})
    if isinstance(field, dict) and 'fields' in field:
        return {k: get_val(field['fields'], k) for k in field['fields']}
    return {}

if not os.path.exists(PLUGIN_CONFIG_PATH):
    print('未找到 plugin_config.json，跳过同步')
    exit(0)

with open(PLUGIN_CONFIG_PATH, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

backend = {}
if os.path.exists(BACKEND_CONFIG_PATH):
    with open(BACKEND_CONFIG_PATH, 'r', encoding='utf-8') as f:
        backend = json.load(f)

# 同步 LLM
llm = get_fields(cfg, 'backend_llm')
if llm:
    llm_config = backend.setdefault('llm', {}).setdefault('config', {})
    for key in ['model', 'api_key', 'base_url', 'max_tokens']:
        if llm.get(key):
            llm_config[key] = llm.get(key)

# 同步 Embedding / 重排序提供方（与插件 index.js 的 buildBackendEmbeddingConfig 对齐）
embedding_fields = get_fields(cfg, 'backend_embedding')
if embedding_fields:
    provider = 'api' if embedding_fields.get('provider') == 'api' else 'local'
    base_url = (embedding_fields.get('api_base_url') or 'https://api.siliconflow.cn/v1').strip()
    api_key = (embedding_fields.get('api_key') or '').strip()
    embed_model = (embedding_fields.get('embedding_model') or 'BAAI/bge-m3').strip()
    rerank_model = (embedding_fields.get('rerank_model') or 'BAAI/bge-reranker-v2-m3').strip()
    embedding = backend.setdefault('embedding', {})
    embedding['provider'] = provider
    embedding['use_api'] = provider == 'api'
    embedding['api_model'] = embed_model
    embedding['api_dimensions'] = embedding.get('api_dimensions') or 1024
    embedding_api = embedding.setdefault('api', {})
    embedding_api['base_url'] = base_url
    embedding_api['model'] = embed_model
    embedding_api['api_key'] = api_key
    search_cfg = backend.setdefault('search', {})
    search_cfg['reranker_provider'] = provider
    reranker_api = search_cfg.setdefault('reranker_api', {})
    reranker_api['base_url'] = base_url
    reranker_api['model'] = rerank_model
    reranker_api['api_key'] = api_key

# 同步检索配置
search = get_fields(cfg, 'backend_search')
if search:
    backend.setdefault('search', {}).update({
        'enable_bm25':         search.get('enable_bm25', True),
        'bm25_weight':         search.get('bm25_weight', 0.3),
        'enable_graph_query':  search.get('enable_graph_query', True),
        'enable_reranker':     search.get('enable_reranker', False),
        'reranker_auto_download': search.get('reranker_auto_download', True),
        'reranker_model_id':   search.get('reranker_model_id') or 'BAAI/bge-reranker-v2-m3',
        'reranker_model_path': search.get('reranker_model_path') or '../../../full-hub/reranker-hub',
        'rerank_top_n':        search.get('rerank_top_n', 20),
        'similarity_threshold': get_val(cfg, 'similarity_threshold') or 0.6
    })

# 同步功能开关
features = get_fields(cfg, 'backend_features')
if features:
    backend.setdefault('entity_extraction', {}).update({
        'enabled': features.get('entity_extraction', True),
        'auto_extract_on_add': features.get('entity_extraction', True)
    })
    backend.setdefault('image', {}).update({
        'enabled': features.get('image_memory', True),
        'auto_describe': features.get('image_auto_describe', True)
    })

os.makedirs(os.path.dirname(BACKEND_CONFIG_PATH), exist_ok=True)
with open(BACKEND_CONFIG_PATH, 'w', encoding='utf-8') as f:
    json.dump(backend, f, ensure_ascii=False, indent=2)

print('已同步插件配置到 memos_config.json')
