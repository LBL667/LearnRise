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
* ``promotion-progress`` -- progress needed for promotion eligibility;
* ``preferences`` -- the four preference groups (notifications / learning /
  ui / privacy), merged from the user row and its JSONB columns;
* ``leaderboard`` -- members ordered by ``10 * correct answers + 4 * reviews``
  inside the competition, with a contiguous server-side ``rank``.
"""

from __future__ import annotations

import zlib
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.storage.base import sanitize_key
from app.adapters.storage.factory import build_storage
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
from app.security.password import hash_password, verify_password

router = APIRouter()
profile_router = APIRouter(prefix="/api/profile", tags=["profile"])
leaderboard_router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

TONE = Literal["primary", "success", "warning", "violet"]
DIFFICULTY = Literal["easy", "medium", "hard"]
QUESTION_TYPE = Literal["choice", "judge", "short_answer"]
NAME_VISIBILITY = Literal["public", "members", "private"]

PREFERENCE_DEFAULTS: dict[str, dict[str, Any]] = {
    "learning": {
        "default_difficulty": "medium",
        "default_question_types": ["choice"],
        "default_quiz_num": 5,
    },
    "privacy": {"leaderboard_anonymous": False, "name_visibility": "public"},
}

NOT_FOUND_DETAIL = "资源不存在"
INVALID_CURRENT_PASSWORD_DETAIL = "当前密码不正确"

#: Accepted avatar image types mapped to the canonical stored extension.
ALLOWED_AVATAR_TYPES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
AVATAR_UNSUPPORTED_DETAIL = "头像只支持 png / jpg / webp"
AVATAR_TOO_LARGE_DETAIL = "头像文件超过大小上限"
AVATAR_EMPTY_DETAIL = "头像文件为空"

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
    school: str | None = None
    grade: str | None = None
    avatarUrl: str | None = None


class AvatarUploadOut(BaseModel):
    avatarUrl: str


class ProfileInfoUpdate(BaseModel):
    """PATCH-style body for :func:`update_profile_info`.

    Only fields present in the request are applied (``exclude_unset``). An
    explicit ``null`` on ``school`` / ``grade`` clears it; an explicit ``null``
    (or blank) ``display_name`` leaves the current value untouched because the
    column is non-nullable and drives the display fallback to the email local
    part.
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    school: str | None = Field(default=None, max_length=64)
    grade: str | None = Field(default=None, max_length=32)


class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


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


class PromotionProgressOut(BaseModel):
    prep_done: bool
    trial_done: int
    trial_total: int


class NotificationPrefsUpdate(BaseModel):
    email_reminders_enabled: bool | None = None


class LearningPrefsUpdate(BaseModel):
    default_difficulty: DIFFICULTY | None = None
    default_question_types: list[QUESTION_TYPE] | None = Field(default=None, min_length=1)
    default_quiz_num: int | None = Field(default=None, ge=1, le=20)


class PrivacyPrefsUpdate(BaseModel):
    leaderboard_anonymous: bool | None = None
    name_visibility: NAME_VISIBILITY | None = None


class NotificationPrefsOut(BaseModel):
    email_reminders_enabled: bool


class LearningPrefsOut(BaseModel):
    default_difficulty: DIFFICULTY
    default_question_types: list[QUESTION_TYPE]
    default_quiz_num: int


class PrivacyPrefsOut(BaseModel):
    leaderboard_anonymous: bool
    name_visibility: NAME_VISIBILITY


class PreferencesOut(BaseModel):
    notifications: NotificationPrefsOut
    learning: LearningPrefsOut
    privacy: PrivacyPrefsOut


class LeaderboardEntryOut(BaseModel):
    rank: int
    userId: str
    name: str
    tier: str
    division: str
    points: int
    avatarHue: int
    avatarUrl: str | None = None


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


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _avatar_url(user: User) -> str | None:
    if not user.avatar_key:
        return None
    return build_storage().sign(user.avatar_key)


def _privacy(user: User) -> dict[str, Any]:
    return {**PREFERENCE_DEFAULTS["privacy"], **(user.privacy_prefs or {})}


def _merged_jsonb(stored: dict | None, changes: dict[str, Any]) -> dict:
    return {**(stored or {}), **changes}


def _preferences_payload(db: Session, user: User) -> PreferencesOut:
    learning = {**PREFERENCE_DEFAULTS["learning"], **(user.learning_prefs or {})}
    privacy = {**PREFERENCE_DEFAULTS["privacy"], **(user.privacy_prefs or {})}
    return PreferencesOut(
        notifications=NotificationPrefsOut(
            email_reminders_enabled=user.email_reminders_enabled
        ),
        learning=LearningPrefsOut(**learning),
        privacy=PrivacyPrefsOut(**privacy),
    )


def _profile_info(db: Session, user: User) -> ProfileInfoOut:
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
        school=user.school,
        grade=user.grade,
        avatarUrl=_avatar_url(user),
    )


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
    return _profile_info(db, user)


@profile_router.put("/info", response_model=ProfileInfoOut)
def update_profile_info(
    payload: ProfileInfoUpdate, db: DbSession, user: CurrentUser
) -> ProfileInfoOut:
    changes = payload.model_dump(exclude_unset=True)

    display_name = changes.get("display_name")
    if isinstance(display_name, str) and display_name.strip():
        user.display_name = display_name.strip()

    if "school" in changes:
        user.school = _clean_optional(changes["school"])
    if "grade" in changes:
        user.grade = _clean_optional(changes["grade"])

    if changes:
        db.commit()
        db.refresh(user)
    return _profile_info(db, user)


