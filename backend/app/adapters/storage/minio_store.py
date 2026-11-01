"""MinIO implementation of the object-storage port (S3-compatible)."""

from __future__ import annotations

from datetime import timedelta
from io import BytesIO

from minio import Minio
from minio.error import S3Error

from app.adapters.storage.base import sanitize_key
from app.config import Settings
from app.config import settings as default_settings
from app.ports import ProviderError

_MISSING_CODES = frozenset({"NoSuchKey", "NoSuchObject", "NoSuchBucket"})


class MinioStorage:
    """Store objects in a MinIO bucket, creating the bucket on first write."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        *,
        secure: bool = False,
    ) -> None:
        if not bucket:
            raise ProviderError("minio bucket not configured")
        self._bucket = bucket
        self._client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        self._bucket_ready = False

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> MinioStorage:
        cfg = settings or default_settings
        return cls(
            cfg.minio_endpoint,
            cfg.minio_access_key,
            cfg.minio_secret_key,
            cfg.minio_bucket,
            secure=cfg.minio_secure,
        )

    def ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        try:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)
        except S3Error as exc:
            raise ProviderError(f"minio bucket setup failed: {exc.code}") from None
        self._bucket_ready = True

    def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        safe = sanitize_key(key)
        self.ensure_bucket()
        try:
            self._client.put_object(
                self._bucket,
                safe,
                BytesIO(data),
                len(data),
                content_type=content_type,
            )
        except S3Error as exc:
            raise ProviderError(f"minio put failed: {exc.code}") from None
        return safe

    def get(self, key: str) -> bytes:
        safe = sanitize_key(key)
        try:
            response = self._client.get_object(self._bucket, safe)
        except S3Error as exc:
            if exc.code in _MISSING_CODES:
                raise FileNotFoundError(safe) from None
            raise ProviderError(f"minio get failed: {exc.code}") from None
        try:
            return response.read()
        except Exception as exc:  # network/stream failure, SDK typed as urllib3
            raise ProviderError(f"minio read failed: {type(exc).__name__}") from None
        finally:
            response.close()
            response.release_conn()

    def sign(self, key: str, expires_seconds: int = 3600) -> str:
        safe = sanitize_key(key)
        if expires_seconds <= 0:
            raise ValueError("expires_seconds must be positive")
        try:
            return self._client.presigned_get_object(
                self._bucket,
                safe,
                expires=timedelta(seconds=expires_seconds),
            )
        except S3Error as exc:
            raise ProviderError(f"minio sign failed: {exc.code}") from None

    def delete(self, key: str) -> bool:
        safe = sanitize_key(key)
        try:
            self._client.stat_object(self._bucket, safe)
        except S3Error as exc:
            if exc.code in _MISSING_CODES:
                return False
            raise ProviderError(f"minio delete failed: {exc.code}") from None
        try:
            self._client.remove_object(self._bucket, safe)
        except S3Error as exc:
            raise ProviderError(f"minio delete failed: {exc.code}") from None
        return True
