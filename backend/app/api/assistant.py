"""Learning assistant: RAG conversations with citations, history and SSE streaming."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from fastapi.concurrency import iterate_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.embedding.factory import build_embedding
from app.adapters.vector.factory import build_vector_store
from app.api.errors import CodedHTTPException
from app.deps import CurrentUser, DbSession
from app.models import (
    AssistantConversation,
    AssistantMessage,
    Chunk,
    CompetitionMember,
    KnowledgePoint,
    KnowledgeSource,
)
from app.ports import ChatMessage
from app.ports.types import ChatRole
from app.services.agent_resolver import resolve_agent

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

NOT_FOUND_DETAIL = "资源不存在"
NO_CONTEXT_DETAIL = "没有检索到可引用的资料，请先上传并解析文档"
HISTORY_TURNS = 6
TOP_K = 8
SNIPPET_CHARS = 200

DEFAULT_SYSTEM_PROMPT = (
    "你是 LearnRise 的学习助手。只能依据提供的资料片段回答；"
    "资料不足时直接说明资料不足，不要编造。回答使用简体中文，条理清晰。"
)


class ConversationCreate(BaseModel):
    competition_id: str | None = None
    title: str = Field(default="", max_length=256)
    mode: str = "concise"


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    mode: str | None = None


class Citation(BaseModel):
    chunk_id: str
    source_id: str
    knowledge_point_id: str | None = None
    page: int | None = None
    heading: str | None = None
    snippet: str
    score: float


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    citations: list[Citation] = Field(default_factory=list)
    mode: str | None = None
    created_at: datetime


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    mode: str
    competition_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ConversationDetail(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]


class AnswerOut(BaseModel):
    message_id: str
    role: str = "assistant"
    content: str
    citations: list[Citation] = Field(default_factory=list)
    created_at: datetime


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


def _load_conversation(db: Session, conversation_id: str, user_id: str) -> AssistantConversation:
    conversation = db.get(AssistantConversation, conversation_id)
    if conversation is None or conversation.user_id != user_id:
        raise _not_found()
    return conversation


def _member_of(db: Session, competition_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(CompetitionMember.id).where(
                CompetitionMember.competition_id == competition_id,
                CompetitionMember.user_id == user_id,
            )
        )
        is not None
    )


def _scope_source_ids(db: Session, conversation: AssistantConversation, user_id: str) -> list[str]:
    if conversation.competition_id is None:
        return list(
            db.scalars(
                select(KnowledgeSource.id).where(KnowledgeSource.user_id == user_id)
            ).all()
        )
    if not _member_of(db, conversation.competition_id, user_id):
        raise _not_found()
    return list(
        db.scalars(
            select(KnowledgeSource.id).where(
                KnowledgeSource.competition_id == conversation.competition_id
            )
        ).all()
    )


def _retrieve(db: Session, source_ids: list[str], question: str) -> list[Citation]:
    if not source_ids:
        return []
    embedder = build_embedding()
    store = build_vector_store()
    try:
        vector = embedder.embed([question]).vectors[0]
        hits = store.search(vector, top_k=TOP_K, source_ids=source_ids)
    except Exception:  # noqa: BLE001 - a provider outage must surface as NO_CONTEXT, not a 500
        return []

    citations: list[Citation] = []
    for hit in hits:
        chunk = db.get(Chunk, hit.chunk_id)
        content = chunk.content if chunk is not None else hit.content
        point_id = db.scalar(
            select(KnowledgePoint.id).where(KnowledgePoint.chunk_id == hit.chunk_id).limit(1)
        )
        if point_id is None:
            point_id = db.scalar(
                select(KnowledgePoint.id)
                .where(KnowledgePoint.source_id == hit.source_id)
                .order_by(KnowledgePoint.level, KnowledgePoint.sort_order)
                .limit(1)
            )
        citations.append(
            Citation(
                chunk_id=hit.chunk_id,
                source_id=hit.source_id,
                knowledge_point_id=point_id,
                page=chunk.page if chunk is not None else hit.page,
                heading=chunk.heading if chunk is not None else hit.heading,
                snippet=(content or "")[:SNIPPET_CHARS],
                score=float(getattr(hit, "score", 0.0) or 0.0),
            )
        )
    return citations


def _history(db: Session, conversation_id: str) -> list[ChatMessage]:
    rows = db.scalars(
        select(AssistantMessage)
        .where(AssistantMessage.conversation_id == conversation_id)
        .order_by(AssistantMessage.created_at.desc(), AssistantMessage.id.desc())
        .limit(HISTORY_TURNS)
    ).all()
    history: list[ChatMessage] = []
    for row in reversed(rows):
        if row.content:
            role: ChatRole = "assistant" if row.role == "assistant" else "user"
            history.append(ChatMessage(role=role, content=row.content))
    return history


def _build_messages(
    history: list[ChatMessage], question: str, citations: list[Citation]
) -> list[ChatMessage]:
    context = "\n\n".join(
        f"[{index + 1}] {citation.snippet}" for index, citation in enumerate(citations)
    )
    system = f"{DEFAULT_SYSTEM_PROMPT}\n\n资料片段：\n{context}"
    return [
        ChatMessage(role="system", content=system),
        *history,
        ChatMessage(role="user", content=question),
    ]


def _persist_message(
    db: Session,
    conversation: AssistantConversation,
    role: str,
    content: str,
    citations: list[Citation],
    mode: str | None,
) -> AssistantMessage:
    message = AssistantMessage(
        conversation_id=conversation.id,
        role=role,
        content=content,
        citations=[citation.model_dump() for citation in citations],
        mode=mode,
    )
    db.add(message)
    conversation.updated_at = datetime.now().astimezone()
    db.commit()
    db.refresh(message)
    return message


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post(
    "/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED
)
def create_conversation(
    payload: ConversationCreate, db: DbSession, user: CurrentUser
) -> ConversationOut:
    if payload.competition_id is not None and not _member_of(
        db, payload.competition_id, user.id
    ):
        raise _not_found()
    conversation = AssistantConversation(
        user_id=user.id,
        competition_id=payload.competition_id,
        title=payload.title,
        mode=payload.mode,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return ConversationOut.model_validate(conversation)


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    db: DbSession,
    user: CurrentUser,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ConversationOut]:
    total = int(
        db.scalar(
            select(func.count())
            .select_from(AssistantConversation)
            .where(AssistantConversation.user_id == user.id)
        )
        or 0
    )
    response.headers["X-Total-Count"] = str(total)
    rows = db.scalars(
        select(AssistantConversation)
        .where(AssistantConversation.user_id == user.id)
        .order_by(AssistantConversation.updated_at.desc(), AssistantConversation.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return [ConversationOut.model_validate(row) for row in rows]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def read_conversation(
    conversation_id: str, db: DbSession, user: CurrentUser
) -> ConversationDetail:
    conversation = _load_conversation(db, conversation_id, user.id)
    rows = db.scalars(
        select(AssistantMessage)
        .where(AssistantMessage.conversation_id == conversation.id)
        .order_by(AssistantMessage.created_at, AssistantMessage.id)
    ).all()
    return ConversationDetail(
        conversation=ConversationOut.model_validate(conversation),
        messages=[MessageOut.model_validate(row) for row in rows],
    )


@router.post("/conversations/{conversation_id}/messages", response_model=AnswerOut)
def send_message(
    conversation_id: str, payload: MessageCreate, db: DbSession, user: CurrentUser
) -> AnswerOut:
    conversation = _load_conversation(db, conversation_id, user.id)
    if payload.mode is not None:
        conversation.mode = payload.mode

    source_ids = _scope_source_ids(db, conversation, user.id)
    citations = _retrieve(db, source_ids, payload.content)
    if not citations:
        raise CodedHTTPException(
            status_code=409, detail=NO_CONTEXT_DETAIL, code="NO_CONTEXT"
        )

    history = _history(db, conversation.id)
    messages = _build_messages(history, payload.content, citations)
    llm, _agent = resolve_agent(
        db, user_id=user.id, agent_id=None, task_type="assistant"
    )
    result = llm.chat(messages)

    _persist_message(db, conversation, "user", payload.content, [], conversation.mode)
    stored = _persist_message(
        db, conversation, "assistant", result.content, citations, conversation.mode
    )
    return AnswerOut(
        message_id=stored.id,
        content=stored.content,
        citations=citations,
        created_at=stored.created_at,
    )


@router.post("/conversations/{conversation_id}/stream")
def stream_message(
    conversation_id: str, payload: MessageCreate, db: DbSession, user: CurrentUser
) -> StreamingResponse:
    conversation = _load_conversation(db, conversation_id, user.id)
    if payload.mode is not None:
        conversation.mode = payload.mode

    source_ids = _scope_source_ids(db, conversation, user.id)
    citations = _retrieve(db, source_ids, payload.content)
    if not citations:
        raise CodedHTTPException(
            status_code=409, detail=NO_CONTEXT_DETAIL, code="NO_CONTEXT"
        )

    history = _history(db, conversation.id)
    messages = _build_messages(history, payload.content, citations)
    llm, _agent = resolve_agent(
        db, user_id=user.id, agent_id=None, task_type="assistant"
    )
    question = payload.content
    mode = conversation.mode

    def _generate() -> Iterator[str]:
        parts: list[str] = []
        yield _sse("citations", {"citations": [c.model_dump() for c in citations]})
        for delta in llm.stream(messages):
            if not delta:
                continue
            parts.append(delta)
            yield _sse("token", {"text": delta})
        content = "".join(parts)
        session = db
        _persist_message(session, conversation, "user", question, [], mode)
        stored = _persist_message(session, conversation, "assistant", content, citations, mode)
        yield _sse("done", {"chars": len(content), "message_id": stored.id})

    return StreamingResponse(
        iterate_in_threadpool(_generate()), media_type="text/event-stream", headers=SSE_HEADERS
    )
