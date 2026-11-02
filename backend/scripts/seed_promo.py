"""Idempotent promo cast seeding for the LearnRise demo video.

Usage (inside the backend container)::

    python scripts/seed_promo.py

Creates six demo accounts (four students + two teachers), three competitions and
the competition-scoped scoring graph for the main competition so that the
leaderboard renders exactly::

    小红 1000 / 小明 960 / 张三 916 / 李四 876

Scoring is ``10 * correct_answers + 4 * submitted_reviews`` (see
``app/api/profile.py``). Correct answers are attributed through
``quiz_questions.competition_id``; reviews are attributed through
``review_card.knowledge_point_id -> knowledge_point.source_id ->
knowledge_source.competition_id``. Both paths therefore point at the main
competition's source.

Idempotency:

* users / competitions / invites / members / source / knowledge points /
  questions are upserted by stable natural keys and never updated on re-run;
* derived rows (attempts / cards / logs) are deleted and rebuilt for the six
  promo users and the main competition, so a second run leaves identical row
  counts.

The manifest is written to ``/app/var/promo_manifest.json`` by default; set
``PROMO_MANIFEST_OUT`` to override. Teachers are *owners only*: no
``CompetitionMember`` row is created for them.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import (
    Competition,
    CompetitionInvite,
    CompetitionMember,
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    ReviewCard,
    ReviewLog,
    User,
)
from app.security.password import hash_password

PASSWORD = "demo1234"

MAIN_TITLE = "2026 春季 · 财务会计班级联赛"
CLASS_ONE_TITLE = "一班 · 财务会计冲刺"
CLASS_TWO_TITLE = "二班 · 微观经济学期中"

MAIN_INVITE = "LR-2026"
CLASS_ONE_INVITE = "LR-2026-C1"
CLASS_TWO_INVITE = "LR-2026-C2"

SOURCE_TITLE = "第3章 应收款项及预防账款"
SOURCE_FILENAME = "第3章 应收款项及预防账款.pdf"
SOURCE_CONTENT_TYPE = "application/pdf"
SOURCE_STORAGE_KEY = "promo/seed/fin-accounting-ch3.pdf"

#: ``(email, display name, role)`` in deterministic creation order.
USER_SPECS: tuple[tuple[str, str, str], ...] = (
    ("xiaohong@example.com", "小红", "student"),
    ("xiaoming@example.com", "小明", "student"),
    ("zhangsan@example.com", "张三", "student"),
    ("lisi@example.com", "李四", "student"),
    ("wang@example.com", "王老师", "teacher"),
    ("zhou@example.com", "周老师", "teacher"),
)

STUDENT_EMAILS = ("xiaohong@example.com", "xiaoming@example.com",
                  "zhangsan@example.com", "lisi@example.com")
WANG_EMAIL = "wang@example.com"
ZHOU_EMAIL = "zhou@example.com"

#: Chapter -> child knowledge-point titles (24 points total, hierarchical).
CHAPTERS: dict[str, tuple[str, ...]] = {
    "应收账款概述": ("应收账款定义与确认", "应收账款入账价值", "应收账款账务处理"),
    "应收账款减值": ("减值迹象识别", "预期信用损失模型", "坏账准备计提方法"),
    "应收票据": ("商业承兑票据", "银行承兑票据", "票据贴现核算"),
    "预付款项与其他应收款": ("预付账款核算", "其他应收款范围", "备用金管理"),
    "坏账准备核算": ("坏账确认条件", "备抵法核算", "核销与收回"),
    "应收款项管理": ("信用政策制定", "账龄分析", "回款考核"),
}

#: Question index -> (type, answer).  Indexes 0..99, stable forever.
QUESTION_TYPES = ("judge", "choice", "choice")
QUESTION_ANSWERS = ("true", "B", "A")


def _tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def _ensure_user(db: Session, email: str, name: str) -> tuple[User, bool]:
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        return user, False
    user = User(email=email, display_name=name, password_hash=hash_password(PASSWORD))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True


def _ensure_competition(
    db: Session,
    *,
    owner: User,
    title: str,
    description: str,
    knowledge_prompt: str,
    rewards: list[dict],
) -> tuple[Competition, bool]:
    competition = db.scalar(
        select(Competition).where(
            Competition.owner_id == owner.id,
            Competition.title == title,
        )
    )
    if competition is not None:
        return competition, False
    now = datetime.now(UTC)
    competition = Competition(
        owner_id=owner.id,
        title=title,
        description=description,
        intro="",
        question_types=["choice", "judge"],
        difficulty="medium",
        winner_count=3,
        rewards=rewards,
        knowledge_prompt=knowledge_prompt,
        start_at=now - timedelta(days=7),
        end_at=now + timedelta(days=90),
        plan_status="ready",
    )
    db.add(competition)
    db.commit()
    db.refresh(competition)
    return competition, True


def _ensure_invite(
    db: Session, *, competition: Competition, creator: User, code: str
) -> None:
    invite = db.scalar(select(CompetitionInvite).where(CompetitionInvite.code == code))
    if invite is not None:
        if invite.competition_id != competition.id:
            raise SystemExit(
                f"[promo-seed] ERROR: invite code {code} belongs to another competition"
            )
        return
    db.add(
        CompetitionInvite(
            competition_id=competition.id,
            created_by=creator.id,
            code=code,
        )
    )
    db.commit()


def _ensure_member(db: Session, *, competition: Competition, user: User) -> bool:
    member = db.scalar(
        select(CompetitionMember).where(
            CompetitionMember.competition_id == competition.id,
            CompetitionMember.user_id == user.id,
        )
    )
    if member is not None:
        return False
    db.add(
        CompetitionMember(
            competition_id=competition.id,
            user_id=user.id,
            role="member",
        )
    )
    db.commit()
    return True


def _ensure_source(
    db: Session, *, owner: User, competition: Competition
) -> tuple[KnowledgeSource, bool]:
    source = db.scalar(
        select(KnowledgeSource).where(
            KnowledgeSource.competition_id == competition.id,
            KnowledgeSource.user_id == owner.id,
            KnowledgeSource.title == SOURCE_TITLE,
        )
    )
    if source is not None:
        return source, False
    source = KnowledgeSource(
        user_id=owner.id,
        competition_id=competition.id,
        title=SOURCE_TITLE,
        filename=SOURCE_FILENAME,
        content_type=SOURCE_CONTENT_TYPE,
        size_bytes=1024 * 1024,
        storage_key=SOURCE_STORAGE_KEY,
        status="ready",
        page_count=12,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source, True


def _ensure_knowledge_points(
    db: Session, *, owner: User, source: KnowledgeSource
) -> tuple[dict[str, KnowledgePoint], list[KnowledgePoint], int]:
    points: dict[str, KnowledgePoint] = {}
    children: list[KnowledgePoint] = []
    created = 0

    for chapter_index, (chapter, child_titles) in enumerate(CHAPTERS.items()):
        parent = db.scalar(
            select(KnowledgePoint).where(
                KnowledgePoint.source_id == source.id,
                KnowledgePoint.title == chapter,
            )
        )
        if parent is None:
            parent = KnowledgePoint(
                user_id=owner.id,
                source_id=source.id,
                parent_id=None,
                title=chapter,
                content=f"{chapter}的核心概念与会计处理要点。",
                level=0,
                sort_order=chapter_index * 10,
                mastery_score=0.65,
            )
            db.add(parent)
            db.commit()
            db.refresh(parent)
            created += 1
        points[chapter] = parent

        for child_index, title in enumerate(child_titles):
            point = db.scalar(
                select(KnowledgePoint).where(
                    KnowledgePoint.source_id == source.id,
                    KnowledgePoint.title == title,
                )
            )
            if point is None:
                point = KnowledgePoint(
                    user_id=owner.id,
                    source_id=source.id,
                    parent_id=parent.id,
                    title=title,
                    content=f"{title}的定义、核算方法与典型例题。",
                    level=1,
                    sort_order=chapter_index * 10 + child_index + 1,
                    mastery_score=0.6,
                )
                db.add(point)
                db.commit()
                db.refresh(point)
                created += 1
            points[title] = point
            children.append(point)

    return points, children, created


def _question_text(index: int, point: KnowledgePoint) -> str:
    if index % 3 == 0:
        return (
            f"第{index + 1:03d}题 · {point.title}："
            f"根据第3章内容，关于{point.title}的会计处理符合企业会计准则的规定。"
        )
    return (
        f"第{index + 1:03d}题 · {point.title}："
        f"下列关于{point.title}的会计处理，正确的是（ ）。"
    )


def _ensure_questions(
    db: Session,
    *,
    owner: User,
    competition: Competition,
    children: list[KnowledgePoint],
) -> tuple[list[QuizQuestion], int]:
    questions: list[QuizQuestion] = []
    created = 0
    for index in range(100):
        point = children[index % len(children)]
        question_type = QUESTION_TYPES[index % len(QUESTION_TYPES)]
        answer = QUESTION_ANSWERS[index % len(QUESTION_ANSWERS)]
        stem = _question_text(index, point)
        question = db.scalar(
            select(QuizQuestion).where(
                QuizQuestion.competition_id == competition.id,
                QuizQuestion.user_id == owner.id,
                QuizQuestion.question == stem,
            )
        )
        if question is None:
            question = QuizQuestion(
                user_id=owner.id,
                competition_id=competition.id,
                knowledge_point_id=point.id,
                type=question_type,
                question=stem,
                options=None if question_type == "judge" else [
                    "A. 按合同金额全额确认",
                    "B. 按实际发生的交易价格确认",
                    "C. 按历史成本确认",
                    "D. 按公允价值确认",
                ],
                answer=answer,
                explanation=f"考查{point.title}的基本概念与账务处理。",
                difficulty=("easy", "medium", "hard")[index % 3],
            )
            db.add(question)
            db.commit()
            db.refresh(question)
            created += 1
        questions.append(question)
    return questions, created


def _wrong_answer(question: QuizQuestion) -> str:
    if question.type == "choice":
        return "A" if question.answer.strip().upper() != "A" else "B"
    return "false" if question.answer.strip().lower() == "true" else "true"


#: Student email -> question indexes answered incorrectly. Disjoint on purpose
#: so no two students are wrong on the same question.
WRONG_INDEXES: dict[str, tuple[int, ...]] = {
    "xiaohong@example.com": (0, 1),
    "xiaoming@example.com": tuple(range(2, 8)),
    "zhangsan@example.com": tuple(range(8, 18)),
    "lisi@example.com": tuple(range(18, 32)),
}

#: Student email -> (first question index, number of cards).
CARD_SPECS: dict[str, tuple[int, int]] = {
    "xiaohong@example.com": (90, 5),
    "xiaoming@example.com": (95, 5),
    "zhangsan@example.com": (90, 4),
    "lisi@example.com": (94, 4),
}


def _rebuild_derived_rows(
    db: Session,
    *,
    students: list[User],
    questions: list[QuizQuestion],
    source: KnowledgeSource,
) -> dict[str, dict[str, int]]:
    student_ids = [student.id for student in students]
    question_ids = [question.id for question in questions]

    db.execute(delete(ReviewLog).where(ReviewLog.user_id.in_(student_ids)))
    db.execute(delete(ReviewCard).where(ReviewCard.user_id.in_(student_ids)))
    db.execute(
        delete(QuizAttempt).where(
            QuizAttempt.user_id.in_(student_ids),
            QuizAttempt.question_id.in_(question_ids),
        )
    )
    db.commit()

    by_email = {student.email: student for student in students}

    for email, wrong_indexes in WRONG_INDEXES.items():
        student = by_email[email]
        wrong = set(wrong_indexes)
        for index, question in enumerate(questions):
            correct = index not in wrong
            db.add(
                QuizAttempt(
                    question_id=question.id,
                    user_id=student.id,
                    answer=question.answer if correct else _wrong_answer(question),
                    correct=correct,
                    response_time_ms=12_000 + (index % 7) * 1_000,
                )
            )
    db.commit()

    today = datetime.now(_tz()).date()
    reviewed_base = datetime.combine(today, time(hour=9, minute=0), tzinfo=_tz())

    for email, (start, count) in CARD_SPECS.items():
        student = by_email[email]
        for offset in range(count):
            question = questions[start + offset]
            reviewed_at = reviewed_base + timedelta(minutes=offset * 5)
            card = ReviewCard(
                user_id=student.id,
                knowledge_point_id=question.knowledge_point_id,
                quiz_question_id=question.id,
                question=question.question,
                answer=question.answer,
                card_type="quiz_wrong",
                difficulty=5.0,
                stability=1.0 + offset * 0.5,
                retrievability=1.0,
                state=0,
                reps=0,
                lapses=0,
                due_date=today,
                last_review=reviewed_at,
                scheduler="dsr_lite",
            )
            db.add(card)
            db.flush()
            db.add(
                ReviewLog(
                    card_id=card.id,
                    user_id=student.id,
                    rating=3 + (offset % 3),
                    response_time_ms=8_000 + offset * 500,
                    reviewed_at=reviewed_at,
                    review_date=today,
                    stability=1.0 + offset * 0.5,
                    difficulty=5.0,
                    scheduled_days=(1, 3, 7, 14, 30)[offset % 5],
                )
            )
        db.commit()

    # Confirm the source really owns every knowledge point the cards point at.
    card_kp_ids = {
        card.knowledge_point_id
        for card in db.scalars(
            select(ReviewCard).where(ReviewCard.user_id.in_(student_ids))
        )
        if card.knowledge_point_id is not None
    }
    if card_kp_ids:
        misplaced = int(
            db.scalar(
                select(func.count())
                .select_from(KnowledgePoint)
                .where(
                    KnowledgePoint.id.in_(card_kp_ids),
                    KnowledgePoint.source_id != source.id,
                )
            )
            or 0
        )
        if misplaced:
            raise SystemExit(
                "[promo-seed] ERROR: review cards point outside the main source"
            )

    return _scorecard(db, students=students, competition_source=source)


def _scorecard(
    db: Session, *, students: list[User], competition_source: KnowledgeSource
) -> dict[str, dict[str, int]]:
    competition_id = competition_source.competition_id
    correct = dict(
        db.execute(
            select(QuizAttempt.user_id, func.count())
            .join(QuizQuestion, QuizQuestion.id == QuizAttempt.question_id)
            .where(
                QuizQuestion.competition_id == competition_id,
                QuizAttempt.correct.is_(True),
                QuizAttempt.user_id.in_([student.id for student in students]),
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
                ReviewLog.user_id.in_([student.id for student in students]),
            )
            .group_by(ReviewLog.user_id)
        ).all()
    )
    result: dict[str, dict[str, int]] = {}
    for student in students:
        correct_count = int(correct.get(student.id) or 0)
        review_count = int(reviews.get(student.id) or 0)
        result[student.email] = {
            "correct": correct_count,
            "cards": review_count,
            "points": correct_count * 10 + review_count * 4,
        }
    return result


def _manifest_path() -> Path:
    override = os.environ.get("PROMO_MANIFEST_OUT")
    if override:
        return Path(override)
    for candidate in (Path("/app/var"), Path(__file__).resolve().parents[1] / "var"):
        if candidate.is_dir():
            return candidate / "promo_manifest.json"
    return Path("/app/var/promo_manifest.json")


def _write_manifest(
    *,
    users: dict[str, User],
    competitions: dict[str, Competition],
    invites: dict[str, str],
    source: KnowledgeSource,
    scorecard: dict[str, dict[str, int]],
) -> Path:
    students = [users[email] for email in STUDENT_EMAILS]
    expected = {
        users[email].display_name: scorecard[email]["points"] for email in STUDENT_EMAILS
    }
    manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "password": PASSWORD,
        "users": [
            {
                "id": users[email].id,
                "email": email,
                "display_name": name,
                "role": role,
            }
            for email, name, role in USER_SPECS
        ],
        "competitions": [
            {
                "id": competitions[MAIN_TITLE].id,
                "title": MAIN_TITLE,
                "invite_code": invites[MAIN_TITLE],
                "owner_email": WANG_EMAIL,
                "is_main": True,
            },
            {
                "id": competitions[CLASS_ONE_TITLE].id,
                "title": CLASS_ONE_TITLE,
                "invite_code": invites[CLASS_ONE_TITLE],
                "owner_email": WANG_EMAIL,
                "is_main": False,
            },
            {
                "id": competitions[CLASS_TWO_TITLE].id,
                "title": CLASS_TWO_TITLE,
                "invite_code": invites[CLASS_TWO_TITLE],
                "owner_email": ZHOU_EMAIL,
                "is_main": False,
            },
        ],
        "main_competition": {
            "id": competitions[MAIN_TITLE].id,
            "title": MAIN_TITLE,
            "invite_code": invites[MAIN_TITLE],
            "source_id": source.id,
        },
        "source": {
            "id": source.id,
            "competition_id": source.competition_id,
            "title": source.title,
            "filename": source.filename,
            "status": source.status,
        },
        "students": [
            {
                "id": student.id,
                "email": student.email,
                "name": student.display_name,
                "points": scorecard[student.email]["points"],
                "cards": scorecard[student.email]["cards"],
                "correct": scorecard[student.email]["correct"],
            }
            for student in students
        ],
        "expected_scores": expected,
        "cast": [
            {
                "name": student.display_name,
                "email": student.email,
                "points": scorecard[student.email]["points"],
                "cards": scorecard[student.email]["cards"],
            }
            for student in students
        ],
    }
    target = _manifest_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def main() -> int:
    db = SessionLocal()
    try:
        users: dict[str, User] = {}
        for email, name, _role in USER_SPECS:
            user, created = _ensure_user(db, email, name)
            users[email] = user
            print(f"[promo-seed] user {email} ({name}): {'created' if created else 'exists'}")

        wang = users[WANG_EMAIL]
        zhou = users[ZHOU_EMAIL]
        students = [users[email] for email in STUDENT_EMAILS]

        competitions: dict[str, Competition] = {}
        main, created = _ensure_competition(
            db,
            owner=wang,
            title=MAIN_TITLE,
            description="以赛促学，围绕《财务会计》第 3 章展开班级联赛。",
            knowledge_prompt="财务会计 第3章 应收款项及预防账款",
            rewards=[
                {"rank": 1, "name": "冠军奖杯"},
                {"rank": 2, "name": "定制笔记本"},
                {"rank": 3, "name": "精美文具套装"},
            ],
        )
        competitions[MAIN_TITLE] = main
        print(f"[promo-seed] competition {MAIN_TITLE}: {'created' if created else 'exists'}")

        class_one, created = _ensure_competition(
            db,
            owner=wang,
            title=CLASS_ONE_TITLE,
            description="一班财务会计专项冲刺，聚焦应收款项与报表分析。",
            knowledge_prompt="财务会计 应收账款与报表分析",
            rewards=[{"rank": 1, "name": "学习之星证书"}],
        )
        competitions[CLASS_ONE_TITLE] = class_one
        print(f"[promo-seed] competition {CLASS_ONE_TITLE}: {'created' if created else 'exists'}")

        class_two, created = _ensure_competition(
            db,
            owner=zhou,
            title=CLASS_TWO_TITLE,
            description="二班微观经济学期中复习，覆盖弹性、消费者行为与市场结构。",
            knowledge_prompt="微观经济学 弹性与消费者行为",
            rewards=[{"rank": 1, "name": "经济学读物"}],
        )
        competitions[CLASS_TWO_TITLE] = class_two
        print(f"[promo-seed] competition {CLASS_TWO_TITLE}: {'created' if created else 'exists'}")

        invites = {
            MAIN_TITLE: MAIN_INVITE,
            CLASS_ONE_TITLE: CLASS_ONE_INVITE,
            CLASS_TWO_TITLE: CLASS_TWO_INVITE,
        }
        _ensure_invite(db, competition=main, creator=wang, code=MAIN_INVITE)
        _ensure_invite(db, competition=class_one, creator=wang, code=CLASS_ONE_INVITE)
        _ensure_invite(db, competition=class_two, creator=zhou, code=CLASS_TWO_INVITE)
        print("[promo-seed] invites: LR-2026 / LR-2026-C1 / LR-2026-C2")

        # Teachers are owners only. Guarantee the main competition contains
        # exactly the four students and no teacher member rows anywhere.
        teacher_ids = [wang.id, zhou.id]
        db.execute(
            delete(CompetitionMember).where(
                CompetitionMember.user_id.in_(teacher_ids),
                CompetitionMember.competition_id.in_(
                    [main.id, class_one.id, class_two.id]
                ),
            )
        )
        db.execute(
            delete(CompetitionMember).where(
                CompetitionMember.competition_id == main.id,
                CompetitionMember.user_id.notin_([student.id for student in students]),
            )
        )
        db.commit()
        for student in students:
            if _ensure_member(db, competition=main, user=student):
                print(f"[promo-seed] member {student.email} in main: created")
        main_members = int(
            db.scalar(
                select(func.count())
                .select_from(CompetitionMember)
                .where(CompetitionMember.competition_id == main.id)
            )
            or 0
        )
        print(f"[promo-seed] main members: {main_members} (students only)")

        source, created = _ensure_source(db, owner=wang, competition=main)
        print(
            f"[promo-seed] source {source.title}: "
            f"{'created' if created else 'exists'} (id={source.id}, status={source.status})"
        )

        _points, children, kp_created = _ensure_knowledge_points(
            db, owner=wang, source=source
        )
        total_kps = int(
            db.scalar(
                select(func.count())
                .select_from(KnowledgePoint)
                .where(KnowledgePoint.source_id == source.id)
            )
            or 0
        )
        print(f"[promo-seed] knowledge points: +{kp_created} (total {total_kps})")

        questions, question_created = _ensure_questions(
            db, owner=wang, competition=main, children=children
        )
        print(f"[promo-seed] questions: +{question_created} (total {len(questions)})")

        scorecard = _rebuild_derived_rows(
            db, students=students, questions=questions, source=source
        )

        total_attempts = int(
            db.scalar(
                select(func.count())
                .select_from(QuizAttempt)
                .where(QuizAttempt.user_id.in_([student.id for student in students]))
            )
            or 0
        )
        total_cards = int(
            db.scalar(
                select(func.count())
                .select_from(ReviewCard)
                .where(ReviewCard.user_id.in_([student.id for student in students]))
            )
            or 0
        )
        total_logs = int(
            db.scalar(
                select(func.count())
                .select_from(ReviewLog)
                .where(ReviewLog.user_id.in_([student.id for student in students]))
            )
            or 0
        )
        print(f"[promo-seed] attempts rebuilt: {total_attempts}")
        print(f"[promo-seed] review cards rebuilt: {total_cards}, logs: {total_logs}")

        print("[promo-seed] leaderboard (main competition):")
        for student in students:
            entry = scorecard[student.email]
            print(
                f"[promo-seed]   {student.display_name:<4} "
                f"points={entry['points']:<4} correct={entry['correct']:<3} "
                f"cards={entry['cards']}"
            )

        manifest = _write_manifest(
            users=users,
            competitions=competitions,
            invites=invites,
            source=source,
            scorecard=scorecard,
        )
        print(f"[promo-seed] manifest: {manifest}")
        print("[promo-seed] done")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
