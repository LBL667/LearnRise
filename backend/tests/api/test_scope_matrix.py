"""Authorization matrix for the opt-in competition scope.

Every combination of ``{personal, shared x leader/member/viewer, stranger}``
against ``{read, write, delete}`` is exercised through the knowledge-point
endpoints (``GET`` / ``PUT`` / ``DELETE``), which resolve the scope through the
point's source. Personal rows must keep the legacy owner-only ``404``; shared
rows follow the leader/member/viewer matrix documented in
:mod:`app.services.scope`.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import (
    Competition,
    CompetitionMember,
    KnowledgePoint,
    KnowledgeSource,
    User,
    new_uuid,
)

NOT_FOUND = "资源不存在"
FORBIDDEN = "没有权限执行该操作"

SCOPE_ROWS = (
    "personal-owner",
    "personal-stranger",
    "shared-leader",
    "shared-member",
    "shared-viewer",
    "shared-stranger",
)
ACTIONS = ("read", "write", "delete")

EXPECTED: dict[tuple[str, str], tuple[int, str | None]] = {
    ("personal-owner", "read"): (200, None),
    ("personal-owner", "write"): (200, None),
    ("personal-owner", "delete"): (204, None),
    ("personal-stranger", "read"): (404, NOT_FOUND),
    ("personal-stranger", "write"): (404, NOT_FOUND),
    ("personal-stranger", "delete"): (404, NOT_FOUND),
    ("shared-leader", "read"): (200, None),
    ("shared-leader", "write"): (200, None),
    ("shared-leader", "delete"): (204, None),
    ("shared-member", "read"): (200, None),
    ("shared-member", "write"): (200, None),
    ("shared-member", "delete"): (204, None),
    ("shared-viewer", "read"): (200, None),
    ("shared-viewer", "write"): (403, FORBIDDEN),
    ("shared-viewer", "delete"): (403, FORBIDDEN),
    ("shared-stranger", "read"): (404, NOT_FOUND),
    ("shared-stranger", "write"): (404, NOT_FOUND),
    ("shared-stranger", "delete"): (404, NOT_FOUND),
}


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


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

    def _create(name: str = "授权用户") -> User:
        user = User(email=f"scope-{uuid.uuid4().hex}@example.com", display_name=name)
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
                delete(Competition).where(Competition.id.in_(competitions))
            )
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


@pytest.fixture
def make_competition(db_session: Session) -> Callable[..., Competition]:
    def _create(owner: User, title: str = "授权竞赛") -> Competition:
        competition = Competition(owner_id=owner.id, title=title)
        db_session.add(competition)
        db_session.flush()
        db_session.add(
            CompetitionMember(
                competition_id=competition.id, user_id=owner.id, role="leader"
            )
        )
        db_session.commit()
        return competition

    return _create


def _add_member(db_session: Session, competition: Competition, user: User, role: str) -> None:
    db_session.add(
        CompetitionMember(competition_id=competition.id, user_id=user.id, role=role)
    )
    db_session.commit()


@pytest.fixture
def make_source(db_session: Session) -> Callable[..., KnowledgeSource]:
    def _create(owner: User, *, competition_id: str | None = None) -> KnowledgeSource:
        source = KnowledgeSource(
            user_id=owner.id,
            competition_id=competition_id,
            title="授权资料",
            filename="scope.md",
            content_type="text/markdown",
            size_bytes=0,
            storage_key=f"{owner.id}/{new_uuid()}/scope.md",
            status="ready",
        )
        db_session.add(source)
        db_session.commit()
        return source

    return _create


@pytest.fixture
def make_point(db_session: Session) -> Callable[..., KnowledgePoint]:
    def _create(owner: User, source: KnowledgeSource, title: str = "授权知识点") -> KnowledgePoint:
        point = KnowledgePoint(
            user_id=owner.id,
            source_id=source.id,
            title=title,
            content="内容",
            level=0,
            sort_order=0,
            mastery_score=0.0,
        )
        db_session.add(point)
        db_session.commit()
        return point

    return _create


def _actor_for(
    row: str,
    owner: User,
    stranger: User,
    db_session: Session,
    make_competition: Callable[..., Competition],
    make_source: Callable[..., KnowledgeSource],
    make_point: Callable[..., KnowledgePoint],
) -> tuple[User, KnowledgePoint]:
    if row.startswith("personal"):
        actor = owner if row == "personal-owner" else stranger
        source = make_source(owner)
        return actor, make_point(owner, source)

    competition = make_competition(owner)
    if row == "shared-leader":
        actor = stranger
        _add_member(db_session, competition, actor, "leader")
    elif row == "shared-member":
        actor = stranger
        _add_member(db_session, competition, actor, "member")
    elif row == "shared-viewer":
        actor = stranger
        _add_member(db_session, competition, actor, "viewer")
    else:
        actor = stranger
    source = make_source(owner, competition_id=competition.id)
    return actor, make_point(owner, source)


def _call(
    client: TestClient,
    action: str,
    point: KnowledgePoint,
    actor: User,
) -> Any:
    headers = _headers(actor)
    if action == "read":
        return client.get(f"/api/knowledge-points/{point.id}", headers=headers)
    if action == "write":
        return client.put(
            f"/api/knowledge-points/{point.id}",
            headers=headers,
            json={"title": "改后的标题"},
        )
    return client.delete(f"/api/knowledge-points/{point.id}", headers=headers)


@pytest.mark.parametrize("row", SCOPE_ROWS)
@pytest.mark.parametrize("action", ACTIONS)
def test_scope_matrix(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_competition: Callable[..., Competition],
    make_source: Callable[..., KnowledgeSource],
    make_point: Callable[..., KnowledgePoint],
    row: str,
    action: str,
) -> None:
    owner = make_user("资料所有者")
    stranger = make_user("外部用户")
    actor, point = _actor_for(
        row, owner, stranger, db_session, make_competition, make_source, make_point
    )

    response = _call(client, action, point, actor)

    status_code, detail = EXPECTED[(row, action)]
    assert response.status_code == status_code
    if detail is not None:
        assert response.json()["detail"] == detail


def test_personal_sources_stay_hidden_from_teammate(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_competition: Callable[..., Competition],
    make_source: Callable[..., KnowledgeSource],
) -> None:
    owner = make_user("所有者")
    teammate = make_user("队友")
    competition = make_competition(owner)
    _add_member(db_session, competition, teammate, "member")
    personal = make_source(owner)
    shared = make_source(owner, competition_id=competition.id)

    listing = client.get("/api/sources", headers=_headers(teammate))
    assert listing.status_code == 200
    listed_ids = {row["id"] for row in listing.json()}
    assert personal.id not in listed_ids
    assert shared.id not in listed_ids
    assert listed_ids == set()

    personal_detail = client.get(
        f"/api/sources/{personal.id}", headers=_headers(teammate)
    )
    team_detail = client.get(f"/api/sources/{shared.id}", headers=_headers(teammate))

    assert personal_detail.status_code == 404
    assert personal_detail.json()["detail"] == NOT_FOUND
    assert team_detail.status_code == 200
    assert team_detail.json()["id"] == shared.id
