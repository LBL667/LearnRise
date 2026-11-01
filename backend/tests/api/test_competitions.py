"""API tests for the competition domain: CRUD, invites, members and the plan gate."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    Competition,
    CompetitionInvite,
    CompetitionMember,
    KnowledgeSource,
    User,
)
from app.security.password import hash_password

PASSWORD = "demo1234"


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

    def _create(name: str = "竞赛用户") -> User:
        user = User(
            email=f"comp-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(PASSWORD),
            display_name=name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        competitions = db_session.scalars(
            select(Competition.id).where(Competition.owner_id.in_(created))
        ).all()
        if competitions:
            db_session.execute(
                delete(CompetitionMember).where(
                    CompetitionMember.competition_id.in_(competitions)
                )
            )
            db_session.execute(
                delete(CompetitionInvite).where(
                    CompetitionInvite.competition_id.in_(competitions)
                )
            )
            db_session.execute(delete(Competition).where(Competition.id.in_(competitions)))
        db_session.execute(delete(CompetitionMember).where(CompetitionMember.user_id.in_(created)))
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _login(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_competition(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "name": "算法冬令营",
        "knowledge_prompt": "图论基础",
        "question_types": ["choice", "judge"],
        "difficulty": "medium",
        "winner_count": 3,
        "rewards": [{"rank": 1, "name": "金牌"}],
        "start_time": "2026-12-01T09:00:00",
        "end_time": "2026-12-31T18:00:00",
        "source_ids": [],
    }
    payload.update(overrides)
    response = client.post("/api/competitions", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_invite_code_and_echoes_question_types(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user("队长")
    headers = _login(client, owner)

    body = _create_competition(client, headers)

    assert body["title"] == "算法冬令营"
    assert body["inviteCode"]
    assert body["questionTypes"] == ["choice", "judge"]
    assert body["currentUserRole"] == "leader"
    assert body["canManageMembers"] is True
    assert body["awardQuota"] == 3
    assert body["daysToStart"] >= 0
    assert body["planStatus"] == "pending"


def test_create_rejects_unknown_question_type(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())

    response = client.post(
        "/api/competitions",
        json={"name": "坏题型", "question_types": ["multiple"]},
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_list_is_scoped_to_membership_and_reports_total(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    stranger = make_user()
    owner_headers = _login(client, owner)
    stranger_headers = _login(client, stranger)
    created = _create_competition(client, owner_headers)
    _create_competition(client, owner_headers, name="第二个竞赛")

    mine = client.get("/api/competitions", headers=owner_headers)
    others = client.get("/api/competitions", headers=stranger_headers)
    page = client.get("/api/competitions?limit=1", headers=owner_headers)

    assert mine.status_code == 200
    assert mine.headers["X-Total-Count"] == "2"
    assert len(mine.json()) == 2
    assert created["id"] in {item["id"] for item in mine.json()}
    assert others.json() == []
    assert others.headers["X-Total-Count"] == "0"
    assert len(page.json()) == 1
    assert page.headers["X-Total-Count"] == "2"


def test_join_by_invite_code_adds_member(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user("队长")
    joiner = make_user("队员")
    owner_headers = _login(client, owner)
    joiner_headers = _login(client, joiner)
    competition = _create_competition(client, owner_headers)

    joined = client.post(
        "/api/competitions/join",
        json={"invite_code": competition["inviteCode"].lower()},
        headers=joiner_headers,
    )

    assert joined.status_code == 200, joined.text
    assert joined.json()["currentUserRole"] == "member"
    assert joined.json()["canManageMembers"] is False

    members = client.get(
        f"/api/competitions/{competition['id']}/members", headers=joiner_headers
    )
    assert members.status_code == 200
    roles = {member["userId"]: member["role"] for member in members.json()}
    assert roles[owner.id] == "leader"
    assert roles[joiner.id] == "member"


def test_join_with_invalid_code_is_404_with_code(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())

    response = client.post(
        "/api/competitions/join", json={"invite_code": "ZZZZZZZZ"}, headers=headers
    )

    assert response.status_code == 404
    assert response.json()["code"] == "JOIN_INVITE_INVALID"


def test_join_twice_is_409_already_member(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    joiner = make_user()
    owner_headers = _login(client, owner)
    joiner_headers = _login(client, joiner)
    competition = _create_competition(client, owner_headers)

    first = client.post(
        "/api/competitions/join",
        json={"invite_code": competition["inviteCode"]},
        headers=joiner_headers,
    )
    second = client.post(
        "/api/competitions/join",
        json={"invite_code": competition["inviteCode"]},
        headers=joiner_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["code"] == "ALREADY_MEMBER"


def test_stranger_sees_404_for_competition_and_members(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    stranger = make_user()
    competition = _create_competition(client, _login(client, owner))
    stranger_headers = _login(client, stranger)

    detail = client.get(f"/api/competitions/{competition['id']}", headers=stranger_headers)
    members = client.get(
        f"/api/competitions/{competition['id']}/members", headers=stranger_headers
    )

    assert detail.status_code == 404
    assert detail.json()["code"] == "NOT_FOUND"
    assert members.status_code == 404
    assert members.json()["code"] == "NOT_FOUND"


def test_member_cannot_remove_others_but_leader_can(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user("队长")
    first = make_user("队员一")
    second = make_user("队员二")
    owner_headers = _login(client, owner)
    first_headers = _login(client, first)
    competition = _create_competition(client, owner_headers)

    for user in (first, second):
        joined = client.post(
            "/api/competitions/join",
            json={"invite_code": competition["inviteCode"]},
            headers=_login(client, user),
        )
        assert joined.status_code == 200

    members = client.get(
        f"/api/competitions/{competition['id']}/members", headers=owner_headers
    ).json()
    second_membership = next(m["id"] for m in members if m["userId"] == second.id)

    denied = client.delete(
        f"/api/competitions/{competition['id']}/members/{second_membership}",
        headers=first_headers,
    )
    allowed = client.delete(
        f"/api/competitions/{competition['id']}/members/{second_membership}",
        headers=owner_headers,
    )

    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"
    assert allowed.status_code == 204

    remaining = client.get(
        f"/api/competitions/{competition['id']}/members", headers=owner_headers
    ).json()
    assert second.id not in {m["userId"] for m in remaining}


def test_leader_cannot_remove_the_owner(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    owner_headers = _login(client, owner)
    competition = _create_competition(client, owner_headers)

    members = client.get(
        f"/api/competitions/{competition['id']}/members", headers=owner_headers
    ).json()
    owner_membership = next(m["id"] for m in members if m["userId"] == owner.id)

    response = client.delete(
        f"/api/competitions/{competition['id']}/members/{owner_membership}",
        headers=owner_headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "CONFLICT"


def test_plan_is_409_until_generated(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())
    competition = _create_competition(client, headers)

    response = client.get(f"/api/competitions/{competition['id']}/plan", headers=headers)

    assert response.status_code == 409
    assert response.json()["code"] == "PLAN_NOT_READY"


def test_invite_lookup_returns_competition_summary(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())
    competition = _create_competition(client, headers)

    found = client.get(f"/api/invite/{competition['inviteCode']}", headers=headers)
    missing = client.get("/api/invite/NOPE1234", headers=headers)

    assert found.status_code == 200
    assert found.json()["competitionId"] == competition["id"]
    assert found.json()["memberCount"] == 1
    assert missing.status_code == 404
    assert missing.json()["code"] == "JOIN_INVITE_INVALID"


def test_binding_another_users_source_is_404_and_does_not_persist(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("资料主")
    intruder = make_user("建赛人")
    source = KnowledgeSource(
        user_id=owner.id,
        title="私有资料",
        filename="private.pdf",
        content_type="application/pdf",
        size_bytes=1,
        storage_key=f"tests/{uuid.uuid4().hex}.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()

    response = client.post(
        "/api/competitions",
        json={"name": "越权绑定", "source_ids": [source.id]},
        headers=_login(client, intruder),
    )

    db_session.expire_all()
    stored = db_session.get(KnowledgeSource, source.id)

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    assert stored is not None
    assert stored.competition_id is None
