"""Contract tests for the object-storage adapters.

Only the local backend is exercised against real I/O; MinIO/OBS are covered by
unit-level checks (SDK absence, factory selection) so the suite stays offline.
"""

from __future__ import annotations

import builtins

import pytest

from app.adapters.storage import (
    MAX_KEY_LENGTH,
    LocalStorage,
    ObsStorage,
    build_storage,
    sanitize_key,
)
from app.config import settings
from app.ports import ObjectStorage, ProviderError

INVALID_KEYS = [
    "../../etc/passwd",
    "a/../../b",
    "..",
    "/abs/path",
    "a\\b",
    "",
    "a/./b",
    "a//b",
    "a/",
    ".",
    ".hidden/file",
    "a/.hidden",
    "文档/1.pdf",
    "a b.pdf",
    "a\x00b",
]


@pytest.mark.parametrize("key", INVALID_KEYS)
def test_reject_traversal(tmp_path, key: str) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put(key, b"x")
    with pytest.raises(ValueError):
        store.get(key)
    with pytest.raises(ValueError):
        store.sign(key)
    with pytest.raises(ValueError):
        store.delete(key)


def test_roundtrip(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    assert isinstance(store, ObjectStorage)
    payload = b"\x00\x01binary\xffpayload"
    returned = store.put("notes/2026/source.pdf", payload, "application/pdf")
    assert returned == "notes/2026/source.pdf"
    assert store.get("notes/2026/source.pdf") == payload
    assert (tmp_path / "notes" / "2026" / "source.pdf").read_bytes() == payload


def test_sign_returns_url(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_base_url", "http://storage.test")
    store = LocalStorage(tmp_path, settings=settings)
    url = store.sign("notes/source.pdf")
    assert url.startswith("http")
    assert "notes/source.pdf" in url
    assert url == "http://storage.test/files/notes/source.pdf"


def test_sign_ignores_expiry_locally(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    assert store.sign("a.pdf", 1) == store.sign("a.pdf", 99999)


def test_delete(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    store.put("docs/a.txt", b"data")
    assert store.delete("docs/a.txt") is True
    assert store.delete("docs/a.txt") is False
    with pytest.raises(FileNotFoundError):
        store.get("docs/a.txt")


def test_unicode_key_rejected(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put("文档/1.pdf", b"x")


def test_empty_key_rejected(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put("", b"x")


def test_oversized_key_rejected(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put("a" * (MAX_KEY_LENGTH + 1), b"x")


def test_key_at_max_length_allowed(tmp_path) -> None:
    key = "/".join(["a" * 204] * 5)
    assert len(key) == MAX_KEY_LENGTH
    assert sanitize_key(key) == key
    store = LocalStorage(tmp_path)
    assert store.put(key, b"x") == key
    assert store.get(key) == b"x"


def test_overlong_segment_rejected_by_local(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put("a" * 256, b"x")


def test_error_message_does_not_echo_long_key(tmp_path) -> None:
    store = LocalStorage(tmp_path)
    hostile = "a" * (MAX_KEY_LENGTH + 1) + "SECRET"
    with pytest.raises(ValueError) as excinfo:
        store.put(hostile, b"x")
    assert "SECRET" not in str(excinfo.value)
    assert len(str(excinfo.value)) < 300


def test_symlink_escape_blocked(tmp_path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "link").symlink_to(outside, target_is_directory=True)
    store = LocalStorage(root)
    with pytest.raises(ValueError):
        store.put("link/pwned.txt", b"x")
    assert not (outside / "pwned.txt").exists()


def test_obs_sdk_missing(monkeypatch) -> None:
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "obs" or name.startswith("obs."):
            raise ImportError("no obs")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(ProviderError, match="obs sdk not installed"):
        ObsStorage("ak", "sk", "obs.example.test", "bucket")


def test_obs_module_imports_without_sdk() -> None:
    import app.adapters.storage.obs as obs_adapter

    assert hasattr(obs_adapter, "ObsStorage")


def test_factory_selects_local(tmp_path, monkeypatch) -> None:
    root = tmp_path / "storage"
    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(settings, "storage_local_root", str(root))
    store = build_storage()
    assert isinstance(store, LocalStorage)
    assert store.root == root.resolve()
    store.put("factory/check.txt", b"ok")
    assert (root / "factory" / "check.txt").read_bytes() == b"ok"


def test_factory_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setattr(settings, "storage_provider", "nope")
    with pytest.raises(ValueError, match="unknown storage provider"):
        build_storage()
