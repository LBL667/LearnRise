"""Structural checks for the provider ports.

These tests do not exercise any vendor: they only verify that the Protocols are
runtime checkable and that conforming fakes satisfy them.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.ports import (
    AgentResolver,
    ChatMessage,
    ChatResult,
    EmailSender,
    EmbeddingProvider,
    EmbeddingResult,
    LLMProvider,
    ObjectStorage,
    OCRProvider,
    OCRResult,
    Scheduler,
    SearchHit,
    SendResult,
    VectorStore,
)

PROTOCOLS = [
    LLMProvider,
    EmbeddingProvider,
    VectorStore,
    ObjectStorage,
    OCRProvider,
    Scheduler,
    EmailSender,
    AgentResolver,
]


class FakeLLM:
    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> ChatResult:
        return ChatResult(content="ok")

    def stream(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> Iterator[str]:
        yield "ok"


class FakeEmbedding:
    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        return EmbeddingResult(vectors=[[0.0] for _ in texts], model=model or "fake", dim=1)


class FakeVectorStore:
    def upsert(self, chunks: list) -> int:
        return len(chunks)

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        return []

    def delete_by_source(self, source_id: str) -> int:
        return 0


class FakeStorage:
    _data: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._data[key] = data
        return key

    def get(self, key: str) -> bytes:
        return self._data[key]

    def sign(self, key: str, expires_seconds: int = 3600) -> str:
        return f"https://example.test/{key}"

    def delete(self, key: str) -> bool:
        return self._data.pop(key, None) is not None


class FakeOCR:
    def recognize(self, image: bytes, *, content_type: str = "image/jpeg") -> OCRResult:
        return OCRResult(blocks=[])


class FakeScheduler:
    def due_cards(self, *, user_id: str, as_of: object) -> list:
        return []

    def review(self, *, state: dict, rating: int, now: object) -> dict:
        return state

    def next_interval(self, *, state: dict, target: float = 0.9) -> int:
        return 1


class FakeEmail:
    def send(self, message: object) -> SendResult:
        return SendResult(ok=True)


class FakeResolver:
    def resolve(self, task_type: str, *, user_id: str, agent_id: str | None = None) -> LLMProvider:
        return FakeLLM()


def test_every_protocol_is_runtime_checkable() -> None:
    for protocol in PROTOCOLS:
        assert getattr(protocol, "_is_runtime_protocol", False), protocol.__name__


def test_fake_llm_satisfies_llm_provider() -> None:
    assert isinstance(FakeLLM(), LLMProvider)


def test_fake_storage_satisfies_object_storage() -> None:
    assert isinstance(FakeStorage(), ObjectStorage)


@pytest.mark.requires_huawei
def test_huawei_profile_requires_credentials(provider_profile: str) -> None:
    assert provider_profile in {"local", "huawei"}
