"""Symmetric encryption and secret masking helpers.

Key derivation rule: the configured ``agent_secret_key`` is used verbatim when
it is a valid 32-byte urlsafe-base64 Fernet key; otherwise it is hashed with
SHA-256 and re-encoded to urlsafe base64, which always yields a valid key.
Plaintext and tokens never appear in any exception message.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

_MASK_BODY = "****"
_SHORT_SECRET_MAX = 8
_TRAILING_KEEP = 4
_SK_PREFIX = "sk-"
_GENERIC_PREFIX_LEN = 2
_MASKED_RE = re.compile(r"^(?:.{0,3})\*{4}.{4}$", re.DOTALL)


def _derive_key(raw: str) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(raw.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeError):
        decoded = b""
    if len(decoded) == 32:
        return raw.encode("ascii")
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def get_fernet() -> Fernet:
    """Return a Fernet built from the configured agent secret key."""
    return Fernet(_derive_key(settings.agent_secret_key))


def encrypt(plaintext: str) -> str:
    """Encrypt ``plaintext`` into a Fernet token string."""
    return get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt a Fernet token, raising ``ValueError`` without echoing it."""
    try:
        return get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        raise ValueError("invalid encryption token") from None


def mask(secret: str) -> str:
    """Return a display-only mask that cannot be reversed into the secret."""
    if not secret or len(secret) < _SHORT_SECRET_MAX:
        return _MASK_BODY
    prefix = _SK_PREFIX if secret.startswith(_SK_PREFIX) else secret[:_GENERIC_PREFIX_LEN]
    return f"{prefix}{_MASK_BODY}{secret[-_TRAILING_KEEP:]}"


def is_masked(value: str) -> bool:
    """Return ``True`` when ``value`` has the shape produced by :func:`mask`."""
    if value == _MASK_BODY:
        return True
    return bool(_MASKED_RE.match(value))
