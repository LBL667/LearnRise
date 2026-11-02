"""Reminder email tests against a local aiosmtpd capture server.

No test sends real mail: SMTP always points at 127.0.0.1. Reminder runs use a
fixed 2001 date so only this module's due cards are selected, even when the
development database contains later-dated cards from other tasks.
"""

from __future__ import annotations

import email.policy
import socket
import uuid
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.parser import BytesParser
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from aiosmtpd.controller import Controller
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, engine
from app.models import EmailReminder, ReviewCard, User
from app.services import email as email_service
from app.services.email import REMINDER_ADVISORY_LOCK_KEY, run_reminders

TZ = ZoneInfo("Asia/Shanghai")
TEST_DAY = date(2001, 1, 1)
NOW = datetime(2001, 1, 1, 8, 0, tzinfo=TZ)


class CaptureHandler:
    def __init__(self) -> None:
        self.envelopes: list[Any] = []

    async def handle_DATA(self, server: object, session: object, envelope: object) -> str:
        self.envelopes.append(envelope)
        return "250 Message accepted for delivery"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _parse(envelope: Any) -> EmailMessage:
    content = envelope.content
    return BytesParser(policy=email.policy.default).parsebytes(content)


def _body(message: EmailMessage) -> str:
    html_part = message.get_body(preferencelist=("html",))
    assert html_part is not None
    return str(html_part.get_content())


