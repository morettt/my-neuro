# -*- coding: utf-8 -*-
"""远程向量 / 重排序提供方离线单元测试。不联网，不依赖 pytest。"""
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from utils.embedding_provider import (  # noqa: E402
    EmbeddingProviderError,
    RemoteCrossEncoder,
    RemoteEmbedder,
    apply_embedding_env_overrides,
    build_embedder,
    redact_secret,
)
from utils.search_utils import Reranker  # noqa: E402


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(cond, label):
    if not cond:
        raise AssertionError(label)


def make_vector(dim=1024, seed=1):
    rng = np.random.default_rng(seed)
    vec = rng.standard_normal(dim).astype(np.float32)
    vec = vec / np.linalg.norm(vec)
    return vec.tolist()


def make_embed_client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        transport=transport,
        headers={"Authorization": "Bearer sk-testkeyvalue12345678", "Content-Type": "application/json"},
    )


def test_encode_shapes_and_empty_list():
    vec = make_vector()

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        data = [{"object": "embedding", "index": i, "embedding": vec} for i, _ in enumerate(body["input"])]
        return httpx.Response(200, json={"object": "list", "data": data})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(handler), keepalive_interval_sec=0,
    )
    one = embedder.encode("肥牛")
    assert_equal(one.ndim, 1, "encode(str) ndim")
    assert_equal(one.shape, (1024,), "encode(str) shape")
    assert_equal(str(one.dtype), "float32", "encode(str) dtype")
    many = embedder.encode(["肥牛", "主人"])
    assert_equal(many.ndim, 2, "encode(list) ndim")
    assert_equal(many.shape, (2, 1024), "encode(list) shape")
    empty = embedder.encode([])
    assert_equal(empty.shape, (0, 1024), "encode([]) shape")
    embedder.close()


def test_batch_split_and_shuffled_index():
    seen_batches = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        texts = body["input"]
        seen_batches.append(len(texts))
        data = []
        for i, text in enumerate(texts):
            seed = int(text.split("-")[-1])
            data.append({"object": "embedding", "index": i, "embedding": make_vector(seed=seed + 10)})
        data.reverse()
        return httpx.Response(200, json={"data": data})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1/", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(handler), keepalive_interval_sec=0, batch_size=32,
    )
    texts = [f"item-{i}" for i in range(33)]
    arr = embedder.encode(texts)
    assert_equal(seen_batches, [32, 1], "33 inputs split into 2 batches")
    assert_equal(arr.shape, (33, 1024), "33 output rows")
    first = np.asarray(make_vector(seed=10), dtype=np.float32)
    last = np.asarray(make_vector(seed=42), dtype=np.float32)
    assert_true(np.allclose(arr[0], first, atol=1e-5), "index 0 restored after shuffle")
    assert_true(np.allclose(arr[32], last, atol=1e-5), "index 32 restored after shuffle")
    embedder.close()


def test_empty_kept_and_long_truncated():
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        captured.extend(body["input"])
        vec = make_vector()
        data = [{"index": i, "embedding": vec} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": data})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(handler), keepalive_interval_sec=0, max_chars_per_text=6000,
    )
    embedder.encode(["", "   ", None, "测" * 12000])
    assert_equal(captured[0], "", "empty string kept")
    assert_equal(captured[1], "   ", "spaces kept")
    assert_equal(captured[2], "", "None becomes empty")
    assert_equal(len(captured[3]), 6000, "long text truncated to 6000")
    embedder.close()


def test_dimension_mismatch():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(handler), keepalive_interval_sec=0,
    )
    try:
        embedder.encode("肥牛")
        raise AssertionError("dimension mismatch should raise")
    except EmbeddingProviderError as exc:
        assert_true("dimension mismatch" in str(exc), "dimension error message")
    embedder.close()


