"""Machine-to-machine endpoints for scheduled jobs (no user JWT).

``POST /internal/reminders/run`` is the target of the Huawei Cloud
FunctionGraph timer (see ``docs/functiongraph.md``). The caller is a scheduler,
not a person, so the endpoint deliberately does **not** use the user JWT
scheme. Authentication is an HMAC over the *raw* request body:

.. code-block:: text

    X-Cron-Timestamp: <unix seconds>
    X-Cron-Signature: hex(hmac_sha256(CRON_SIGNATURE_SECRET, f"{timestamp}.{raw_body}"))

The body is read with ``await request.body()`` and signed verbatim; a
re-serialized payload would not match what the caller signed.

Replay protection
-----------------
A signature is a one-shot token: the first valid delivery inside the ±300s
window claims it, and an identical signature arriving again returns
``sent == 0`` without invoking the runner. The reminder orchestrator itself is
idempotent per ``(user, day)``, so even a delivery that races this cache cannot
double-send mail.

Errors
------
* missing / malformed / non-matching signature -> ``401 {"detail": "未认证"}``
* ``|now - timestamp| > 300``                  -> ``401 {"detail": "签名已过期"}``
* reminder orchestration raised                -> ``503 {"detail": "提醒服务暂不可用"}``

The exception text is redacted before logging and never reaches the client.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.config import settings
from app.security.redaction import redact_text
from app.services.email import run_reminders

__all__ = [
    "MAX_CLOCK_SKEW_SECONDS",
    "SIGNATURE_HEADER",
    "TIMESTAMP_HEADER",
    "compute_signature",
    "reset_replay_cache",
    "router",
]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

MAX_CLOCK_SKEW_SECONDS = 300
TIMESTAMP_HEADER = "X-Cron-Timestamp"
SIGNATURE_HEADER = "X-Cron-Signature"

_UNAUTHENTICATED = "未认证"
_SIGNATURE_EXPIRED = "签名已过期"
_SERVICE_UNAVAILABLE = "提醒服务暂不可用"

_replayed: dict[str, float] = {}
_replay_lock = threading.Lock()


class ReminderRunOut(BaseModel):
    ok: bool
    sent: int
    skipped: int
    failed: int
    replay: bool = False


def compute_signature(secret: str, timestamp: int | str, body: bytes) -> str:
    """Return ``hex(hmac_sha256(secret, f"{timestamp}.{body}"))``."""
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def reset_replay_cache() -> None:
    """Drop every claimed signature (tests only)."""
    with _replay_lock:
        _replayed.clear()


def _claim_signature(signature: str, now: float) -> bool:
    """Return ``True`` the first time ``signature`` is seen inside the window."""
    cutoff = now - MAX_CLOCK_SKEW_SECONDS
    with _replay_lock:
        for key in [key for key, seen in _replayed.items() if seen < cutoff]:
            del _replayed[key]
        if signature in _replayed:
            return False
        _replayed[signature] = now
        return True


def _release_signature(signature: str) -> None:
    """Allow a retry after a failed run consumed the token."""
    with _replay_lock:
        _replayed.pop(signature, None)


def _unauthorized(detail: str = _UNAUTHENTICATED) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _parse_timestamp(raw: str | None) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw.strip())
    except (TypeError, ValueError):
        return None


def _signature_matches(signature: str, expected: str) -> bool:
    try:
        return hmac.compare_digest(signature.strip().lower(), expected)
    except TypeError:
        return False


def _as_int(value: object) -> int:
    return value if isinstance(value, int) else 0


@router.post("/reminders/run", response_model=ReminderRunOut)
async def run_reminders_endpoint(request: Request) -> ReminderRunOut:
    """Verify the scheduler signature and run the daily reminder job once."""
    body = await request.body()
    timestamp = _parse_timestamp(request.headers.get(TIMESTAMP_HEADER))
    signature = request.headers.get(SIGNATURE_HEADER)
    secret = settings.cron_signature_secret

    if timestamp is None or not signature or not secret:
        raise _unauthorized()

    if not _signature_matches(signature, compute_signature(secret, timestamp, body)):
        raise _unauthorized()

    now = time.time()
    if abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS:
        raise _unauthorized(_SIGNATURE_EXPIRED)

    if not _claim_signature(signature, now):
        logger.info("internal reminder run ignored: replayed signature")
        return ReminderRunOut(ok=True, sent=0, skipped=0, failed=0, replay=True)

    try:
        summary = run_reminders()
    except Exception as exc:
        _release_signature(signature)
        logger.warning(
            "internal reminder run failed: %s",
            redact_text(f"{type(exc).__name__}: {exc}"),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_SERVICE_UNAVAILABLE,
        ) from None

    logger.info("internal reminder run finished: sent=%s", summary.get("sent"))
    return ReminderRunOut(
        ok=True,
        sent=_as_int(summary.get("sent")),
        skipped=_as_int(summary.get("skipped")),
        failed=_as_int(summary.get("failed")),
    )
