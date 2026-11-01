"""Runtime-contract startup assertions.

The pass case runs against the live dev Postgres (the same instance the
contract tests use). Failure cases monkeypatch the snapshot reader so a
broken deployment shape can be asserted without damaging the database.
"""

from __future__ import annotations

import pytest

import app.main as main
import app.startup_checks as startup_checks
from app.startup_checks import DbSnapshot

HEALTHY_HEAD = "0004_quiz_attempts"


def _healthy_snapshot(**overrides: object) -> DbSnapshot:
    values: dict[str, object] = {
        "extension_present": True,
        "embedding_type": "vector(1024)",
        "heads": (HEALTHY_HEAD,),
        "revisions": (HEALTHY_HEAD,),
        "blank_model_rows": 0,
        "bad_dim_rows": 0,
    }
    values.update(overrides)
    return DbSnapshot(**values)


def _patch_healthy_db(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    snapshot = _healthy_snapshot(**overrides)
    monkeypatch.setattr(startup_checks, "_read_db_snapshot", lambda engine: snapshot)
    monkeypatch.setattr(startup_checks, "_storage_problems", lambda cfg: [])


def test_live_database_satisfies_contract() -> None:
    assert startup_checks.assert_runtime_contract(strict=False) == []


def test_dimension_mismatch_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(monkeypatch)
    monkeypatch.setattr(startup_checks.settings, "embedding_dim", 768)

    problems = startup_checks.assert_runtime_contract()

    assert problems == ["settings: EMBEDDING_DIM is 768, expected 1024"]


def test_missing_vector_extension_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(monkeypatch, extension_present=False)

    problems = startup_checks.assert_runtime_contract()

    assert any("pg_extension 'vector' is not installed" in problem for problem in problems)


def test_multi_head_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(
        monkeypatch,
        heads=("0004_quiz_attempts", "0005_conflicting_head"),
        revisions=("0004_quiz_attempts",),
    )

    problems = startup_checks.assert_runtime_contract()

    assert any("2 heads" in problem for problem in problems)
    assert not any("does not match head" in problem for problem in problems)


def test_revision_drift_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(monkeypatch, revisions=("0003_quiz_questions",))

    problems = startup_checks.assert_runtime_contract()

    assert any("0003_quiz_questions" in problem for problem in problems)


def test_bad_rows_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(monkeypatch, blank_model_rows=2, bad_dim_rows=1)

    problems = startup_checks.assert_runtime_contract()

    assert any("2 chunk row(s) have an empty embedding_model" in problem for problem in problems)
    assert any("1 chunk row(s) have embedding_dim != 1024" in problem for problem in problems)


def test_obs_storage_requires_complete_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the DB snapshot is stubbed here: the point of this case is the real
    # storage problem mapper, so ``_patch_healthy_db`` (which also stubs
    # ``_storage_problems``) must not be used.
    snapshot = _healthy_snapshot()
    monkeypatch.setattr(startup_checks, "_read_db_snapshot", lambda engine: snapshot)
    monkeypatch.setattr(startup_checks.settings, "storage_provider", "obs")
    monkeypatch.setattr(startup_checks.settings, "obs_endpoint", "")
    monkeypatch.setattr(startup_checks.settings, "obs_bucket", "")
    monkeypatch.setattr(startup_checks.settings, "obs_access_key_id", "")
    monkeypatch.setattr(startup_checks.settings, "obs_secret_access_key", "")

    problems = startup_checks._storage_problems(startup_checks.settings)

    assert len(problems) == 1
    assert "OBS_ACCESS_KEY_ID" in problems[0]
    assert "OBS_ENDPOINT" in problems[0]


def test_strict_raises_with_all_problems(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_healthy_db(monkeypatch, extension_present=False)
    monkeypatch.setattr(startup_checks.settings, "embedding_dim", 768)

    non_strict = startup_checks.assert_runtime_contract(strict=False)
    assert len(non_strict) == 2

    with pytest.raises(RuntimeError) as excinfo:
        startup_checks.assert_runtime_contract(strict=True)

    message = str(excinfo.value)
    assert "runtime contract violated" in message
    assert all(problem in message for problem in non_strict)


def test_create_app_runs_checks_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setenv("STARTUP_CHECKS", "1")
    monkeypatch.setattr(
        startup_checks,
        "assert_runtime_contract",
        lambda **kwargs: calls.append(kwargs) or [],
    )

    main.create_app()

    assert calls == [{"strict": True}]


def test_create_app_propagates_contract_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STARTUP_CHECKS", "1")

    def _boom(**kwargs: object) -> list[str]:
        raise RuntimeError("runtime contract violated: boom")

    monkeypatch.setattr(startup_checks, "assert_runtime_contract", _boom)

    with pytest.raises(RuntimeError, match="boom"):
        main.create_app()


def test_create_app_skips_checks_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.delenv("STARTUP_CHECKS", raising=False)
    monkeypatch.setattr(
        startup_checks,
        "assert_runtime_contract",
        lambda **kwargs: calls.append(1) or [],
    )

    main.create_app()

    assert calls == []


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_checks_enabled_truthy(value: str) -> None:
    assert startup_checks.checks_enabled(value) is True


@pytest.mark.parametrize("value", ["", "0", "false", "off"])
def test_checks_enabled_falsey(value: str) -> None:
    assert startup_checks.checks_enabled(value) is False
