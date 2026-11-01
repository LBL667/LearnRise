"""Huawei Cloud OBS implementation of the object-storage port.

``esdk-obs-python`` is an optional extra (``pip install .[huawei]``). It is
imported lazily so this module — and the application — imports cleanly on a
machine without the SDK; every entry point then raises :class:`ProviderError`.
"""

from __future__ import annotations

from typing import Any

from app.adapters.storage.base import sanitize_key
from app.config import Settings
from app.config import settings as default_settings
from app.ports import ProviderError


class ObsStorage:
    """Store objects in a Huawei OBS bucket."""

    def __init__(
        self,
        access_key_id: str,
        secret_access_key: str,
        endpoint: str,
        bucket: str,
        *,
        client: Any | None = None,
    ) -> None:
        if not bucket:
            raise ProviderError("obs bucket not configured")
        self._bucket = bucket
        self._client: Any = client or self._build_client(
            access_key_id, secret_access_key, endpoint
        )

    @staticmethod
    def _build_client(access_key_id: str, secret_access_key: str, endpoint: str) -> Any:
        try:
            import obs
        except ImportError:
            raise ProviderError("obs sdk not installed") from None
        if not endpoint:
            raise ProviderError("obs endpoint not configured")
        return obs.ObsClient(
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            server=endpoint,
        )

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> ObsStorage:
        cfg = settings or default_settings
        return cls(
            cfg.obs_access_key_id,
            cfg.obs_secret_access_key,
            cfg.obs_endpoint,
            cfg.obs_bucket,
        )

    def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        safe = sanitize_key(key)
        try:
            self._client.putContent(
                self._bucket,
                safe,
                data,
                headers={"Content-Type": content_type},
            )
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"obs put failed: {type(exc).__name__}") from None
        return safe

    def get(self, key: str) -> bytes:
        safe = sanitize_key(key)
        try:
            response = self._client.getObject(self._bucket, safe, loadStreamInMemory=True)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"obs get failed: {type(exc).__name__}") from None
        status = int(getattr(response, "status", 0))
        if status == 404:
            raise FileNotFoundError(safe)
        if status >= 300:
            raise ProviderError(f"obs get failed: status {status}")
        body = getattr(response, "body", None)
        buffer = getattr(body, "buffer", None)
        if buffer is None:
            read = getattr(body, "read", None)
            if callable(read):
                buffer = read()
        if isinstance(buffer, bytes):
            return buffer
        if isinstance(buffer, bytearray):
            return bytes(buffer)
        raise ProviderError("obs get returned no payload")

    def sign(self, key: str, expires_seconds: int = 3600) -> str:
        safe = sanitize_key(key)
        if expires_seconds <= 0:
            raise ValueError("expires_seconds must be positive")
        try:
            return str(
                self._client.createSignedUrl(
                    "GET",
                    self._bucket,
                    safe,
                    expires=expires_seconds,
                )
            )
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"obs sign failed: {type(exc).__name__}") from None

    def delete(self, key: str) -> bool:
        safe = sanitize_key(key)
        try:
            response = self._client.deleteObject(self._bucket, safe)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"obs delete failed: {type(exc).__name__}") from None
        status = int(getattr(response, "status", 0))
        if status == 404:
            return False
        if status >= 300:
            raise ProviderError(f"obs delete failed: status {status}")
        return True
