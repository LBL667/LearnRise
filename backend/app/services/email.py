"""Daily review reminders: email delivery plus the idempotent run orchestrator.

The public surface is deliberately small:

* :func:`send_reminder_email` renders and delivers one HTML + plain-text mail
  over SMTP (SSL by default, three attempts with backoff) and returns a
  :class:`~app.ports.types.SendResult` instead of raising.
* :func:`run_reminders` is the once-a-day orchestrator used by the standalone
  APScheduler process. It finds every user with at least one due card, claims
  the day in ``email_reminders`` with ``ON CONFLICT DO NOTHING``, sends one
  mail, and records ``sent`` / ``failed``.

Idempotency
-----------
Two layers protect against duplicate mail:

1. A PostgreSQL **session** advisory lock (``pg_try_advisory_lock``) held on one
   connection for the whole run. A second concurrent worker logs
   ``skipped: lock held`` and does nothing.
2. ``email_reminders`` has ``UNIQUE (user_id, send_date)``. The row is claimed
   with ``ON CONFLICT DO NOTHING`` *before* sending, so even if two processes
   slip past the lock the loser never sends.

In-app fallback
---------------
When SMTP is not configured the row is still written (status ``failed``,
``error='smtp not configured'``) so the dashboard can render the reminder from
``email_reminders`` without a mail server.

Secrets
-------
The SMTP password is never logged; exception text passes through
:func:`app.security.redaction.redact_text` and the configured password is
replaced explicitly before it reaches a log record or the ``error`` column.
"""

from __future__ import annotations

import logging
import smtplib
import time
from datetime import date, datetime
from email.message import EmailMessage
from email.utils import make_msgid
from zoneinfo import ZoneInfo

from jinja2 import Environment
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, engine
from app.models import EmailReminder, ReviewCard, User
from app.ports.types import SendResult
from app.security.redaction import redact_text

__all__ = [
    "REMINDER_ADVISORY_LOCK_KEY",
    "run_reminders",
    "send_reminder_email",
]

logger = logging.getLogger(__name__)

#: Arbitrary 64-bit key identifying the reminder-worker advisory lock.
REMINDER_ADVISORY_LOCK_KEY = 0x5A17_2024

_MAX_ATTEMPTS = 3
_RETRY_BACKOFF: tuple[float, ...] = (0.5, 1.0)
_SMTP_TIMEOUT_SECONDS = 20
_PREVIEW_LIMIT = 5
_SMTP_NOT_CONFIGURED = "smtp not configured"

_HTML_TEMPLATE = Environment(autoescape=True, trim_blocks=True, lstrip_blocks=True).from_string(
    """<!doctype html>
<html lang="zh-CN">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <p>{{ display_name }}，你好：</p>
    <p>今日有 <strong>{{ due_count }}</strong> 张卡片待复习。</p>
    {% if previews %}
    <p>待复习题目：</p>
    <ul>
      {% for question in previews %}
      <li>{{ question }}</li>
      {% endfor %}
    </ul>
    {% endif %}
    <p><a href="{{ review_url }}">开始复习</a></p>
    <p style="color: #888; font-size: 12px;">LearnRise · 每日复习提醒</p>
  </body>
</html>
"""
)

_TEXT_TEMPLATE = Environment(
    autoescape=False, trim_blocks=True, lstrip_blocks=True
).from_string(
    """{{ display_name }}，你好：

今日有 {{ due_count }} 张卡片待复习。
{% if previews %}
待复习题目：
{% for question in previews %}- {{ question }}
{% endfor %}
{% endif %}
开始复习：{{ review_url }}

LearnRise · 每日复习提醒
"""
)


def _redact_error(exc: BaseException) -> str:
    message = redact_text(f"{type(exc).__name__}: {exc}")
    password = settings.smtp_password
    if password:
        message = message.replace(password, "****")
    return message


def _sender_address() -> str:
    return settings.smtp_from or settings.smtp_user or f"noreply@{settings.smtp_host}"


def _render_message(user: User, due_count: int, previews: list[str]) -> tuple[str, str, str]:
    display_name = user.display_name or user.email
    review_url = f"{settings.app_base_url.rstrip('/')}/review"
    context = {
        "display_name": display_name,
        "due_count": due_count,
        "previews": previews,
        "review_url": review_url,
    }
    subject = f"今日有 {due_count} 张卡片待复习"
    return subject, _HTML_TEMPLATE.render(**context), _TEXT_TEMPLATE.render(**context)


def send_reminder_email(
    user: User,
    due_count: int,
    previews: list[str],
    *,
    use_ssl: bool | None = None,
) -> SendResult:
    """Deliver one reminder to ``user``; never raises.

    ``use_ssl`` defaults to ``settings.smtp_use_ssl`` (production: SSL on 465).
    The non-SSL branch exists for the local ``aiosmtpd`` test server.
    """
    host = settings.smtp_host
    port = settings.smtp_port
    ssl_enabled = settings.smtp_use_ssl if use_ssl is None else use_ssl

    subject, html, plain = _render_message(user, due_count, previews)
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = _sender_address()
    message["To"] = user.email
    message["Message-ID"] = make_msgid()
    message.set_content(plain)
    message.add_alternative(html, subtype="html")

    last_error = "unknown email error"
    for attempt in range(_MAX_ATTEMPTS):
        try:
            if ssl_enabled:
                client: smtplib.SMTP = smtplib.SMTP_SSL(
                    host, port, timeout=_SMTP_TIMEOUT_SECONDS
                )
            else:
                client = smtplib.SMTP(host, port, timeout=_SMTP_TIMEOUT_SECONDS)
            with client:
                if settings.smtp_user:
                    client.login(settings.smtp_user, settings.smtp_password)
                client.send_message(message)
            return SendResult(ok=True, provider_id=message["Message-ID"])
        except Exception as exc:
            last_error = _redact_error(exc)
            logger.warning(
                "reminder email attempt %s/%s to %s failed: %s",
                attempt + 1,
                _MAX_ATTEMPTS,
                user.email,
                last_error,
            )
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(_RETRY_BACKOFF[attempt])

    return SendResult(ok=False, error=last_error)


