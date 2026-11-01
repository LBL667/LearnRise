"""API tests for persisted trial exams and server-side grading."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import (
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    TrialAnswer,
    TrialExam,
    User,
)


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

    def _create(display_name: str = "试炼用户") -> User:
        user = User(
            email=f"trial-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        exam_ids = db_session.scalars(
            select(TrialExam.id).where(TrialExam.user_id.in_(created))
        ).all()
        if exam_ids:
            db_session.execute(delete(TrialAnswer).where(TrialAnswer.exam_id.in_(exam_ids)))
            db_session.execute(delete(TrialExam).where(TrialExam.id.in_(exam_ids)))
        db_session.execute(delete(QuizQuestion).where(QuizQuestion.user_id.in_(created)))
        db_session.execute(delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created)))
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


@pytest.fixture
def make_question(
    db_session: Session,
) -> Iterator[Callable[..., QuizQuestion]]:
    points: dict[str, KnowledgePoint] = {}

    def _create(
        user: User,
        *,
        stem: str = "题干",
        qtype: str = "choice",
        options: list[Any] | None = None,
        answer: str = "A",
        explanation: str = "解析",
    ) -> QuizQuestion:
        point = points.get(user.id)
        if point is None:
            source = KnowledgeSource(
                user_id=user.id,
                title="试炼讲义",
                filename="trial.pdf",
                content_type="application/pdf",
                size_bytes=1,
                storage_key=f"tests/{uuid.uuid4().hex}.pdf",
                status="ready",
            )
            db_session.add(source)
            db_session.commit()
            db_session.refresh(source)
            point = KnowledgePoint(
                user_id=user.id,
                source_id=source.id,
                title="试炼知识点",
                content="",
                level=0,
                sort_order=0,
            )
            db_session.add(point)
            db_session.commit()
            db_session.refresh(point)
            points[user.id] = point
        question = QuizQuestion(
            user_id=user.id,
            knowledge_point_id=point.id,
            type=qtype,
            question=stem,
            options=options,
            answer=answer,
            explanation=explanation,
            difficulty="medium",
        )
        db_session.add(question)
        db_session.commit()
        db_session.refresh(question)
        return question

    yield _create


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _start(client: TestClient, user: User, **payload: Any) -> dict[str, Any]:
    response = client.post("/api/trial/exams", json=payload, headers=_headers(user))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def test_start_freezes_ordered_questions_and_leaks_no_answers(
    client: TestClient, db_session: Session, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    first = make_question(
        user,
        stem="单选题",
        qtype="choice",
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
        answer="B",
    )
    second = make_question(user, stem="判断题", qtype="judge", answer="true")
    third = make_question(user, stem="填空题", qtype="short_answer", answer="光合作用")

    body = _start(client, user, count=3)

    assert body["total"] == 3
    assert body["exam_id"]
    assert body["expires_at"]
    assert [question["no"] for question in body["questions"]] == [1, 2, 3]
    assert [question["id"] for question in body["questions"]] == [
        first.id,
        second.id,
        third.id,
    ]
    assert body["questions"][2]["type"] == "blank"
    assert body["questions"][0]["options"] == [
        {"key": "A", "text": "甲"},
        {"key": "B", "text": "乙"},
        {"key": "C", "text": "丙"},
        {"key": "D", "text": "丁"},
    ]
    assert all(question["score"] == 33 for question in body["questions"])
    for question in body["questions"]:
        assert "answer" not in question
        assert "explanation" not in question

    exam = db_session.get(TrialExam, body["exam_id"])
    assert exam is not None
    assert exam.question_ids == [first.id, second.id, third.id]
    assert exam.status == "in_progress"


def test_submit_grades_half_correct_answers_server_side(
    client: TestClient, db_session: Session, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    make_question(
        user,
        stem="q1",
        qtype="choice",
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
        answer="A",
    )
    make_question(user, stem="q2", qtype="judge", answer="true")
    make_question(
        user,
        stem="q3",
        qtype="choice",
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
        answer="B",
    )
    make_question(user, stem="q4", qtype="short_answer", answer="光合作用")
    body = _start(client, user, count=4)

    answers = {}
    for question in body["questions"]:
        answers[question["id"]] = {
            "q1": "A",
            "q2": "true",
            "q3": "A",
            "q4": "呼吸作用",
        }[question["stem"]]

    response = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": answers},
        headers=_headers(user),
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["score"] == 2
    assert result["total"] == 4
    by_stem = {question["stem"]: question["id"] for question in body["questions"]}
    flags = {item["question_id"]: item["correct"] for item in result["results"]}
    assert flags[by_stem["q1"]] is True
    assert flags[by_stem["q2"]] is True
    assert flags[by_stem["q3"]] is False
    assert flags[by_stem["q4"]] is False

    stored = db_session.scalar(
        select(func.count())
        .select_from(TrialAnswer)
        .where(TrialAnswer.exam_id == body["exam_id"])
    )
    assert stored == 4
    exam = db_session.get(TrialExam, body["exam_id"])
    assert exam is not None
    assert exam.status == "submitted"
    assert exam.score == 2


def test_resubmitting_is_idempotent(
    client: TestClient, db_session: Session, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    make_question(user, stem="q1", answer="A")
    make_question(user, stem="q2", answer="B")
    body = _start(client, user, count=2)
    answers = {
        body["questions"][0]["id"]: "A",
        body["questions"][1]["id"]: "wrong",
    }

    first = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": answers},
        headers=_headers(user),
    )
    second = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": answers},
        headers=_headers(user),
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert first.json()["score"] == 1

    stored = db_session.scalar(
        select(func.count())
        .select_from(TrialAnswer)
        .where(TrialAnswer.exam_id == body["exam_id"])
    )
    assert stored == 2


def test_expired_exam_submit_is_409(
    client: TestClient, db_session: Session, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    make_question(user)
    body = _start(client, user, count=1)

    exam = db_session.get(TrialExam, body["exam_id"])
    assert exam is not None
    exam.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db_session.commit()

    response = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": {body["questions"][0]["id"]: "A"}},
        headers=_headers(user),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "EXAM_EXPIRED"
    db_session.expire_all()
    refreshed = db_session.get(TrialExam, body["exam_id"])
    assert refreshed is not None
    assert refreshed.status == "expired"


def test_another_users_exam_is_404(
    client: TestClient, make_user: Callable[..., User], make_question
) -> None:
    owner = make_user("出题人")
    stranger = make_user("陌生人")
    make_question(owner)
    body = _start(client, owner, count=1)

    submit = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": {}},
        headers=_headers(stranger),
    )
    read = client.get(f"/api/trial/exams/{body['exam_id']}", headers=_headers(stranger))
    missing = client.get(f"/api/trial/exams/{uuid.uuid4()}", headers=_headers(stranger))

    assert submit.status_code == 404
    assert submit.json()["code"] == "NOT_FOUND"
    assert read.status_code == 404
    assert read.json()["code"] == "NOT_FOUND"
    assert missing.status_code == 404
    assert missing.json()["code"] == "NOT_FOUND"


def test_count_over_available_and_out_of_range(
    client: TestClient, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    make_question(user, stem="q1")
    make_question(user, stem="q2")

    larger = _start(client, user, count=10)
    too_small = client.post(
        "/api/trial/exams", json={"count": 0}, headers=_headers(user)
    )
    too_large = client.post(
        "/api/trial/exams", json={"count": 51}, headers=_headers(user)
    )

    assert larger["total"] == 2
    assert len(larger["questions"]) == 2
    assert too_small.status_code == 422
    assert too_small.json()["code"] == "VALIDATION_ERROR"
    assert too_large.status_code == 422
    assert too_large.json()["code"] == "VALIDATION_ERROR"


def test_trial_mistakes_reach_the_wrong_question_book(
    client: TestClient, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    wrong_choice = make_question(
        user,
        stem="试炼错题单选",
        qtype="choice",
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
        answer="A",
    )
    wrong_judge = make_question(user, stem="试炼错题判断", qtype="judge", answer="true")
    correct = make_question(
        user,
        stem="试炼答对单选",
        qtype="choice",
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"],
        answer="B",
    )
    body = _start(client, user, count=3)

    response = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={
            "answers": {
                wrong_choice.id: "B",
                wrong_judge.id: "false",
                correct.id: "B",
            }
        },
        headers=_headers(user),
    )
    assert response.status_code == 200, response.text
    assert response.json()["score"] == 1

    listing = client.get("/api/wrong-questions?limit=50", headers=_headers(user))

    assert listing.status_code == 200, listing.text
    by_id = {item["id"]: item for item in listing.json()}
    assert set(by_id) == {wrong_choice.id, wrong_judge.id}
    assert by_id[wrong_choice.id]["wrongCount"] == 1
    assert by_id[wrong_judge.id]["wrongCount"] == 1
    assert by_id[wrong_judge.id]["type"] == "judge"
    assert by_id[wrong_judge.id]["myMistake"] == "false"
    assert correct.id not in by_id


def test_trial_resubmission_does_not_duplicate_attempts(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_question,
) -> None:
    user = make_user()
    question = make_question(user, stem="重复提交单选", answer="A")
    body = _start(client, user, count=1)
    answers = {question.id: "B"}

    first = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": answers},
        headers=_headers(user),
    )
    second = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": answers},
        headers=_headers(user),
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json() == first.json()

    attempts = db_session.scalar(
        select(func.count())
        .select_from(QuizAttempt)
        .where(
            QuizAttempt.user_id == user.id,
            QuizAttempt.question_id == question.id,
        )
    )
    assert attempts == 1
    listing = client.get("/api/wrong-questions?limit=50", headers=_headers(user))
    by_id = {item["id"]: item for item in listing.json()}
    assert by_id[question.id]["wrongCount"] == 1


def test_trial_mistakes_feed_weak_points(
    client: TestClient, make_user: Callable[..., User], make_question
) -> None:
    user = make_user()
    choice = make_question(user, stem="薄弱单选", qtype="choice", answer="A")
    judge = make_question(user, stem="薄弱判断", qtype="judge", answer="true")
    body = _start(client, user, count=2)

    response = client.post(
        f"/api/trial/exams/{body['exam_id']}/submit",
        json={"answers": {choice.id: "B", judge.id: "false"}},
        headers=_headers(user),
    )
    assert response.status_code == 200, response.text

    weak = client.get("/api/assistant/weak-points", headers=_headers(user))

    assert weak.status_code == 200, weak.text
    points = weak.json()
    assert len(points) == 1
    assert points[0]["knowledge_point_id"] == choice.knowledge_point_id
    assert points[0]["total_attempts"] == 2
    assert points[0]["wrong_attempts"] == 2
    assert points[0]["error_rate"] == 1.0
