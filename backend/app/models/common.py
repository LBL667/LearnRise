"""Shared column mixins for the relational schema.

Primary keys are Postgres ``UUID`` columns surfaced as ``str`` in Python
(``as_uuid=False``) so that JSON payloads and foreign keys stay plain strings.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column


def new_uuid() -> str:
    """Return a fresh UUID4 rendered as a 36 character string."""
    return str(uuid.uuid4())


class UUIDPrimaryKeyMixin:
    """Adds a string-backed UUID primary key generated in Python."""

    id: Mapped[str] = mapped_column(
        PgUUID(as_uuid=False),
        primary_key=True,
        default=new_uuid,
        nullable=False,
    )


class TimestampMixin:
    """Adds ``created_at`` / ``updated_at`` with database-side defaults."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class CreatedAtMixin:
    """Adds a database-side ``created_at`` for append-only tables."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
