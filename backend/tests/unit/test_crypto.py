import re

import pytest

from app.security.crypto import decrypt, encrypt, get_fernet, is_masked, mask


def test_roundtrip() -> None:
    plaintext = "sk-live-0123456789abcdef"
    token = encrypt(plaintext)
    assert token != plaintext
    assert decrypt(token) == plaintext


def test_get_fernet_accepts_configured_key() -> None:
    assert get_fernet().encrypt(b"x") != b"x"


def test_mask_format() -> None:
    masked = mask("sk-1234567890abcd")
    assert re.match(r"^sk-\*{4}.{4}$", masked)


def test_mask_roundtrip() -> None:
    plaintext = "sk-live-abcdef123456"
    token = encrypt(plaintext)
    display = mask(token)
    assert display != token
    assert decrypt(token) == plaintext


def test_short_secret_masked() -> None:
    assert mask("abc") == "****"
    assert mask("1234567") == "****"


def test_invalid_token_raises() -> None:
    bad = "not-a-valid-fernet-token"
    with pytest.raises(ValueError) as excinfo:
        decrypt(bad)
    assert bad not in str(excinfo.value)


def test_is_masked() -> None:
    assert is_masked(mask("sk-1234567890abcd")) is True
    assert is_masked(mask("abcdefghij")) is True
    assert is_masked("sk-realkey1234567890") is False
    assert is_masked("") is False