def _local_now(now: datetime | None) -> datetime:
    tz = ZoneInfo(settings.timezone)
    if now is None:
        return datetime.now(tz)
    if now.tzinfo is None:
        return now.replace(tzinfo=tz)
    return now.astimezone(tz)


def _due_previews(db: Session, *, user_id: str, day: date) -> list[str]:
    rows = db.scalars(
        select(ReviewCard.question)
        .where(
            ReviewCard.user_id == user_id,
            ReviewCard.due_date.is_not(None),
            ReviewCard.due_date <= day,
        )
        .order_by(
            ReviewCard.due_date.asc(),
            ReviewCard.created_at.asc(),
            ReviewCard.id.asc(),
        )
        .limit(_PREVIEW_LIMIT)
    ).all()
    return list(rows)


def _claim_reminder(
    db: Session, *, user_id: str, day: date, due_count: int
) -> str | None:
    return db.execute(
        pg_insert(EmailReminder)
        .values(
            user_id=user_id,
            send_date=day,
            status="pending",
            provider="smtp",
            error=None,
            cards_count=due_count,
            sent_at=None,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "send_date"])
        .returning(EmailReminder.id)
    ).scalar_one_or_none()


def _finish_reminder(
    db: Session,
    *,
    reminder_id: str,
    status: str,
    error: str | None,
    cards_count: int,
    sent_at: datetime | None,
) -> None:
    db.execute(
        update(EmailReminder)
        .where(EmailReminder.id == reminder_id)
        .values(
            status=status,
            error=error,
            cards_count=cards_count,
            sent_at=sent_at,
        )
    )
    db.commit()


def _run_locked(db: Session, moment: datetime) -> dict[str, object]:
    day = moment.date()
    logger.info("reminder run started for %s", day.isoformat())

    recipients = db.execute(
        select(User, func.count(ReviewCard.id).label("due_count"))
        .join(ReviewCard, ReviewCard.user_id == User.id)
        .where(
            ReviewCard.due_date.is_not(None),
            ReviewCard.due_date <= day,
        )
        .group_by(User.id)
        .order_by(User.id)
    ).all()

    sent = 0
    failed = 0
    skipped = 0

    for user, due_count in recipients:
        count = int(due_count)
        if count <= 0:  # pragma: no cover
            continue

        previews = _due_previews(db, user_id=user.id, day=day)
        reminder_id = _claim_reminder(db, user_id=user.id, day=day, due_count=count)
        db.commit()

        if reminder_id is None:
            skipped += 1
            logger.info("reminder skipped: already sent for user=%s date=%s", user.id, day)
            continue

        if not settings.smtp_host:
            logger.warning(
                "reminder for user=%s date=%s skipped: %s", user.id, day, _SMTP_NOT_CONFIGURED
            )
            _finish_reminder(
                db,
                reminder_id=reminder_id,
                status="failed",
                error=_SMTP_NOT_CONFIGURED,
                cards_count=count,
                sent_at=None,
            )
            failed += 1
            continue

        try:
            result = send_reminder_email(user, count, previews)
        except Exception as exc:  # pragma: no cover
            result = SendResult(ok=False, error=_redact_error(exc))

        if result.ok:
            _finish_reminder(
                db,
                reminder_id=reminder_id,
                status="sent",
                error=None,
                cards_count=count,
                sent_at=moment,
            )
            sent += 1
        else:
            _finish_reminder(
                db,
                reminder_id=reminder_id,
                status="failed",
                error=result.error or "send failed",
                cards_count=count,
                sent_at=None,
            )
            failed += 1

    summary: dict[str, object] = {
        "status": "ok",
        "date": day.isoformat(),
        "users": len(recipients),
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
    }
    logger.info("reminder run finished: %s", summary)
    return summary


def run_reminders(now: datetime | None = None) -> dict[str, object]:
    """Send at most one reminder per user per day.

    Returns ``{"status": "skipped", "reason": "lock held", ...}`` when another
    worker owns the run, otherwise a summary with ``sent`` / ``failed`` /
    ``skipped`` counters.
    """
    moment = _local_now(now)
    day = moment.date()

    with engine.connect() as lock_conn:
        acquired = bool(
            lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": REMINDER_ADVISORY_LOCK_KEY},
            ).scalar()
        )
        if not acquired:
            logger.info("reminder run skipped: lock held for %s", day.isoformat())
            return {
                "status": "skipped",
                "reason": "lock held",
                "date": day.isoformat(),
                "users": 0,
                "sent": 0,
                "failed": 0,
                "skipped": 0,
            }
        try:
            with SessionLocal() as db:
                return _run_locked(db, moment)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": REMINDER_ADVISORY_LOCK_KEY},
            )
