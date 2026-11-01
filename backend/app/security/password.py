"""Password hashing helpers built on bcrypt (via passlib).

bcrypt only consumes the **first 72 bytes** of its input: anything past that
boundary is silently ignored by the algorithm. To keep long passphrases fully
significant (and to avoid two different passwords that share a 72-byte prefix
verifying against each other), every password whose UTF-8 encoding exceeds 72
bytes is first folded with SHA-256 and the resulting 64 character ASCII hex
digest is handed to bcrypt instead. The rule is applied identically in
:func:`hash_password` and :func:`verify_password`, so hashes stay verifiable
across processes.
"""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import bcrypt
from passlib.context import CryptContext

# bcrypt's hard input limit (bytes, not characters).
_BCRYPT_MAX_BYTES = 72

# Cost factor: 12 rounds is ~250 ms per verify on commodity hardware, which is
# the usual "login feels instant but offline cracking stays expensive" point.
_BCRYPT_ROUNDS = 12

# passlib 1.7.4 probes ``bcrypt.__about__.__version__``; bcrypt >= 4.1 dropped
# that attribute, which makes passlib print a "(trapped) error reading bcrypt
# version" warning on first use. Publishing the deprecated metadata keeps the
# logs (and test output) clean without changing behaviour.
if not hasattr(bcrypt, "__about__"):  # pragma: no branch - version dependent
    setattr(  # noqa: B010 - setattr keeps mypy happy about the dynamic attr
        bcrypt,
        "__about__",
        SimpleNamespace(__version__=getattr(bcrypt, "__version__", "4.1.0")),
    )

_pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=_BCRYPT_ROUNDS,
)


def _prepare(password: str) -> str:
    """Return the value bcrypt should actually hash.

    Passwords longer than 72 UTF-8 bytes are replaced by the SHA-256 hex digest
    of their bytes (64 ASCII characters, safely below the limit); shorter ones
    are passed through untouched so stored hashes remain plain bcrypt.
    """
    raw = password.encode("utf-8")
    if len(raw) > _BCRYPT_MAX_BYTES:
        return hashlib.sha256(raw).hexdigest()
    return password


def hash_password(password: str) -> str:
    return _pwd_context.hash(_prepare(password))


def verify_password(password: str, hashed: str | None) -> bool:
    """Check ``password`` against a stored hash.

    Returns ``False`` for malformed/empty hashes instead of raising, so callers
    can treat every failure (unknown user, corrupt row, wrong password) the same
    way at the API boundary.
    """
    if not hashed:
        return False
    try:
        return _pwd_context.verify(_prepare(password), hashed)
    except Exception:  # noqa: BLE001 - malformed hashes must never leak as 500s
        return False
