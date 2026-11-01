"""API tests for the knowledge-point tree, CRUD and search endpoints.

Rows are inserted directly through the SQLAlchemy models -- the notes service
(Task 16) and the ingest pipeline are never involved, so these tests stay
independent of parallel work.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import KnowledgePoint, KnowledgeSource, User, new_uuid
from app.services.knowledge_tree import build_tree

DETAILS = "资源不存在"


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

    def _create(display_name: str = "知识点用户") -> User:
        user = User(
            email=f"task17-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


@pytest.fixture
def make_source(
    db_session: Session,
) -> Iterator[Callable[..., KnowledgeSource]]:
    def _create(
        user: User, *, title: str = "计算机网络讲义", filename: str = "net.md"
    ) -> KnowledgeSource:
        source = KnowledgeSource(
            user_id=user.id,
            title=title,
            filename=filename,
            content_type="text/markdown",
            size_bytes=0,
            storage_key=f"{user.id}/{new_uuid()}/{filename}",
            status="ready",
        )
        db_session.add(source)
        db_session.commit()
        db_session.refresh(source)
        return source

    yield _create


@pytest.fixture
def make_kp(db_session: Session) -> Callable[..., KnowledgePoint]:
    def _create(
        user: User,
        *,
        source: KnowledgeSource | None = None,
        parent_id: str | None = None,
        title: str = "知识点",
        content: str = "",
        level: int = 0,
        sort_order: int = 0,
        mastery_score: float = 0.0,
        point_id: str | None = None,
    ) -> KnowledgePoint:
        point = KnowledgePoint(
            id=point_id or new_uuid(),
            user_id=user.id,
            source_id=source.id if source is not None else None,
            parent_id=parent_id,
            title=title,
            content=content,
            level=level,
            sort_order=sort_order,
            mastery_score=mastery_score,
        )
        db_session.add(point)
        db_session.commit()
        db_session.refresh(point)
        return point

    return _create


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _tree(client: TestClient, user: User, source_id: str) -> Any:
    return client.get(f"/api/sources/{source_id}/tree", headers=_headers(user))


def _flatten(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    stack = list(reversed(nodes))
    while stack:
        node = stack.pop()
        flat.append(node)
        stack.extend(reversed(node["children"]))
    return flat


def test_tree_shape(
    client: TestClient,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    source = make_source(user)
    other_source = make_source(user, title="另一份", filename="other.md")

    root = make_kp(user, source=source, title="网络分层", level=0, sort_order=2)
    first = make_kp(
        user, source=source, parent_id=root.id, title="应用层", level=1, sort_order=1
    )
    second = make_kp(
        user, source=source, parent_id=root.id, title="传输层", level=1, sort_order=2
    )
    grandchild = make_kp(
        user, source=source, parent_id=first.id, title="HTTP", level=2, sort_order=0
    )
    make_kp(user, source=other_source, title="不应出现", level=0)

    response = _tree(client, user, source.id)

    assert response.status_code == 200
    body = response.json()
    assert [node["id"] for node in body] == [root.id]
    root_node = body[0]
    assert set(root_node) == {
        "id",
        "title",
        "content",
        "level",
        "mastery_score",
        "children",
    }
    assert [child["id"] for child in root_node["children"]] == [first.id, second.id]
    assert [child["id"] for child in root_node["children"][0]["children"]] == [
        grandchild.id
    ]
    assert root_node["children"][1]["children"] == []


def test_tree_roots_sorted_by_sort_order(
    client: TestClient,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    source = make_source(user)
    late = make_kp(user, source=source, title="晚", sort_order=9)
    early = make_kp(user, source=source, title="早", sort_order=1)
    middle = make_kp(user, source=source, title="中", sort_order=5)

    response = _tree(client, user, source.id)

    assert response.status_code == 200
    assert [node["id"] for node in response.json()] == [early.id, middle.id, late.id]


def test_tree_orphan_promoted() -> None:
    orphan = KnowledgePoint(
        id=new_uuid(),
        user_id=new_uuid(),
        source_id=new_uuid(),
        parent_id=new_uuid(),
        title="孤儿节点",
        content="父节点已不存在",
        level=3,
        sort_order=1,
        mastery_score=0.0,
    )
    child = KnowledgePoint(
        id=new_uuid(),
        user_id=new_uuid(),
        source_id=new_uuid(),
        parent_id=orphan.id,
        title="孤儿的子节点",
        content="",
        level=4,
        sort_order=0,
        mastery_score=0.0,
    )

    tree = build_tree([child, orphan])

    assert [node["id"] for node in tree] == [orphan.id]
    assert [node["id"] for node in tree[0]["children"]] == [child.id]


def test_tree_cycle_safe(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    source = make_source(user)

    self_ref_id = new_uuid()
    self_ref = make_kp(
        user,
        source=source,
        point_id=self_ref_id,
        parent_id=self_ref_id,
        title="自引用",
        sort_order=1,
    )

    left = make_kp(user, source=source, title="环A", sort_order=2)
    right = make_kp(user, source=source, parent_id=left.id, title="环B", sort_order=3)
    left.parent_id = right.id
    db_session.add(left)
    db_session.commit()

    response = _tree(client, user, source.id)

    assert response.status_code == 200
    flat = _flatten(response.json())
    ids = [node["id"] for node in flat]
    assert sorted(ids) == sorted([self_ref.id, left.id, right.id])
    assert len(ids) == len(set(ids))


def test_cross_user_404(
    client: TestClient,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    owner = make_user("拥有者")
    intruder = make_user("陌生人")
    source = make_source(owner)
    point = make_kp(owner, source=source, title="私密知识点")

    assert _tree(client, intruder, source.id).status_code == 404
    assert _tree(client, intruder, new_uuid()).status_code == 404
    assert _tree(client, owner, new_uuid()).status_code == 404

    detail = client.get(
        f"/api/knowledge-points/{point.id}", headers=_headers(intruder)
    )
    assert detail.status_code == 404
    assert detail.json()["detail"] == DETAILS

    update = client.put(
        f"/api/knowledge-points/{point.id}",
        headers=_headers(intruder),
        json={"title": "改掉"},
    )
    assert update.status_code == 404

    removal = client.delete(
        f"/api/knowledge-points/{point.id}", headers=_headers(intruder)
    )
    assert removal.status_code == 404

    still_there = client.get(
        f"/api/knowledge-points/{point.id}", headers=_headers(owner)
    )
    assert still_there.status_code == 200
    assert still_there.json()["title"] == "私密知识点"


def test_crud_update_and_delete_cascade(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    source = make_source(user)
    root = make_kp(user, source=source, title="根", content="旧内容", sort_order=1)
    child = make_kp(
        user, source=source, parent_id=root.id, title="子", level=1, sort_order=2
    )
    grandchild = make_kp(
        user, source=source, parent_id=child.id, title="孙", level=2, sort_order=3
    )
    sibling = make_kp(user, source=source, title="旁支", sort_order=4)
    root_id, child_id = root.id, child.id
    grandchild_id, sibling_id = grandchild.id, sibling.id

    detail = client.get(
        f"/api/knowledge-points/{root_id}", headers=_headers(user)
    )
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["id"] == root_id
    assert payload["source_id"] == source.id
    assert payload["parent_id"] is None
    assert set(payload) == {
        "id",
        "source_id",
        "parent_id",
        "title",
        "content",
        "level",
        "sort_order",
        "mastery_score",
        "created_at",
        "updated_at",
    }

    update = client.put(
        f"/api/knowledge-points/{root_id}",
        headers=_headers(user),
        json={"title": "新标题", "content": "新内容", "sort_order": 7},
    )
    assert update.status_code == 200
    updated = update.json()
    assert updated["title"] == "新标题"
    assert updated["content"] == "新内容"
    assert updated["sort_order"] == 7

    too_long = client.put(
        f"/api/knowledge-points/{root_id}",
        headers=_headers(user),
        json={"title": "x" * 501},
    )
    assert too_long.status_code == 422

    removal = client.delete(
        f"/api/knowledge-points/{root_id}", headers=_headers(user)
    )
    assert removal.status_code == 204
    assert removal.content == b""

    for gone_id in (root_id, child_id, grandchild_id):
        assert (
            client.get(
                f"/api/knowledge-points/{gone_id}", headers=_headers(user)
            ).status_code
            == 404
        )
    assert (
        client.get(
            f"/api/knowledge-points/{sibling_id}", headers=_headers(user)
        ).status_code
        == 200
    )
    listed = client.get("/api/knowledge-points", headers=_headers(user))
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [sibling_id]
    remaining = db_session.scalar(
        select(func.count())
        .select_from(KnowledgePoint)
        .where(KnowledgePoint.id == grandchild_id)
    )
    assert remaining == 0


def test_search_title_and_content(
    client: TestClient,
    make_user: Callable[..., User],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    title_match = make_kp(
        user,
        title="TCP 三次握手",
        content="建立可靠连接的过程",
        mastery_score=0.1,
    )
    content_match = make_kp(
        user,
        title="UDP 协议",
        content="无连接的传输层协议，不进行握手",
        mastery_score=0.5,
    )
    another_content = make_kp(
        user,
        title="其他",
        content="握手相关的补充说明",
        mastery_score=0.9,
    )

    ascii_hit = client.get(
        "/api/knowledge-points/search", headers=_headers(user), params={"q": "tcp"}
    )
    assert ascii_hit.status_code == 200
    assert [item["id"] for item in ascii_hit.json()] == [title_match.id]

    chinese_hit = client.get(
        "/api/knowledge-points/search", headers=_headers(user), params={"q": "握手"}
    )
    assert chinese_hit.status_code == 200
    ordered = [item["id"] for item in chinese_hit.json()]
    assert ordered == [title_match.id, another_content.id, content_match.id]

    content_only = client.get(
        "/api/knowledge-points/search",
        headers=_headers(user),
        params={"q": "无连接"},
    )
    assert content_only.status_code == 200
    assert [item["id"] for item in content_only.json()] == [content_match.id]


def test_search_escapes_wildcards(
    client: TestClient,
    make_user: Callable[..., User],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    literal = make_kp(user, title="进度 100% 完成", content="")
    make_kp(user, title="进度 100 完成", content="没有百分号")
    make_kp(user, title="进度 1000 完成", content="另一个数字")

    response = client.get(
        "/api/knowledge-points/search",
        headers=_headers(user),
        params={"q": "100%"},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [literal.id]

    underscore = make_kp(user, title="a_b", content="")
    make_kp(user, title="axb", content="")
    underscore_hit = client.get(
        "/api/knowledge-points/search",
        headers=_headers(user),
        params={"q": "a_b"},
    )
    assert underscore_hit.status_code == 200
    assert [item["id"] for item in underscore_hit.json()] == [underscore.id]


def test_limit_capped(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
) -> None:
    user = make_user()
    source = make_source(user)
    rows = [
        KnowledgePoint(
            user_id=user.id,
            source_id=source.id,
            title=f"节点{index}",
            content="批量",
            level=index % 3,
            sort_order=index,
        )
        for index in range(505)
    ]
    db_session.add_all(rows)
    db_session.commit()

    search = client.get(
        "/api/knowledge-points/search",
        headers=_headers(user),
        params={"q": "节点", "limit": 999},
    )
    assert search.status_code == 200
    assert len(search.json()) == 20

    listed = client.get(
        "/api/knowledge-points",
        headers=_headers(user),
        params={"limit": 999},
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 500


def test_list_ordered_and_filtered(
    client: TestClient,
    make_user: Callable[..., User],
    make_source: Callable[..., KnowledgeSource],
    make_kp: Callable[..., KnowledgePoint],
) -> None:
    user = make_user()
    source = make_source(user)
    other_source = make_source(user, title="另一份", filename="other.md")

    deep = make_kp(user, source=source, title="深层", level=2, sort_order=1)
    shallow_late = make_kp(user, source=source, title="浅层后", level=1, sort_order=2)
    shallow_early = make_kp(user, source=source, title="浅层前", level=1, sort_order=1)
    make_kp(user, source=other_source, title="其他来源", level=3, sort_order=0)

    response = client.get(
        "/api/knowledge-points",
        headers=_headers(user),
        params={"source_id": source.id},
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        shallow_early.id,
        shallow_late.id,
        deep.id,
    ]
