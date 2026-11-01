"""Shared helpers for the object-storage adapters.

Every backend funnels its keys through :func:`sanitize_key` before touching a
filesystem, an SDK, or a network API. Keys are intentionally restricted to an
ASCII subset so a key generated on one provider stays valid on the others
(local disk, MinIO, Huawei OBS) and can also be embedded in a URL path.
"""

from __future__ import annotations

import re

#: Hard ceiling on key length. Object stores accept more, but a 1 KiB key is far
#: beyond anything the application needs and keeps filesystem paths sane.
MAX_KEY_LENGTH = 1024

#: Allowed characters: letters, digits, ``/`` (hierarchy), ``_``, ``.``, ``-``.
_ALLOWED_KEY = re.compile(r"^[A-Za-z0-9/_.-]+$")

_PREVIEW_CHARS = 64


def _preview(key: str) -> str:
    """Return a short, safe excerpt of *key* for an error message.

    Never echoes more than :data:`_PREVIEW_CHARS` characters so a hostile or
    gigantic key cannot be reflected back into logs in full.
    """

    return key[:_PREVIEW_CHARS]


def sanitize_key(key: str) -> str:
    """Validate an object key and return it unchanged.

    Rules (all violations raise :class:`ValueError`):

    * non-empty :class:`str`;
    * at most :data:`MAX_KEY_LENGTH` characters;
    * only ``[A-Za-z0-9/_.-]``, i.e. ASCII only - callers must slugify any
      human-facing name before storing it;
    * no NUL byte and no backslash;
    * relative: no leading ``/``;
    * no empty, ``.`` or ``..`` path segment, and no segment starting with
      ``.`` (dotfiles are reserved for adapter internals such as temp files).
    """

    if not isinstance(key, str) or not key:
        raise ValueError("storage key must be a non-empty string")
    if len(key) > MAX_KEY_LENGTH:
        raise ValueError(f"storage key too long ({len(key)} > {MAX_KEY_LENGTH})")
    if "\x00" in key:
        raise ValueError("storage key must not contain NUL bytes")
    if "\\" in key:
        raise ValueError("storage key must not contain backslashes")
    if key.startswith("/"):
        raise ValueError("storage key must be relative, not absolute")
    if not _ALLOWED_KEY.match(key):
        raise ValueError(
            f"storage key contains disallowed characters: {_preview(key)!r}"
        )
    for segment in key.split("/"):
        if segment in ("", "."):
            raise ValueError("storage key must not contain empty or '.' segments")
        if segment == "..":
            raise ValueError("storage key must not contain '..' segments")
        if segment.startswith("."):
            raise ValueError("storage key segments must not start with '.'")
    return key
