"""Public read-only access to stored blobs (reward images, shared assets)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from app.adapters.storage.base import sanitize_key
from app.adapters.storage.factory import build_storage

router = APIRouter(tags=["files"])

_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}


@router.get("/files/{path:path}")
def read_stored_file(path: str) -> Response:
    try:
        key = sanitize_key(path)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在") from None
    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    try:
        data = build_storage().get(key)
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在") from None
    media_type = _CONTENT_TYPES.get(Path(key).suffix.lower(), "application/octet-stream")
    return Response(content=data, media_type=media_type)