@profile_router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def update_password(
    payload: PasswordUpdate, db: DbSession, user: CurrentUser
) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INVALID_CURRENT_PASSWORD_DETAIL,
            code="INVALID_CURRENT_PASSWORD",
        )

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@profile_router.post("/avatar", response_model=AvatarUploadOut)
def upload_avatar(
    file: Annotated[UploadFile, File(...)], db: DbSession, user: CurrentUser
) -> AvatarUploadOut:
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    suffix = ALLOWED_AVATAR_TYPES.get(content_type)
    if suffix is None:
        raise CodedHTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=AVATAR_UNSUPPORTED_DETAIL,
            code="UNSUPPORTED_MEDIA_TYPE",
        )

    limit_bytes = int(settings.max_upload_mb) * 1024 * 1024
    data = file.file.read(limit_bytes + 1)
    if len(data) > limit_bytes:
        raise CodedHTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=AVATAR_TOO_LARGE_DETAIL,
            code="PAYLOAD_TOO_LARGE",
        )
    if not data:
        raise CodedHTTPException(
            status_code=422, detail=AVATAR_EMPTY_DETAIL, code="EMPTY_FILE"
        )

    key = sanitize_key(f"avatars/{user.id}/avatar{suffix}")
    storage = build_storage()
    storage.put(key, data, content_type)
    if user.avatar_key and user.avatar_key != key:
        try:
            storage.delete(user.avatar_key)
        except Exception:
            pass

    user.avatar_key = key
    db.commit()
    db.refresh(user)
    return AvatarUploadOut(avatarUrl=storage.sign(key))


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
        .order_by(CompetitionMember.created_at.desc(), CompetitionMember.competition_id.desc())
        .limit(10)
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


@profile_router.get("/promotion-progress", response_model=PromotionProgressOut)
def get_promotion_progress(db: DbSession, user: CurrentUser) -> PromotionProgressOut:
    kp_total = int(db.scalar(select(func.count()).select_from(KnowledgePoint).where(KnowledgePoint.user_id == user.id)) or 0)
    kp_mastered = int(db.scalar(select(func.count()).select_from(KnowledgePoint).where(KnowledgePoint.user_id == user.id, KnowledgePoint.mastery_score >= 0.8)) or 0)
    exams_total = int(db.scalar(select(func.count()).select_from(TrialExam).where(TrialExam.user_id == user.id)) or 0)
    exams_done = int(db.scalar(select(func.count()).select_from(TrialExam).where(TrialExam.user_id == user.id, TrialExam.status == "submitted")) or 0)
    return PromotionProgressOut(
        prep_done=kp_total > 0 and round(kp_mastered * 100 / kp_total) >= 80,
        trial_done=exams_done,
        trial_total=exams_total,
    )


@profile_router.get("/preferences", response_model=PreferencesOut)
def get_preferences(db: DbSession, user: CurrentUser) -> PreferencesOut:
    return _preferences_payload(db, user)


@profile_router.put("/preferences/notifications", response_model=PreferencesOut)
def update_notification_prefs(
    payload: NotificationPrefsUpdate, db: DbSession, user: CurrentUser
) -> PreferencesOut:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "email_reminders_enabled" in changes:
        user.email_reminders_enabled = bool(changes["email_reminders_enabled"])
        db.commit()
        db.refresh(user)
    return _preferences_payload(db, user)


@profile_router.put("/preferences/learning", response_model=PreferencesOut)
def update_learning_prefs(
    payload: LearningPrefsUpdate, db: DbSession, user: CurrentUser
) -> PreferencesOut:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if changes:
        user.learning_prefs = _merged_jsonb(user.learning_prefs, changes)
        db.commit()
        db.refresh(user)
    return _preferences_payload(db, user)


@profile_router.put("/preferences/privacy", response_model=PreferencesOut)
def update_privacy_prefs(
    payload: PrivacyPrefsUpdate, db: DbSession, user: CurrentUser
) -> PreferencesOut:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if changes:
        user.privacy_prefs = _merged_jsonb(user.privacy_prefs, changes)
        db.commit()
        db.refresh(user)
    return _preferences_payload(db, user)


@leaderboard_router.get("/{competition_id}", response_model=list[LeaderboardEntryOut])
def get_leaderboard(
    competition_id: str,
    db: DbSession,
    user: CurrentUser,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
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
    response.headers["X-Total-Count"] = str(len(scored))

    by_id = {row.id: row for row in rows}
    output: list[LeaderboardEntryOut] = []
    page = scored[offset : offset + limit]
    for absolute_rank, (user_id, name, score) in enumerate(page, start=offset + 1):
        tier, division = _tier_for(score)
        entry_user = by_id[user_id]
        privacy = _privacy(entry_user)
        if (
            privacy["leaderboard_anonymous"] is True
            or privacy["name_visibility"] == "private"
        ):
            name = "匿名用户"
        output.append(
            LeaderboardEntryOut(
                rank=absolute_rank,
                userId=user_id,
                name=name,
                tier=tier,
                division=division,
                points=score,
                avatarHue=_hue_for(user_id),
                avatarUrl=_avatar_url(entry_user),
            )
        )
    return output


router.include_router(profile_router)
router.include_router(leaderboard_router)
