"""OpenAI-compatible embedding adapter built on raw ``httpx``.

Serves SiliconFlow / 百炼 ``bge-m3`` (Phase A) and ModelArts MaaS ``bge-m3``
(Phase B) with the same ``POST /embeddings`` wire format. No vendor SDK is
imported: the isolation gate forbids ``openai`` outside ``app.adapters``.

Every batch is validated against the configured dimension (1024) so a swapped
endpoint can never silently poison the pgvector column with a different
embedding size.

Failure mapping mirrors the LLM adapter (never include the upstream body or the
api key):

* ``401`` / ``403`` -> :class:`ProviderAuthError`
* ``429`` -> retried with exponential backoff, then :class:`ProviderRateLimitError`
* ``5xx`` -> :class:`ProviderError`
* timeout / connect failure -> :class:`UpstreamTimeoutError`
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.ports import EmbeddingResult
from app.ports.errors import (
    DimensionMismatch,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    UpstreamTimeoutError,
)

logger = logging.getLogger(__name__)

MAX_CHARS = 8000

_AUTH_STATUSES = frozenset({401, 403})


class OpenAICompatibleEmbedding:
    """Batched embeddings over the OpenAI ``/embeddings`` wire format.

    Inputs are split into ``batch_size`` chunks (default 16), sent sequentially
    and concatenated in order. An empty input list short-circuits without any
    HTTP call.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        dim: int | None = None,
        batch_size: int | None = None,
        timeout: float = 60.0,
        backoff_base: float = 0.2,
        max_retries: int = 2,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        resolved = settings or get_settings()
        self._base_url = (base_url or resolved.embedding_base_url).rstrip("/")
        self._api_key = api_key if api_key is not None else resolved.embedding_api_key
        self._model = model or resolved.embedding_model
        self._dim = int(dim if dim is not None else resolved.embedding_dim)
        self._batch_size = max(
            1, int(batch_size if batch_size is not None else resolved.embedding_batch_size)
        )
        self._timeout = timeout
        self._backoff_base = backoff_base
        self._max_retries = max(0, max_retries)
        self._sleep = sleep or time.sleep

    @property
    def model(self) -> str:
        """Default embedding model id."""
        return self._model

    @property
    def dim(self) -> int:
        """Expected embedding dimension enforced on every vector."""
        return self._dim

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        """Embed ``texts`` in batches; one vector per input, in input order."""
        requested_model = model or self._model
        if not texts:
            return EmbeddingResult(vectors=[], model=requested_model, dim=self._dim)

        prepared = [self._truncate(text) for text in texts]
        vectors: list[list[float]] = []
        reported_model = requested_model
        for start in range(0, len(prepared), self._batch_size):
            batch = prepared[start : start + self._batch_size]
            batch_vectors, batch_model = self._embed_batch(batch, requested_model)
            vectors.extend(batch_vectors)
            if batch_model:
                reported_model = batch_model
        return EmbeddingResult(vectors=vectors, model=reported_model, dim=self._dim)

    def _truncate(self, text: str) -> str:
        if len(text) <= MAX_CHARS:
            return text
        # Never log payload content, only the size being cut down.
        logger.warning("embedding input truncated: %d chars -> %d chars", len(text), MAX_CHARS)
        return text[:MAX_CHARS]

    def _embed_batch(self, batch: list[str], model: str) -> tuple[list[list[float]], str]:
        payload: dict[str, Any] = {"model": model, "input": batch}
        response = self._post_with_retry(payload)
        return self._parse(response, expected_count=len(batch), requested_model=model)

    def _post_with_retry(self, payload: dict[str, Any]) -> httpx.Response:
        attempts = self._max_retries + 1
        last_rate_limited = False
        for attempt in range(attempts):
            response = self._post(payload)
            status = response.status_code
            if status in _AUTH_STATUSES:
                raise ProviderAuthError("模型鉴权失败")
            if status == 429:
                last_rate_limited = True
                if attempt < attempts - 1:
                    self._wait(attempt)
                    continue
                break
            if 500 <= status < 600:
                raise ProviderError("模型服务暂时不可用")
            if not 200 <= status < 300:
                raise ProviderError(f"模型服务返回异常状态 {status}")
            return response
        if last_rate_limited:
            raise ProviderRateLimitError("模型服务限流，请稍后重试")
        raise ProviderError("模型服务返回异常状态")

    def _post(self, payload: dict[str, Any]) -> httpx.Response:
        try:
            return httpx.post(
                f"{self._base_url}/embeddings",
                headers=self._headers(),
                json=payload,
                timeout=self._timeout,
            )
        except httpx.TimeoutException:
            raise UpstreamTimeoutError("模型服务响应超时") from None
        except httpx.HTTPError:
            raise ProviderError("模型服务连接失败") from None

    def _wait(self, attempt: int) -> None:
        delay = self._backoff_base * (2**attempt)
        if delay > 0:
            self._sleep(delay)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _parse(
        self,
        response: httpx.Response,
        *,
        expected_count: int,
        requested_model: str,
    ) -> tuple[list[list[float]], str]:
        try:
            data = response.json()
        except ValueError:
            raise ProviderError("模型服务返回了无法解析的响应") from None
        if not isinstance(data, dict):
            raise ProviderError("模型服务返回了无法解析的响应")

        raw_items = data.get("data")
        if not isinstance(raw_items, list) or len(raw_items) != expected_count:
            raise ProviderError("embedding 响应数量与请求不一致")

        ordered = sorted(
            (item for item in raw_items if isinstance(item, dict)),
            key=_index_of,
        )
        if len(ordered) != expected_count:
            raise ProviderError("embedding 响应数量与请求不一致")

        vectors: list[list[float]] = []
        first_len: int | None = None
        for item in ordered:
            embedding = item.get("embedding")
            if not isinstance(embedding, list):
                raise ProviderError("embedding 响应缺少向量")
            length = len(embedding)
            if length != self._dim:
                raise DimensionMismatch(f"expected dim {self._dim}, got {length}")
            if first_len is None:
                first_len = length
            elif length != first_len:
                raise DimensionMismatch(f"expected dim {first_len}, got {length}")
            vectors.append([float(value) for value in embedding])

        reported_model = data.get("model")
        model_name = (
            requested_model
            if not isinstance(reported_model, str) or not reported_model
            else reported_model
        )
        return vectors, model_name


def _index_of(item: dict[str, Any]) -> int:
    index = item.get("index")
    if isinstance(index, int) and not isinstance(index, bool):
        return index
    return 0
