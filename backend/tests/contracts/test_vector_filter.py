"""Filtered vector search: scope filters and recall against a seeded set.

Seeds two competitions (plus separate owners) with random embeddings, builds the
ANN index through the production code path, and proves that an isolated
``competition_id`` filter (the denormalised ``chunks.competition_id`` column)
still returns the true nearest neighbours: recall@10 must stay above 0.9.
"""

from __future__ import annotations

import math
import random
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from sqlalchemy import delete

from app.adapters.vector import PgVectorStore
from app.db import SessionLocal
from app.models import Chunk, Competition, KnowledgeSource, User
from app.ports import ChunkRecord

DIM = 1024
MODEL = "bge-m3"
SEED = 20261101
PER_SCOPE = 80
QUERIES = 10
TOP_K = 10
MIN_RECALL = 0.9


def _unit(rng: random.Random) -> list[float]:
    vector = [rng.gauss(0.0, 1.0) for _ in range(DIM)]
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector]


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


@dataclass
class Seeded:
    competition_id: str
    source_id: str
    user_id: str
    vectors: dict[str, list[float]]


@pytest.fixture
def seeded() -> Iterator[tuple[Seeded, Seeded, PgVectorStore]]:
    rng = random.Random(SEED)
    store = PgVectorStore()
    user_ids: list[str] = []
    competition_ids: list[str] = []
    seeds: list[Seeded] = []

    with SessionLocal() as db:
        for _ in range(2):
            user = User(email=f"filter-{uuid.uuid4().hex}@example.com", display_name="filter")
            db.add(user)
            db.flush()
            competition = Competition(owner_id=user.id, title="过滤竞赛")
            db.add(competition)
            db.flush()
            source = KnowledgeSource(
                user_id=user.id,
                competition_id=competition.id,
                title="过滤资料",
                filename="filter.md",
                content_type="text/markdown",
                size_bytes=0,
                storage_key=f"filter/{uuid.uuid4().hex}.md",
                status="ready",
            )
            db.add(source)
            db.flush()
            user_ids.append(user.id)
            competition_ids.append(competition.id)
            seeds.append(
                Seeded(
                    competition_id=competition.id,
                    source_id=source.id,
                    user_id=user.id,
                    vectors={},
                )
            )
        db.commit()

    try:
        for seed in seeds:
            records: list[ChunkRecord] = []
            for index in range(PER_SCOPE):
                chunk_id = str(uuid.uuid4())
                vector = _unit(rng)
                seed.vectors[chunk_id] = vector
                records.append(
                    ChunkRecord(
                        chunk_id=chunk_id,
                        source_id=seed.source_id,
                        content=f"chunk-{index}",
                        page=None,
                        heading=None,
                        embedding=vector,
                        embedding_model=MODEL,
                        embedding_dim=DIM,
                        embedding_version="1",
                    )
                )
            store.upsert(records)
        store.ensure_index()
        yield seeds[0], seeds[1], store
    finally:
        for seed in seeds:
            store.delete_by_source(seed.source_id)
        store.close()
        with SessionLocal() as db:
            db.execute(delete(Chunk).where(Chunk.user_id.in_(user_ids)))
            db.execute(
                delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(user_ids))
            )
            db.execute(delete(Competition).where(Competition.id.in_(competition_ids)))
            db.execute(delete(User).where(User.id.in_(user_ids)))
            db.commit()


def _ground_truth(seed: Seeded, query: list[float]) -> set[str]:
    scored = sorted(
        ((_dot(query, vector), chunk_id) for chunk_id, vector in seed.vectors.items()),
        reverse=True,
    )
    return {chunk_id for _score, chunk_id in scored[:TOP_K]}


def test_filtered_search_recall(seeded: tuple[Seeded, Seeded, PgVectorStore]) -> None:
    first, second, store = seeded
    rng = random.Random(SEED + 1)
    overlaps: list[float] = []

    for chunk_id in list(first.vectors)[:QUERIES]:
        query = [
            value + rng.gauss(0.0, 0.02)
            for value in first.vectors[chunk_id]
        ]
        expected = _ground_truth(first, query)
        hits = store.search(query, top_k=TOP_K, competition_id=first.competition_id)
        returned = {hit.chunk_id for hit in hits}
        overlaps.append(len(returned & expected) / TOP_K)
        assert all(hit.source_id == first.source_id for hit in hits)

    recall = sum(overlaps) / len(overlaps)
    assert recall >= MIN_RECALL

    unfiltered = store.search(
        first.vectors[next(iter(first.vectors))],
        top_k=TOP_K,
        competition_id=second.competition_id,
    )
    assert unfiltered
    assert all(hit.source_id == second.source_id for hit in unfiltered)


def test_user_filter_isolates_chunk_owners(
    seeded: tuple[Seeded, Seeded, PgVectorStore],
) -> None:
    first, second, store = seeded
    query = next(iter(first.vectors.values()))

    own = store.search(query, top_k=TOP_K, user_id=first.user_id)
    other = store.search(query, top_k=TOP_K, user_id=second.user_id)

    assert own
    assert other
    assert all(hit.source_id == first.source_id for hit in own)
    assert all(hit.source_id == second.source_id for hit in other)
