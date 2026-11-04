"""API tests for the upload → async ingestion pipeline.

BackgroundTasks executes inline under ``TestClient``, so an autouse fixture
replaces ``run_ingest`` with a no-op on the module object and each test calls
the real pipeline explicitly. That keeps every assertion deterministic and
avoids depending on background scheduling.

The PDF fixture is built in-memory (2 pages × 20 short Chinese sentences). At
~30 tokens per sentence a page comfortably exceeds the 500-token chunk budget,
giving at least two chunks per page (≥4 total). The plan's "≥20 chunks" target
refers to its 20-page fixture; the assertion here is ``>= 4`` by design.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.adapters.storage.local import LocalStorage
from app.adapters.vector import PgVectorStore
from app.api.auth import create_access_token
from app.config import settings as app_settings
from app.db import SessionLocal
from app.models import Chunk, IngestionJob, KnowledgeSource, User
from app.ports import (
    ChunkRecord,
    EmbeddingResult,
    ProviderRateLimitError,
    SearchHit,
    VectorStore,
)
from app.services import ingest as ingest_service
from app.services.ingest import run_ingest as real_run_ingest

DIM = 1024
README = "pdf, docx, txt, md, png, jpg, jpeg"


class FakeEmbedding:
    """Deterministic 1024-dim embeddings with optional rate-limit behaviour."""

    def __init__(self, *, fail_first: bool = False, fail_all: bool = False) -> None:
        self.calls = 0
        self.fail_first = fail_first
        self.fail_all = fail_all
        self.batch_sizes: list[int] = []

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        self.calls += 1
        if self.fail_all or (self.fail_first and self.calls == 1):
            raise ProviderRateLimitError("rate limited")
        self.batch_sizes.append(len(texts))
        vectors: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            vector = [0.0] * DIM
            vector[int.from_bytes(digest[:2], "big") % DIM] = 1.0
            vectors.append(vector)
        return EmbeddingResult(vectors=vectors, model=model or "fake-embedding", dim=DIM)


class FakeVectorStore:
    """In-memory :class:`VectorStore` capturing upserted records."""

    def __init__(self) -> None:
        self.records: dict[str, ChunkRecord] = {}

    def upsert(self, chunks: list[ChunkRecord]) -> int:
        for record in chunks:
            self.records[record.chunk_id] = record
        return len(chunks)

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        return []

    def delete_by_source(self, source_id: str) -> int:
        doomed = [
            chunk_id
            for chunk_id, record in self.records.items()
            if record.source_id == source_id
        ]
        for chunk_id in doomed:
            del self.records[chunk_id]
        return len(doomed)


@dataclass
class PipelineEnv:
    embedding: FakeEmbedding
    store: FakeVectorStore


def _headers(user: User | None) -> dict[str, str]:
    if user is None:
        return {}
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _pdf_bytes() -> bytes:
    document = fitz.open()
    try:
        for _ in range(2):
            page = document.new_page()
            y = 72
            for index in range(20):
                sentence = (
                    f"第{index + 1}句：在计算机网络中，协议定义了通信双方"
                    "必须遵守的规则与数据格式。"
                )
                page.insert_text((72, y), sentence, fontname="china-s", fontsize=9)
                y += 18
        return document.tobytes()
    finally:
        document.close()


@pytest.fixture(autouse=True)
def _keep_pipeline_synchronous(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise BackgroundTasks + retry sleeps for deterministic tests."""
    monkeypatch.setattr(ingest_service, "run_ingest", lambda job_id: None)
    monkeypatch.setattr(ingest_service, "_sleep", lambda seconds: None)


@pytest.fixture(autouse=True)
def _isolated_storage(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> LocalStorage:
    storage = LocalStorage(tmp_path / "storage")
    monkeypatch.setattr(ingest_service, "build_storage", lambda: storage)
    return storage


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

    def _create(display_name: str = "摄入用户") -> User:
        user = User(
            email=f"task15-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


@pytest.fixture
def pipeline(monkeypatch: pytest.MonkeyPatch) -> PipelineEnv:
    env = PipelineEnv(embedding=FakeEmbedding(), store=FakeVectorStore())
    monkeypatch.setattr(ingest_service, "build_embedding", lambda: env.embedding)
    monkeypatch.setattr(ingest_service, "build_vector_store", lambda: env.store)
    return env


def _upload(
    client: TestClient,
    user: User | None,
    data: bytes,
    *,
    filename: str = "handout.pdf",
    content_type: str = "application/pdf",
) -> Any:
    return client.post(
        "/api/sources/upload",
        headers=_headers(user),
        files={"file": (filename, data, content_type)},
    )


def _chunk_count(db: Session, source_id: str) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(Chunk).where(Chunk.source_id == source_id)
        )
        or 0
    )


