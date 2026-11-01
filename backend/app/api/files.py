"""Read-only access to stored blobs.

``rewards/`` keys are reward images embedded in competition cards and stay
public. Every other key belongs to a knowledge source and is only served to its
owner (first path segment is the user id) or to a member of the competition the
source is shared with.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.storage.base import sanitize_key
from app.adapters.storage.factory import build_storage
from app.deps import DbSession, OptionalUser
from app.models import KnowledgeSource, User
from app.services.scope import resolve_scope

router = APIRouter(tags=["files"])

PUBLIC_PREFIXES = ("rewards/",)

_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未认证",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _may_read(db: Session, key: str, user: User | None) -> bool:
    if key.startswith(PUBLIC_PREFIXES):
        return True
    if user is None:
        raise _unauthorized()
    if key.split("/", 1)[0] == str(user.id):
        return True
    competition_id = db.scalar(
        select(KnowledgeSource.competition_id).where(
            KnowledgeSource.storage_key == key
        )
    )
    if competition_id is None:
        return False
    resolve_scope(db, user, competition_id)
    return True


@router.get("/files/{path:path}")
def read_stored_file(path: str, db: DbSession, user: OptionalUser) -> Response:
    try:
        key = sanitize_key(path)
    except ValueError:
        raise _not_found() from None
    if not key or not _may_read(db, key, user):
        raise _not_found()
    try:
        data = build_storage().get(key)
    except Exception:
        raise _not_found() from None
    media_type = _CONTENT_TYPES.get(Path(key).suffix.lower(), "application/octet-stream")
    return Response(content=data, media_type=media_type)
