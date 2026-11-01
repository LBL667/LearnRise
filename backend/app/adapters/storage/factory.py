"""Select an object-storage backend from application settings."""

from __future__ import annotations

from app.adapters.storage.local import LocalStorage
from app.adapters.storage.minio_store import MinioStorage
from app.adapters.storage.obs import ObsStorage
from app.config import Settings
from app.config import settings as default_settings
from app.ports import ObjectStorage


def build_storage(settings: Settings | None = None) -> ObjectStorage:
    """Return the backend named by ``settings.storage_provider``.

    Supported values are ``local`` (default), ``minio`` and ``obs``. Anything
    else raises :class:`ValueError` so a typo fails fast at startup instead of
    silently falling back to local disk.
    """

    cfg = settings or default_settings
    provider = (cfg.storage_provider or "local").strip().lower()
    if provider == "local":
        return LocalStorage(settings=cfg)
    if provider == "minio":
        return MinioStorage.from_settings(cfg)
    if provider == "obs":
        return ObsStorage.from_settings(cfg)
    raise ValueError(f"unknown storage provider: {provider!r}")
