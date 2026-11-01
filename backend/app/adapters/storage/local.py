"""Local-filesystem object storage used by the ``local`` provider profile.

Objects live at ``<root>/<key>`` where *root* defaults to
``settings.storage_local_root`` (``var/storage``). Reads missing objects raise
:class:`FileNotFoundError`; deletes of missing objects return ``False``.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from app.adapters.storage.base import sanitize_key
from app.config import Settings
from app.config import settings as default_settings

_MAX_SEGMENT = 255


class LocalStorage:
    """Store objects as plain files under a single root directory."""

    def __init__(
        self,
        root: str | os.PathLike[str] | None = None,
        *,
        settings: Settings | None = None,
    ) -> None:
        cfg = settings or default_settings
        base = Path(root) if root is not None else Path(cfg.storage_local_root)
        self._root = base.resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._app_base_url = cfg.app_base_url.rstrip("/")

    @property
    def root(self) -> Path:
        return self._root

    def _resolve(self, key: str) -> tuple[str, Path]:
        safe = sanitize_key(key)
        if any(len(segment) > _MAX_SEGMENT for segment in safe.split("/")):
            raise ValueError("storage key segment too long for the local filesystem")
        target = (self._root / safe).resolve()
        if not target.is_relative_to(self._root):
            raise ValueError("storage key escapes the storage root")
        return safe, target

    def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        safe, target = self._resolve(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._assert_contained(target)
        fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, target)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp_name)
            raise
        return safe

    def get(self, key: str) -> bytes:
        _, target = self._resolve(key)
        return target.read_bytes()

    def sign(self, key: str, expires_seconds: int = 3600) -> str:
        safe = sanitize_key(key)
        # NOTE: local storage has no signing/expiry semantics. FastAPI will serve
        # GET /files/{path} from the storage root in a later task, so the URL is
        # static and expires_seconds is accepted for interface parity only.
        del expires_seconds
        return f"{self._app_base_url}/files/{safe}"

    def delete(self, key: str) -> bool:
        _, target = self._resolve(key)
        try:
            target.unlink()
        except FileNotFoundError:
            return False
        return True

    def _assert_contained(self, target: Path) -> None:
        if not target.resolve().is_relative_to(self._root):
            raise ValueError("storage key escapes the storage root")
