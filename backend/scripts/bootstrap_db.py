"""Provision the pgvector extension for the active provider profile.

Usage:
    python scripts/bootstrap_db.py --profile local
    python scripts/bootstrap_db.py --profile huawei [--allow-fallback]

The script is idempotent: running it twice exits 0 both times.
"""

from __future__ import annotations

import argparse
import os
import sys

import psycopg

from app.config import settings

PROFILES = ("local", "huawei")


def _psycopg_dsn(database_url: str) -> str:
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if database_url.startswith(prefix):
            return "postgresql://" + database_url[len(prefix) :]
    return database_url


def _vector_version(conn: psycopg.Connection) -> str | None:
    row = conn.execute(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    ).fetchone()
    return row[0] if row else None


def _control_extension_available(conn: psycopg.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM pg_proc WHERE proname = 'control_extension' LIMIT 1"
    ).fetchone()
    return row is not None


def _create_local(conn: psycopg.Connection) -> None:
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")


def _create_huawei(conn: psycopg.Connection, *, allow_fallback: bool) -> str:
    if _control_extension_available(conn):
        conn.execute("SELECT control_extension('create', 'vector')")
        return "control_extension"
    message = (
        "control_extension() is not available on this server; "
        "cannot apply the huawei profile."
    )
    if not allow_fallback:
        print(f"[bootstrap_db] ERROR: {message}", file=sys.stderr)
        print(
            "[bootstrap_db] Re-run with --allow-fallback to use "
            "CREATE EXTENSION IF NOT EXISTS vector instead.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    print(f"[bootstrap_db] WARNING: {message} Falling back to CREATE EXTENSION.")
    _create_local(conn)
    return "fallback"


def bootstrap(profile: str, database_url: str, *, allow_fallback: bool = False) -> str:
    dsn = _psycopg_dsn(database_url)
    with psycopg.connect(dsn, autocommit=True) as conn:
        version = _vector_version(conn)
        if version is not None:
            return f"profile={profile} vector={version} status=already-enabled"
        if profile == "local":
            _create_local(conn)
            strategy = "create-extension"
        else:
            strategy = _create_huawei(conn, allow_fallback=allow_fallback)
        version = _vector_version(conn)
        if version is None:
            raise SystemExit(f"[bootstrap_db] ERROR: vector extension missing after {strategy}")
        return f"profile={profile} vector={version} strategy={strategy} status=ok"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Provision the pgvector extension.")
    parser.add_argument(
        "--profile",
        choices=PROFILES,
        default=os.environ.get("PROVIDER_PROFILE") or settings.provider_profile,
        help="Provider profile (default: PROVIDER_PROFILE or local)",
    )
    parser.add_argument(
        "--database-url",
        default=settings.database_url,
        help="SQLAlchemy database URL (default: settings.database_url)",
    )
    parser.add_argument(
        "--allow-fallback",
        action="store_true",
        help="On non-Huawei servers, fall back to CREATE EXTENSION for the huawei profile",
    )
    args = parser.parse_args(argv)
    summary = bootstrap(args.profile, args.database_url, allow_fallback=args.allow_fallback)
    print(f"[bootstrap_db] {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
