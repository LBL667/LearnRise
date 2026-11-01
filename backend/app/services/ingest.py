"""Ingestion pipeline: store upload → parse → chunk → embed → vector upsert.

The request handler only validates/stores the blob and enqueues a job; all CPU
and network heavy work happens in :func:`run_ingest`, which opens its *own*
database session (never the request session) so it can run as a background task.

Design notes
------------
* Uploads are validated by extension first (the extension wins) and fall back
  to the declared MIME type only when the filename carries no known suffix.
  The content type persisted on ``knowledge_sources`` is always canonical.
* Storage keys are ``<user_id>/<source_id>/<slug>`` and always pass
  :func:`app.adapters.storage.base.sanitize_key`.
* Embeddings are requested in batches of ``settings.embedding_batch_size``.
  A rate-limited batch is retried twice with exponential backoff (0.2s / 0.4s);
  a batch that still fails only tallies ``failed_chunks`` while the remaining
  batches continue. The job is ``failed`` only when *every* batch failed.
* Vector rows are accumulated and upserted once per job: ``ChunkRecord`` has no
  ``chunk_index`` field, so the pgvector adapter derives indices from position
  within the batch. A whole-source batch therefore keeps the order stable.
* Logs carry counts and job ids only - never file contents or storage keys.
"""

from __future__ import annotations

import importlib
import logging
import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.adapters.embedding import build_embedding
from app.adapters.storage import build_storage
from app.adapters.vector import build_vector_store
from app.config import settings
from app.db import SessionLocal
from app.models import IngestionJob, KnowledgeSource
from app.ports import (
    ChunkRecord,
    EmbeddingProvider,
    EmbeddingResult,
    OCRProvider,
    ProviderError,
    ProviderRateLimitError,
)
from app.services.chunking import TextChunk, chunk_document
from app.services.parsing import ParsedDocument, parse_document

__all__ = [
    "ALLOWED_EXTENSIONS",
    "UNSUPPORTED_TYPE_MESSAGE",
    "UnsupportedFileType",
    "make_storage_key",
    "resolve_content_type",
    "run_ingest",
    "save_upload",
    "slug_filename",
    "title_from_filename",
]

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = "pdf, docx, txt, md, png, jpg, jpeg"
UNSUPPORTED_TYPE_MESSAGE = f"不支持的文件类型，允许的格式：{ALLOWED_EXTENSIONS}"

_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_EXTENSION_CONTENT_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": _DOCX,
    ".txt": "text/plain",
    ".md": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

_DECLARED_CONTENT_TYPES: dict[str, str] = {
    "application/pdf": "application/pdf",
    _DOCX: _DOCX,
    "text/plain": "text/plain",
    "text/markdown": "text/plain",
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
}

_IMAGE_CONTENT_TYPES = frozenset({"image/png", "image/jpeg"})

_RETRY_DELAYS = (0.2, 0.4)

_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]")
_DOTS_RE = re.compile(r"\.{2,}")

#: Indirection so tests can neutralise retry sleeps without patching ``time``.
_sleep = time.sleep


class UnsupportedFileType(ValueError):
    """Raised when neither the extension nor the declared type is whitelisted."""


def slug_filename(filename: str) -> str:
    """Return a filesystem/object-store safe name.

    Keeps ``[A-Za-z0-9._-]`` only, collapses every run of dots so ``..`` can
    never appear, strips leading dots (``sanitize_key`` forbids dot-prefixed
    segments) and caps the length.
    """

    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    slug = _SLUG_RE.sub("_", base)
    slug = _DOTS_RE.sub("_", slug)
    slug = slug.lstrip(".")
    if not slug:
        return "file"
    return slug[:200]


def make_storage_key(user_id: str, source_id: str, filename: str) -> str:
    """Build ``<user_id>/<source_id>/<slug>`` for a new source."""
    return f"{user_id}/{source_id}/{slug_filename(filename)}"


