"""Log redaction for credentials.

Secrets occasionally reach log records through exception text, request dumps,
or debugging statements. :class:`SecretRedactionFilter` rewrites the formatted
message and any exception text before a handler emits it, so tokens never land
in a log file or the console.
"""

from __future__ import annotations

import logging
import re

_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+"), r"\1****"),
    (re.compile(r"sk-[A-Za-z0-9_\-]{8,}"), "sk-****"),
    (re.compile(r'"?api_key"?\s*[:=]\s*"?[^"\s,}]+', re.IGNORECASE), "api_key=****"),
    (re.compile(r'"?Authorization"?\s*[:=]\s*"[^"]*"', re.IGNORECASE), "Authorization=****"),
    (
        re.compile(
            r"(?i)\b(access_key|secret_key|ak|sk)\b(\s*[:=]\s*|\s+)"
            r"[A-Za-z0-9/+_\-]{32,}"
        ),
        r"\1\2****",
    ),
]


def redact_text(text: str) -> str:
    """Apply every redaction rule to ``text``."""
    redacted = text
    for pattern, replacement in _REDACTIONS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


class SecretRedactionFilter(logging.Filter):
    """Logging filter that scrubs credential-shaped substrings in place."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        record.msg = redact_text(message)
        record.args = ()
        if record.exc_info and not record.exc_text:
            formatter = logging.Formatter()
            record.exc_text = redact_text(formatter.formatException(record.exc_info))
        elif record.exc_text:
            record.exc_text = redact_text(record.exc_text)
        return True


def install_redaction(logger: logging.Logger | None = None) -> None:
    """Attach the redaction filter once; safe to call repeatedly."""
    target = logger if logger is not None else logging.getLogger()
    if not any(isinstance(existing, SecretRedactionFilter) for existing in target.filters):
        target.addFilter(SecretRedactionFilter())
    if logger is None:
        for handler in target.handlers:
            if not any(
                isinstance(existing, SecretRedactionFilter) for existing in handler.filters
            ):
                handler.addFilter(SecretRedactionFilter())
