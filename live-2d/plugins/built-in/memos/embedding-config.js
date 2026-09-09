function buildBackendEmbeddingConfig(cfg, backendCfg) {
    const be = cfg && cfg.backend_embedding;
    if (!be) return backendCfg;
    const provider = be.provider === 'api' ? 'api' : 'local';
    const baseUrl = String(be.api_base_url || 'https://api.siliconflow.cn/v1').trim();
    const apiKey = String(be.api_key || '').trim();
    backendCfg.embedding = backendCfg.embedding || {};
    backendCfg.embedding.provider = provider;
    backendCfg.embedding.use_api = provider === 'api';
    backendCfg.embedding.api_model = String(be.embedding_model || 'BAAI/bge-m3').trim();
    backendCfg.embedding.api = {
        ...(backendCfg.embedding.api || {}),
        base_url: baseUrl,
        model: String(be.embedding_model || 'BAAI/bge-m3').trim(),
        api_key: apiKey
    };
    backendCfg.search = backendCfg.search || {};
    backendCfg.search.reranker_provider = provider;
    backendCfg.search.reranker_api = {
        ...(backendCfg.search.reranker_api || {}),
        base_url: baseUrl,
        model: String(be.rerank_model || 'BAAI/bge-reranker-v2-m3').trim(),
        api_key: apiKey
    };
    return backendCfg;
}

module.exports = { buildBackendEmbeddingConfig };
