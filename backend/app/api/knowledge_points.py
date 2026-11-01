"""Knowledge-point tree, CRUD and search endpoints.

Every query is scoped to the authenticated user; a foreign or unknown id
answers ``404`` so the API never confirms that another user's object exists.

Tree assembly lives in :mod:`app.services.knowledge_tree` so this module only
loads the allowed slice and serialises it.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession
from app.models import KnowledgePoint, KnowledgeSource, User
from app.services.knowledge_tree import build_tree
from app.services.scope import authorize_resource

router = APIRouter(prefix="/api", tags=["knowledge-points"])

_NOT_FOUND = "资源不存在"

_LIST_DEFAULT_LIMIT = 100
_LIST_MAX_LIMIT = 500
_SEARCH_MAX_LIMIT = 20
_TITLE_MAX_LENGTH = 500


class TreeNode(BaseModel):
    id: str
    title: str
    content: str
    level: int
    mastery_score: float
    children: list[TreeNode] = Field(default_factory=list)


TreeNode.model_rebuild()


class KnowledgePointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str | None
    parent_id: str | None
    title: str
    content: str
    level: int
    sort_order: int
    mastery_score: float
    created_at: datetime
    updated_at: datetime


class KnowledgePointUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=_TITLE_MAX_LENGTH)
    content: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


def _valid_uuid(value: str) -> str:
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise _not_found() from None
    return value


def _load_source(
    db: Session, source_id: str, user: User, *, write: bool = False
) -> KnowledgeSource:
    source = db.get(KnowledgeSource, _valid_uuid(source_id))
    if source is None:
        raise _not_found()
    authorize_resource(
        db,
        user,
        resource_user_id=source.user_id,
        competition_id=source.competition_id,
        write=write,
    )
    return source


def _point_competition_id(db: Session, point: KnowledgePoint) -> str | None:
    if point.source_id is None:
        return None
    source = db.get(KnowledgeSource, point.source_id)
    return source.competition_id if source is not None else None


def _load_point(
    db: Session, point_id: str, user: User, *, write: bool = False
) -> KnowledgePoint:
    point = db.get(KnowledgePoint, _valid_uuid(point_id))
    if point is None:
        raise _not_found()
    authorize_resource(
        db,
        user,
        resource_user_id=point.user_id,
        competition_id=_point_competition_id(db, point),
        write=write,
    )
    return point


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _descendant_ids(db: Session, point: KnowledgePoint) -> list[str]:
    """Collect ``point`` plus every descendant using a recursive CTE.

    ``union`` (not ``union_all``) deduplicates rows, so a corrupt parent cycle
    terminates instead of looping forever.
    """
    tree = (
        select(KnowledgePoint.id)
        .where(
            KnowledgePoint.id == point.id,
            KnowledgePoint.user_id == point.user_id,
        )
        .cte("knowledge_point_descendants", recursive=True)
    )
    tree = tree.union(
        select(KnowledgePoint.id)
        .join(tree, KnowledgePoint.parent_id == tree.c.id)
        .where(KnowledgePoint.user_id == point.user_id)
    )
    return list(db.execute(select(tree.c.id)).scalars().all())


@router.get("/sources/{source_id}/tree", response_model=list[TreeNode])
def get_source_tree(
    source_id: str, db: DbSession, user: CurrentUser
) -> list[dict[str, object]]:
    source = _load_source(db, source_id, user)
    statement = select(KnowledgePoint).where(KnowledgePoint.source_id == source.id)
    if source.competition_id is None:
        statement = statement.where(KnowledgePoint.user_id == user.id)
    rows = list(
        db.execute(statement.order_by(KnowledgePoint.sort_order, KnowledgePoint.title))
        .scalars()
        .all()
    )
    return build_tree(rows)


@router.get("/knowledge-points/search", response_model=list[KnowledgePointOut])
def search_knowledge_points(
    db: DbSession,
    user: CurrentUser,
    q: str = Query(..., min_length=1),
    limit: int = Query(_SEARCH_MAX_LIMIT),
) -> list[KnowledgePoint]:
    capped = max(1, min(limit, _SEARCH_MAX_LIMIT))
    pattern = f"%{_escape_like(q.lower())}%"
    title_match = func.lower(KnowledgePoint.title).like(pattern, escape="\\")
    content_match = func.lower(KnowledgePoint.content).like(pattern, escape="\\")
    title_rank = case((title_match, 0), else_=1)
    statement = (
        select(KnowledgePoint)
        .where(
            KnowledgePoint.user_id == user.id,
            or_(title_match, content_match),
        )
        .order_by(
            title_rank,
            KnowledgePoint.mastery_score.desc(),
            KnowledgePoint.title,
            KnowledgePoint.id,
        )
        .limit(capped)
    )
    return list(db.execute(statement).scalars().all())


@router.get("/knowledge-points", response_model=list[KnowledgePointOut])
def list_knowledge_points(
    db: DbSession,
    user: CurrentUser,
    source_id: str | None = Query(default=None),
    limit: int = Query(_LIST_DEFAULT_LIMIT),
    offset: int = Query(0, ge=0),
) -> list[KnowledgePoint]:
    capped = max(1, min(limit, _LIST_MAX_LIMIT))
    statement = select(KnowledgePoint).where(KnowledgePoint.user_id == user.id)
    if source_id is not None:
        statement = statement.where(
            KnowledgePoint.source_id == _valid_uuid(source_id)
        )
    statement = (
        statement.order_by(
            KnowledgePoint.level,
            KnowledgePoint.sort_order,
            KnowledgePoint.title,
            KnowledgePoint.id,
        )
        .offset(offset)
        .limit(capped)
    )
    return list(db.execute(statement).scalars().all())


@router.get("/knowledge-points/{knowledge_point_id}", response_model=KnowledgePointOut)
def get_knowledge_point(
    knowledge_point_id: str, db: DbSession, user: CurrentUser
) -> KnowledgePoint:
    return _load_point(db, knowledge_point_id, user)


@router.put("/knowledge-points/{knowledge_point_id}", response_model=KnowledgePointOut)
def update_knowledge_point(
    knowledge_point_id: str,
    payload: KnowledgePointUpdate,
    db: DbSession,
    user: CurrentUser,
) -> KnowledgePoint:
    point = _load_point(db, knowledge_point_id, user, write=True)
    changes = payload.model_dump(exclude_unset=True)
    for field_name in ("title", "content", "sort_order"):
        value = changes.get(field_name)
        if value is not None:
            setattr(point, field_name, value)
    db.commit()
    db.refresh(point)
    return point


@router.delete(
    "/knowledge-points/{knowledge_point_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_knowledge_point(
    knowledge_point_id: str, db: DbSession, user: CurrentUser
) -> Response:
    point = _load_point(db, knowledge_point_id, user, write=True)
    doomed = _descendant_ids(db, point)
    if doomed:
        db.execute(
            delete(KnowledgePoint).where(
                KnowledgePoint.user_id == point.user_id,
                KnowledgePoint.id.in_(doomed),
            )
        )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
