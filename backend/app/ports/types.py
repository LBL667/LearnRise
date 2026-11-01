"""Data types shared by the provider ports.

These are deliberately provider-agnostic: no SDK types, no HTTP clients, no
storage-specific objects. Adapters translate between their native payloads and
these records so the application core never depends on a concrete vendor.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

ChatRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class ChatMessage:
    """A single chat turn handed to an ``LLMProvider``."""

    role: ChatRole
    content: str


@dataclass(frozen=True, slots=True)
class ChatResult:
    """Normalised completion returned by an ``LLMProvider``."""

    content: str
    reasoning: str = ""
    model: str = ""
    usage: dict[str, int] | None = None


@dataclass(frozen=True, slots=True)
class EmbeddingResult:
    """Batch embedding output, one vector per input text."""

    vectors: list[list[float]]
    model: str
    dim: int


@dataclass(frozen=True, slots=True)
class ChunkRecord:
    """A retrievable document chunk together with its embedding metadata."""

    chunk_id: str
    source_id: str
    content: str
    page: int | None
    heading: str | None
    embedding: list[float] | None = None
    embedding_model: str = ""
    embedding_dim: int = 1024
    embedding_version: str = "1"
    competition_id: str | None = None


@dataclass(frozen=True, slots=True)
class SearchHit:
    """A single vector search result."""

    chunk_id: str
    source_id: str
    content: str
    score: float
    page: int | None
    heading: str | None


@dataclass(frozen=True, slots=True)
class OCRBlock:
    """One recognised text block, optionally with a bounding box."""

    text: str
    confidence: float
    box: list[list[float]] | None = None
    needs_review: bool = False


@dataclass(frozen=True, slots=True)
class OCRResult:
    """Aggregate OCR output for one image."""

    blocks: list[OCRBlock]
    raw: dict | None = None


@dataclass(frozen=True, slots=True)
class CardSummary:
    """A due review card shaped for the scheduler port.

    Intentionally a plain record (not the ORM model) so the port stays free of
    database imports.
    """

    card_id: str
    user_id: str
    due_date: date
    knowledge_point_id: str | None


@dataclass(frozen=True, slots=True)
class MailMessage:
    """An outbound email message."""

    to: list[str]
    subject: str
    html: str
    text: str | None = None


@dataclass(frozen=True, slots=True)
class SendResult:
    """Outcome of an email send attempt."""

    ok: bool
    provider_id: str | None = None
    error: str | None = None