def test_retries_and_401():
    hits = {"n": 0}

    def flaky(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        if hits["n"] < 3:
            return httpx.Response(500, text="server boom")
        vec = make_vector()
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": vec}]})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(flaky), keepalive_interval_sec=0, max_retries=2,
        retry_sleep=lambda _s: None,
    )
    arr = embedder.encode("肥牛")
    assert_equal(hits["n"], 3, "500 retried then succeeded")
    assert_equal(arr.shape, (1024,), "success after retry")
    embedder.close()

    sleeps = []
    hits429 = {"n": 0}

    def limited(request: httpx.Request) -> httpx.Response:
        hits429["n"] += 1
        if hits429["n"] == 1:
            return httpx.Response(429, text="slow down", headers={"Retry-After": "2"})
        vec = make_vector()
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": vec}]})

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(limited), keepalive_interval_sec=0, max_retries=2,
        retry_sleep=lambda s: sleeps.append(s),
    )
    embedder.encode("肥牛")
    assert_equal(sleeps, [2.0], "429 uses Retry-After")
    embedder.close()

    conn_hits = {"n": 0}

    def boom(request: httpx.Request) -> httpx.Response:
        conn_hits["n"] += 1
        raise httpx.ConnectError("connection down")

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(boom), keepalive_interval_sec=0, max_retries=2,
        retry_sleep=lambda _s: None,
    )
    try:
        embedder.encode("肥牛")
        raise AssertionError("connect error should raise")
    except EmbeddingProviderError:
        pass
    assert_equal(conn_hits["n"], 3, "connect error retried 2 times")
    embedder.close()

    auth_hits = {"n": 0}

    def unauthorized(request: httpx.Request) -> httpx.Response:
        auth_hits["n"] += 1
        return httpx.Response(401, text='{"message":"Api key is invalid"}')

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-test",
        client=make_embed_client(unauthorized), keepalive_interval_sec=0, max_retries=2,
        retry_sleep=lambda _s: None,
    )
    try:
        embedder.encode("肥牛")
        raise AssertionError("401 should raise")
    except EmbeddingProviderError as exc:
        assert_equal(exc.status_code, 401, "401 status")
    assert_equal(auth_hits["n"], 1, "401 is not retried")
    embedder.close()


def test_health_snapshot_redacts_secret():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="fail Bearer sk-supersecretvalue12345678")

    embedder = RemoteEmbedder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-m3", "sk-supersecretvalue12345678",
        client=make_embed_client(handler), keepalive_interval_sec=0, max_retries=0,
        retry_sleep=lambda _s: None,
    )
    try:
        embedder.encode("肥牛")
    except EmbeddingProviderError:
        pass
    snap = embedder.health_snapshot()
    assert_equal(snap["total_calls"], 1, "total_calls")
    assert_equal(snap["total_failures"], 1, "total_failures")
    assert_equal(snap["consecutive_failures"], 1, "consecutive_failures")
    assert_true(snap["last_error"], "last_error present")
    assert_true("sk-supersecretvalue12345678" not in str(snap["last_error"]), "secret not in snapshot")
    assert_true("sk-***" in redact_secret("Bearer sk-supersecretvalue12345678"), "redact helper")
    embedder.close()


def test_cross_encoder_order_missing_index_and_circuit():
    clock = {"now": 1000.0}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["query"] == "fail":
            return httpx.Response(500, text="rerank down")
        data = [
            {"index": 1, "relevance_score": 0.2},
            {"index": 0, "relevance_score": 0.9},
        ]
        return httpx.Response(200, json={"results": data})

    model = RemoteCrossEncoder(
        "https://api.siliconflow.cn/v1", "BAAI/bge-reranker-v2-m3", "sk-test",
        client=make_embed_client(handler), max_retries=0, circuit_break_failures=3,
        circuit_break_cooldown_sec=10, retry_sleep=lambda _s: None, clock=lambda: clock["now"],
    )
    scores = model.predict([["q", "a"], ["q", "b"], ["q", "c"]])
    assert_equal(list(np.round(scores, 4)), [0.9, 0.2, 0.0], "order aligned and missing index=0")

    for _ in range(3):
        try:
            model.predict([["fail", "x"]])
        except EmbeddingProviderError:
            pass
    assert_true(model.is_open(), "circuit opened after 3 failures")
    reranker = Reranker.__new__(Reranker)
    reranker.model = model
    reranker.provider = "api"
    reranker.api_config = {}
    reranker.model_path = None
    assert_true(not reranker.is_available(), "is_available false when circuit open")
    clock["now"] = 1011.0
    assert_true(not model.is_open(), "circuit half-open after cooldown")
    scores = model.predict([["q", "a"], ["q", "b"]])
    assert_equal(list(np.round(scores, 4)), [0.9, 0.2], "recovered after cooldown")
    assert_true(not model.is_open(), "circuit closed after success")
    model.close()