def title_from_filename(filename: str) -> str:
    """Derive a human title from the original filename stem."""
    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    stem = Path(base).stem
    return (stem or base or "未命名")[:512]


def resolve_content_type(filename: str, declared: str) -> str:
    """Return the canonical content type or raise :class:`UnsupportedFileType`.

    The filename extension wins; a mismatched declared type is tolerated. When
    the extension is unknown the declared type is accepted only if it maps to a
    whitelisted canonical type.
    """

    extension = Path(filename).suffix.lower()
    canonical = _EXTENSION_CONTENT_TYPES.get(extension)
    if canonical is not None:
        return canonical
    normalised = declared.split(";", 1)[0].strip().lower()
    canonical = _DECLARED_CONTENT_TYPES.get(normalised)
    if canonical is not None:
        return canonical
    raise UnsupportedFileType(UNSUPPORTED_TYPE_MESSAGE)


def save_upload(storage_key: str, data: bytes, content_type: str) -> str:
    """Persist the uploaded bytes through the configured storage adapter."""
    return build_storage().put(storage_key, data, content_type)


def _build_ocr() -> OCRProvider | None:
    """Return the OCR adapter when its factory exists (Task 34), else ``None``."""
    try:
        module = importlib.import_module("app.adapters.ocr")
    except ImportError:
        return None
    factory = getattr(module, "build_ocr", None)
    if not callable(factory):
        return None
    return factory()


def _now() -> datetime:
    return datetime.now(UTC)


def _fail(
    db: Session,
    job: IngestionJob,
    source: KnowledgeSource | None,
    message: str,
) -> None:
    """Mark the job (and mirrored source) failed and commit."""
    trimmed = message[:2048]
    job.status = "failed"
    job.error_message = trimmed
    job.finished_at = _now()
    if source is not None:
        source.status = "failed"
        source.error_message = trimmed
    db.commit()


def _finish_success(
    db: Session,
    job: IngestionJob,
    source: KnowledgeSource,
    status: str,
    failed_chunks: int,
) -> None:
    job.status = status
    job.progress = 100
    job.failed_chunks = failed_chunks
    job.error_message = None
    job.finished_at = _now()
    source.status = status
    source.error_message = None
    db.commit()


def _embed_with_retry(embedding: EmbeddingProvider, texts: list[str]) -> EmbeddingResult:
    """Embed one batch, retrying :class:`ProviderRateLimitError` twice."""
    attempt = 0
    while True:
        try:
            return embedding.embed(texts)
        except ProviderRateLimitError:
            if attempt >= len(_RETRY_DELAYS):
                raise
            _sleep(_RETRY_DELAYS[attempt])
            attempt += 1


def _build_records(
    chunks: list[TextChunk],
    vectors: list[list[float]],
    source_id: str,
    model: str,
    dim: int,
) -> list[ChunkRecord]:
    records: list[ChunkRecord] = []
    for chunk, vector in zip(chunks, vectors, strict=True):
        records.append(
            ChunkRecord(
                chunk_id=str(uuid.uuid4()),
                source_id=source_id,
                content=chunk.content,
                page=chunk.page,
                heading=chunk.heading,
                embedding=vector,
                embedding_model=model,
                embedding_dim=dim,
                embedding_version="1",
            )
        )
    return records


