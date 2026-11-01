"""Resolve which LLM provider serves a task for a given user.

Resolution order:

1. an explicit ``agent_id`` (must belong to the user, otherwise ``404``)
2. the user's ``is_default`` agent
3. the environment-configured provider from :func:`app.adapters.llm.build_llm`

Agent API keys are decrypted at call time and never logged. Stored base URLs
are re-validated before every use so a row written out of band can never turn
into an SSRF probe.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.llm import build_llm
from app.adapters.llm.openai_compatible import OpenAICompatibleLLM
from app.config import settings
from app.models import AgentConfig
from app.ports import LLMProvider
from app.security.crypto import decrypt
from app.services.agent_security import validate_base_url

_NOT_FOUND = "资源不存在"
_BAD_CONFIG = "Agent 配置无效"


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _load_owned_agent(db: Session, *, user_id: str, agent_id: str) -> AgentConfig:
    if not _is_uuid(agent_id):
        raise _not_found()
    agent = db.get(AgentConfig, agent_id)
    if agent is None or str(agent.user_id) != str(user_id):
        raise _not_found()
    return agent


def _default_agent(db: Session, user_id: str) -> AgentConfig | None:
    return db.scalar(
        select(AgentConfig)
        .where(AgentConfig.user_id == user_id, AgentConfig.is_default.is_(True))
        .order_by(AgentConfig.created_at, AgentConfig.id)
        .limit(1)
    )


def _build_agent_llm(agent: AgentConfig) -> OpenAICompatibleLLM | None:
    """Build a provider from a stored config, or ``None`` when it is unusable."""
    try:
        base_url = validate_base_url(agent.base_url)
        api_key = decrypt(agent.api_key_encrypted)
    except ValueError:
        return None
    if not base_url or not agent.model:
        return None
    return OpenAICompatibleLLM(
        base_url=base_url,
        api_key=api_key,
        model=agent.model,
        timeout=settings.agent_request_timeout_seconds,
        temperature=agent.temperature,
    )


def resolve_agent(
    db: Session, *, user_id: str, agent_id: str | None, task_type: str
) -> tuple[LLMProvider, AgentConfig | None]:
    """Return ``(provider, agent_config)``; config is ``None`` for env fallback."""
    if agent_id is not None:
        agent = _load_owned_agent(db, user_id=user_id, agent_id=agent_id)
        llm = _build_agent_llm(agent)
        if llm is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=_BAD_CONFIG
            )
        return llm, agent

    default = _default_agent(db, user_id)
    if default is not None:
        llm = _build_agent_llm(default)
        if llm is not None:
            return llm, default

    return build_llm(settings), None


class AgentResolver:
    """Stateful wrapper around :func:`resolve_agent` bound to one DB session."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def resolve(
        self, task_type: str, *, user_id: str, agent_id: str | None = None
    ) -> LLMProvider:
        llm, _agent = resolve_agent(
            self._db, user_id=user_id, agent_id=agent_id, task_type=task_type
        )
        return llm

    def resolve_with_config(
        self, task_type: str, *, user_id: str, agent_id: str | None = None
    ) -> tuple[LLMProvider, AgentConfig | None]:
        return resolve_agent(
            self._db, user_id=user_id, agent_id=agent_id, task_type=task_type
        )
