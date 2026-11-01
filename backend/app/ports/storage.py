"""Object storage port."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class ObjectStorage(Protocol):
    """Blob storage backend (local disk, MinIO, Huawei OBS, ...)."""

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Store ``data`` under ``key`` and return the stored key."""
        ...

    def get(self, key: str) -> bytes:
        """Read the object stored under ``key``."""
        ...

    def sign(self, key: str, expires_seconds: int = 3600) -> str:
        """Return a time-limited download URL for ``key``."""
        ...

    def delete(self, key: str) -> bool:
        """Delete ``key``; return ``True`` when the object was removed."""
        ...