def test_reranker_from_config_and_rerank_shape():
    with tempfile.TemporaryDirectory() as tmp:
        missing = os.path.join(tmp, "no-such-reranker")
        local_dir = os.path.join(tmp, "reranker-hub")
        os.makedirs(local_dir)

        none_local = Reranker.from_config(
            {"reranker_provider": "local", "reranker_model_path": missing},
            base_dir=tmp,
        )
        assert_equal(none_local, None, "local missing dir -> None")

        fake_local = []

        class FakeLocal:
            def __init__(self, path):
                fake_local.append(path)

            def predict(self, pairs):
                return [0.3, 0.8, 0.1]

        import sentence_transformers
        original = getattr(sentence_transformers, "CrossEncoder", None)
        sentence_transformers.CrossEncoder = FakeLocal
        try:
            fallback = Reranker.from_config(
                {"reranker_provider": "api", "reranker_model_path": local_dir, "reranker_api": {}},
                base_dir=tmp,
                shared_api_key="",
            )
            assert_true(fallback is not None, "api missing key falls back to local")
            assert_equal(fallback.provider, "local", "fallback provider local")

            both_missing = Reranker.from_config(
                {"reranker_provider": "api", "reranker_model_path": missing, "reranker_api": {}},
                base_dir=tmp,
            )
            assert_equal(both_missing, None, "api missing key and local dir -> None")
        finally:
            if original is not None:
                sentence_transformers.CrossEncoder = original

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"results": [
                {"index": 0, "relevance_score": 0.2},
                {"index": 1, "relevance_score": 0.9},
                {"index": 2, "relevance_score": 0.4},
            ]})

        api_reranker = Reranker(
            provider="api",
            api_config={
                "base_url": "https://api.siliconflow.cn/v1",
                "model": "BAAI/bge-reranker-v2-m3",
                "api_key": "sk-test",
            },
        )
        api_reranker.model = RemoteCrossEncoder(
            "https://api.siliconflow.cn/v1", "BAAI/bge-reranker-v2-m3", "sk-test",
            client=make_embed_client(handler), max_retries=0, retry_sleep=lambda _s: None,
        )
        assert_true(api_reranker.is_available(), "api reranker available")
        docs = [{"content": "a"}, {"content": "b"}, {"content": "c"}]
        ranked = api_reranker.rerank("q", docs, top_k=2)
        assert_equal([d["content"] for d in ranked], ["b", "c"], "rerank desc + top_k")
        assert_true("rerank_score" in ranked[0], "rerank_score field")
        assert_equal(round(ranked[0]["rerank_score"], 4), 0.9, "top score")


