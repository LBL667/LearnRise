"""Opt-in competition scope and the permission matrix.

Data ownership stays personal by default: every resource carries a nullable
``competition_id`` and ``NULL`` means "only the owner can see it". This module
adds the *opt-in* shared scope that is activated as soon as a resource is
attached to a competition. The shared scope is resolved from
``competition_members`` and never widens personal access.

Permission matrix
-----------------
``competition_id IS NULL`` (personal, unchanged behaviour)
    * owner                 -> read / write / manage
    * anybody else          -> ``404`` ``资源不存在`` (via :func:`require_owner`)

``competition_id`` set (shared)
    * ``leader``            -> read / write / manage
    * ``member``            -> read / write
    * ``viewer``            -> read
    * non-member            -> ``404`` ``资源不存在`` (existence is never confirmed)
    * member lacking a capability (e.g. viewer writing) -> ``403``
      ``没有权限执行该操作``; the member already knows the resource exists, so
      answering ``403`` does not leak anything.

The ``404``-not-``403`` rule is therefore preserved exactly where it matters:
a stranger can never distinguish "missing" from "belongs to somebody else".

Files whose ownership decision now goes through this module
-----------------------------------------------------------
* ``backend/app/api/sources.py`` — ``_load_source`` (read / reprocess write)
  and ``_load_job`` (job inherits its source's scope).
* ``backend/app/api/knowledge_points.py`` — ``_load_source`` /
  ``_load_point`` (read, update, delete). The tree now reads every point of a
  shared source while personal sources keep the ``user_id`` filter.
* ``backend/app/api/review.py`` — ``_load_point`` when attaching a point to a
  personal card (cards themselves remain personal).
* ``backend/app/api/explain.py`` — ``_load_knowledge_point``.
* ``backend/app/api/assistant.py`` — conversation membership checks reuse
  :func:`resolve_scope` while conversations stay owned by their creator.
* ``backend/app/api/trial.py`` — question visibility reuses
  :func:`resolve_scope` instead of a hand-rolled membership probe.

Files reviewed and deliberately left personal-only (no ``competition_id``
column): ``agents.py`` (``agent_configs``), ``internal.py``, ``auth.py``,
``files.py``, ``dashboard.py``. Service-level personal filters in
``app/services/{quiz,answer,notes}.py`` also remain owner-scoped because their
rows are personal study artefacts; the scope layer never mixes personal rows
into a shared query.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import require_owner
from app.models import CompetitionMember, User

__all__ = [
    "FORBIDDEN_DETAIL",
    "NOT_FOUND_DETAIL",
    "Scope",
    "authorize_resource",
    "resolve_scope",
]

NOT_FOUND_DETAIL = "资源不存在"
FORBIDDEN_DETAIL = "没有权限执行该操作"

ScopeKind = Literal["personal", "shared"]
MemberRole = Literal["leader", "member", "viewer"]

_LEADER = "leader"
_MEMBER = "member"


@dataclass(frozen=True, slots=True)
class Scope:
    """Resolved permission view for one user against one competition scope."""

    kind: ScopeKind
    role: str | None
    can_read: bool
    can_write: bool
    can_manage: bool
    competition_id: str | None = None

    def require_read(self) -> None:
        """Raise ``404`` when the user may not even know the resource exists."""
        if not self.can_read:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL
            )

    def require_write(self) -> None:
        """Raise ``404`` for strangers and ``403`` for read-only members."""
        self.require_read()
        if not self.can_write:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAIL
            )

    def require_manage(self) -> None:
        """Raise ``404`` for strangers and ``403`` for non-managers."""
        self.require_read()
        if not self.can_manage:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAIL
            )


def _personal_scope() -> Scope:
    return Scope(
        kind="personal",
        role=None,
        can_read=True,
        can_write=True,
        can_manage=True,
        competition_id=None,
    )


def _user_id(user: User | str) -> str:
    return str(getattr(user, "id", user))


def resolve_scope(db: Session, user: User | str, competition_id: str | None) -> Scope:
    """Resolve the permission matrix for ``user`` in ``competition_id``.

    ``competition_id is None`` returns the personal scope. The caller still has
    to enforce the owner check with :func:`require_owner`; this mirrors every
    pre-existing endpoint byte-for-byte. A non-``NULL`` scope requires an actual
    membership row and raises ``404`` for non-members.
    """

    if competition_id is None:
        return _personal_scope()

    role = db.scalar(
        select(CompetitionMember.role).where(
            CompetitionMember.competition_id == competition_id,
            CompetitionMember.user_id == _user_id(user),
        )
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL
        )

    if role == _LEADER:
        return Scope("shared", role, True, True, True, competition_id)
    if role == _MEMBER:
        return Scope("shared", role, True, True, False, competition_id)
    # Unknown/legacy roles degrade to the least-privileged read-only viewer.
    return Scope("shared", role, True, False, False, competition_id)


def authorize_resource(
    db: Session,
    user: User,
    *,
    resource_user_id: str,
    competition_id: str | None,
    write: bool = False,
    manage: bool = False,
) -> Scope:
    """Authorize access to a resource that belongs to ``resource_user_id``.

    Personal resources (``competition_id is None``) keep the exact legacy
    behaviour of :func:`require_owner`: the id comparison and the ``404``
    detail are unchanged. Shared resources are checked against the membership
    matrix and raise ``404`` (stranger) or ``403`` (member without capability).
    """

    if competition_id is None:
        require_owner(resource_user_id, user)
        return _personal_scope()

    scope = resolve_scope(db, user, competition_id)
    if manage:
        scope.require_manage()
    elif write:
        scope.require_write()
    else:
        scope.require_read()
    return scope
