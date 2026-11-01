"""Competition CRUD, membership, invite codes and the generated study plan."""

from __future__ import annotations

import math
import secrets
import zlib
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.db import SessionLocal
from app.deps import CurrentUser, DbSession
from app.models import (
    Competition,
    CompetitionInvite,
    CompetitionMember,
    IngestionJob,
    KnowledgePoint,
    KnowledgeSource,
    User,
)

router = APIRouter(tags=["competitions"])

QUESTION_TYPE = Literal["choice", "judge", "short_answer"]
DIFFICULTY = Literal["easy", "medium", "hard"]
MEMBER_ROLE = Literal["leader", "member", "viewer"]
COVER_VARIANTS = ("aurora", "blackboard", "geometry", "wave", "forest")

NOT_FOUND_DETAIL = "资源不存在"
INVITE_INVALID_DETAIL = "邀请码无效或已过期"
ALREADY_MEMBER_DETAIL = "你已经加入该竞赛"
COMPETITION_FULL_DETAIL = "竞赛人数已满"
PLAN_NOT_READY_DETAIL = "学习规划尚未生成"
CANNOT_REMOVE_SELF_DETAIL = "不能移除自己"
FORBIDDEN_DETAIL = "没有权限执行该操作"

LEADER = "leader"
MEMBER = "member"
VIEWER = "viewer"


class RewardItem(BaseModel):
    rank: int = Field(ge=1)
    name: str = ""
    imageUrl: str | None = None


class CompetitionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    knowledge_prompt: str = ""
    question_types: list[QUESTION_TYPE] = Field(default_factory=list)
    difficulty: DIFFICULTY = "medium"
    winner_count: int = Field(default=3, ge=0, le=100)
    rewards: list[RewardItem] = Field(default_factory=list)
    start_time: str | None = None
    end_time: str | None = None
    source_ids: list[str] = Field(default_factory=list)


class CompetitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    level: str = ""
    description: str = ""
    host: str = ""
    memberCount: int = 0
    capacity: int = 0
    startTime: str = ""
    endTime: str = ""
    awardQuota: int = 0
    daysToStart: int = 0
    daysToEnd: int = 0
    cover: str = "aurora"
    inviteCode: str = ""
    questionTypes: list[str] = Field(default_factory=list)
    difficulty: str = "medium"
    rewards: list[RewardItem] = Field(default_factory=list)
    planStatus: str = "pending"
    currentUserRole: str | None = None
    canManageMembers: bool = False


class MemberOut(BaseModel):
    id: str
    userId: str
    name: str
    role: str
    avatarHue: int


class InviteOut(BaseModel):
    code: str
    competitionId: str
    title: str
    memberCount: int
    capacity: int = 0


class JoinRequest(BaseModel):
    invite_code: str = Field(min_length=1, max_length=32)


class PlanOut(BaseModel):
    stats: dict
    rewards: list[RewardItem]
    intro: str
    stages: list[dict]


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = raw.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise CodedHTTPException(
            status_code=422, detail="时间格式不合法", code="VALIDATION_ERROR"
        ) from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _days_between(target: datetime | None, now: datetime) -> int:
    if target is None:
        return 0
    return max(0, math.ceil((target - now).total_seconds() / 86400))


def _cover_for(competition_id: str) -> str:
    return COVER_VARIANTS[zlib.crc32(competition_id.encode()) % len(COVER_VARIANTS)]


def _hue_for(user_id: str) -> int:
    return zlib.crc32(user_id.encode()) % 360


def _role_for(db: Session, competition_id: str, user_id: str) -> str | None:
    return db.scalar(
        select(CompetitionMember.role).where(
            CompetitionMember.competition_id == competition_id,
            CompetitionMember.user_id == user_id,
        )
    )


def _visible_competition(db: Session, competition_id: str, user: User) -> tuple[Competition, str]:
    competition = db.get(Competition, competition_id)
    if competition is None:
        raise _not_found()
    role = _role_for(db, competition_id, user.id)
    if role is None:
        raise _not_found()
    return competition, role


def _member_count(db: Session, competition_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(CompetitionMember)
            .where(CompetitionMember.competition_id == competition_id)
        )
        or 0
    )


