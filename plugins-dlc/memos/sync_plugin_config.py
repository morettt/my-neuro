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
    backend.setdefault('llm', {})['config'] = {
        'model':    llm.get('model', ''),
        'api_key':  llm.get('api_key', ''),
        'base_url': llm.get('base_url', '')
    }

# 同步 Embedding 配置
backend.setdefault('embedding', {}).update({
    'use_api':        get_val(cfg, 'use_api_embedding') is True,
    'api_model':      get_val(cfg, 'api_embedding_model') or 'text-embedding-3-large',
    'api_dimensions': get_val(cfg, 'api_embedding_dimensions') or 1024
})

# 同步检索配置
search = get_fields(cfg, 'backend_search')
if search:
    backend.setdefault('search', {}).update({
        'enable_bm25':         search.get('enable_bm25', True),
        'bm25_weight':         search.get('bm25_weight', 0.3),
        'enable_graph_query':  search.get('enable_graph_query', True),
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
