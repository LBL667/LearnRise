"""API tests for RAG-based quiz generation.

No network and no real vector store: the service's resolver, embedding
factory and vector-store factory are monkeypatched with fakes.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import Chunk, KnowledgePoint, KnowledgeSource, QuizQuestion, User
from app.ports import ChatMessage, ChatResult, EmbeddingResult, SearchHit

RAG_TEXT = "光合作用把光能转化为化学能并储存在有机物中。"


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

    def _create(display_name: str = "出题用户") -> User:
        user = User(
            email=f"task18-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(QuizQuestion).where(QuizQuestion.user_id.in_(created)))
        db_session.execute(delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created)))
        db_session.execute(delete(Chunk).where(Chunk.user_id.in_(created)))
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_source(db_session: Session, user: User) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        title="生物学讲义",
        filename="biology.pdf",
        content_type="application/pdf",
        size_bytes=2048,
        storage_key=f"{user.id}/biology.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def _make_kp(
    db_session: Session,
    user: User,
    source: KnowledgeSource,
    *,
    title: str = "光合作用",
    content: str = "绿色植物利用光能合成有机物。",
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        chunk_id=None,
        parent_id=None,
        title=title,
        content=content,
        level=0,
        sort_order=0,
        mastery_score=0.0,
    )
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)
    return point


class FakeLLM:
    model = "fake-quiz-model"

    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[ChatMessage]] = []

    def chat(self, messages: list[ChatMessage], **kwargs: Any) -> ChatResult:
        self.calls.append(list(messages))
        index = min(len(self.calls) - 1, len(self.responses) - 1)
        return ChatResult(content=self.responses[index], model=self.model)


class FakeEmbedder:
    def __init__(self) -> None:
        self.inputs: list[str] = []

    def embed(
        self, texts: list[str], *, model: str | None = None
    ) -> EmbeddingResult:
        self.inputs.extend(texts)
        return EmbeddingResult(
            vectors=[[0.1, 0.2, 0.3, 0.4] for _ in texts],
            model="fake-embed",
            dim=4,
        )


class FakeStore:
    def __init__(self, hits: Sequence[SearchHit]) -> None:
        self.hits = list(hits)
        self.calls: list[dict[str, Any]] = []

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        self.calls.append({"top_k": top_k, "source_ids": source_ids})
        return self.hits[:top_k]

    def upsert(self, chunks: list[Any]) -> int:
        return len(chunks)

    def delete_by_source(self, source_id: str) -> int:
        return 0


def _hit(source: KnowledgeSource) -> SearchHit:
    return SearchHit(
        chunk_id=str(uuid.uuid4()),
        source_id=source.id,
        content=RAG_TEXT,
        score=0.91,
        page=2,
        heading="光合作用",
    )


class PatchQuiz:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.monkeypatch = monkeypatch

    def apply(
        self, responses: list[str], source: KnowledgeSource
    ) -> tuple[FakeLLM, FakeEmbedder, FakeStore]:
        fake = FakeLLM(responses)
        embedder = FakeEmbedder()
        store = FakeStore([_hit(source)])

        def _resolve(
            db: Session, *, user_id: str, agent_id: str | None, task_type: str
        ) -> tuple[Any, Any]:
            return fake, None

        self.monkeypatch.setattr("app.services.quiz.resolve_agent", _resolve)
        self.monkeypatch.setattr(
            "app.services.quiz.build_embedding", lambda: embedder
        )
        self.monkeypatch.setattr(
            "app.services.quiz.build_vector_store", lambda: store
        )
        return fake, embedder, store


@pytest.fixture
def patch_quiz(monkeypatch: pytest.MonkeyPatch) -> PatchQuiz:
    return PatchQuiz(monkeypatch)


def _choice(
    *,
    question: str = "光合作用的产物是什么？",
    answer: str = "A",
    options: list[Any] | None = None,
    explanation: str = "光能转化为化学能。",
    difficulty: str = "easy",
) -> dict[str, Any]:
    return {
        "question": question,
        "options": options if options is not None else ["有机物", "氧气", "水", "二氧化碳"],
        "answer": answer,
        "explanation": explanation,
        "difficulty": difficulty,
    }


def _judge(answer: Any = "正确", *, explanation: str = "正确。") -> dict[str, Any]:
    return {
        "question": "光合作用需要光能。",
        "instructions": "判断对错",
        "answer": answer,
        "explanation": explanation,
        "difficulty": "medium",
    }


def _short(explanation: str = "叶绿体是场所。") -> dict[str, Any]:
    return {
        "question": "简述光合作用的场所。",
        "answer": "在叶绿体中进行。",
        "explanation": explanation,
        "difficulty": "hard",
    }


def _payload(items: list[Any]) -> str:
    return json.dumps(items, ensure_ascii=False)


def _post(
    client: TestClient,
    user: User,
    *,
    kp_ids: list[str],
    qtype: str = "choice",
    num: int = 1,
    difficulty: str | None = None,
) -> Any:
    body: dict[str, Any] = {
        "knowledge_point_ids": kp_ids,
        "type": qtype,
        "num": num,
    }
    if difficulty is not None:
        body["difficulty"] = difficulty
    return client.post("/api/quiz/generate", headers=_headers(user), json=body)


def _rows(db_session: Session, user: User) -> list[QuizQuestion]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(QuizQuestion).where(QuizQuestion.user_id == user.id)
        ).all()
    )


def _count(db_session: Session, user: User) -> int:
    db_session.expire_all()
    return int(
        db_session.scalar(
            select(func.count())
            .select_from(QuizQuestion)
            .where(QuizQuestion.user_id == user.id)
        )
        or 0
    )


def test_generate_choice_3(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    items = [
        _choice(question=f"光合作用问题 {index}", answer="ABCD"[index])
        for index in range(3)
    ]
    fake, embedder, store = patch_quiz.apply([_payload(items)], source)

    response = _post(client, user, kp_ids=[point.id], num=3)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["model"] == "fake-quiz-model"
    assert len(body["created"]) == 3
    for index, item in enumerate(body["created"]):
        assert item["type"] == "choice"
        assert len(item["options"]) == 4
        assert item["answer"] == "ABCD"[index]
        assert item["difficulty"] == "easy"
        assert item["question"] == f"光合作用问题 {index}"

    rows = _rows(db_session, user)
    assert len(rows) == 3
    assert all(row.knowledge_point_id == point.id for row in rows)
    assert all(len(row.options or []) == 4 for row in rows)

    assert len(fake.calls) == 1
    assert store.calls and store.calls[0]["top_k"] == 3
    assert store.calls[0]["source_ids"] == [source.id]
    assert embedder.inputs and point.title in embedder.inputs[0]


def test_invalid_answer_rejected(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    fake, _embedder, _store = patch_quiz.apply([_payload([_choice(answer="Z")])], source)

    response = _post(client, user, kp_ids=[point.id], num=1)

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["message"] == "出题失败：JSON 校验未通过"
    assert detail["raw"]
    assert len(fake.calls) == 2
    assert _count(db_session, user) == 0


def test_num_over_20_400(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    fake, _embedder, _store = patch_quiz.apply([_payload([_choice()])], source)

    too_many = _post(client, user, kp_ids=[point.id], num=21)
    zero = _post(client, user, kp_ids=[point.id], num=0)

    assert too_many.status_code == 400, too_many.text
    assert too_many.json()["detail"] == "生成数量需在 1-20 之间"
    assert zero.status_code == 400, zero.text
    assert zero.json()["detail"] == "生成数量需在 1-20 之间"
    assert fake.calls == []
    assert _count(db_session, user) == 0


def test_empty_kp_ids_400(
    client: TestClient,
    make_user: Callable[..., User],
) -> None:
    user = make_user()

    response = _post(client, user, kp_ids=[], num=3)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "知识点列表不能为空"


def test_foreign_kp_404(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    owner = make_user()
    intruder = make_user()
    source = _make_source(db_session, owner)
    point = _make_kp(db_session, owner, source)
    fake, _embedder, _store = patch_quiz.apply([_payload([_choice()])], source)

    foreign = _post(client, intruder, kp_ids=[point.id], num=1)
    unknown = _post(client, owner, kp_ids=[str(uuid.uuid4())], num=1)
    invalid = _post(client, owner, kp_ids=["not-a-uuid"], num=1)

    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["detail"] == "资源不存在"
    assert unknown.status_code == 404, unknown.text
    assert invalid.status_code == 404, invalid.text
    assert fake.calls == []
    assert _count(db_session, owner) == 0


def test_judge_normalized(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    patch_quiz.apply([_payload([_judge("正确")])], source)

    response = _post(client, user, kp_ids=[point.id], qtype="judge", num=1)

    assert response.status_code == 201, response.text
    item = response.json()["created"][0]
    assert item["type"] == "judge"
    assert item["answer"] == "true"
    assert item["options"] is None

    rows = _rows(db_session, user)
    assert len(rows) == 1
    assert rows[0].answer == "true"


def test_short_answer_requires_explanation(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    fake, _embedder, _store = patch_quiz.apply(
        [_payload([_short(explanation="   ")])], source
    )

    response = _post(client, user, kp_ids=[point.id], qtype="short_answer", num=1)

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["message"] == "出题失败：JSON 校验未通过"
    assert len(fake.calls) == 2
    assert _count(db_session, user) == 0


def test_invalid_then_valid_retry(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    fake, _embedder, _store = patch_quiz.apply(
        ["这不是 JSON", _payload([_choice(question="重试成功")])], source
    )

    response = _post(client, user, kp_ids=[point.id], num=1)

    assert response.status_code == 201, response.text
    assert response.json()["created"][0]["question"] == "重试成功"
    assert len(fake.calls) == 2
    assert fake.calls[1][-1].content.startswith("只输出合法 JSON 数组")
    assert _count(db_session, user) == 1


def test_rag_context_used(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    fake, _embedder, store = patch_quiz.apply([_payload([_choice()])], source)

    response = _post(client, user, kp_ids=[point.id], num=1)

    assert response.status_code == 201, response.text
    assert store.calls[0]["source_ids"] == [source.id]
    assert store.calls[0]["top_k"] == 3
    assert RAG_TEXT in fake.calls[0][1].content
    assert point.title in fake.calls[0][1].content


def test_num_distribution(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    first = _make_kp(db_session, user, source, title="光反应", content="类囊体薄膜。")
    second = _make_kp(db_session, user, source, title="暗反应", content="叶绿体基质。")
    items = [_choice(question=f"综合题 {index}") for index in range(4)]
    _fake, embedder, _store = patch_quiz.apply([_payload(items)], source)

    response = _post(client, user, kp_ids=[first.id, second.id], num=4)

    assert response.status_code == 201, response.text
    assert len(response.json()["created"]) == 4
    assert len(embedder.inputs) == 2

    rows = _rows(db_session, user)
    assert len(rows) == 4
    counts = {first.id: 0, second.id: 0}
    for row in rows:
        counts[row.knowledge_point_id] += 1
    assert counts == {first.id: 2, second.id: 2}


def _put_learning_prefs(client: TestClient, user: User, body: dict[str, Any]) -> None:
    response = client.put(
        "/api/profile/preferences/learning", json=body, headers=_headers(user)
    )
    assert response.status_code == 200, response.text


def test_generate_uses_learning_preferences_when_fields_omitted(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    _put_learning_prefs(
        client,
        user,
        {
            "default_difficulty": "hard",
            "default_question_types": ["short_answer"],
            "default_quiz_num": 2,
        },
    )
    items = [_short(f"解析 {index}") for index in range(2)]
    fake, _embedder, _store = patch_quiz.apply([_payload(items)], source)

    response = client.post(
        "/api/quiz/generate",
        json={"knowledge_point_ids": [point.id]},
        headers=_headers(user),
    )

    assert response.status_code == 201, response.text
    created = response.json()["created"]
    assert len(created) == 2
    assert {item["type"] for item in created} == {"short_answer"}
    prompt = "\n".join(message.content for message in fake.calls[0])
    assert "2 道简答题" in prompt
    assert "难度 hard" in prompt


def test_explicit_generate_params_override_learning_preferences(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    patch_quiz: PatchQuiz,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    _put_learning_prefs(
        client,
        user,
        {
            "default_difficulty": "hard",
            "default_question_types": ["short_answer"],
            "default_quiz_num": 2,
        },
    )
    fake, _embedder, _store = patch_quiz.apply([_payload([_choice()])], source)

    response = _post(
        client, user, kp_ids=[point.id], qtype="choice", num=1, difficulty="easy"
    )

    assert response.status_code == 201, response.text
    created = response.json()["created"]
    assert len(created) == 1
    assert created[0]["type"] == "choice"
    prompt = "\n".join(message.content for message in fake.calls[0])
    assert "1 道选择题" in prompt
    assert "难度 easy" in prompt
