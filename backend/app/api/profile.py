"""Personal centre and competition leaderboard.

Every endpoint here is strictly per-user. ``/api/profile/*`` reads only rows
owned by the authenticated user; ``/api/leaderboard/{competition_id}`` answers
``404 NOT_FOUND`` when the caller is not a member, so it never reveals whether
another tenant's competition exists.

Profile aggregates are computed with SQL counts/means (no fixture constants):

* ``info`` -- account fields plus a deterministic avatar hue and a level
  derived from the number of review logs;
* ``stats`` -- competition count, review count, mean knowledge-point mastery
  and the current review streak;
* ``competition-records`` -- memberships joined to competitions;
* ``study-progress`` -- knowledge-point / review-card / trial completion;
* ``settings`` -- the static preference catalogue served by the API so the
  frontend no longer imports it from mock data;
* ``leaderboard`` -- members ordered by ``10 * correct answers + 4 * reviews``
  inside the competition, with a contiguous server-side ``rank``.
"""

from __future__ import annotations

import zlib
from datetime import date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import (
    Competition,
    CompetitionMember,
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    ReviewCard,
    ReviewLog,
    TrialExam,
    User,
)

router = APIRouter()
profile_router = APIRouter(prefix="/api/profile", tags=["profile"])
leaderboard_router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

TONE = Literal["primary", "success", "warning", "violet"]
SETTING_ICON = Literal["user", "shield", "bell", "sliders", "monitor", "lock"]

NOT_FOUND_DETAIL = "资源不存在"

#: Review-count thresholds for the six display levels (lower bound inclusive).
LEVELS: tuple[tuple[int, str], ...] = (
    (200, "卓越"),
    (100, "贯通"),
    (50, "融会"),
    (20, "明理"),
    (5, "启行"),
    (0, "初识"),
)

#: Point bands per level: ``(lower bound, tier)``, ordered highest first.
TIER_BANDS: tuple[tuple[int, str], ...] = (
    (1000, "卓越"),
    (500, "贯通"),
    (300, "融会"),
    (150, "明理"),
    (50, "启行"),
    (0, "初识"),
)

DIVISIONS = ("I", "II", "III", "IV")

#: A correct quiz answer and one submitted review are worth these points.
CORRECT_ANSWER_POINTS = 10
REVIEW_POINTS = 4


class ProfileInfoOut(BaseModel):
    id: str
    name: str
    email: str
    avatarHue: int
    level: str
    joinedAt: str
    competitionCount: int


class ProfileStatOut(BaseModel):
    key: str
    label: str
    value: str
    unit: str | None = None
    tone: TONE


class CompetitionRecordOut(BaseModel):
    id: str
    title: str
    role: str
    memberCount: int
    joinedAt: str
    status: str


class StudyProgressOut(BaseModel):
    label: str
    value: int
    total: int
    percent: int


class SettingItemOut(BaseModel):
    label: str
    description: str
    icon: SETTING_ICON
    value: str | None = None


class SettingGroupOut(BaseModel):
    title: str
    items: list[SettingItemOut]


class LeaderboardEntryOut(BaseModel):
    rank: int
    userId: str
    name: str
    tier: str
    division: str
    points: int
    avatarHue: int


def _today_local() -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def _hue_for(user_id: str) -> int:
    return zlib.crc32(user_id.encode()) % 360


def _display_name(user: User) -> str:
    return (user.display_name or "").strip() or user.email.split("@", 1)[0]


def _level_for(review_count: int) -> str:
    for threshold, label in LEVELS:
        if review_count >= threshold:
            return label
    return LEVELS[-1][1]


def _tier_for(points: int) -> tuple[str, str]:
    """Return ``(tier, division)``; division I is the top of each tier."""
    for index, (threshold, tier) in enumerate(TIER_BANDS):
        if points < threshold:
            continue
        upper = TIER_BANDS[index - 1][0] if index > 0 else threshold + 250
        width = max(1, upper - threshold)
        fraction = min(0.999, (points - threshold) / width)
        position = 3 - min(3, int(fraction * 4))
        return tier, DIVISIONS[position]
    return TIER_BANDS[-1][1], DIVISIONS[-1]


def _iso_date(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.date().isoformat()


def _status_for(competition: Competition, now: datetime) -> str:
    if competition.end_at is not None and now >= competition.end_at:
        return "已结束"
    if competition.start_at is not None and now >= competition.start_at:
        return "进行中"
    if competition.start_at is not None:
        return "即将开始"
    return "进行中"


def _review_count(db: Session, user_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(ReviewLog)
            .where(ReviewLog.user_id == user_id)
        )
        or 0
    )


def _streak_days(db: Session, user_id: str, *, today: date) -> int:
    days = list(
        db.scalars(
            select(ReviewLog.review_date)
            .where(ReviewLog.user_id == user_id)
            .distinct()
            .order_by(ReviewLog.review_date.desc())
            .limit(400)
        ).all()
    )
    if not days:
        return 0
    yesterday = today - timedelta(days=1)
    if days[0] == today:
        expected = today
    elif days[0] == yesterday:
        expected = yesterday
    else:
        return 0
    streak = 0
    for day in days:
        if day != expected:
            break
        streak += 1
        expected -= timedelta(days=1)
    return streak


