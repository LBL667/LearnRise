"""Huawei Cloud FunctionGraph timer adapter (standard library only).

The function never touches RDS, Redis or OSS: it only forwards a timer tick to
the backend's signed internal endpoint and returns a small JSON summary. That
keeps the function package dependency-free (``zip handler.py`` and upload) and
sidesteps the VPC/egress trap described in ``docs/functiongraph.md``.

Entry point: ``handler.handler(event, context)``.

Timer events are recognised by any of these shapes::

    {"trigger_type": "TIMER", ...}   # FunctionGraph timer v1
    {"event_type": "Timer", ...}     # documented alternative
    {"Type": "Timer", ...}           # legacy/console variant

Anything else returns ``{"ok": False, "reason": "not a timer trigger"}`` so a
mistaken HTTP/test invocation cannot fire the reminder job.

Required environment variables:

``INTERNAL_REMINDER_URL``
    Absolute URL of ``POST /internal/reminders/run``.
``CRON_SIGNATURE_SECRET``
    Shared secret; must equal the backend's ``CRON_SIGNATURE_SECRET``.

The secret and the signature are never logged or echoed back.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

TIMEOUT_SECONDS = 60
MAX_BODY_CHARS = 500
EMPTY_BODY = b"{}"

__all__ = ["TIMEOUT_SECONDS", "compute_signature", "handler", "is_timer_event"]


def compute_signature(secret: str, timestamp: int | str, body: bytes) -> str:
    """Mirror of ``app.api.internal.compute_signature`` (kept import-free)."""
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def is_timer_event(event: Any) -> bool:
    """Return True when ``event`` carries one of the accepted timer markers."""
    if not isinstance(event, dict):
        return False
    return (
        event.get("trigger_type") == "TIMER"
        or event.get("event_type") == "Timer"
        or event.get("Type") == "Timer"
    )


def _truncate(payload: bytes) -> str:
    return payload.decode("utf-8", "replace")[:MAX_BODY_CHARS]


def handler(event: Any, context: Any = None) -> dict[str, Any]:
    """Trigger the reminder run when called by a timer; otherwise do nothing."""
    if not is_timer_event(event):
        return {"ok": False, "reason": "not a timer trigger"}

    url = os.environ.get("INTERNAL_REMINDER_URL", "").strip()
    secret = os.environ.get("CRON_SIGNATURE_SECRET", "")
    if not url or not secret:
        return {"ok": False, "reason": "missing configuration"}

    timestamp = int(time.time())
    request = urllib.request.Request(
        url,
        data=EMPTY_BODY,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Cron-Timestamp": str(timestamp),
            "X-Cron-Signature": compute_signature(secret, timestamp, EMPTY_BODY),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status_code = int(response.getcode())
            body = _truncate(response.read())
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status": int(exc.code), "body": _truncate(exc.read())}
    except Exception as exc:
        return {"ok": False, "reason": type(exc).__name__}

    return {"ok": True, "status": status_code, "body": body}


if __name__ == "__main__":
    print(json.dumps(handler({"trigger_type": "TIMER"}, None), ensure_ascii=False))
