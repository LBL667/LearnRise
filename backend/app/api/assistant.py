"""Learning assistant: RAG conversations with citations, history and SSE streaming."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated
from uuid import UUID

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
    KnowledgePoint,
    KnowledgeSource,
    QuizQuestion,
)
from app.ports import ChatMessage
from app.ports.types import ChatRole
from app.services.agent_resolver import resolve_agent
from app.services.scope import resolve_scope
from app.services.socratic import (
    SOCRATIC_SYSTEM_GUIDANCE,
    load_answers,
    rewrite_leaks,
    token_chunks,
)

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


class RevealRequest(BaseModel):
    question_id: str | None = None
    chunk_id: str | None = None


class RevealOut(BaseModel):
    answer: str
    explanation: str = ""


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
    rewritten: bool = False


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _load_conversation(db: Session, conversation_id: str, user_id: str) -> AssistantConversation:
    conversation = db.get(AssistantConversation, conversation_id)
    if conversation is None or conversation.user_id != user_id:
        raise _not_found()
    return conversation


def _scope_source_ids(db: Session, conversation: AssistantConversation, user_id: str) -> list[str]:
    if conversation.competition_id is None:
        return list(
            db.scalars(
                select(KnowledgeSource.id).where(KnowledgeSource.user_id == user_id)
            ).all()
        )
    resolve_scope(db, user_id, conversation.competition_id).require_read()
    return list(
        db.scalars(
            select(KnowledgeSource.id).where(
                KnowledgeSource.competition_id == conversation.competition_id
            )
        ).all()
    )


def _retrieve(
    db: Session,
    source_ids: list[str],
    question: str,
    *,
    competition_id: str | None = None,
) -> list[Citation]:
    if not source_ids:
        return []
    embedder = build_embedding()
    store = build_vector_store()
    try:
        vector = embedder.embed([question]).vectors[0]
        hits = store.search(
            vector,
            top_k=TOP_K,
            source_ids=source_ids,
            competition_id=competition_id,
        )
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
    history: list[ChatMessage],
    question: str,
    citations: list[Citation],
    *,
    socratic: bool = False,
) -> list[ChatMessage]:
    context = "\n\n".join(
        f"[{index + 1}] {citation.snippet}" for index, citation in enumerate(citations)
    )
    system = DEFAULT_SYSTEM_PROMPT
    if socratic:
        system = f"{system}\n\n{SOCRATIC_SYSTEM_GUIDANCE}"
    system = f"{system}\n\n资料片段：\n{context}"
    return [
        ChatMessage(role="system", content=system),
        *history,
        ChatMessage(role="user", content=question),
    ]


def _answers_for_citations(
    db: Session, citations: list[Citation], user_id: str
) -> list[str]:
    return load_answers(
        db,
        (citation.knowledge_point_id for citation in citations),
        user_id=user_id,
    )


def _authorize_source(
    db: Session, conversation: AssistantConversation, source: KnowledgeSource, user_id: str
) -> None:
    if source.user_id == user_id:
        return
    if (
        conversation.competition_id is not None
        and source.competition_id == conversation.competition_id
    ):
        resolve_scope(db, user_id, conversation.competition_id).require_read()
        return
    raise _not_found()


def _authorize_question(
    db: Session, conversation: AssistantConversation, question: QuizQuestion, user_id: str
) -> None:
    if question.user_id == user_id:
        return
    if (
        conversation.competition_id is not None
        and question.competition_id == conversation.competition_id
    ):
        resolve_scope(db, user_id, conversation.competition_id).require_read()
        return
    raise _not_found()


def _question_for_chunk(
    db: Session, conversation: AssistantConversation, chunk_id: str, user_id: str
) -> QuizQuestion:
    if not _is_uuid(chunk_id):
        raise _not_found()
    chunk = db.get(Chunk, chunk_id)
    if chunk is None:
        raise _not_found()
    source = db.get(KnowledgeSource, chunk.source_id)
    if source is None:
        raise _not_found()
    _authorize_source(db, conversation, source, user_id)

    point_id = db.scalar(
        select(KnowledgePoint.id).where(KnowledgePoint.chunk_id == chunk.id).limit(1)
    )
    if point_id is None:
        point_id = db.scalar(
            select(KnowledgePoint.id)
            .where(KnowledgePoint.source_id == chunk.source_id)
            .order_by(KnowledgePoint.level, KnowledgePoint.sort_order)
            .limit(1)
        )
    if point_id is None:
        raise _not_found()

    question = db.scalars(
        select(QuizQuestion)
        .where(QuizQuestion.knowledge_point_id == point_id)
        .order_by(QuizQuestion.created_at, QuizQuestion.id)
        .limit(1)
    ).first()
    if question is None:
        raise _not_found()
    _authorize_question(db, conversation, question, user_id)
    return question


def _resolve_reveal(
    db: Session,
    conversation: AssistantConversation,
    payload: RevealRequest,
    user_id: str,
) -> QuizQuestion:
    if payload.question_id is not None:
        if not _is_uuid(payload.question_id):
            raise _not_found()
        question = db.get(QuizQuestion, payload.question_id)
        if question is None:
            raise _not_found()
        _authorize_question(db, conversation, question, user_id)
        return question

    chunk_id = payload.chunk_id
    if chunk_id is None:
        last = db.scalars(
            select(AssistantMessage)
            .where(
                AssistantMessage.conversation_id == conversation.id,
                AssistantMessage.role == "assistant",
            )
            .order_by(AssistantMessage.created_at.desc(), AssistantMessage.id.desc())
            .limit(1)
        ).first()
        if last is not None and last.citations:
            candidate = last.citations[0].get("chunk_id")
            chunk_id = candidate if isinstance(candidate, str) else None
    if chunk_id is None:
        raise _not_found()
    return _question_for_chunk(db, conversation, chunk_id, user_id)


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
    resolve_scope(db, user, payload.competition_id).require_read()
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
    citations = _retrieve(
        db, source_ids, payload.content, competition_id=conversation.competition_id
    )
    if not citations:
        raise CodedHTTPException(
            status_code=409, detail=NO_CONTEXT_DETAIL, code="NO_CONTEXT"
        )

    history = _history(db, conversation.id)
    socratic = conversation.mode == "socratic"
    messages = _build_messages(history, payload.content, citations, socratic=socratic)
    answers = _answers_for_citations(db, citations, user.id) if socratic else []
    llm, _agent = resolve_agent(
        db, user_id=user.id, agent_id=None, task_type="assistant"
    )
    result = llm.chat(messages)

    content = result.content
    rewritten = False
    if socratic:
        content, rewritten = rewrite_leaks(content, answers)

    _persist_message(db, conversation, "user", payload.content, [], conversation.mode)
    stored = _persist_message(
        db, conversation, "assistant", content, citations, conversation.mode
    )
    return AnswerOut(
        message_id=stored.id,
        content=stored.content,
        citations=citations,
        created_at=stored.created_at,
        rewritten=rewritten,
    )


@router.post("/conversations/{conversation_id}/reveal", response_model=RevealOut)
def reveal_answer(
    conversation_id: str,
    payload: RevealRequest,
    db: DbSession,
    user: CurrentUser,
) -> RevealOut:
    conversation = _load_conversation(db, conversation_id, user.id)
    question = _resolve_reveal(db, conversation, payload, user.id)
    return RevealOut(answer=question.answer, explanation=question.explanation or "")


@router.post("/conversations/{conversation_id}/stream")
def stream_message(
    conversation_id: str, payload: MessageCreate, db: DbSession, user: CurrentUser
) -> StreamingResponse:
    conversation = _load_conversation(db, conversation_id, user.id)
    if payload.mode is not None:
        conversation.mode = payload.mode

    source_ids = _scope_source_ids(db, conversation, user.id)
    citations = _retrieve(
        db, source_ids, payload.content, competition_id=conversation.competition_id
    )
    if not citations:
        raise CodedHTTPException(
            status_code=409, detail=NO_CONTEXT_DETAIL, code="NO_CONTEXT"
        )

    history = _history(db, conversation.id)
    mode = conversation.mode
    socratic = mode == "socratic"
    messages = _build_messages(history, payload.content, citations, socratic=socratic)
    answers = _answers_for_citations(db, citations, user.id) if socratic else []
    llm, _agent = resolve_agent(
        db, user_id=user.id, agent_id=None, task_type="assistant"
    )
    question = payload.content

    def _generate() -> Iterator[str]:
        yield _sse("citations", {"citations": [c.model_dump() for c in citations]})
        if socratic:
            buffered: list[str] = []
            for delta in llm.stream(messages):
                if delta:
                    buffered.append(delta)
            content, rewritten = rewrite_leaks("".join(buffered), answers)
            for piece in token_chunks(content):
                yield _sse("token", {"text": piece})
            _persist_message(db, conversation, "user", question, [], mode)
            stored = _persist_message(
                db, conversation, "assistant", content, citations, mode
            )
            yield _sse(
                "done",
                {
                    "chars": len(content),
                    "message_id": stored.id,
                    "rewritten": rewritten,
                },
            )
            return

        parts: list[str] = []
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