def _process(
    db: Session,
    job: IngestionJob,
    source: KnowledgeSource,
    ocr: OCRProvider | None,
) -> None:
    """Run the parse → chunk → embed → upsert stages for one job."""
    job.status = "parsing"
    job.progress = 10
    if job.started_at is None:
        job.started_at = _now()
    job.finished_at = None
    job.error_message = None
    source.status = "parsing"
    source.error_message = None
    db.commit()

    provider = ocr
    if source.content_type in _IMAGE_CONTENT_TYPES and provider is None:
        provider = _build_ocr()
        if provider is None:
            logger.warning("ingest job %s: OCR provider unavailable", job.id)
            _fail(db, job, source, "OCR 服务未配置")
            return

    try:
        data = build_storage().get(source.storage_key)
    except Exception as exc:
        logger.error("ingest job %s: storage read failed (%s)", job.id, type(exc).__name__)
        _fail(db, job, source, "读取文件失败")
        return

    try:
        parsed: ParsedDocument = parse_document(
            data,
            content_type=source.content_type,
            filename=source.filename,
            ocr=provider,
        )
    except ValueError as exc:
        _fail(db, job, source, str(exc) or "文档解析失败")
        return

    chunks: list[TextChunk] = [] if parsed.empty else chunk_document(parsed)
    source.page_count = 0 if parsed.empty else len(parsed.pages)
    job.progress = 40
    db.commit()

    if parsed.empty or not chunks:
        logger.info("ingest job %s: empty document", job.id)
        _finish_success(db, job, source, "ready_empty", 0)
        return

    job.status = "embedding"
    source.status = "embedding"
    db.commit()

    try:
        embedding = build_embedding()
    except Exception as exc:
        logger.error("ingest job %s: embedding unavailable (%s)", job.id, type(exc).__name__)
        _fail(db, job, source, "嵌入服务不可用")
        return

    batch_size = max(1, int(settings.embedding_batch_size))
    total = len(chunks)
    processed = 0
    failed = 0
    records: list[ChunkRecord] = []
    last_model = settings.embedding_model
    last_dim = int(settings.embedding_dim)

    for start in range(0, total, batch_size):
        batch = chunks[start : start + batch_size]
        try:
            result = _embed_with_retry(embedding, [chunk.content for chunk in batch])
        except ProviderError as exc:
            logger.warning(
                "ingest job %s: embedding batch failed (%s)", job.id, type(exc).__name__
            )
            failed += len(batch)
        else:
            last_model = result.model or last_model
            last_dim = int(result.dim or last_dim)
            if len(result.vectors) != len(batch):
                logger.warning("ingest job %s: embedding count mismatch", job.id)
                failed += len(batch)
            else:
                records.extend(
                    _build_records(batch, result.vectors, source.id, last_model, last_dim)
                )

        processed += len(batch)
        job.progress = min(90, 40 + int(processed * 50 / total))
        job.failed_chunks = failed
        db.commit()

    job.progress = 90
    db.commit()

    if failed == total:
        logger.warning("ingest job %s: all %d chunks failed to embed", job.id, total)
        _fail(db, job, source, "全部文本块嵌入失败")
        return

    try:
        written = build_vector_store().upsert(records)
    except Exception as exc:
        logger.error("ingest job %s: vector upsert failed (%s)", job.id, type(exc).__name__)
        _fail(db, job, source, "向量写入失败")
        return

    logger.info(
        "ingest job %s: ready chunks=%d failed=%d written=%d",
        job.id,
        total,
        failed,
        written,
    )
    _finish_success(db, job, source, "ready", failed)


def run_ingest(job_id: str, *, ocr: OCRProvider | None = None) -> None:
    """Execute one ingestion job in its own session.

    Idempotent-safe: a job that already reached ``ready`` / ``ready_empty`` is
    left untouched, so a duplicated background dispatch is a no-op.

    ``ocr`` may be injected by callers/tests; when omitted, the OCR factory is
    discovered lazily and image sources fail with ``OCR 服务未配置`` until
    Task 34 ships it.
    """

    db = SessionLocal()
    try:
        job = db.get(IngestionJob, job_id)
        if job is None:
            logger.warning("ingest: unknown job %s", job_id)
            return
        if job.status in ("ready", "ready_empty"):
            return

        source = db.get(KnowledgeSource, job.source_id)
        if source is None:
            _fail(db, job, None, "知识源不存在")
            return

        try:
            _process(db, job, source, ocr)
        except Exception as exc:
            logger.error("ingest job %s: unexpected failure (%s)", job.id, type(exc).__name__)
            db.rollback()
            _fail(db, job, source, "处理失败")
    finally:
        db.close()