def _invite_code_for(db: Session, competition_id: str) -> str:
    code = db.scalar(
        select(CompetitionInvite.code)
        .where(CompetitionInvite.competition_id == competition_id)
        .order_by(CompetitionInvite.created_at)
        .limit(1)
    )
    return code or ""


def _to_out(db: Session, competition: Competition, user: User, role: str | None) -> CompetitionOut:
    now = datetime.now(UTC)
    owner = db.get(User, competition.owner_id)
    rewards = [RewardItem.model_validate(item) for item in (competition.rewards or [])]
    return CompetitionOut(
        id=competition.id,
        title=competition.title,
        description=competition.description,
        host=owner.display_name if owner is not None else "",
        memberCount=_member_count(db, competition.id),
        startTime=competition.start_at.isoformat() if competition.start_at else "",
        endTime=competition.end_at.isoformat() if competition.end_at else "",
        awardQuota=competition.winner_count,
        daysToStart=_days_between(competition.start_at, now),
        daysToEnd=_days_between(competition.end_at, now),
        cover=_cover_for(competition.id),
        inviteCode=_invite_code_for(db, competition.id),
        questionTypes=list(competition.question_types or []),
        difficulty=competition.difficulty,
        rewards=rewards,
        planStatus=competition.plan_status,
        currentUserRole=role,
        canManageMembers=role == LEADER,
    )


def _new_invite(db: Session, competition_id: str, creator_id: str) -> CompetitionInvite:
    for _ in range(8):
        code = secrets.token_hex(4).upper()
        if db.scalar(select(CompetitionInvite.id).where(CompetitionInvite.code == code)) is None:
            invite = CompetitionInvite(
                competition_id=competition_id, created_by=creator_id, code=code
            )
            db.add(invite)
            return invite
    raise HTTPException(status_code=500, detail="邀请码生成失败")