def _competition_points(db: Session, *, competition_id: str, user_ids: list[str]) -> dict[str, int]:
    """Score members by correct answers and submitted reviews in a competition."""
    if not user_ids:
        return {}

    correct = dict(
        db.execute(
            select(QuizAttempt.user_id, func.count())
            .join(QuizQuestion, QuizQuestion.id == QuizAttempt.question_id)
            .where(
                QuizQuestion.competition_id == competition_id,
                QuizAttempt.correct.is_(True),
                QuizAttempt.user_id.in_(user_ids),
            )
            .group_by(QuizAttempt.user_id)
        ).all()
    )

    reviews = dict(
        db.execute(
            select(ReviewLog.user_id, func.count())
            .join(ReviewCard, ReviewCard.id == ReviewLog.card_id)
            .join(KnowledgePoint, KnowledgePoint.id == ReviewCard.knowledge_point_id)
            .join(KnowledgeSource, KnowledgeSource.id == KnowledgePoint.source_id)
            .where(
                KnowledgeSource.competition_id == competition_id,
                ReviewLog.user_id.in_(user_ids),
            )
            .group_by(ReviewLog.user_id)
        ).all()
    )

    return {
        user_id: int(correct.get(user_id) or 0) * CORRECT_ANSWER_POINTS
        + int(reviews.get(user_id) or 0) * REVIEW_POINTS
        for user_id in user_ids
    }


@profile_router.get("/info", response_model=ProfileInfoOut)
def get_profile_info(db: DbSession, user: CurrentUser) -> ProfileInfoOut:
    competition_count = int(
        db.scalar(
            select(func.count())
            .select_from(CompetitionMember)
            .where(CompetitionMember.user_id == user.id)
        )
        or 0
    )
    return ProfileInfoOut(
        id=user.id,
        name=_display_name(user),
        email=user.email,
        avatarHue=_hue_for(user.id),
        level=_level_for(_review_count(db, user.id)),
        joinedAt=_iso_date(user.created_at),
        competitionCount=competition_count,
    )


@profile_router.get("/stats", response_model=list[ProfileStatOut])
def get_profile_stats(db: DbSession, user: CurrentUser) -> list[ProfileStatOut]:
    competition_count = int(
        db.scalar(
            select(func.count())
            .select_from(CompetitionMember)
            .where(CompetitionMember.user_id == user.id)
        )
        or 0
    )
    reviews = _review_count(db, user.id)
    mastery = db.scalar(
        select(func.avg(KnowledgePoint.mastery_score)).where(
            KnowledgePoint.user_id == user.id
        )
    )
    mastery_percent = round(float(mastery or 0.0) * 100)
    streak = _streak_days(db, user.id, today=_today_local())

    return [
        ProfileStatOut(
            key="competitions",
            label="参赛数",
            value=str(competition_count),
            unit="场",
            tone="primary",
        ),
        ProfileStatOut(
            key="reviews",
            label="复习次数",
            value=str(reviews),
            unit="次",
            tone="success",
        ),
        ProfileStatOut(
            key="mastery",
            label="平均掌握度",
            value=str(mastery_percent),
            unit="%",
            tone="warning",
        ),
        ProfileStatOut(
            key="streak",
            label="连续学习天数",
            value=str(streak),
            unit="天",
            tone="violet",
        ),
    ]


@profile_router.get("/competition-records", response_model=list[CompetitionRecordOut])
def get_competition_records(
    db: DbSession, user: CurrentUser
) -> list[CompetitionRecordOut]:
    rows = db.execute(
        select(CompetitionMember.role, CompetitionMember.created_at, Competition)
        .join(Competition, Competition.id == CompetitionMember.competition_id)
        .where(CompetitionMember.user_id == user.id)
        .order_by(CompetitionMember.created_at.desc())
    ).all()

    now = datetime.now(ZoneInfo(settings.timezone))
    records: list[CompetitionRecordOut] = []
    for role, joined_at, competition in rows:
        member_count = int(
            db.scalar(
                select(func.count())
                .select_from(CompetitionMember)
                .where(CompetitionMember.competition_id == competition.id)
            )
            or 0
        )
        records.append(
            CompetitionRecordOut(
                id=competition.id,
                title=competition.title,
                role=role,
                memberCount=member_count,
                joinedAt=_iso_date(joined_at),
                status=_status_for(competition, now),
            )
        )
    return records


