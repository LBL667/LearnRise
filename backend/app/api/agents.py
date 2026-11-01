"""Agent configuration CRUD with encrypted keys and SSRF-hardened URLs.

Keys are stored Fernet-encrypted and are never returned: responses only carry
an unreversible mask. A blank or already-masked ``api_key`` on update keeps the
stored ciphertext, so an edit form that never saw the secret cannot destroy it.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.adapters.llm import OpenAICompatibleLLM
from app.config import settings
from app.deps import CurrentUser, DbSession, require_owner
from app.models import AgentConfig, User
from app.ports import ChatMessage
from app.ports.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    UpstreamTimeoutError,
)
from app.security.crypto import decrypt, encrypt, is_masked, mask
from app.services.agent_security import validate_base_url

router = APIRouter(prefix="/api/agents", tags=["agents"])

_BAD_BASE_URL = "base_url 不合法"

# Per-agent concurrency limits, keyed by agent id. Task 13 only *provides* this
# registry; the request path in Task 14 acquires the semaphore before calling
# the provider. Values are sized from ``AgentConfig.max_concurrency``.
_agent_semaphores: dict[str, asyncio.Semaphore] = {}


def get_agent_semaphore(agent_id: str, max_concurrency: int | None = None) -> asyncio.Semaphore:
    """Return the (lazily created) semaphore for ``agent_id``.

    Called from async request handlers; creation does not bind an event loop in
    Python 3.11, so this is safe to use from any loop.
    """
    semaphore = _agent_semaphores.get(agent_id)
    if semaphore is None:
        limit = max_concurrency if max_concurrency and max_concurrency > 0 else 2
        semaphore = asyncio.Semaphore(limit)
        _agent_semaphores[agent_id] = semaphore
    return semaphore


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    provider_type: Literal["openai_compatible"] = "openai_compatible"
    base_url: str = Field(min_length=1, max_length=512)
    api_key: str = ""
    model: str = Field(min_length=1, max_length=128)
    system_prompt: str | None = None
    temperature: float = Field(default=0.7, ge=0, le=2)
    is_default: bool = False


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    provider_type: Literal["openai_compatible"] | None = None
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_key: str | None = None
    model: str | None = Field(default=None, min_length=1, max_length=128)
    system_prompt: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    is_default: bool | None = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    provider_type: str
    base_url: str
    model: str
    system_prompt: str | None
    temperature: float
    is_default: bool
    api_key_masked: str
    created_at: datetime
    updated_at: datetime


class AgentTestResult(BaseModel):
    ok: bool
    message: str


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资源不存在")


def _check_base_url(raw: str) -> str:
    try:
        return validate_base_url(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_BAD_BASE_URL
        ) from None


def _masked_key(agent: AgentConfig) -> str:
    try:
        return mask(decrypt(agent.api_key_encrypted))
    except ValueError:
        return mask("")


def _to_out(agent: AgentConfig) -> AgentOut:
    return AgentOut(
        id=agent.id,
        name=agent.name,
        provider_type=agent.provider_type,
        base_url=agent.base_url,
        model=agent.model,
        system_prompt=agent.system_prompt,
        temperature=agent.temperature,
        is_default=agent.is_default,
        api_key_masked=_masked_key(agent),
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


def _load_owned(db: Session, agent_id: str, user: User) -> AgentConfig:
    try:
        UUID(agent_id)
    except ValueError:
        raise _not_found() from None
    agent = db.get(AgentConfig, agent_id)
    if agent is None:
        raise _not_found()
    require_owner(agent.user_id, user)
    return agent


def _clear_other_defaults(db: Session, user_id: str, keep_id: str | None) -> None:
    stmt = update(AgentConfig).where(
        AgentConfig.user_id == user_id,
        AgentConfig.is_default.is_(True),
    )
    if keep_id is not None:
        stmt = stmt.where(AgentConfig.id != keep_id)
    db.execute(stmt.values(is_default=False))


def _promote_default_if_needed(db: Session, user_id: str) -> None:
    has_default = db.scalar(
        select(func.count())
        .select_from(AgentConfig)
        .where(AgentConfig.user_id == user_id, AgentConfig.is_default.is_(True))
    )
    if has_default:
        return
    successor = db.scalar(
        select(AgentConfig)
        .where(AgentConfig.user_id == user_id)
        .order_by(AgentConfig.created_at, AgentConfig.id)
        .limit(1)
    )
    if successor is not None:
        successor.is_default = True


def _apply_update(db: Session, agent: AgentConfig, payload: AgentUpdate) -> None:
    updates = payload.model_dump(exclude_unset=True)

    if "base_url" in updates and updates["base_url"] is not None:
        updates["base_url"] = _check_base_url(updates["base_url"])

    if "api_key" in updates:
        raw_key = updates.pop("api_key")
        if raw_key is not None and raw_key != "" and not is_masked(raw_key):
            agent.api_key_encrypted = encrypt(raw_key)

    is_default = updates.pop("is_default", None)
    for field, value in updates.items():
        if value is not None:
            setattr(agent, field, value)

    if is_default is True:
        _clear_other_defaults(db, agent.user_id, keep_id=agent.id)
        agent.is_default = True
    elif is_default is False:
        agent.is_default = False


@router.get("", response_model=list[AgentOut])
def list_agents(db: DbSession, user: CurrentUser) -> list[AgentOut]:
    agents = db.scalars(
        select(AgentConfig)
        .where(AgentConfig.user_id == user.id)
        .order_by(AgentConfig.created_at, AgentConfig.id)
    ).all()
    return [_to_out(agent) for agent in agents]


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
def create_agent(payload: AgentCreate, db: DbSession, user: CurrentUser) -> AgentOut:
    base_url = _check_base_url(payload.base_url)

    existing = db.scalar(
        select(func.count()).select_from(AgentConfig).where(AgentConfig.user_id == user.id)
    )
    make_default = payload.is_default or not existing
    if make_default:
        _clear_other_defaults(db, user.id, keep_id=None)

    agent = AgentConfig(
        user_id=user.id,
        name=payload.name,
        provider_type=payload.provider_type,
        base_url=base_url,
        api_key_encrypted=encrypt(payload.api_key),
        model=payload.model,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
        is_default=make_default,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _to_out(agent)


@router.get("/{agent_id}", response_model=AgentOut)
def read_agent(agent_id: str, db: DbSession, user: CurrentUser) -> AgentOut:
    return _to_out(_load_owned(db, agent_id, user))


@router.put("/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: str, payload: AgentUpdate, db: DbSession, user: CurrentUser
) -> AgentOut:
    agent = _load_owned(db, agent_id, user)
    _apply_update(db, agent, payload)
    db.commit()
    db.refresh(agent)
    return _to_out(agent)


@router.patch("/{agent_id}/default", response_model=AgentOut)
def set_default_agent(agent_id: str, db: DbSession, user: CurrentUser) -> AgentOut:
    agent = _load_owned(db, agent_id, user)
    _clear_other_defaults(db, user.id, keep_id=agent.id)
    agent.is_default = True
    db.commit()
    db.refresh(agent)
    return _to_out(agent)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: str, db: DbSession, user: CurrentUser) -> None:
    agent = _load_owned(db, agent_id, user)
    was_default = agent.is_default
    db.delete(agent)
    db.flush()
    if was_default:
        _promote_default_if_needed(db, user.id)
    db.commit()


@router.post("/{agent_id}/test", response_model=AgentTestResult)
def test_agent(agent_id: str, db: DbSession, user: CurrentUser) -> AgentTestResult:
    agent = _load_owned(db, agent_id, user)

    # Re-validate the stored URL: a row written before this gate existed (or
    # tampered with out of band) must never become an SSRF probe.
    try:
        base_url = validate_base_url(agent.base_url)
    except ValueError:
        return AgentTestResult(ok=False, message=_BAD_BASE_URL)

    try:
        api_key = decrypt(agent.api_key_encrypted)
    except ValueError:
        return AgentTestResult(ok=False, message="密钥无效")

    llm = OpenAICompatibleLLM(
        base_url=base_url,
        api_key=api_key,
        model=agent.model,
        timeout=settings.agent_request_timeout_seconds,
    )
    try:
        llm.chat([ChatMessage(role="user", content="ping")], max_tokens=1)
    except ProviderAuthError:
        return AgentTestResult(ok=False, message="模型鉴权失败")
    except ProviderRateLimitError:
        return AgentTestResult(ok=False, message="上游限流，请稍后重试")
    except UpstreamTimeoutError:
        return AgentTestResult(ok=False, message="连接超时")
    except ProviderError:
        return AgentTestResult(ok=False, message="连接失败")
    except Exception:
        return AgentTestResult(ok=False, message="连接失败")
    return AgentTestResult(ok=True, message="连接成功")
