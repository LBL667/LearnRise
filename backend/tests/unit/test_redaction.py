import logging

from app.security.redaction import (
    SecretRedactionFilter,
    install_redaction,
    redact_text,
)


def test_bearer_redacted() -> None:
    raw = "Authorization: Bearer abc.def-ghi_123"
    out = redact_text(raw)
    assert "Bearer ****" in out
    assert "abc.def-ghi_123" not in out


def test_sk_key_redacted() -> None:
    out = redact_text("token sk-abcdefgh12345678")
    assert "sk-****" in out
    assert "abcdefgh12345678" not in out


def test_api_key_redacted() -> None:
    out = redact_text('api_key="supersecretvalue"')
    assert "api_key=****" in out
    assert "supersecretvalue" not in out


def test_authorization_header_redacted() -> None:
    out = redact_text('Authorization="Bearer real-token-value"')
    assert "real-token-value" not in out
    assert "Authorization=****" in out


def test_access_key_redacted() -> None:
    raw = "access_key=ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    out = redact_text(raw)
    assert "access_key=****" in out
    assert "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" not in out


def test_install_redaction_is_idempotent() -> None:
    logger = logging.getLogger("tests.redaction.idempotent")
    logger.filters.clear()
    install_redaction(logger)
    install_redaction(logger)
    added = [f for f in logger.filters if isinstance(f, SecretRedactionFilter)]
    assert len(added) == 1


def test_filter_redacts_record() -> None:
    logger = logging.getLogger("tests.redaction.record")
    logger.filters.clear()
    install_redaction(logger)
    record = logging.LogRecord(
        name="tests.redaction.record",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="api_key=%s",
        args=("sk-abcdefgh12345678",),
        exc_info=None,
    )
    assert logger.handle(record) is None
    assert "sk-abcdefgh12345678" not in record.getMessage()