@router.get("/api/competitions", response_model=list[CompetitionOut])
def list_competitions(
    db: DbSession,
    user: CurrentUser,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[CompetitionOut]:
    member_ids = select(CompetitionMember.competition_id).where(
        CompetitionMember.user_id == user.id
    )
    total = int(
        db.scalar(
            select(func.count()).select_from(Competition).where(Competition.id.in_(member_ids))
        )
        or 0
    )
    response.headers["X-Total-Count"] = str(total)

    rows = db.scalars(
        select(Competition)
        .where(Competition.id.in_(member_ids))
        .order_by(Competition.created_at.desc(), Competition.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return [_to_out(db, row, user, _role_for(db, row.id, user.id)) for row in rows]


@router.post(
    "/api/competitions", response_model=CompetitionOut, status_code=status.HTTP_201_CREATED
)
def create_competition(
    payload: CompetitionCreate, db: DbSession, user: CurrentUser
) -> CompetitionOut:
    start_at = _parse_dt(payload.start_time)
    end_at = _parse_dt(payload.end_time)
    if start_at and end_at and end_at <= start_at:
        raise CodedHTTPException(
            status_code=422, detail="结束时间必须晚于开始时间", code="VALIDATION_ERROR"
        )

    competition = Competition(
        owner_id=user.id,
        title=payload.name.strip(),
        description="",
        intro="",
        question_types=list(payload.question_types),
        difficulty=payload.difficulty,
        winner_count=payload.winner_count,
        rewards=[reward.model_dump() for reward in payload.rewards],
        knowledge_prompt=payload.knowledge_prompt,
        start_at=start_at,
        end_at=end_at,
    )
    db.add(competition)
    db.flush()

    db.add(CompetitionMember(competition_id=competition.id, user_id=user.id, role=LEADER))
    _new_invite(db, competition.id, user.id)

    for source_id in payload.source_ids:
        source = db.get(KnowledgeSource, source_id)
        if source is None or source.user_id != user.id or source.competition_id is not None:
            db.rollback()
            raise _not_found()
        source.competition_id = competition.id

    db.commit()
    db.refresh(competition)
    return _to_out(db, competition, user, LEADER)


@router.get("/api/invite/{code}", response_model=InviteOut)
def read_invite(code: str, db: DbSession, user: CurrentUser) -> InviteOut:
    invite = db.scalar(select(CompetitionInvite).where(CompetitionInvite.code == code.upper()))
    if invite is None:
        raise CodedHTTPException(
            status_code=404, detail=INVITE_INVALID_DETAIL, code="JOIN_INVITE_INVALID"
        )
    competition = db.get(Competition, invite.competition_id)
    if competition is None:
        raise _not_found()
    return InviteOut(
        code=invite.code,
        competitionId=competition.id,
        title=competition.title,
        memberCount=_member_count(db, competition.id),
    )


@router.post("/api/competitions/join", response_model=CompetitionOut)
def join_competition(
    payload: JoinRequest, db: DbSession, user: CurrentUser
) -> CompetitionOut:
    code = payload.invite_code.strip().upper()
    invite = db.scalar(select(CompetitionInvite).where(CompetitionInvite.code == code))
    if invite is None:
        raise CodedHTTPException(
            status_code=404, detail=INVITE_INVALID_DETAIL, code="JOIN_INVITE_INVALID"
        )
    if invite.expires_at is not None and invite.expires_at <= datetime.now(UTC):
        raise CodedHTTPException(
            status_code=409, detail=INVITE_INVALID_DETAIL, code="JOIN_INVITE_INVALID"
        )

    competition = db.get(Competition, invite.competition_id)
    if competition is None:
        raise _not_found()

    existing_role = _role_for(db, competition.id, user.id)
    if existing_role is not None:
        raise CodedHTTPException(
            status_code=409, detail=ALREADY_MEMBER_DETAIL, code="ALREADY_MEMBER"
        )

    db.add(CompetitionMember(competition_id=competition.id, user_id=user.id, role=MEMBER))
    invite.uses += 1
    db.commit()
    db.refresh(competition)
    return _to_out(db, competition, user, MEMBER)


@router.get("/api/competitions/{competition_id}", response_model=CompetitionOut)
def read_competition(competition_id: str, db: DbSession, user: CurrentUser) -> CompetitionOut:
    competition, role = _visible_competition(db, competition_id, user)
    return _to_out(db, competition, user, role)


@router.get("/api/competitions/{competition_id}/members", response_model=list[MemberOut])
def list_members(competition_id: str, db: DbSession, user: CurrentUser) -> list[MemberOut]:
    _visible_competition(db, competition_id, user)
    rows = db.execute(
        select(CompetitionMember, User)
        .join(User, User.id == CompetitionMember.user_id)
        .where(CompetitionMember.competition_id == competition_id)
        .order_by(CompetitionMember.created_at, CompetitionMember.id)
    ).all()
    return [
        MemberOut(
            id=membership.id,
            userId=member.id,
            name=member.display_name or member.email,
            role=membership.role,
            avatarHue=_hue_for(member.id),
        )
        for membership, member in rows
    ]


@router.delete(
    "/api/competitions/{competition_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_member(
    competition_id: str, member_id: str, db: DbSession, user: CurrentUser
) -> Response:
    competition, role = _visible_competition(db, competition_id, user)
    if role != LEADER:
        raise CodedHTTPException(
            status_code=403, detail=FORBIDDEN_DETAIL, code="FORBIDDEN"
        )

    membership = db.get(CompetitionMember, member_id)
    if membership is None or membership.competition_id != competition.id:
        raise _not_found()
    if membership.user_id == competition.owner_id:
        raise CodedHTTPException(
            status_code=409, detail=CANNOT_REMOVE_SELF_DETAIL, code="CONFLICT"
        )

    db.delete(membership)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/competitions/{competition_id}/plan", response_model=PlanOut)
def read_plan(competition_id: str, db: DbSession, user: CurrentUser) -> PlanOut:
    competition, _role = _visible_competition(db, competition_id, user)
    payload = competition.plan_payload
    if competition.plan_status != "ready" or not payload:
        raise CodedHTTPException(
            status_code=409, detail=PLAN_NOT_READY_DETAIL, code="PLAN_NOT_READY"
        )
    return PlanOut(
        stats=payload.get("stats", {}),
        rewards=[RewardItem.model_validate(item) for item in (competition.rewards or [])],
        intro=payload.get("intro", competition.intro),
        stages=payload.get("stages", []),
    )


STAGE_THEMES = (
    ("基础梳理", "把资料里的定义与概念过一遍"),
    ("框架搭建", "按章节串成知识框架"),
    ("典型题型", "用例题固化理解"),
    ("薄弱补强", "集中处理反复出错的知识点"),
    ("综合应用", "跨章节综合题训练"),
    ("模拟冲刺", "按考试节奏做整套练习"),
)
STAGE_ICONS = ("book", "grid", "triangle", "chart", "pie", "crown")
NO_CONTEXT_DETAIL = "共享库里还没有可用的知识点"


def _build_stages(points: list[KnowledgePoint]) -> list[dict]:
    ordered = sorted(points, key=lambda point: (point.level, point.sort_order, point.title))
    titles = [point.title for point in ordered if point.title.strip()]
    stages: list[dict] = []
    total = len(STAGE_THEMES)
    for index, (theme, summary) in enumerate(STAGE_THEMES):
        bucket = titles[index::total] if titles else []
        stages.append(
            {
                "no": f"{index + 1:02d}",
                "title": theme,
                "theme": summary,
                "points": bucket[:8],
                "icon": STAGE_ICONS[index],
            }
        )
    return stages


def _plan_stats(competition: Competition) -> dict:
    now = datetime.now(UTC)
    return {
        "daysToStart": _days_between(competition.start_at, now),
        "startAt": competition.start_at.isoformat() if competition.start_at else "",
        "daysToEnd": _days_between(competition.end_at, now),
        "endAt": competition.end_at.isoformat() if competition.end_at else "",
        "awardQuota": competition.winner_count,
    }


def _generate_plan(competition_id: str, job_id: str) -> None:
    session = SessionLocal()
    try:
        competition = session.get(Competition, competition_id)
        job = session.get(IngestionJob, job_id)
        if competition is None or job is None:
            return
        job.status = "parsing"
        job.progress = 10
        session.commit()

        source_ids = session.scalars(
            select(KnowledgeSource.id).where(KnowledgeSource.competition_id == competition_id)
        ).all()
        points = (
            session.scalars(
                select(KnowledgePoint).where(KnowledgePoint.source_id.in_(source_ids))
            ).all()
            if source_ids
            else []
        )

        competition.plan_payload = {
            "stats": _plan_stats(competition),
            "intro": competition.intro or f"围绕《{competition.title}》的六阶段备赛路线。",
            "stages": _build_stages(list(points)),
        }
        competition.plan_status = "ready"
        competition.plan_generated_at = datetime.now(UTC)
        job.status = "ready"
        job.progress = 100
        job.finished_at = datetime.now(UTC)
        session.commit()
    except Exception as exc:  # noqa: BLE001 - a failed background job must not crash the worker
        session.rollback()
        competition = session.get(Competition, competition_id)
        job = session.get(IngestionJob, job_id)
        if competition is not None:
            competition.plan_status = "failed"
        if job is not None:
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.finished_at = datetime.now(UTC)
        session.commit()
    finally:
        session.close()


@router.post(
    "/api/competitions/{competition_id}/plan/generate",
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_plan(
    competition_id: str,
    db: DbSession,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    competition, role = _visible_competition(db, competition_id, user)
    if role != LEADER:
        raise CodedHTTPException(status_code=403, detail=FORBIDDEN_DETAIL, code="FORBIDDEN")

    source = db.scalar(
        select(KnowledgeSource)
        .where(KnowledgeSource.competition_id == competition_id)
        .order_by(KnowledgeSource.created_at)
        .limit(1)
    )
    if source is None:
        raise CodedHTTPException(
            status_code=409, detail=NO_CONTEXT_DETAIL, code="NO_CONTEXT"
        )

    competition.plan_status = "generating"
    job = IngestionJob(source_id=source.id, user_id=user.id, status="queued", progress=0)
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(_generate_plan, competition.id, job.id)
    return {"job_id": job.id, "competition_id": competition.id, "status": "queued"}
