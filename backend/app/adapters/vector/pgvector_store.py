"""pgvector-backed :class:`~app.ports.vector.VectorStore`.

The same implementation serves the ``local`` Docker profile and the Huawei
Cloud ``huawei`` profile (RDS for PostgreSQL + pgvector): only the DSN differs.

Design notes
------------
* The constructor never opens a socket. The psycopg connection is created on
  first use (:meth:`connection`) and closed by :meth:`close` / the context
  manager, so importing or building the adapter is side-effect free.
* ``chunks`` is owned by Alembic; this adapter never creates or alters tables.
  :meth:`ensure_index` only creates an *index*, and it is idempotent.
* Every statement is parameterised. Column names come from a fixed whitelist
  intersected with what the live table actually exposes, never from user data.
* ``ChunkRecord`` does not carry ``chunk_index``, ``user_id`` or
  ``token_count`` (the port predates the final schema). The adapter therefore:
    - uses ``chunk_id`` as the row primary key;
    - takes ``chunk_index`` from the record when present (``getattr``), else
      from the record's position within its source in the batch;
    - resolves ``user_id`` from ``knowledge_sources`` (unless the record carries
      one);
    - writes ``token_count`` as ``0`` unless the record carries it.
  This keeps the port untouched while staying idempotent for whole-source
  upserts (the normal ingestion path).
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from pgvector.psycopg import register_vector
from psycopg import Connection, Cursor

from app.config import Settings, get_settings
from app.ports import ChunkRecord, DimensionMismatch, ProviderError, SearchHit

EMBEDDING_DIM = 1024

HNSW_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw "
    "ON chunks USING hnsw (embedding vector_cosine_ops)"
)
IVFFLAT_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS chunks_embedding_ivfflat "
    "ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
)

_REQUIRED_COLUMNS = (
    "id",
    "source_id",
    "user_id",
    "chunk_index",
    "embedding_model",
    "embedding_dim",
    "embedding_version",
)
_OPTIONAL_COLUMNS = ("content", "page", "heading", "token_count", "embedding")

_SQLALCHEMY_PREFIXES = ("postgresql+psycopg://", "postgresql+psycopg2://")

_COLUMNS_SQL = """
SELECT column_name
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'chunks'
"""

_SOURCE_OWNERS_SQL = """
SELECT id::text AS id, user_id::text AS user_id
FROM knowledge_sources
WHERE id = ANY(%s::uuid[])
"""



def _dsn_from_settings(settings: Settings) -> str:
    """Strip the SQLAlchemy dialect suffix so psycopg can consume the URL."""

    url = settings.database_url or ""
    for prefix in _SQLALCHEMY_PREFIXES:
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix) :]
    return url


def _validate_vector(vector: Sequence[float], *, what: str) -> None:
    length = len(vector)
    if length != EMBEDDING_DIM:
        raise DimensionMismatch(f"{what}: expected dim {EMBEDDING_DIM}, got {length}")


class PgVectorStore:
    def __init__(self, dsn: str | None = None, *, settings: Settings | None = None) -> None:
        cfg = settings or get_settings()
        self._dsn = dsn or _dsn_from_settings(cfg)
        self._conn: Connection[Any] | None = None
        self._table_columns: frozenset[str] | None = None
        self.index_kind: str | None = None

    @property
    def dsn(self) -> str:
        return self._dsn

    def connection(self) -> Connection[Any]:
        if self._conn is None or self._conn.closed:
            conn = psycopg.connect(self._dsn, autocommit=True)
            register_vector(conn)
            self._conn = conn
        return self._conn

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
        self._conn = None

    def __enter__(self) -> PgVectorStore:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    @contextmanager
    def _cursor(self) -> Iterator[Cursor[Any]]:
        with self.connection().cursor() as cur:
            yield cur

    def _execute(self, sql: str, params: Sequence[Any] | None = None) -> int:
        with self._cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount

    def _columns(self) -> frozenset[str]:
        if self._table_columns is None:
            with self._cursor() as cur:
                cur.execute(_COLUMNS_SQL)
                self._table_columns = frozenset(row[0] for row in cur.fetchall())
        return self._table_columns

    def _insert_columns(self) -> list[str]:
        columns = self._columns()
        selected = [name for name in _REQUIRED_COLUMNS if name in columns]
        selected.extend(name for name in _OPTIONAL_COLUMNS if name in columns)
        missing = [name for name in _REQUIRED_COLUMNS if name not in columns]
        if missing:
            raise ProviderError(f"chunks table is missing columns: {', '.join(missing)}")
        return selected

    def upsert(self, chunks: list[ChunkRecord]) -> int:
        if not chunks:
            return 0

        for record in chunks:
            if record.embedding is not None:
                _validate_vector(record.embedding, what="upsert")
            declared = int(record.embedding_dim)
            if declared != EMBEDDING_DIM:
                raise DimensionMismatch(
                    f"upsert: expected dim {EMBEDDING_DIM}, got {declared}"
                )

        owners = self._source_owners({record.source_id for record in chunks})
        columns = self._insert_columns()

        counters: dict[str, int] = {}
        rows: dict[tuple[str, int, str, int, str], tuple[Any, ...]] = {}
        for record in chunks:
            chunk_index = getattr(record, "chunk_index", None)
            if chunk_index is None:
                chunk_index = counters.get(record.source_id, 0)
                counters[record.source_id] = chunk_index + 1
            user_id = getattr(record, "user_id", None) or owners[record.source_id]
            identity = (
                record.source_id,
                int(chunk_index),
                record.embedding_model,
                int(record.embedding_dim),
                record.embedding_version,
            )
            values = {
                "id": record.chunk_id,
                "source_id": record.source_id,
                "user_id": user_id,
                "chunk_index": int(chunk_index),
                "content": record.content,
                "page": record.page,
                "heading": record.heading,
                "token_count": int(getattr(record, "token_count", 0)),
                "embedding": record.embedding,
                "embedding_model": record.embedding_model,
                "embedding_dim": int(record.embedding_dim),
                "embedding_version": record.embedding_version,
            }
            rows[identity] = tuple(values[column] for column in columns)

        if not rows:
            return 0

        placeholders = ", ".join(
            "(" + ", ".join(["%s"] * len(columns)) + ")" for _ in rows
        )
        sql = (
            f"INSERT INTO chunks ({', '.join(columns)}) VALUES {placeholders} "
            "ON CONFLICT (source_id, chunk_index, embedding_model, embedding_dim, "
            "embedding_version) DO UPDATE SET "
            + ", ".join(
                f"{column} = EXCLUDED.{column}"
                for column in columns
                if column not in _REQUIRED_COLUMNS
            )
            + ", updated_at = now()"
        )
        params = [value for row in rows.values() for value in row]
        return self._execute(sql, params)

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        _validate_vector(query_vector, what="search")
        if top_k <= 0:
            return []

        sql = (
            "SELECT id::text, source_id::text, content, page, heading, "
            "1 - (embedding <=> %s::vector) AS score "
            "FROM chunks WHERE embedding IS NOT NULL"
        )
        params: list[Any] = [query_vector]
        if source_ids is not None:
            if not source_ids:
                return []
            sql += " AND source_id = ANY(%s::uuid[])"
            params.append(source_ids)
        sql += " ORDER BY embedding <=> %s::vector LIMIT %s"
        params.extend([query_vector, top_k])

        with self._cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        return [
            SearchHit(
                chunk_id=str(row[0]),
                source_id=str(row[1]),
                content=row[2],
                score=round(float(row[5]), 6),
                page=row[3],
                heading=row[4],
            )
            for row in rows
        ]

    def delete_by_source(self, source_id: str) -> int:
        return self._execute(
            "DELETE FROM chunks WHERE source_id = %s::uuid",
            [source_id],
        )

    def ensure_index(self) -> str:
        try:
            self._execute(HNSW_INDEX_SQL)
            self.index_kind = "hnsw"
        except psycopg.Error:
            self._execute(IVFFLAT_INDEX_SQL)
            self.index_kind = "ivfflat"
        return self.index_kind

    def _source_owners(self, source_ids: set[str]) -> dict[str, str]:
        if not source_ids:
            return {}
        with self._cursor() as cur:
            cur.execute(_SOURCE_OWNERS_SQL, [sorted(source_ids)])
            owners = {str(row[0]): str(row[1]) for row in cur.fetchall()}
        missing = sorted(source_ids - owners.keys())
        if missing:
            raise ProviderError(f"unknown knowledge source: {missing[0]}")
        return owners
