"""Public reward-image upload for competitions."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, status
from pydantic import BaseModel

from app.adapters.storage.base import sanitize_key
from app.api.errors import CodedHTTPException
from app.deps import CurrentUser
from app.services.ingest import save_upload

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

MAX_REWARD_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_REWARD_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
TOO_LARGE_DETAIL = "奖励图片不能超过 2MB"
UNSUPPORTED_DETAIL = "奖励图片只支持 png / jpg / webp"


class RewardImageOut(BaseModel):
    url: str
    key: str


@router.post(
    "/reward-image", response_model=RewardImageOut, status_code=status.HTTP_201_CREATED
)
async def upload_reward_image(file: UploadFile, user: CurrentUser) -> RewardImageOut:
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    suffix = ALLOWED_REWARD_IMAGE_TYPES.get(content_type)
    if suffix is None:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise CodedHTTPException(
                status_code=415, detail=UNSUPPORTED_DETAIL, code="UNSUPPORTED_MEDIA_TYPE"
            )
        suffix = ".jpg" if suffix == ".jpeg" else suffix

    data = await file.read(MAX_REWARD_IMAGE_BYTES + 1)
    if len(data) > MAX_REWARD_IMAGE_BYTES:
        raise CodedHTTPException(
            status_code=413, detail=TOO_LARGE_DETAIL, code="PAYLOAD_TOO_LARGE"
        )
    if not data:
        raise CodedHTTPException(
            status_code=422, detail="奖励图片为空", code="VALIDATION_ERROR"
        )

    key = sanitize_key(f"rewards/{user.id}/{uuid.uuid4().hex}{suffix}")
    save_upload(key, data, content_type or "image/png")
    from app.adapters.storage.factory import build_storage

    return RewardImageOut(url=build_storage().sign(key), key=key)
