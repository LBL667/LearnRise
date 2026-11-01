"""Object-storage adapters (local disk, MinIO, Huawei OBS)."""

from __future__ import annotations

from app.adapters.storage.base import MAX_KEY_LENGTH, sanitize_key
from app.adapters.storage.factory import build_storage
from app.adapters.storage.local import LocalStorage
from app.adapters.storage.minio_store import MinioStorage
from app.adapters.storage.obs import ObsStorage

__all__ = [
    "MAX_KEY_LENGTH",
    "LocalStorage",
    "MinioStorage",
    "ObsStorage",
    "build_storage",
    "sanitize_key",
]