@profile_router.get("/study-progress", response_model=list[StudyProgressOut])
def get_study_progress(db: DbSession, user: CurrentUser) -> list[StudyProgressOut]:
    def _scalar(statement: Any) -> int:
        return int(db.scalar(statement) or 0)

    kp_total = _scalar(
        select(func.count()).select_from(KnowledgePoint).where(
            KnowledgePoint.user_id == user.id
        )
    )
    kp_mastered = _scalar(
        select(func.count())
        .select_from(KnowledgePoint)
        .where(KnowledgePoint.user_id == user.id, KnowledgePoint.mastery_score >= 0.8)
    )

    cards_total = _scalar(
        select(func.count()).select_from(ReviewCard).where(ReviewCard.user_id == user.id)
    )
    cards_reviewed = _scalar(
        select(func.count())
        .select_from(ReviewCard)
        .where(ReviewCard.user_id == user.id, ReviewCard.reps > 0)
    )

    today = _today_local()
    reviewed_today = _scalar(
        select(func.count())
        .select_from(ReviewLog)
        .where(ReviewLog.user_id == user.id, ReviewLog.review_date == today)
    )
    due_today = _scalar(
        select(func.count())
        .select_from(ReviewCard)
        .where(
            ReviewCard.user_id == user.id,
            ReviewCard.due_date.is_not(None),
            ReviewCard.due_date <= today,
        )
    )

    exams_total = _scalar(
        select(func.count()).select_from(TrialExam).where(TrialExam.user_id == user.id)
    )
    exams_done = _scalar(
        select(func.count())
        .select_from(TrialExam)
        .where(TrialExam.user_id == user.id, TrialExam.status == "submitted")
    )

    def _percent(value: int, total: int) -> int:
        if total <= 0:
            return 0
        return min(100, round(value * 100 / total))

    return [
        StudyProgressOut(
            label="知识点掌握",
            value=kp_mastered,
            total=kp_total,
            percent=_percent(kp_mastered, kp_total),
        ),
        StudyProgressOut(
            label="复习卡片",
            value=cards_reviewed,
            total=cards_total,
            percent=_percent(cards_reviewed, cards_total),
        ),
        StudyProgressOut(
            label="今日复习",
            value=reviewed_today,
            total=reviewed_today + due_today,
            percent=_percent(reviewed_today, reviewed_today + due_today),
        ),
        StudyProgressOut(
            label="试炼完成",
            value=exams_done,
            total=exams_total,
            percent=_percent(exams_done, exams_total),
        ),
    ]


@profile_router.get("/settings", response_model=list[SettingGroupOut])
def get_setting_groups(user: CurrentUser) -> list[SettingGroupOut]:
    return [
        SettingGroupOut(
            title="账号设置",
            items=[
                SettingItemOut(
                    label="基本信息",
                    description="修改昵称、学校、年级等个人信息",
                    icon="user",
                    value=_display_name(user),
                ),
                SettingItemOut(
                    label="安全设置",
                    description="修改密码、绑定邮箱、账号安全",
                    icon="shield",
                    value=user.email,
                ),
                SettingItemOut(
                    label="通知设置",
                    description="管理系统通知、邮件提醒",
                    icon="bell",
                ),
            ],
        ),
        SettingGroupOut(
            title="偏好设置",
            items=[
                SettingItemOut(
                    label="学习偏好",
                    description="选择感兴趣的学科方向和难度范围",
                    icon="sliders",
                ),
                SettingItemOut(
                    label="界面设置",
                    description="调整网站主题、显示偏好",
                    icon="monitor",
                ),
                SettingItemOut(
                    label="隐私设置",
                    description="管理个人资料的可见范围",
                    icon="lock",
                ),
            ],
        ),
    ]


@leaderboard_router.get("/{competition_id}", response_model=list[LeaderboardEntryOut])
def get_leaderboard(
    competition_id: str, db: DbSession, user: CurrentUser
) -> list[LeaderboardEntryOut]:
    try:
        UUID(competition_id)
    except (ValueError, TypeError, AttributeError):
        raise CodedHTTPException(
            status_code=404, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
        ) from None

    membership = db.scalar(
        select(CompetitionMember.role).where(
            CompetitionMember.competition_id == competition_id,
            CompetitionMember.user_id == user.id,
        )
    )
    if membership is None:
        raise CodedHTTPException(
            status_code=404, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
        )

    rows = db.execute(
        select(User)
        .join(CompetitionMember, CompetitionMember.user_id == User.id)
        .where(CompetitionMember.competition_id == competition_id)
    ).scalars().all()

    points = _competition_points(
        db, competition_id=competition_id, user_ids=[row.id for row in rows]
    )

    scored: list[tuple[str, str, int]] = [
        (entry.id, _display_name(entry), points.get(entry.id, 0)) for entry in rows
    ]
    scored.sort(key=lambda item: (-item[2], item[1], item[0]))

    output: list[LeaderboardEntryOut] = []
    for index, (user_id, name, score) in enumerate(scored, start=1):
        tier, division = _tier_for(score)
        output.append(
            LeaderboardEntryOut(
                rank=index,
                userId=user_id,
                name=name,
                tier=tier,
                division=division,
                points=score,
                avatarHue=_hue_for(user_id),
            )
        )
    return output


router.include_router(profile_router)
router.include_router(leaderboard_router)
