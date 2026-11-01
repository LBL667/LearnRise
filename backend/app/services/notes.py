"""Structured note generation from a source's chunks.

The pipeline is deliberately strict: the LLM is asked for a JSON document,
the response is stripped of Markdown fences, parsed and validated with
pydantic. One retry is allowed with an extra "output only valid JSON"
instruction. If the second attempt still fails, :class:`NoteGenerationError`
carries the (truncated) raw text so the API can surface it for manual repair.

Only validated trees are ever written to ``knowledge_points``; a single
transaction first removes the source's previous rows and then inserts the new
hierarchy. Prompts are never logged, only their length and the model name.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import AgentConfig, Chunk, KnowledgePoint, KnowledgeSource
from app.ports import ChatMessage, LLMProvider
from app.services.agent_resolver import resolve_agent

logger = logging.getLogger(__name__)

TASK_TYPE = "note"
MAX_ROOT_NODES = 12
MAX_LEVEL = 5
PROMPT_CHUNK_LIMIT = 12
PROMPT_CHAR_LIMIT = 12000
RAW_LIMIT = 2000

SYSTEM_PROMPT = (
    "你是学习笔记整理助手；只输出 JSON；"
    "顶层 {title, nodes:[{title, content, level, children}]}；"
    "最多 12 个一级节点；每个节点 title ≤ 40 字、content ≤ 200 字"
)
STRICT_INSTRUCTION = "只输出合法 JSON，不要任何解释或代码块围栏"
FAILURE_MESSAGE = "笔记生成失败：JSON 校验未通过"

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


class NoteNode(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=4000)
    level: int = Field(ge=0, le=MAX_LEVEL)
    children: list[NoteNode] = Field(default_factory=list)


class NoteDocument(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    nodes: list[NoteNode] = Field(min_length=1, max_length=MAX_ROOT_NODES)

    @model_validator(mode="after")
    def _check_levels(self) -> NoteDocument:
        _validate_levels(self.nodes, depth=0)
        return self


def _validate_levels(nodes: list[NoteNode], *, depth: int) -> None:
    if depth > MAX_LEVEL:
        raise ValueError(f"node depth {depth} exceeds {MAX_LEVEL}")
    for node in nodes:
        if node.level != depth:
            raise ValueError(f"node level {node.level} does not match depth {depth}")
        _validate_levels(node.children, depth=depth + 1)


NoteNode.model_rebuild()
NoteDocument.model_rebuild()


class NoteSourceNotFound(Exception):
    """The source does not exist or belongs to another user (mapped to 404)."""


class NoteGenerationError(Exception):
    """Both LLM attempts produced invalid JSON (mapped to 422)."""

    def __init__(self, raw: str) -> None:
        super().__init__(FAILURE_MESSAGE)
        self.raw = (raw or "")[:RAW_LIMIT]


@dataclass(frozen=True, slots=True)
class NotesResult:
    source_id: str
    knowledge_points_created: int
    root_ids: list[str]
    model: str


Resolver = Callable[..., tuple[LLMProvider, AgentConfig | None]]


def _load_source(db: Session, *, source_id: str, user_id: str) -> KnowledgeSource:
    try:
        UUID(source_id)
    except (ValueError, TypeError, AttributeError):
        raise NoteSourceNotFound(source_id) from None
    source = db.get(KnowledgeSource, source_id)
    if source is None or str(source.user_id) != str(user_id):
        raise NoteSourceNotFound(source_id)
    return source


def _load_chunks(db: Session, *, source_id: str, user_id: str) -> list[Chunk]:
    return list(
        db.scalars(
            select(Chunk)
            .where(Chunk.source_id == source_id, Chunk.user_id == user_id)
            .order_by(Chunk.chunk_index)
            .limit(PROMPT_CHUNK_LIMIT)
        ).all()
    )


def _chunk_piece(chunk: Chunk) -> str:
    body = chunk.content or ""
    if chunk.page is None:
        return body
    return f"[page {chunk.page}]\n{body}"


def _build_context(chunks: list[Chunk]) -> str:
    parts: list[str] = []
    total = 0
    for chunk in chunks:
        piece = _chunk_piece(chunk)
        if not piece:
            continue
        remaining = PROMPT_CHAR_LIMIT - total
        if remaining <= 0:
            break
        if len(piece) > remaining:
            parts.append(piece[:remaining])
            break
        parts.append(piece)
        total += len(piece)
    return "\n\n".join(parts)


def _build_messages(source: KnowledgeSource, chunks: list[Chunk]) -> list[ChatMessage]:
    context = _build_context(chunks)
    user_prompt = (
        f"资料标题：{source.title}\n\n"
        f"以下是资料片段：\n{context}\n\n"
        "请根据以上内容生成层级结构化学习笔记，只输出 JSON。"
    )
    return [
        ChatMessage(role="system", content=SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_prompt),
    ]


def _strip_fences(text: str) -> str:
    match = _FENCE_RE.search(text)
    if match is not None:
        return match.group(1).strip()
    return text.strip()


def _extract_object(text: str) -> Any | None:
    start = text.find("{")
    if start == -1:
        return None
    decoder = json.JSONDecoder()
    try:
        payload, _end = decoder.raw_decode(text[start:])
        return payload
    except json.JSONDecodeError:
        end = text.rfind("}")
        if end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None


def _parse_document(raw: str) -> NoteDocument | None:
    candidate = _strip_fences(raw or "")
    if not candidate:
        return None
    try:
        payload: Any = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        payload = _extract_object(candidate)
    if payload is None:
        return None
    try:
        return NoteDocument.model_validate(payload)
    except ValidationError:
        return None


def _chat(llm: LLMProvider, messages: list[ChatMessage]) -> str:
    result = llm.chat(messages)
    return result.content or ""


def _generate_document(
    llm: LLMProvider, messages: list[ChatMessage]
) -> NoteDocument:
    raw = _chat(llm, messages)
    document = _parse_document(raw)
    if document is not None:
        return document

    retry_messages = [*messages, ChatMessage(role="user", content=STRICT_INSTRUCTION)]
    raw = _chat(llm, retry_messages)
    document = _parse_document(raw)
    if document is not None:
        return document
    raise NoteGenerationError(raw)


def _persist(
    db: Session,
    *,
    user_id: str,
    source_id: str,
    document: NoteDocument,
    chunk_id: str | None,
) -> tuple[int, list[str]]:
    created = 0
    try:
        db.execute(
            delete(KnowledgePoint).where(
                KnowledgePoint.source_id == source_id,
                KnowledgePoint.user_id == user_id,
            )
        )
        db.flush()

        def insert(nodes: list[NoteNode], parent_id: str | None, depth: int) -> list[str]:
            nonlocal created
            ids: list[str] = []
            for index, node in enumerate(nodes):
                point = KnowledgePoint(
                    user_id=user_id,
                    source_id=source_id,
                    chunk_id=chunk_id,
                    parent_id=parent_id,
                    title=node.title,
                    content=node.content,
                    level=depth,
                    sort_order=index,
                    mastery_score=0.0,
                )
                db.add(point)
                db.flush()
                created += 1
                ids.append(point.id)
                insert(node.children, point.id, depth + 1)
            return ids

        root_ids = insert(document.nodes, None, 0)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created, root_ids


def generate_notes(
    db: Session,
    *,
    user_id: str,
    source_id: str,
    agent_id: str | None = None,
    resolver: Resolver | None = None,
) -> NotesResult:
    """Generate and persist a structured note tree for ``source_id``.

    Raises :class:`NoteSourceNotFound` when the source is missing/foreign,
    ``ValueError("no chunks")`` when it has no text, and
    :class:`NoteGenerationError` when JSON validation fails twice.
    """
    source = _load_source(db, source_id=source_id, user_id=user_id)
    chunks = _load_chunks(db, source_id=source.id, user_id=user_id)
    if not chunks:
        raise ValueError("no chunks")

    resolve = resolver if resolver is not None else resolve_agent
    llm, _agent = resolve(
        db, user_id=user_id, agent_id=agent_id, task_type=TASK_TYPE
    )

    messages = _build_messages(source, chunks)
    logger.info(
        "notes: source=%s chunks=%d prompt_chars=%d model=%s",
        source.id,
        len(chunks),
        sum(len(message.content) for message in messages),
        getattr(llm, "model", ""),
    )

    document = _generate_document(llm, messages)
    created, root_ids = _persist(
        db,
        user_id=user_id,
        source_id=source.id,
        document=document,
        chunk_id=chunks[0].id,
    )
    return NotesResult(
        source_id=source.id,
        knowledge_points_created=created,
        root_ids=root_ids,
        model=str(getattr(llm, "model", "") or ""),
    )