def test_upload_pdf_ready(
    client: TestClient,
    make_user: Callable[..., User],
    pipeline: PipelineEnv,
) -> None:
    user = make_user()

    response = _upload(client, user, _pdf_bytes())

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "queued"
    assert set(body) == {"source_id", "job_id", "status"}

    real_run_ingest(body["job_id"])

    job = client.get(f"/api/jobs/{body['job_id']}", headers=_headers(user))
    assert job.status_code == 200
    job_body = job.json()
    assert job_body["status"] == "ready"
    assert job_body["progress"] == 100
    assert job_body["failed_chunks"] == 0
    assert job_body["started_at"] is not None
    assert job_body["finished_at"] is not None

    source = client.get(f"/api/sources/{body['source_id']}", headers=_headers(user))
    assert source.status_code == 200
    source_body = source.json()
    assert source_body["status"] == "ready"
    assert source_body["page_count"] == 2
    assert source_body["content_type"] == "application/pdf"
    assert source_body["title"] == "handout"

    assert len(pipeline.store.records) >= 4
    assert all(record.embedding_dim == DIM for record in pipeline.store.records.values())


def test_upload_mismatched_declared_type_uses_canonical(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = _upload(
        client,
        user,
        b"plain text body",
        filename="notes.txt",
        content_type="application/octet-stream",
    )

    assert response.status_code == 202
    source = client.get(
        f"/api/sources/{response.json()['source_id']}", headers=_headers(user)
    )
    assert source.json()["content_type"] == "text/plain"


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [("picture.webp", "image/webp"), ("scan.heic", "image/heic")],
)
def test_unsupported_type_415(
    client: TestClient,
    make_user: Callable[..., User],
    pipeline: PipelineEnv,
    filename: str,
    content_type: str,
) -> None:
    user = make_user()

    response = _upload(client, user, b"binary", filename=filename, content_type=content_type)

    assert response.status_code == 415
    detail = response.json()["detail"]
    for extension in README.split(", "):
        assert extension in detail
    assert pipeline.store.records == {}


def test_empty_file_400(
    client: TestClient, make_user: Callable[..., User], pipeline: PipelineEnv
) -> None:
    user = make_user()

    response = _upload(client, user, b"", filename="empty.txt", content_type="text/plain")

    assert response.status_code == 400
    assert response.json()["detail"] == "文件为空"
    assert pipeline.store.records == {}


