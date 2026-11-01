"""Hard runtime-contract assertions executed while the app is being created.

The checks exist so a mis-provisioned deployment fails at boot instead of
silently degrading later. They are gated by ``STARTUP_CHECKS=1`` (the
production profile sets it; development leaves it unset) and are invoked from
``app.main.create_app``.

What is verified
----------------
* ``EMBEDDING_DIM`` is the 1024 that both ``bge-m3`` profiles share. A mismatch
  here would make every new vector incompatible with the ``chunks.embedding``
  column, so it is never tolerated.
* PostgreSQL has the ``vector`` extension; ``chunks.embedding`` really is
  ``vector(1024)``; Alembic has exactly one head and the database revision is
  that head.
* No row carries an empty ``embedding_model``; no row records an
  ``embedding_dim`` other than 1024.
* The configured object-storage backend is reachable: the local root exists
  and is writable, the MinIO bucket exists, or the OBS credentials are set.

Every problem is returned as a human-readable string. ``strict=True`` raises a
single :class:`RuntimeError` containing all of them, which makes the importing
process exit non-zero. Import failures are reported by type only so a DSN with
a password can never leak into a traceback.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.config import Settings, settings

#: Single source of truth for the pgvector column width. ``chunks.embedding``,
#: the mock/local/remote embedding adapters and both provider profiles all use
#: this value; the startup check exists to prove the deployment agrees.
EXPECTED_EMBEDDING_DIM = 1024

#: Environment switch read by :func:`app.main.create_app`.
STARTUP_CHECKS_ENV = "STARTUP_CHECKS"

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})

ALEMBIC_VERSION_SQL = "SELECT version_num FROM alembic_version"
VECTOR_EXTENSION_SQL = "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"
EMBEDDING_TYPE_SQL = (
    "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
    "WHERE attrelid = to_regclass('chunks') "
    "AND attname = 'embedding' AND NOT attisdropped"
)
EMPTY_MODEL_SQL = (
    "SELECT count(*) FROM chunks "
    "WHERE embedding_model IS NULL OR btrim(embedding_model) = ''"
)
BAD_DIM_SQL = "SELECT count(*) FROM chunks WHERE embedding_dim <> :dim"


def checks_enabled(raw: str | None = None) -> bool:
    """Return whether startup assertions are enabled.

    ``raw`` overrides ``os.environ`` so callers (and tests) can evaluate the
    flag without mutating the process environment.
    """

    value = os.environ.get(STARTUP_CHECKS_ENV, "0") if raw is None else raw
    return (value or "").strip().lower() in _TRUE_VALUES


@dataclass(frozen=True)
class DbSnapshot:
    """One-shot view of the database facts the contract depends on."""

    extension_present: bool
    embedding_type: str | None
    heads: tuple[str, ...]
    revisions: tuple[str, ...]
    blank_model_rows: int
    bad_dim_rows: int


def _alembic_heads() -> tuple[str, ...]:
    """Read the head revision(s) from the migration scripts.

    Parsed through Alembic's own ``ScriptDirectory`` instead of shelling out so
    the check works identically in Docker, CI and an installed wheel. An
    unreachable/missing ``alembic.ini`` yields an empty tuple, which the
    problem mapper reports as "0 heads".
    """

    ini_path = Path(__file__).resolve().parents[1] / "alembic.ini"
    if not ini_path.is_file():
        return ()
    config = Config(str(ini_path))
    # ``script_location`` in alembic.ini is relative to the working directory;
    # pin it next to the ini so the check does not depend on the caller's cwd.
    config.set_main_option("script_location", str(ini_path.parent / "alembic"))
    script = ScriptDirectory.from_config(config)
    return tuple(str(head) for head in script.get_heads())


def _read_db_snapshot(engine: Engine) -> DbSnapshot:
    """Collect every database fact in one connection.

    Raises on a connection/schema error; the caller turns that into a problem
    string. Individual facts are nullable so a missing table still produces a
    precise message instead of an exception.
    """

    with engine.connect() as conn:
        extension = conn.execute(text(VECTOR_EXTENSION_SQL)).scalar()
        type_row = conn.execute(text(EMBEDDING_TYPE_SQL)).first()
        revisions = tuple(
            str(row[0]) for row in conn.execute(text(ALEMBIC_VERSION_SQL)).all()
        )
        table_exists = conn.execute(text("SELECT to_regclass('chunks')")).scalar() is not None
        blank_model_rows = 0
        bad_dim_rows = 0
        if table_exists:
            blank_model_rows = int(conn.execute(text(EMPTY_MODEL_SQL)).scalar() or 0)
            bad_dim_rows = int(
                conn.execute(text(BAD_DIM_SQL), {"dim": EXPECTED_EMBEDDING_DIM}).scalar()
                or 0
            )
    return DbSnapshot(
        extension_present=bool(extension),
        embedding_type=str(type_row[0]) if type_row and type_row[0] else None,
        heads=_alembic_heads(),
        revisions=revisions,
        blank_model_rows=blank_model_rows,
        bad_dim_rows=bad_dim_rows,
    )


def _db_problems(snapshot: DbSnapshot) -> list[str]:
    """Translate a :class:`DbSnapshot` into contract violations."""

    problems: list[str] = []
    if not snapshot.extension_present:
        problems.append("db: pg_extension 'vector' is not installed")
    if snapshot.embedding_type != "vector(1024)":
        actual = snapshot.embedding_type or "<missing>"
        problems.append(
            f"db: chunks.embedding is {actual}, expected vector({EXPECTED_EMBEDDING_DIM})"
        )
    if len(snapshot.heads) != 1:
        listed = ", ".join(snapshot.heads) or "none"
        problems.append(
            f"db: alembic has {len(snapshot.heads)} heads ({listed}), expected exactly 1"
        )
    elif set(snapshot.revisions) != set(snapshot.heads):
        current = ", ".join(snapshot.revisions) or "empty"
        problems.append(
            f"db: alembic_version ({current}) does not match head {snapshot.heads[0]}"
        )
    if snapshot.blank_model_rows:
        problems.append(
            f"db: {snapshot.blank_model_rows} chunk row(s) have an empty embedding_model"
        )
    if snapshot.bad_dim_rows:
        problems.append(
            f"db: {snapshot.bad_dim_rows} chunk row(s) have embedding_dim != "
            f"{EXPECTED_EMBEDDING_DIM}"
        )
    return problems


def _settings_problems(cfg: Settings) -> list[str]:
    """Provider-level settings that must never drift between profiles."""

    if int(cfg.embedding_dim) != EXPECTED_EMBEDDING_DIM:
        return [
            f"settings: EMBEDDING_DIM is {cfg.embedding_dim}, "
            f"expected {EXPECTED_EMBEDDING_DIM}"
        ]
    return []


def _storage_problems(cfg: Settings) -> list[str]:
    """Prove the configured object-storage backend is usable.

    Storage is imported lazily so a plain ``import app.main`` stays cheap. The
    MinIO probe is the only network call; it is reachable only when
    ``STORAGE_PROVIDER=minio`` and startup assertions are explicitly enabled.
    """

    provider = (cfg.storage_provider or "local").strip().lower()
    if provider == "local":
        root = Path(cfg.storage_local_root)
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return [
                f"storage: local root {root} is not usable ({type(exc).__name__})"
            ]
        if not root.is_dir():
            return [f"storage: local root {root} is not a directory"]
        try:
            with tempfile.NamedTemporaryFile(dir=root, prefix=".startup-check-", delete=True):
                pass
        except OSError as exc:
            return [f"storage: local root {root} is not writable ({type(exc).__name__})"]
        return []
    if provider == "minio":
        from app.adapters.storage import MinioStorage

        if not cfg.minio_bucket:
            return ["storage: MINIO_BUCKET is empty"]
        try:
            store = MinioStorage.from_settings(cfg)
            if not store._client.bucket_exists(cfg.minio_bucket):
                return [f"storage: minio bucket {cfg.minio_bucket!r} is missing"]
        except Exception as exc:  # network/SDK failure, reported by type only
            return [f"storage: minio unreachable ({type(exc).__name__})"]
        return []
    if provider == "obs":
        required = (
            ("OBS_ACCESS_KEY_ID", cfg.obs_access_key_id),
            ("OBS_SECRET_ACCESS_KEY", cfg.obs_secret_access_key),
            ("OBS_ENDPOINT", cfg.obs_endpoint),
            ("OBS_BUCKET", cfg.obs_bucket),
        )
        missing = [name for name, value in required if not value]
        if missing:
            return [f"storage: obs credentials incomplete (missing {', '.join(missing)})"]
        return []
    return [f"storage: unknown provider {provider!r}"]


def collect_problems(engine: Engine | None = None) -> list[str]:
    """Return every runtime-contract violation found right now.

    ``engine`` defaults to ``app.db.engine``. Tests inject a fake snapshot by
    monkeypatching :func:`_read_db_snapshot` rather than standing up a database.
    """

    cfg = settings
    problems = _settings_problems(cfg)

    if engine is None:
        from app.db import engine as app_engine

        resolved: Engine = app_engine
    else:
        resolved = engine

    try:
        snapshot = _read_db_snapshot(resolved)
    except Exception as exc:  # connection or schema error, type only
        problems.append(f"db: unable to verify schema ({type(exc).__name__})")
    else:
        problems.extend(_db_problems(snapshot))

    problems.extend(_storage_problems(cfg))
    return problems


def assert_runtime_contract(
    engine: Engine | None = None, *, strict: bool | None = None
) -> list[str]:
    """Verify the runtime contract and optionally fail hard.

    Returns the list of problems (empty when healthy). With ``strict=True`` a
    non-empty list raises :class:`RuntimeError` containing every problem, so
    ``create_app`` cannot return a half-valid application.
    """

    problems = collect_problems(engine)
    if strict and problems:
        raise RuntimeError("runtime contract violated:\n" + "\n".join(problems))
    return problems