@pytest.fixture
def db_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def make_user(db_session: Session) -> Iterator[Callable[..., User]]:
    created: list[str] = []

    def _create(display_name: str = "提醒用户") -> User:
        user = User(
            email=f"task24-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(EmailReminder).where(EmailReminder.user_id.in_(created)))
        db_session.execute(delete(ReviewCard).where(ReviewCard.user_id.in_(created)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _make_card(
    db_session: Session,
    user: User,
    *,
    due_date: date,
    question: str,
) -> ReviewCard:
    card = ReviewCard(
        user_id=user.id,
        knowledge_point_id=None,
        quiz_question_id=None,
        question=question,
        answer="答案",
        card_type="manual",
        due_date=due_date,
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card


@pytest.fixture
def smtp_server(monkeypatch: pytest.MonkeyPatch) -> Iterator[CaptureHandler]:
    handler = CaptureHandler()
    port = _free_port()
    controller = Controller(handler, hostname="127.0.0.1", port=port)
    controller.start()
    monkeypatch.setattr(settings, "smtp_host", "127.0.0.1")
    monkeypatch.setattr(settings, "smtp_port", port)
    monkeypatch.setattr(settings, "smtp_use_ssl", False)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_password", "")
    monkeypatch.setattr(settings, "smtp_from", "noreply@example.com")
    monkeypatch.setattr(email_service, "_RETRY_BACKOFF", (0.0, 0.0))
    try:
        yield handler
    finally:
        controller.stop()


def _envelopes_for(handler: CaptureHandler, user: User) -> list[Any]:
    """Return only the captured messages addressed to ``user``.

    ``run_reminders`` is global, so the shared SMTP capture server may also see
    mail for other users if the development database contains due cards. Every
    assertion must therefore look at this user's envelopes, not the whole list.
    """
    matched: list[Any] = []
    for envelope in handler.envelopes:
        recipients = [str(address) for address in getattr(envelope, "rcpt_tos", [])]
        if user.email in recipients:
            matched.append(envelope)
    return matched


def _reminders(db_session: Session, user: User) -> list[EmailReminder]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(EmailReminder).where(EmailReminder.user_id == user.id)
        ).all()
    )


def test_exactly_one(
    smtp_server: CaptureHandler,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    for index in range(3):
        _make_card(db_session, user, due_date=TEST_DAY, question=f"题目-{index}")

    result = run_reminders(now=NOW)

    assert result["status"] == "ok"
    assert result["sent"] == 1
    envelopes = _envelopes_for(smtp_server, user)
    assert len(envelopes) == 1
    message = _parse(envelopes[0])
    assert "3" in str(message["Subject"])

    rows = _reminders(db_session, user)
    assert len(rows) == 1
    assert rows[0].send_date == TEST_DAY
    assert rows[0].status == "sent"
    assert rows[0].cards_count == 3
    assert rows[0].provider == "smtp"
    assert rows[0].sent_at is not None


def test_duplicate_trigger(
    smtp_server: CaptureHandler,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    _make_card(db_session, user, due_date=TEST_DAY, question="今日题目")

    first = run_reminders(now=NOW)
    second = run_reminders(now=NOW)

    assert first["sent"] == 1
    assert second["sent"] == 0
    assert second["skipped"] == 1
    assert len(_envelopes_for(smtp_server, user)) == 1

    rows = _reminders(db_session, user)
    assert len(rows) == 1
    assert rows[0].status == "sent"
    owned_rows = db_session.scalar(
        select(func.count())
        .select_from(EmailReminder)
        .where(
            EmailReminder.user_id == user.id,
            EmailReminder.send_date == TEST_DAY,
        )
    )
    assert int(owned_rows or 0) == 1


def test_smtp_failure_marks_failed(
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "smtp_host", "127.0.0.1")
    monkeypatch.setattr(settings, "smtp_port", _free_port())
    monkeypatch.setattr(settings, "smtp_use_ssl", False)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_password", "")
    monkeypatch.setattr(settings, "smtp_from", "noreply@example.com")
    monkeypatch.setattr(email_service, "_RETRY_BACKOFF", (0.0, 0.0))

    first_user = make_user("失败用户一")
    second_user = make_user("失败用户二")
    _make_card(db_session, first_user, due_date=TEST_DAY, question="题目一")
    _make_card(db_session, second_user, due_date=TEST_DAY, question="题目二")

    result = run_reminders(now=NOW)

    assert result["status"] == "ok"
    assert result["failed"] == 2
    for user in (first_user, second_user):
        rows = _reminders(db_session, user)
        assert len(rows) == 1
        assert rows[0].status == "failed"
        assert rows[0].error
        assert rows[0].sent_at is None


def test_smtp_not_configured_path(
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "smtp_host", "")
    user = make_user()
    _make_card(db_session, user, due_date=TEST_DAY, question="站内提醒题目")

    result = run_reminders(now=NOW)

    assert result["status"] == "ok"
    assert result["failed"] == 1
    rows = _reminders(db_session, user)
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert rows[0].error == "smtp not configured"
    assert rows[0].cards_count == 1


def test_advisory_lock_skips_second_run(
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    _make_card(db_session, user, due_date=TEST_DAY, question="锁定题目")

    with engine.connect() as lock_conn:
        lock_conn.execute(
            text("SELECT pg_advisory_lock(:key)"),
            {"key": REMINDER_ADVISORY_LOCK_KEY},
        )
        try:
            result = run_reminders(now=NOW)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": REMINDER_ADVISORY_LOCK_KEY},
            )

    assert result["status"] == "skipped"
    assert result["reason"] == "lock held"
    assert _reminders(db_session, user) == []


def test_email_contains_previews(
    smtp_server: CaptureHandler,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    for offset in range(6):
        _make_card(
            db_session,
            user,
            due_date=TEST_DAY - timedelta(days=offset),
            question=f"预览题目{offset}",
        )

    run_reminders(now=NOW)

    envelopes = _envelopes_for(smtp_server, user)
    assert len(envelopes) == 1
    html = _body(_parse(envelopes[0]))
    for offset in range(1, 6):
        assert f"预览题目{offset}" in html
    assert "预览题目0" not in html


def test_opted_out_user_is_never_selected(
    smtp_server: CaptureHandler,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    """``email_reminders_enabled=False`` produces no row and no mail."""
    opted_out = make_user("退订用户")
    opted_in = make_user("订阅用户")
    opted_out.email_reminders_enabled = False
    db_session.commit()
    _make_card(db_session, opted_out, due_date=TEST_DAY, question="退订题目")
    _make_card(db_session, opted_in, due_date=TEST_DAY, question="订阅题目")

    result = run_reminders(now=NOW)

    assert result["status"] == "ok"
    assert _reminders(db_session, opted_out) == []
    assert _envelopes_for(smtp_server, opted_out) == []
    rows = _reminders(db_session, opted_in)
    assert len(rows) == 1
    assert rows[0].status == "sent"
    assert len(_envelopes_for(smtp_server, opted_in)) == 1