def test_build_embedder_branches(monkey_modules=None):
    class FakeST:
        def __init__(self, path):
            self.path = path
            self.device = "cpu"

        def to(self, device):
            self.device = device
            return self

    import utils.embedding_provider as ep
    original_st = ep.SentenceTransformer if hasattr(ep, "SentenceTransformer") else None

    import sentence_transformers
    old_st = sentence_transformers.SentenceTransformer
    import torch
    old_cuda = torch.cuda.is_available
    sentence_transformers.SentenceTransformer = FakeST
    torch.cuda.is_available = lambda: False
    try:
        local, info = build_embedder({"embedding": {}}, base_dir=ROOT)
        assert_equal(info["provider"], "local", "missing provider -> local")
        assert_equal(info["configured_provider"], "local", "configured local")

        bad, bad_info = build_embedder({"embedding": {"provider": "weird"}}, base_dir=ROOT)
        assert_equal(bad_info["provider"], "local", "illegal provider -> local")

        api_fallback, api_info = build_embedder(
            {"embedding": {"provider": "api", "api": {"base_url": "https://api.siliconflow.cn/v1"}}},
            base_dir=ROOT,
        )
        assert_equal(api_info["provider"], "local", "api without key -> local")
        assert_equal(api_info["configured_provider"], "api", "configured_provider stays api")
        assert_true(api_info["warning"], "warning present")

        legacy, legacy_info = build_embedder(
            {
                "embedding": {
                    "use_api": True,
                    "api_model": "BAAI/bge-m3",
                    "api": {"api_key": "sk-test", "base_url": "https://api.siliconflow.cn/v1"},
                }
            },
            base_dir=ROOT,
        )
        assert_equal(legacy_info["provider"], "api", "use_api true without provider -> api")
        assert_equal(legacy_info["model"], "BAAI/bge-m3", "legacy api_model mapped")
        if hasattr(legacy, "close"):
            legacy.close()
    finally:
        sentence_transformers.SentenceTransformer = old_st
        torch.cuda.is_available = old_cuda
        if original_st is not None:
            ep.SentenceTransformer = original_st


def test_env_overrides(monkeypatch_env=None):
    keys = [
        "MEMOS_EMBEDDING_PROVIDER",
        "MEMOS_EMBEDDING_API_KEY",
        "MEMOS_EMBEDDING_BASE_URL",
        "MEMOS_EMBEDDING_MODEL",
        "MEMOS_RERANK_PROVIDER",
        "MEMOS_RERANK_API_KEY",
        "MEMOS_RERANK_BASE_URL",
        "MEMOS_RERANK_MODEL",
    ]
    old = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        cfg = {"embedding": {"provider": "local"}, "search": {}}
        applied = apply_embedding_env_overrides(cfg)
        assert_equal(applied, [], "no env -> no apply")

        os.environ["MEMOS_EMBEDDING_PROVIDER"] = ""
        applied = apply_embedding_env_overrides(cfg)
        assert_equal(applied, [], "empty env does not override")

        os.environ["MEMOS_EMBEDDING_PROVIDER"] = "api"
        os.environ["MEMOS_EMBEDDING_API_KEY"] = "sk-from-env-not-for-log"
        os.environ["MEMOS_EMBEDDING_BASE_URL"] = "https://api.siliconflow.cn/v1"
        os.environ["MEMOS_EMBEDDING_MODEL"] = "BAAI/bge-m3"
        os.environ["MEMOS_RERANK_PROVIDER"] = "api"
        os.environ["MEMOS_RERANK_API_KEY"] = "sk-rerank-from-env"
        os.environ["MEMOS_RERANK_BASE_URL"] = "https://api.siliconflow.cn/v1"
        os.environ["MEMOS_RERANK_MODEL"] = "BAAI/bge-reranker-v2-m3"
        cfg = {"embedding": {"provider": "local"}, "search": {}}
        applied = apply_embedding_env_overrides(cfg)
        assert_equal(sorted(applied), sorted(keys), "all 8 env vars applied")
        assert_equal(cfg["embedding"]["provider"], "api", "provider overwritten")
        assert_equal(cfg["embedding"]["api"]["model"], "BAAI/bge-m3", "embed model")
        assert_equal(cfg["search"]["reranker_provider"], "api", "rerank provider")
        assert_equal(cfg["search"]["reranker_api"]["model"], "BAAI/bge-reranker-v2-m3", "rerank model")
        assert_true("sk-from-env-not-for-log" in cfg["embedding"]["api"]["api_key"], "key written to config object only")
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    test_encode_shapes_and_empty_list()
    test_batch_split_and_shuffled_index()
    test_empty_kept_and_long_truncated()
    test_dimension_mismatch()
    test_retries_and_401()
    test_health_snapshot_redacts_secret()
    test_cross_encoder_order_missing_index_and_circuit()
    test_reranker_from_config_and_rerank_shape()
    test_build_embedder_branches()
    test_env_overrides()
    print("embedding provider ok")
