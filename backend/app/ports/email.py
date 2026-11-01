"""Outbound email port."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.ports.types import MailMessage, SendResult


@runtime_checkable
class EmailSender(Protocol):
    """Email delivery backend (SMTP, provider API, ...)."""

    def send(self, message: MailMessage) -> SendResult:
        """Deliver ``message`` and report the outcome."""
        ...
