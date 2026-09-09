# -*- coding: utf-8 -*-
"""远程向量 / 重排序提供方。对外接口模仿 SentenceTransformer.encode 与 CrossEncoder.predict。"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urljoin

import httpx
import numpy as np

logger = logging.getLogger(__name__)

SECRET_RE = re.compile(r"(sk-[A-Za-z0-9]{8,})|(Bearer\s+\S+)", re.IGNORECASE)
DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1"
DEFAULT_EMBED_MODEL = "BAAI/bge-m3"
DEFAULT_RERANK_MODEL = "BAAI/bge-reranker-v2-m3"
RETRY_BACKOFF_SEC = (0.5, 1.0)
RETRY_AFTER_CAP_SEC = 5.0

ENV_EMBEDDING_PROVIDER = "MEMOS_EMBEDDING_PROVIDER"
ENV_EMBEDDING_API_KEY = "MEMOS_EMBEDDING_API_KEY"
ENV_EMBEDDING_BASE_URL = "MEMOS_EMBEDDING_BASE_URL"
ENV_EMBEDDING_MODEL = "MEMOS_EMBEDDING_MODEL"
ENV_RERANK_PROVIDER = "MEMOS_RERANK_PROVIDER"
ENV_RERANK_API_KEY = "MEMOS_RERANK_API_KEY"
ENV_RERANK_BASE_URL = "MEMOS_RERANK_BASE_URL"
ENV_RERANK_MODEL = "MEMOS_RERANK_MODEL"


class EmbeddingProviderError(Exception):
    """远程向量 / 重排序调用失败。message 必须已经脱敏。"""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(redact_secret(message))
        self.status_code = status_code


def redact_secret(text: Any) -> str:
    return SECRET_RE.sub(lambda m: "sk-***" if (m.group(1) or "").startswith("sk-") else "Bearer sk-***", str(text))


def normalize_provider(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text == "api":
        return "api"
    if text and text != "local":
        logger.warning("未知 embedding/reranker provider=%r，按 local 处理", value)
    return "local"


def _join_url(base_url: str, path: str) -> str:
    base = base_url.rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def _as_text(value: Any, max_chars: int) -> str:
    if value is None:
        text = ""
    else:
        text = str(value)
    if max_chars > 0 and len(text) > max_chars:
        return text[:max_chars]
    return text


def _parse_retry_after(header: Optional[str]) -> Optional[float]:
    if not header:
        return None
    try:
        return min(float(header), RETRY_AFTER_CAP_SEC)
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class _CallStats:
    def __init__(self, window: int = 50):
        self.consecutive_failures = 0
        self.total_calls = 0
        self.total_failures = 0
        self.last_ok_at: Optional[str] = None
        self.last_error: Optional[str] = None
        self.last_latency_ms: Optional[float] = None
        self._latencies: deque = deque(maxlen=window)

    def record_ok(self, latency_ms: float) -> None:
        self.total_calls += 1
        self.consecutive_failures = 0
        self.last_ok_at = _now_iso()
        self.last_error = None
        self.last_latency_ms = round(latency_ms, 1)
        self._latencies.append(latency_ms)

    def record_error(self, latency_ms: float, error: str) -> None:
        self.total_calls += 1
        self.total_failures += 1
        self.consecutive_failures += 1
        self.last_latency_ms = round(latency_ms, 1)
        self.last_error = redact_secret(error)

    def avg_latency_ms(self) -> Optional[float]:
        if not self._latencies:
            return None
        return round(sum(self._latencies) / len(self._latencies), 1)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "consecutive_failures": self.consecutive_failures,
            "total_calls": self.total_calls,
            "total_failures": self.total_failures,
            "last_ok_at": self.last_ok_at,
            "last_error": self.last_error,
            "last_latency_ms": self.last_latency_ms,
            "avg_latency_ms": self.avg_latency_ms(),
        }


def _request_with_retry(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    json_body: Dict[str, Any],
    max_retries: int,
    retry_sleep=time.sleep,
) -> httpx.Response:
    last_error: Optional[Exception] = None
    attempts = max(0, int(max_retries)) + 1
    for attempt in range(attempts):
        try:
            resp = client.request(method, url, json=json_body)
        except (httpx.TimeoutException, httpx.NetworkError, httpx.TransportError) as exc:
            last_error = exc
            if attempt >= attempts - 1:
                raise EmbeddingProviderError(f"connection error: {redact_secret(exc)}") from exc
            retry_sleep(RETRY_BACKOFF_SEC[min(attempt, len(RETRY_BACKOFF_SEC) - 1)])
            continue

        if resp.status_code == 429:
            if attempt >= attempts - 1:
                raise EmbeddingProviderError(
                    f"HTTP 429: {redact_secret(resp.text[:200])}",
                    status_code=429,
                )
            wait = _parse_retry_after(resp.headers.get("Retry-After"))
            retry_sleep(wait if wait is not None else RETRY_BACKOFF_SEC[min(attempt, len(RETRY_BACKOFF_SEC) - 1)])
            continue

        if 500 <= resp.status_code <= 599:
            if attempt >= attempts - 1:
                raise EmbeddingProviderError(
                    f"HTTP {resp.status_code}: {redact_secret(resp.text[:200])}",
                    status_code=resp.status_code,
                )
            retry_sleep(RETRY_BACKOFF_SEC[min(attempt, len(RETRY_BACKOFF_SEC) - 1)])
            continue

        if resp.status_code == 401 or (400 <= resp.status_code <= 499):
            raise EmbeddingProviderError(
                f"HTTP {resp.status_code}: {redact_secret(resp.text[:200])}",
                status_code=resp.status_code,
            )

        if resp.status_code != 200:
            raise EmbeddingProviderError(
                f"HTTP {resp.status_code}: {redact_secret(resp.text[:200])}",
                status_code=resp.status_code,
            )
        return resp

    raise EmbeddingProviderError(f"retry exhausted: {redact_secret(last_error)}")


class RemoteEmbedder:
    provider = "api"

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        dimension: int = 1024,
        timeout_sec: float = 10.0,
        connect_timeout_sec: float = 5.0,
        max_retries: int = 2,
        batch_size: int = 32,
        max_chars_per_text: int = 6000,
        keepalive_interval_sec: float = 120,
        client: Optional[httpx.Client] = None,
        retry_sleep=time.sleep,
    ):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.model = model or DEFAULT_EMBED_MODEL
        self.api_key = api_key
        self.dimension = int(dimension)
        self.max_retries = int(max_retries)
        self.batch_size = max(1, int(batch_size))
        self.max_chars_per_text = int(max_chars_per_text)
        self.keepalive_interval_sec = float(keepalive_interval_sec)
        self._retry_sleep = retry_sleep
        self._stats = _CallStats()
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._closed = False
        self._owns_client = client is None
        if client is not None:
            self.client = client
        else:
            self.client = httpx.Client(
                timeout=httpx.Timeout(timeout_sec, connect=connect_timeout_sec),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
                http2=False,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
        self._stop_event = threading.Event()
        self._keepalive_thread: Optional[threading.Thread] = None
        if self.keepalive_interval_sec > 0:
            self._keepalive_thread = threading.Thread(
                target=self._keepalive_loop,
                name="memos-embed-keepalive",
                daemon=True,
            )
            self._keepalive_thread.start()

    def get_sentence_embedding_dimension(self) -> int:
        return self.dimension

    def encode(
        self,
        sentences,
        batch_size=None,
        show_progress_bar=False,
        convert_to_numpy=True,
        convert_to_tensor=False,
        normalize_embeddings=False,
        **kwargs,
    ):
        if convert_to_tensor:
            raise NotImplementedError("RemoteEmbedder 不支持 convert_to_tensor=True")
        single = isinstance(sentences, str)
        if single:
            items = [sentences]
        elif sentences is None:
            items = [""]
        else:
            items = list(sentences)
        if not items:
            empty = np.zeros((0, self.dimension), dtype=np.float32)
            return empty
        texts = [_as_text(item, self.max_chars_per_text) for item in items]
        vectors = self._embed_texts(texts, batch_size=batch_size or self.batch_size)
        arr = np.asarray(vectors, dtype=np.float32)
        if normalize_embeddings:
            norms = np.linalg.norm(arr, axis=1, keepdims=True)
            norms = np.clip(norms, 1e-12, None)
            arr = arr / norms
        if single:
            return arr[0]
        return arr

    def _embed_texts(self, texts: List[str], batch_size: int) -> List[List[float]]:
        out: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            out.extend(self._embed_batch(texts[i:i + batch_size]))
        return out

    def _embed_batch(self, texts: List[str]) -> List[List[float]]:
        url = _join_url(self.base_url, "/embeddings")
        started = time.perf_counter()
        try:
            resp = _request_with_retry(
                self.client,
                "POST",
                url,
                json_body={"model": self.model, "input": texts, "encoding_format": "float"},
                max_retries=self.max_retries,
                retry_sleep=self._retry_sleep,
            )
            payload = resp.json()
            rows = payload.get("data") or []
            ordered: List[Optional[List[float]]] = [None] * len(texts)
            for row in rows:
                idx = int(row.get("index", 0))
                vec = row.get("embedding") or []
                if len(vec) != self.dimension:
                    raise EmbeddingProviderError(
                        f"dimension mismatch: got {len(vec)}, expected {self.dimension}"
                    )
                if 0 <= idx < len(ordered):
                    ordered[idx] = list(vec)
            if any(item is None for item in ordered):
                raise EmbeddingProviderError("embeddings response missing index")
            latency_ms = (time.perf_counter() - started) * 1000.0
            with self._lock:
                self._stats.record_ok(latency_ms)
                self._last_request_at = time.time()
            return ordered  # type: ignore[return-value]
        except EmbeddingProviderError as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            with self._lock:
                self._stats.record_error(latency_ms, str(exc))
            raise
        except Exception as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            err = EmbeddingProviderError(redact_secret(exc))
            with self._lock:
                self._stats.record_error(latency_ms, str(err))
            raise err from exc

    def _keepalive_loop(self) -> None:
        while not self._stop_event.wait(self.keepalive_interval_sec):
            if self._closed:
                return
            with self._lock:
                idle = time.time() - self._last_request_at
            if idle < self.keepalive_interval_sec:
                continue
            try:
                self._embed_batch(["。"])
            except Exception as exc:
                logger.warning("Embedding 保温请求失败: %s", redact_secret(exc))

    def health_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            snap = self._stats.snapshot()
        snap.update({
            "provider": "api",
            "model": self.model,
            "base_url": self.base_url,
            "dimension": self.dimension,
            "ready": self._stats.total_failures == 0 or self._stats.consecutive_failures == 0,
        })
        return snap

    def close(self) -> None:
        self._closed = True
        self._stop_event.set()
        if self._keepalive_thread and self._keepalive_thread.is_alive():
            self._keepalive_thread.join(timeout=1.0)
        if self._owns_client:
            self.client.close()


class RemoteCrossEncoder:
    provider = "api"

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        timeout_sec: float = 10.0,
        connect_timeout_sec: float = 5.0,
        max_retries: int = 1,
        circuit_break_failures: int = 3,
        circuit_break_cooldown_sec: float = 60,
        max_chars_per_text: int = 6000,
        client: Optional[httpx.Client] = None,
        retry_sleep=time.sleep,
        clock=time.time,
    ):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.model = model or DEFAULT_RERANK_MODEL
        self.api_key = api_key
        self.max_retries = int(max_retries)
        self.circuit_break_failures = int(circuit_break_failures)
        self.circuit_break_cooldown_sec = float(circuit_break_cooldown_sec)
        self.max_chars_per_text = int(max_chars_per_text)
        self._retry_sleep = retry_sleep
        self._clock = clock
        self._stats = _CallStats()
        self._opened_at: Optional[float] = None
        self._owns_client = client is None
        if client is not None:
            self.client = client
        else:
            self.client = httpx.Client(
                timeout=httpx.Timeout(timeout_sec, connect=connect_timeout_sec),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
                http2=False,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )

    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        if self._clock() - self._opened_at >= self.circuit_break_cooldown_sec:
            return False
        return True

    def predict(self, sentences, batch_size=None, show_progress_bar=False, **kwargs):
        pairs = list(sentences or [])
        if not pairs:
            return np.zeros((0,), dtype=np.float32)
        if self.is_open():
            raise EmbeddingProviderError("rerank circuit open")
        scores = np.zeros((len(pairs),), dtype=np.float32)
        groups: Dict[str, List[Tuple[int, str]]] = {}
        for idx, pair in enumerate(pairs):
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                query, doc = "", ""
            else:
                query, doc = pair[0], pair[1]
            groups.setdefault(str(query), []).append((idx, _as_text(doc, self.max_chars_per_text)))
        for query, items in groups.items():
            docs = [doc for _, doc in items]
            batch_scores = self._rerank_batch(query, docs)
            for (idx, _), score in zip(items, batch_scores):
                scores[idx] = score
        return scores

    def _rerank_batch(self, query: str, documents: List[str]) -> List[float]:
        url = _join_url(self.base_url, "/rerank")
        started = time.perf_counter()
        try:
            resp = _request_with_retry(
                self.client,
                "POST",
                url,
                json_body={
                    "model": self.model,
                    "query": query,
                    "documents": documents,
                    "top_n": len(documents),
                    "return_documents": False,
                },
                max_retries=self.max_retries,
                retry_sleep=self._retry_sleep,
            )
            payload = resp.json()
            scores = [0.0] * len(documents)
            seen = set()
            for row in payload.get("results") or []:
                idx = int(row.get("index", -1))
                if 0 <= idx < len(scores):
                    scores[idx] = float(row.get("relevance_score", 0.0))
                    seen.add(idx)
            missing = [i for i in range(len(documents)) if i not in seen]
            if missing:
                logger.warning("重排序响应缺少 index: %s，已补 0.0", missing)
            latency_ms = (time.perf_counter() - started) * 1000.0
            self._stats.record_ok(latency_ms)
            self._opened_at = None
            return scores
        except EmbeddingProviderError as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            self._stats.record_error(latency_ms, str(exc))
            if self._stats.consecutive_failures >= self.circuit_break_failures:
                self._opened_at = self._clock()
            raise
        except Exception as exc:
            latency_ms = (time.perf_counter() - started) * 1000.0
            err = EmbeddingProviderError(redact_secret(exc))
            self._stats.record_error(latency_ms, str(err))
            if self._stats.consecutive_failures >= self.circuit_break_failures:
                self._opened_at = self._clock()
            raise err from exc

    def health_snapshot(self) -> Dict[str, Any]:
        snap = self._stats.snapshot()
        snap.update({
            "provider": "api",
            "model": self.model,
            "available": not self.is_open(),
            "circuit_open": self.is_open(),
        })
        return snap

    def close(self) -> None:
        if self._owns_client:
            self.client.close()


def _resolve_model_path(model_path: str, base_dir: str) -> str:
    if not model_path:
        return model_path
    if os.path.isabs(model_path):
        return os.path.normpath(model_path)
    return os.path.normpath(os.path.join(base_dir, model_path))


def apply_legacy_embedding_aliases(config: Dict[str, Any]) -> None:
    """兼容线上旧键 use_api / api_model / api_dimensions，以及复用 LLM 的地址和密钥。"""
    embedding = _ensure_nested(config, "embedding")
    api_cfg = _ensure_nested(config, "embedding", "api")
    llm_cfg = ((config.get("llm") or {}).get("config") or {})

    if not str(embedding.get("provider") or "").strip() and embedding.get("use_api") is True:
        embedding["provider"] = "api"

    if not str(api_cfg.get("model") or "").strip():
        legacy_model = str(embedding.get("api_model") or "").strip()
        if legacy_model:
            api_cfg["model"] = legacy_model

    if not embedding.get("vector_size") and embedding.get("api_dimensions"):
        try:
            embedding["vector_size"] = int(embedding.get("api_dimensions"))
        except (TypeError, ValueError):
            pass

    if not str(api_cfg.get("api_key") or "").strip():
        llm_key = str(llm_cfg.get("api_key") or "").strip()
        if llm_key:
            api_cfg["api_key"] = llm_key

    if not str(api_cfg.get("base_url") or "").strip():
        llm_url = str(llm_cfg.get("base_url") or "").strip()
        if llm_url:
            api_cfg["base_url"] = llm_url


def build_embedder(config: dict, base_dir: str):
    """返回 (embedder, info)。api 无密钥时按本地加载，并在 info 里留下 warning。"""
    apply_legacy_embedding_aliases(config)
    embedding = config.get("embedding") or {}
    configured = normalize_provider(embedding.get("provider"))
    api_cfg = embedding.get("api") or {}
    api_key = str(api_cfg.get("api_key") or "").strip()
    warning = None
    provider = configured
    if provider == "api" and not api_key:
        provider = "local"
        warning = "API 密钥未配置，已按本地模型运行"

    if provider == "api":
        embedder = RemoteEmbedder(
            base_url=str(api_cfg.get("base_url") or DEFAULT_BASE_URL),
            model=str(api_cfg.get("model") or DEFAULT_EMBED_MODEL),
            api_key=api_key,
            dimension=int(embedding.get("vector_size") or api_cfg.get("dimension") or 1024),
            timeout_sec=float(api_cfg.get("timeout_sec") or 10),
            connect_timeout_sec=float(api_cfg.get("connect_timeout_sec") or 5),
            max_retries=int(api_cfg.get("max_retries") or 2),
            batch_size=int(api_cfg.get("batch_size") or 32),
            max_chars_per_text=int(api_cfg.get("max_chars_per_text") or 6000),
            keepalive_interval_sec=float(api_cfg.get("keepalive_interval_sec") or 120),
        )
        info = {
            "provider": "api",
            "configured_provider": configured,
            "model": embedder.model,
            "base_url": embedder.base_url,
            "warning": warning,
            "device": None,
        }
        return embedder, info

    from sentence_transformers import SentenceTransformer
    import torch

    model_path = embedding.get("model_path", "../full-hub/rag-hub")
    model_path = _resolve_model_path(model_path, base_dir)
    embedding_model = SentenceTransformer(model_path)
    device = "cpu"
    if torch.cuda.is_available():
        embedding_model = embedding_model.to("cuda")
        device = "cuda"
    setattr(embedding_model, "provider", "local")
    info = {
        "provider": "local",
        "configured_provider": configured,
        "model_path": model_path,
        "device": device,
        "warning": warning,
    }
    return embedding_model, info


def _ensure_nested(root: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    cur = root
    for key in keys:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt
    return cur


def apply_embedding_env_overrides(loaded_config: Dict[str, Any]) -> List[str]:
    """环境变量覆盖向量 / 重排序配置。空值不覆盖。返回生效的变量名。"""
    applied: List[str] = []
    embedding = _ensure_nested(loaded_config, "embedding")
    embedding_api = _ensure_nested(loaded_config, "embedding", "api")
    search = _ensure_nested(loaded_config, "search")
    reranker_api = _ensure_nested(loaded_config, "search", "reranker_api")

    mapping = (
        (ENV_EMBEDDING_PROVIDER, embedding, "provider"),
        (ENV_EMBEDDING_API_KEY, embedding_api, "api_key"),
        (ENV_EMBEDDING_BASE_URL, embedding_api, "base_url"),
        (ENV_EMBEDDING_MODEL, embedding_api, "model"),
        (ENV_RERANK_PROVIDER, search, "reranker_provider"),
        (ENV_RERANK_API_KEY, reranker_api, "api_key"),
        (ENV_RERANK_BASE_URL, reranker_api, "base_url"),
        (ENV_RERANK_MODEL, reranker_api, "model"),
    )
    for env_name, target, key in mapping:
        value = os.getenv(env_name)
        if value:
            target[key] = value
            applied.append(env_name)
    return applied


_apply_embedding_env_overrides = apply_embedding_env_overrides
