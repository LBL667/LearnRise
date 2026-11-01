"""Seed fixtures for local development and tests.

Importable without a database: no connection is opened at import time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

DEMO_USER: dict[str, str] = {
    "email": "demo@example.com",
    "password": "demo1234",
    "display_name": "演示用户",
}

SAMPLE_SOURCE: dict[str, Any] = {
    "title": "计算机网络 第1章",
    "filename": "lec01.pdf",
    "content_type": "application/pdf",
    "size_bytes": 1024 * 1024,
    "storage_key": "samples/lec01.pdf",
    "status": "ready",
}


def demo_user_kwargs() -> dict[str, Any]:
    """Keyword arguments for ``User`` with a real bcrypt hash of the demo password."""
    from app.security.password import hash_password

    return {
        "email": DEMO_USER["email"],
        "password_hash": hash_password(DEMO_USER["password"]),
        "display_name": DEMO_USER["display_name"],
    }


def seed(db: Session) -> dict[str, Any]:
    """Insert the demo user and sample source idempotently, returning both."""
    from sqlalchemy import select

    from app.models import KnowledgeSource, User

    user = db.scalar(select(User).where(User.email == DEMO_USER["email"]))
    if user is None:
        user = User(**demo_user_kwargs())
        db.add(user)
        db.flush()

    source = db.scalar(
        select(KnowledgeSource).where(
            KnowledgeSource.user_id == user.id,
            KnowledgeSource.title == SAMPLE_SOURCE["title"],
        )
    )
    if source is None:
        source = KnowledgeSource(user_id=user.id, **SAMPLE_SOURCE)
        db.add(source)
        db.flush()

    return {"user": user, "source": source}
