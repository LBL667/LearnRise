"""Streamed knowledge-point explanations over Server-Sent Events.

The response is read live from the provider and forwarded without buffering so
the client can render tokens as they arrive. Whatever text was emitted is
persisted to ``explanation_logs`` even if the upstream fails mid-stream; the
client only ever sees a generic Chinese error message, never an upstream body,
URL or key.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool
from starlette.responses import StreamingResponse

from app.api.agents import get_agent_semaphore
from app.db import SessionLocal
from app.deps import CurrentUser, DbSession
from app.models import AgentConfig, ExplanationLog, KnowledgePoint
from app.ports import ChatMessage, LLMProvider
from app.ports.errors import (
    ProviderAuthError,
    ProviderRateLimitError,
    UpstreamTimeoutError,
)
from app.services.agent_resolver import resolve_agent

router = APIRouter(prefix="/api/knowledge-points", tags=["explain"])

EXPLAIN_TASK = "explain"

ExplainStyle = Literal["concise", "detailed", "example"]

DEFAULT_SYSTEM_PROMPT = (
    "你是一位耐心的中文学习助教。请用中文讲解知识点，语言简洁清晰，"
    "不要使用 Markdown 标题，整体不超过 400 字。"
)

_STYLE_HINTS: dict[str, str] = {
    "concise": "简明扼要，直接讲清核心要点。",
    "detailed": "详细展开，说明背景、原理和易错点。",
    "example": "给出一个具体例子帮助理解。",
}

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

_NOT_FOUND = "资源不存在"


class ExplainRequest(BaseModel):
    agent_id: str | None = None
    style: ExplainStyle = "concise"


def _sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _load_knowledge_point(
    db: Session, knowledge_point_id: str, user_id: str
) -> KnowledgePoint:
    try:
        UUID(knowledge_point_id)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None
    point = db.get(KnowledgePoint, knowledge_point_id)
    if point is None or str(point.user_id) != str(user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return point


def _build_messages(
    point: KnowledgePoint, style: ExplainStyle, system_prompt: str
) -> list[ChatMessage]:
    content = point.content or "（暂无正文，请依据标题讲解）"
    user_prompt = (
        f"知识点标题：{point.title}\n\n"
        f"知识点内容：{content}\n\n"
        f"请按以下风格讲解：{_STYLE_HINTS[style]}"
    )
    return [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_prompt),
    ]


def _persist_explanation(
    *,
    user_id: str,
    knowledge_point_id: str,
    agent_id: str | None,
    style: str,
    content: str,
    status_value: str,
    error_message: str | None,
    model: str,
) -> None:
    log = ExplanationLog(
        user_id=user_id,
        knowledge_point_id=knowledge_point_id,
        agent_id=agent_id,
        task_type=EXPLAIN_TASK,
        style=style,
        content=content,
        status=status_value,
        error_message=error_message,
        model=model,
        chars=len(content),
    )
    db = SessionLocal()
    try:
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _model_name(llm: LLMProvider) -> str:
    return str(getattr(llm, "model", "") or "")


def _error_message(exc: Exception) -> str:
    if isinstance(exc, ProviderAuthError):
        return "模型鉴权失败"
    if isinstance(exc, ProviderRateLimitError):
        return "上游限流，请稍后重试"
    if isinstance(exc, UpstreamTimeoutError):
        return "连接超时"
    return "讲解失败，请稍后重试"


def _resolve(
    db: Session, user_id: str, agent_id: str | None
) -> tuple[LLMProvider, AgentConfig | None]:
    return resolve_agent(
        db, user_id=user_id, agent_id=agent_id, task_type=EXPLAIN_TASK
    )


@router.post("/{knowledge_point_id}/explain")
def explain_knowledge_point(
    knowledge_point_id: str,
    db: DbSession,
    user: CurrentUser,
    payload: ExplainRequest | None = None,
) -> StreamingResponse:
    point = _load_knowledge_point(db, knowledge_point_id, user.id)
    request_body = payload or ExplainRequest()

    llm, agent = _resolve(db, user.id, request_body.agent_id)
    system_prompt = (
        agent.system_prompt
        if agent is not None and agent.system_prompt
        else DEFAULT_SYSTEM_PROMPT
    )
    messages = _build_messages(point, request_body.style, system_prompt)

    agent_id = agent.id if agent is not None else None
    max_concurrency = agent.max_concurrency if agent is not None else None
    semaphore_key = agent_id if agent_id is not None else f"user:{user.id}"
    semaphore = get_agent_semaphore(semaphore_key, max_concurrency)

    model = _model_name(llm)
    user_id = user.id
    point_id = point.id
    style = request_body.style

    async def _generate() -> AsyncIterator[str]:
        parts: list[str] = []
        failure: Exception | None = None
        try:
            async with semaphore:
                async for delta in iterate_in_threadpool(llm.stream(messages)):
                    if not delta:
                        continue
                    parts.append(delta)
                    yield _sse("token", {"text": delta})
        except Exception as exc:
            failure = exc

        content = "".join(parts)
        if failure is None:
            await run_in_threadpool(
                _persist_explanation,
                user_id=user_id,
                knowledge_point_id=point_id,
                agent_id=agent_id,
                style=style,
                content=content,
                status_value="ok",
                error_message=None,
                model=model,
            )
            yield _sse("done", {"chars": len(content)})
            return

        message = _error_message(failure)
        status_value = "partial" if content else "failed"
        await run_in_threadpool(
            _persist_explanation,
            user_id=user_id,
            knowledge_point_id=point_id,
            agent_id=agent_id,
            style=style,
            content=content,
            status_value=status_value,
            error_message=message,
            model=model,
        )
        yield _sse("error", {"message": message})

    return StreamingResponse(
        _generate(), media_type="text/event-stream", headers=_SSE_HEADERS
    )
