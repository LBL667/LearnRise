"""Cloud-agnostic provider ports.

Importing anything from this package must never pull in a vendor SDK. Concrete
adapters live under ``app.adapters`` and are the only place allowed to import
``openai``, ``huaweicloudsdk*``, ``obs``, ``minio`` or ``boto3``.
"""

from __future__ import annotations

from app.ports.agent import AgentResolver
from app.ports.email import EmailSender
from app.ports.embedding import EmbeddingProvider
from app.ports.errors import (
    DimensionMismatch,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    UpstreamTimeoutError,
)
from app.ports.llm import LLMProvider
from app.ports.ocr import OCRProvider
from app.ports.scheduler import Scheduler
from app.ports.storage import ObjectStorage
from app.ports.types import (
    CardSummary,
    ChatMessage,
    ChatResult,
    ChunkRecord,
    EmbeddingResult,
    MailMessage,
    OCRBlock,
    OCRResult,
    SearchHit,
    SendResult,
)
from app.ports.vector import VectorStore

__all__ = [
    "AgentResolver",
    "CardSummary",
    "ChatMessage",
    "ChatResult",
    "ChunkRecord",
    "DimensionMismatch",
    "EmailSender",
    "EmbeddingProvider",
    "EmbeddingResult",
    "LLMProvider",
    "MailMessage",
    "OCRBlock",
    "OCRProvider",
    "OCRResult",
    "ObjectStorage",
    "ProviderAuthError",
    "ProviderError",
    "ProviderRateLimitError",
    "Scheduler",
    "SearchHit",
    "SendResult",
    "UpstreamTimeoutError",
    "VectorStore",
]
