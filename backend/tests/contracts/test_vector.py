"""Contract tests for the pgvector adapter against the real Postgres container."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import replace

import psycopg
import pytest
from sqlalchemy import delete, func, select

from app.adapters.vector import (
    HNSW_INDEX_SQL,
    IVFFLAT_INDEX_SQL,
    PgVectorStore,
    build_vector_store,
)
from app.config import Settings
from app.db import SessionLocal
from app.models import Chunk, KnowledgeSource, User
from app.ports import ChunkRecord, DimensionMismatch, SearchHit, VectorStore

DIM = 1024
MODEL = "bge-m3"


def unit(index: int) -> list[float]:
    vector = [0.0] * DIM
    vector[index] = 1.0
    return vector


def make_record(
    source_id: str,
    position: int,
    *,
    content: str | None = None,
    chunk_id: str | None = None,
    page: int | None = None,
    heading: str | None = None,
) -> ChunkRecord:
    return ChunkRecord(
        chunk_id=chunk_id or str(uuid.uuid4()),
        source_id=source_id,
        content=content if content is not None else f"chunk-{position}",
        page=page,
        heading=heading,
        embedding=unit(position),
        embedding_model=MODEL,
        embedding_dim=DIM,
        embedding_version="1",
    )


@pytest.fixture
def sources() -> Iterator[Callable[..., list[str]]]:
    user_ids: list[str] = []

    def _create(count: int = 1) -> list[str]:
        with SessionLocal() as db:
            user = User(
                email=f"task9-{uuid.uuid4().hex}@example.com",
                display_name="task9 vector",
            )
            db.add(user)
            db.flush()
            created: list[str] = []
            for _ in range(count):
                source = KnowledgeSource(
                    user_id=user.id,
                    title="task9 vector source",
                    filename="task9.pdf",
                    content_type="application/pdf",
                    size_bytes=1,
                    storage_key=f"task9/{uuid.uuid4().hex}.pdf",
                )
                db.add(source)
                db.flush()
                created.append(source.id)
            db.commit()
            user_ids.append(user.id)
        return created

    yield _create

    if user_ids:
        with SessionLocal() as db:
            db.execute(delete(Chunk).where(Chunk.user_id.in_(user_ids)))
            db.execute(delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(user_ids)))
            db.execute(delete(User).where(User.id.in_(user_ids)))
            db.commit()


@pytest.fixture
def store() -> Iterator[PgVectorStore]:
    with PgVectorStore() as opened:
        yield opened


def chunk_count(source_id: str) -> int:
    with SessionLocal() as db:
        return int(
            db.scalar(
                select(func.count()).select_from(Chunk).where(Chunk.source_id == source_id)
            )
            or 0
        )


def stored_content(source_id: str) -> str:
    with SessionLocal() as db:
        value = db.scalar(select(Chunk.content).where(Chunk.source_id == source_id))
    assert isinstance(value, str)
    return value


def test_adapter_implements_port(store: PgVectorStore) -> None:
    assert isinstance(store, VectorStore)


def test_factory_uses_pgvector_for_both_profiles() -> None:
    cfg = Settings(
        provider_profile="huawei",
        database_url="postgresql+psycopg://user:pass@rds.example:5432/learnrise",
    )
    remote = build_vector_store(settings=cfg)
    assert isinstance(remote, PgVectorStore)
    assert remote.dsn == "postgresql://user:pass@rds.example:5432/learnrise"
    remote.close()

    local_cfg = Settings(
        provider_profile="local",
        database_url="postgresql+psycopg://learnrise:learnrise@db:5432/learnrise",
    )
    local = build_vector_store(settings=local_cfg)
    assert isinstance(local, PgVectorStore)
    assert local.dsn == "postgresql://learnrise:learnrise@db:5432/learnrise"
    local.close()


def test_topk_order(store: PgVectorStore, sources: Callable[..., list[str]]) -> None:
    source_id = sources(1)[0]
    records = [
        make_record(source_id, index, page=index + 1, heading=f"h{index}")
        for index in range(5)
    ]
    assert store.upsert(records) == 5

    hits = store.search(unit(3), top_k=5, source_ids=[source_id])

    assert len(hits) == 5
    assert hits[0].chunk_id == records[3].chunk_id
    assert hits[0].page == 4
    assert hits[0].heading == "h3"
    assert all(isinstance(hit, SearchHit) for hit in hits)
    scores = [hit.score for hit in hits]
    assert scores == sorted(scores, reverse=True)
    assert scores[0] == pytest.approx(1.0)

    assert len(store.search(unit(0), top_k=3, source_ids=[source_id])) == 3


def test_upsert_idempotent(
    store: PgVectorStore, sources: Callable[..., list[str]]
) -> None:
    source_id = sources(1)[0]
    record = make_record(source_id, 0, content="first")

    assert store.upsert([record]) == 1
    assert chunk_count(source_id) == 1

    assert store.upsert([replace(record, content="second")]) == 1

    assert chunk_count(source_id) == 1
    assert stored_content(source_id) == "second"


def test_dim_mismatch(store: PgVectorStore, sources: Callable[..., list[str]]) -> None:
    source_id = sources(1)[0]
    short = make_record(source_id, 0)
    short = replace(short, embedding=[0.0] * 768, embedding_dim=768)

    with pytest.raises(DimensionMismatch):
        store.upsert([short])

    with pytest.raises(DimensionMismatch):
        store.search([0.0] * 768)

    assert chunk_count(source_id) == 0


def test_delete_by_source(
    store: PgVectorStore, sources: Callable[..., list[str]]
) -> None:
    source_id = sources(1)[0]
    assert store.upsert([make_record(source_id, index) for index in range(3)]) == 3

    assert store.delete_by_source(source_id) == 3
    assert chunk_count(source_id) == 0
    assert store.delete_by_source(source_id) == 0


def test_filter_by_source_ids(
    store: PgVectorStore, sources: Callable[..., list[str]]
) -> None:
    first, second = sources(2)
    assert store.upsert([make_record(first, index) for index in range(2)]) == 2
    assert store.upsert([make_record(second, index) for index in range(2)]) == 2

    hits = store.search(unit(0), top_k=10, source_ids=[first])

    assert len(hits) == 2
    assert {hit.source_id for hit in hits} == {first}


def test_empty_search(store: PgVectorStore) -> None:
    assert store.search(unit(0), source_ids=[str(uuid.uuid4())]) == []


def test_ensure_index_uses_hnsw(store: PgVectorStore) -> None:
    assert store.ensure_index() == "hnsw"
    assert store.index_kind == "hnsw"


def test_ensure_index_falls_back_to_ivfflat(monkeypatch: pytest.MonkeyPatch) -> None:
    store = PgVectorStore()
    original = store._execute
    seen: list[str] = []

    def flaky(sql: str, params: object | None = None) -> int:
        seen.append(sql)
        if sql == HNSW_INDEX_SQL:
            raise psycopg.errors.UndefinedObject("hnsw is not supported")
        return original(sql, params)  # type: ignore[arg-type]

    monkeypatch.setattr(store, "_execute", flaky)
    try:
        assert store.ensure_index() == "ivfflat"
        assert store.index_kind == "ivfflat"
    finally:
        store.close()

    assert IVFFLAT_INDEX_SQL in seen
    assert HNSW_INDEX_SQL in seen