def test_oversize_413(
    client: TestClient,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    monkeypatch.setattr(app_settings, "max_upload_mb", 1)
    payload = b"a" * (2 * 1024 * 1024)

    response = _upload(client, user, payload, filename="big.txt", content_type="text/plain")

    assert response.status_code == 413
    assert "1MB" in response.json()["detail"]


def test_upload_requires_authentication(client: TestClient) -> None:
    response = _upload(client, None, b"hello", filename="a.txt", content_type="text/plain")
    assert response.status_code == 401


def test_cross_user_404(
    client: TestClient, make_user: Callable[..., User], pipeline: PipelineEnv
) -> None:
    owner = make_user()
    intruder = make_user()
    uploaded = _upload(client, owner, b"hello", filename="a.txt", content_type="text/plain")
    source_id = uploaded.json()["source_id"]
    job_id = uploaded.json()["job_id"]

    source = client.get(f"/api/sources/{source_id}", headers=_headers(intruder))
    job = client.get(f"/api/jobs/{job_id}", headers=_headers(intruder))
    reprocess = client.post(
        f"/api/sources/{source_id}/reprocess", headers=_headers(intruder)
    )

    assert source.status_code == 404
    assert job.status_code == 404
    assert reprocess.status_code == 404
    assert source.json()["detail"] == "资源不存在"


def test_list_sources_is_user_scoped_and_newest_first(
    client: TestClient, make_user: Callable[..., User], pipeline: PipelineEnv
) -> None:
    owner = make_user()
    stranger = make_user()
    first = _upload(client, owner, b"one", filename="one.txt", content_type="text/plain")
    second = _upload(client, owner, b"two", filename="two.txt", content_type="text/plain")

    listing = client.get("/api/sources", headers=_headers(owner))
    other = client.get("/api/sources", headers=_headers(stranger))

    assert listing.status_code == 200
    rows = listing.json()
    assert [row["id"] for row in rows] == [
        second.json()["source_id"],
        first.json()["source_id"],
    ]
    assert set(rows[0]) == {
        "id",
        "title",
        "filename",
        "content_type",
        "size_bytes",
        "status",
        "page_count",
        "created_at",
    }
    assert rows[0]["filename"] == "two.txt"
    assert rows[0]["size_bytes"] == 3
    assert other.json() == []


def test_embedding_429_retry(
    client: TestClient, make_user: Callable[..., User], monkeypatch: pytest.MonkeyPatch
) -> None:
    user = make_user()
    embedding = FakeEmbedding(fail_first=True)
    store = FakeVectorStore()
    monkeypatch.setattr(ingest_service, "build_embedding", lambda: embedding)
    monkeypatch.setattr(ingest_service, "build_vector_store", lambda: store)
    uploaded = _upload(client, user, _pdf_bytes())

    real_run_ingest(uploaded.json()["job_id"])

    job = client.get(f"/api/jobs/{uploaded.json()['job_id']}", headers=_headers(user)).json()
    assert job["status"] == "ready"
    assert job["failed_chunks"] == 0
    assert embedding.calls >= 2
    assert len(store.records) >= 4


def test_all_batches_fail(
    client: TestClient, make_user: Callable[..., User], monkeypatch: pytest.MonkeyPatch
) -> None:
    user = make_user()
    embedding = FakeEmbedding(fail_all=True)
    store = FakeVectorStore()
    monkeypatch.setattr(ingest_service, "build_embedding", lambda: embedding)
    monkeypatch.setattr(ingest_service, "build_vector_store", lambda: store)
    uploaded = _upload(client, user, _pdf_bytes())

    real_run_ingest(uploaded.json()["job_id"])

    job = client.get(f"/api/jobs/{uploaded.json()['job_id']}", headers=_headers(user)).json()
    assert job["status"] == "failed"
    assert job["failed_chunks"] > 0
    assert store.records == {}

    source = client.get(
        f"/api/sources/{uploaded.json()['source_id']}", headers=_headers(user)
    ).json()
    assert source["status"] == "failed"


def test_empty_document_ready_empty(
    client: TestClient, make_user: Callable[..., User], pipeline: PipelineEnv
) -> None:
    user = make_user()
    uploaded = _upload(
        client,
        user,
        b"   \n\t\n  ",
        filename="blank.txt",
        content_type="text/plain",
    )

    real_run_ingest(uploaded.json()["job_id"])

    job = client.get(f"/api/jobs/{uploaded.json()['job_id']}", headers=_headers(user)).json()
    source = client.get(
        f"/api/sources/{uploaded.json()['source_id']}", headers=_headers(user)
    ).json()

    assert job["status"] == "ready_empty"
    assert job["progress"] == 100
    assert job["failed_chunks"] == 0
    assert source["status"] == "ready_empty"
    assert source["page_count"] == 0
    assert pipeline.store.records == {}


def test_run_ingest_is_idempotent_after_ready(
    client: TestClient, make_user: Callable[..., User], pipeline: PipelineEnv
) -> None:
    user = make_user()
    uploaded = _upload(client, user, _pdf_bytes())
    real_run_ingest(uploaded.json()["job_id"])
    upserts_after_first = len(pipeline.store.records)

    real_run_ingest(uploaded.json()["job_id"])

    assert len(pipeline.store.records) == upserts_after_first
    job = client.get(f"/api/jobs/{uploaded.json()['job_id']}", headers=_headers(user)).json()
    assert job["status"] == "ready"


def test_reprocess_deletes_old_chunks(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    source = KnowledgeSource(
        user_id=user.id,
        title="旧资料",
        filename="old.pdf",
        content_type="application/pdf",
        size_bytes=10,
        storage_key=f"{user.id}/{uuid.uuid4()}/old.pdf",
        status="ready",
        page_count=1,
    )
    db_session.add(source)
    db_session.flush()
    for index in range(3):
        db_session.add(
            Chunk(
                source_id=source.id,
                user_id=user.id,
                chunk_index=index,
                content=f"old-{index}",
                token_count=1,
                embedding_model="fake-embedding",
                embedding_dim=DIM,
                embedding_version="1",
            )
        )
    db_session.commit()
    assert _chunk_count(db_session, source.id) == 3

    response = client.post(
        f"/api/sources/{source.id}/reprocess", headers=_headers(user)
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["source_id"] == source.id
    assert body["job_id"] != source.id
    db_session.expire_all()
    assert _chunk_count(db_session, source.id) == 0
    refreshed = db_session.get(KnowledgeSource, source.id)
    assert refreshed is not None
    assert refreshed.status == "pending"
    job = db_session.get(IngestionJob, body["job_id"])
    assert job is not None
    assert job.status == "queued"


def test_integration_real_vector_store(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    store = PgVectorStore()
    monkeypatch.setattr(ingest_service, "build_embedding", lambda: FakeEmbedding())
    monkeypatch.setattr(ingest_service, "build_vector_store", lambda: store)
    try:
        uploaded = _upload(client, user, _pdf_bytes())
        assert uploaded.status_code == 202

        real_run_ingest(uploaded.json()["job_id"])

        job = client.get(
            f"/api/jobs/{uploaded.json()['job_id']}", headers=_headers(user)
        ).json()
        assert job["status"] == "ready"
        assert isinstance(store, VectorStore)
        db_session.expire_all()
        assert _chunk_count(db_session, uploaded.json()["source_id"]) >= 4
    finally:
        store.close()


def test_delete_source_owner_only_cascades_and_removes_file(
    client: TestClient, db_session: Session, make_user: Callable[..., User],
    _isolated_storage: LocalStorage, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.sources as source_api
    from app.models import KnowledgePoint, QuizQuestion

    monkeypatch.setattr(source_api, "build_storage", lambda: _isolated_storage)
    owner, other = make_user("资料拥有者"), make_user("其他用户")
    uploaded = _upload(client, owner, b"test document", filename="test.txt", content_type="text/plain").json()
    source = db_session.get(KnowledgeSource, uploaded["source_id"])
    job = db_session.get(IngestionJob, uploaded["job_id"])
    assert source is not None and job is not None
    storage_key = source.storage_key
    assert client.delete(f"/api/sources/{source.id}", headers=_headers(other)).status_code == 404
    assert client.delete(f"/api/sources/{source.id}", headers=_headers(owner)).status_code == 409
    source.status = "ready"
    job.status = "ready"
    point = KnowledgePoint(user_id=owner.id, source_id=source.id, title="测试", content="测试")
    db_session.add(point)
    db_session.flush()
    question = QuizQuestion(user_id=owner.id, knowledge_point_id=point.id, type="choice", question="测试题", options=["a", "b"], answer="A", explanation="", difficulty="easy")
    db_session.add(question)
    db_session.commit()
    point_id, question_id, source_id = point.id, question.id, source.id
    result = client.delete(f"/api/sources/{source_id}", headers=_headers(owner))
    assert result.status_code == 204, result.text
    db_session.expire_all()
    assert db_session.get(KnowledgeSource, source_id) is None
    assert db_session.get(KnowledgePoint, point_id) is None
    assert db_session.get(QuizQuestion, question_id) is None
    assert _isolated_storage.delete(storage_key) is False
    assert client.get(f"/api/sources/{source_id}", headers=_headers(owner)).status_code == 404


def test_delete_source_keeps_database_when_storage_fails(
    client: TestClient, db_session: Session, make_user: Callable[..., User], monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.sources as source_api
    user = make_user("删除失败")
    uploaded = _upload(client, user, b"test document", filename="failure.txt", content_type="text/plain").json()
    source = db_session.get(KnowledgeSource, uploaded["source_id"])
    job = db_session.get(IngestionJob, uploaded["job_id"])
    assert source is not None and job is not None
    source.status = "ready"
    job.status = "ready"
    db_session.commit()
    class FailingStorage:
        def delete(self, key: str) -> bool:
            raise OSError("storage failure")
    monkeypatch.setattr(source_api, "build_storage", lambda: FailingStorage())
    response = client.delete(f"/api/sources/{source.id}", headers=_headers(user))
    assert response.status_code == 500
    assert client.get(f"/api/sources/{source.id}", headers=_headers(user)).status_code == 200
