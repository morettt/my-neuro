const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackendEmbeddingConfig } = require('../embedding-config.js');

test('没有 backend_embedding 时不改配置', () => {
    const backend = { embedding: { model_path: '../../../full-hub/rag-hub' } };
    const out = buildBackendEmbeddingConfig({}, backend);
    assert.equal(out.embedding.model_path, '../../../full-hub/rag-hub');
    assert.equal(out.embedding.provider, undefined);
});

test('默认 local 写出空 Key 和 bge-m3', () => {
    const backend = { embedding: {}, search: { enable_reranker: false } };
    const out = buildBackendEmbeddingConfig({
        backend_embedding: {
            provider: 'local',
            api_base_url: 'https://api.siliconflow.cn/v1',
            api_key: '',
            embedding_model: 'BAAI/bge-m3',
            rerank_model: 'BAAI/bge-reranker-v2-m3'
        }
    }, backend);
    assert.equal(out.embedding.provider, 'local');
    assert.equal(out.embedding.use_api, false);
    assert.equal(out.embedding.api.model, 'BAAI/bge-m3');
    assert.equal(out.embedding.api.api_key, '');
    assert.equal(out.search.reranker_provider, 'local');
    assert.equal(out.search.enable_reranker, false);
});

test('选 api 时同步 8 个键且保留其它 search 字段', () => {
    const backend = { search: { enable_reranker: false, bm25_weight: 0.3 } };
    const out = buildBackendEmbeddingConfig({
        backend_embedding: {
            provider: 'api',
            api_base_url: 'https://api.siliconflow.cn/v1',
            api_key: 'user-provided-key',
            embedding_model: 'BAAI/bge-m3',
            rerank_model: 'BAAI/bge-reranker-v2-m3'
        }
    }, backend);
    assert.equal(out.embedding.provider, 'api');
    assert.equal(out.embedding.use_api, true);
    assert.equal(out.embedding.api.base_url, 'https://api.siliconflow.cn/v1');
    assert.equal(out.embedding.api.model, 'BAAI/bge-m3');
    assert.equal(out.embedding.api.api_key, 'user-provided-key');
    assert.equal(out.search.reranker_provider, 'api');
    assert.equal(out.search.reranker_api.model, 'BAAI/bge-reranker-v2-m3');
    assert.equal(out.search.reranker_api.api_key, 'user-provided-key');
    assert.equal(out.search.bm25_weight, 0.3);
    assert.equal(out.search.enable_reranker, false);
});
