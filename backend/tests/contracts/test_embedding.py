"""Contract tests for the embedding adapters (no network, respx mocked)."""

from __future__ import annotations

import json
import sys
from typing import Any

import httpx
import pytest
import respx

from app.adapters.embedding import LocalFlagEmbedding, OpenAICompatibleEmbedding
from app.config import Settings
from app.ports import DimensionMismatch, ProviderError

EMBED_URL = "https://embed.test/v1/embeddings"
DIM = 1024


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "embedding_provider": "openai_compatible",
        "embedding_base_url": "https://embed.test/v1",
        "embedding_api_key": "test-key",
        "embedding_model": "bge-m3",
        "embedding_dim": DIM,
        "embedding_batch_size": 16,
    }
    values.update(overrides)
    return Settings(**values)


def make_adapter(**overrides: Any) -> OpenAICompatibleEmbedding:
    return OpenAICompatibleEmbedding(make_settings(**overrides), backoff_base=0.0)


def vectors(count: int, *, dim: int = DIM) -> list[dict[str, Any]]:
    return [{"index": index, "embedding": [0.0] * dim} for index in range(count)]


def body_of(request: httpx.Request) -> dict[str, Any]:
    return json.loads(request.content)


def test_batch_16() -> None:
    adapter = make_adapter()
    with respx.mock(base_url="https://embed.test") as router:
        route = router.post("/v1/embeddings").mock(
            return_value=httpx.Response(200, json={"model": "bge-m3", "data": vectors(16)})
        )
        result = adapter.embed([f"text-{index}" for index in range(16)])

    assert len(result.vectors) == 16
    assert result.dim == DIM
    assert result.model == "bge-m3"
    assert route.call_count == 1
    sent = body_of(route.calls[0].request)
    assert len(sent["input"]) == 16
    assert sent["model"] == "bge-m3"


def test_batch_split() -> None:
    adapter = make_adapter(embedding_batch_size=16)

    def _echo(request: httpx.Request) -> httpx.Response:
        inputs = body_of(request)["input"]
        data = [
            {"index": index, "embedding": [float(text.split("-")[1])] + [0.0] * (DIM - 1)}
            for index, text in enumerate(inputs)
        ]
        return httpx.Response(200, json={"model": "bge-m3", "data": data})

    with respx.mock(base_url="https://embed.test") as router:
        route = router.post("/v1/embeddings").mock(side_effect=_echo)
        result = adapter.embed([f"text-{index}" for index in range(20)])

    assert route.call_count == 2
    assert len(result.vectors) == 20
    assert [vector[0] for vector in result.vectors] == [float(index) for index in range(20)]


def test_dim_guard() -> None:
    adapter = make_adapter()
    with respx.mock(base_url="https://embed.test") as router:
        router.post("/v1/embeddings").mock(
            return_value=httpx.Response(200, json={"model": "bge-m3", "data": vectors(1, dim=768)})
        )
        with pytest.raises(DimensionMismatch, match="expected dim 1024, got 768"):
            adapter.embed(["short text"])


def test_empty_input() -> None:
    adapter = make_adapter()
    with respx.mock(base_url="https://embed.test", assert_all_called=False) as router:
        route = router.post("/v1/embeddings").mock(
            return_value=httpx.Response(200, json={"data": vectors(0)})
        )
        result = adapter.embed([])

    assert route.call_count == 0
    assert result.vectors == []
    assert result.model == "bge-m3"
    assert result.dim == DIM


def test_429_retry_then_success() -> None:
    adapter = make_adapter()
    with respx.mock(base_url="https://embed.test") as router:
        route = router.post("/v1/embeddings").mock(
            side_effect=[
                httpx.Response(429, json={"error": "rate limited"}),
                httpx.Response(200, json={"model": "bge-m3", "data": vectors(1)}),
            ]
        )
        result = adapter.embed(["retry me"])

    assert route.call_count == 2
    assert len(result.vectors) == 1


def test_long_text_truncated() -> None:
    adapter = make_adapter()
    with respx.mock(base_url="https://embed.test") as router:
        route = router.post("/v1/embeddings").mock(
            return_value=httpx.Response(200, json={"model": "bge-m3", "data": vectors(1)})
        )
        adapter.embed(["x" * 20000])

    sent = body_of(route.calls[0].request)
    assert len(sent["input"][0]) == 8000


def test_local_backend_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "FlagEmbedding", None)
    adapter = LocalFlagEmbedding(make_settings())
    with pytest.raises(ProviderError, match="local embedding backend not installed"):
        adapter.embed(["x"])
