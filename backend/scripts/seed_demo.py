"""Idempotent demo seeding: fixtures, demo user and demo agent.

Usage (inside the backend container)::

    python scripts/seed_demo.py
    python scripts/seed_demo.py --make-fixtures --fixtures-dir /app/fixtures
    python scripts/seed_demo.py --ingest --fixtures-dir /app/fixtures

The demo user is ``demo@example.com`` / ``demo1234``. Exactly one agent is kept:
``DeepSeek 官方`` with a placeholder key and ``is_default = false``, so the demo
falls back to the server-default provider (``LLM_PROVIDER`` from the
environment, ``mock`` in the demo profile) until a real key is configured. The
legacy ``本地 Mock`` agent (``https://mock.invalid/v1``) is removed when present
because the API re-validates stored base URLs and would return 400. Running the
script twice leaves the same rows behind.
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import psycopg
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import (
    AgentConfig,
    Competition,
    CompetitionInvite,
    CompetitionMember,
    IngestionJob,
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    ReviewCard,
    User,
    new_uuid,
)
from app.security.crypto import encrypt
from app.security.password import hash_password
from app.services.ingest import (
    make_storage_key,
    resolve_content_type,
    run_ingest,
    save_upload,
    title_from_filename,
)

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo1234"
DEMO_NAME = "演示同学"

MOCK_AGENT_NAME = "本地 Mock"
PLACEHOLDER_API_KEY = "sk-placeholder-replace-with-a-real-key"
REAL_AGENT = {
    "name": "DeepSeek 官方",
    "provider_type": "openai_compatible",
    "base_url": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "system_prompt": None,
    "temperature": 0.7,
    "api_key": PLACEHOLDER_API_KEY,
}

ORGANIZER_EMAIL = "mentor@example.com"
ORGANIZER_NAME = "竞赛导师"

DEMO_STAGE_BLUEPRINT: tuple[dict[str, Any], ...] = (
    {"no": "01", "title": "初识", "theme": "基础概念梳理",
     "points": ["核心概念", "基础术语", "知识框架", "入门练习"], "icon": "book"},
    {"no": "02", "title": "启行", "theme": "专项初步训练",
     "points": ["基础题型", "课后练习", "专项训练", "错题整理"], "icon": "grid"},
    {"no": "03", "title": "明理", "theme": "重难点突破",
     "points": ["核心难点", "易错辨析", "方法总结", "典型例题"], "icon": "triangle"},
    {"no": "04", "title": "融会", "theme": "知识综合运用",
     "points": ["跨章综合", "知识串联", "综合练习", "思维导图"], "icon": "chart"},
    {"no": "05", "title": "贯通", "theme": "真题模拟实战",
     "points": ["历年真题", "模拟测试", "限时训练", "查漏补缺"], "icon": "pie"},
    {"no": "06", "title": "卓越", "theme": "冲刺全面提升",
     "points": ["高频考点", "综合模拟", "考前冲刺", "心态调整"], "icon": "crown"},
)

DEMO_COMPETITIONS: tuple[dict[str, Any], ...] = (
    {
        "title": "2025 秋季学习挑战赛",
        "description": "以学促赛，在挑战中遇见更强的自己!",
        "question_types": ["choice", "judge", "short_answer"],
        "difficulty": "medium",
        "winner_count": 3,
        "rewards": [
            {"rank": 1, "name": "运动手环"},
            {"rank": 2, "name": "小风扇"},
            {"rank": 3, "name": "水杯"},
        ],
        "knowledge_prompt": "计算机网络、英语语法与物理综合知识",
        "invite_code": "A7K9M2",
        "owner_email": DEMO_EMAIL,
        "member_email": DEMO_EMAIL,
        "member_role": "leader",
        "start_days": 12,
        "end_days": 26,
    },
    {
        "title": "全科知识联赛模拟赛",
        "description": "覆盖多学科综合知识，全面提升学习竞争力。",
        "question_types": ["choice", "short_answer"],
        "difficulty": "hard",
        "winner_count": 2,
        "rewards": [
            {"rank": 1, "name": "定制奖杯"},
            {"rank": 2, "name": "精美文具套装"},
        ],
        "knowledge_prompt": "跨学科综合能力与竞赛解题技巧",
        "invite_code": "Q3X8R5",
        "owner_email": ORGANIZER_EMAIL,
        "member_email": DEMO_EMAIL,
        "member_role": "member",
        "start_days": 8,
        "end_days": 22,
    },
)

DEMO_KNOWLEDGE = (
    ("英语语法", "非限制性定语从句、倒装句与动词时态。"),
    ("物理运动学", "匀变速直线运动、自由落体与速度位移关系。"),
    ("生物细胞", "细胞分化、衰老与凋亡的基本概念。"),
    ("历史纲要", "新民主主义革命时期的重要会议与方针。"),
    ("化学计量", "物质的量、气体摩尔体积与化学方程式计算。"),
    ("语文成语", "常见成语的语义、感情色彩与使用语境。"),
)

DEMO_QUESTIONS: tuple[dict[str, Any], ...] = (
    {
        "knowledge": "英语语法",
        "type": "choice",
        "stem": "The new policy will take effect next month, ______ everyone has been discussing recently.",
        "options": ["A. that", "B. which", "C. what", "D. as"],
        "answer": "B",
        "explanation": "考查非限制性定语从句。先行词为整个主句所述内容，且从句缺少主语，应用关系代词 which 引导，故选 B。that 不能引导非限制性定语从句；what 不能引导定语从句；as 引导定语从句时多与 such / the same 连用。",
    },
    {
        "knowledge": "物理运动学",
        "type": "short_answer",
        "stem": "一物体以 10 m/s 的初速度做匀减速直线运动，加速度大小为 2 m/s²，则它停止前最后 1 s 内的位移为 ______ m。",
        "options": None,
        "answer": "1",
        "explanation": "逆序处理：停止前最后 1 s 的运动可视为初速度为零、加速度 2 m/s² 的匀加速运动，位移 x = ½at² = ½ × 2 × 1² = 1 m。",
    },
    {
        "knowledge": "生物细胞",
        "type": "choice",
        "stem": "下列关于细胞分化、衰老与凋亡的叙述，正确的是：",
        "options": [
            "A. 细胞分化导致细胞内遗传物质发生改变",
            "B. 衰老细胞内多种酶的活性降低",
            "C. 细胞凋亡是由外界不利因素引起的被动死亡",
            "D. 分化的细胞将失去全部分裂能力",
        ],
        "answer": "B",
        "explanation": "细胞分化是基因选择性表达的结果，遗传物质不变，A 错；衰老细胞内多种酶活性降低、代谢减慢，B 正确；细胞凋亡是由基因决定的程序性死亡，属主动过程，C 错；部分分化细胞（如记忆细胞）仍保留分裂能力，D 错。故选 B。",
    },
    {
        "knowledge": "英语语法",
        "type": "short_answer",
        "stem": "用所给词的适当形式填空：Hardly ______ (we arrive) at the station when the train began to pull away.",
        "options": None,
        "answer": "had we arrived",
        "explanation": "hardly…when… 句型中，hardly 置于句首引起部分倒装，且主句动作发生在从句动作之前，用过去完成时，故填 had we arrived。",
    },
    {
        "knowledge": "历史纲要",
        "type": "choice",
        "stem": "1927 年，八七会议确定的总方针是：",
        "options": [
            "A. 建立农村革命根据地",
            "B. 土地革命和武装反抗国民党反动派",
            "C. 和平争取民主建国",
            "D. 全面开展工人运动",
        ],
        "answer": "B",
        "explanation": "八七会议确立了土地革命和武装反抗国民党反动派的总方针，毛泽东在会上提出「政权是由枪杆子中取得的」著名论断，故选 B。建立农村革命根据地是会后逐渐探索的道路，A 不是会议确定的总方针。",
    },
    {
        "knowledge": "化学计量",
        "type": "short_answer",
        "stem": "将 100 mL 2.0 mol/L 的盐酸与足量碳酸钙完全反应，标准状况下生成 CO₂ 的体积约为 ______ L（保留两位小数）。",
        "options": None,
        "answer": "2.24",
        "explanation": "n(HCl) = 2.0 mol/L × 0.1 L = 0.2 mol。由 CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑，生成 n(CO₂) = 0.1 mol。标准状况下 V = 0.1 × 22.4 = 2.24 L。",
    },
    {
        "knowledge": "语文成语",
        "type": "choice",
        "stem": "下列句子中，加点成语使用恰当的一项是：",
        "options": [
            "A. 他在辩论会上侃侃而谈，观点鲜明，令对手难以招架。",
            "B. 这篇论文的观点不伦不类，见解十分深刻。",
            "C. 晚会现场装饰得栩栩如生，充满了节日气氛。",
            "D. 他做事总是杯弓蛇影，从不轻易下结论。",
        ],
        "answer": "A",
        "explanation": "侃侃而谈形容说话理直气壮、从容不迫，用于辩论场合恰当，A 正确。不伦不类形容不规范、不像样，与「见解深刻」矛盾，B 错；栩栩如生形容形象生动逼真，不能形容会场装饰，C 错；杯弓蛇影比喻疑神疑鬼，含贬义且与语境不符，D 错。",
    },
    {
        "knowledge": "物理运动学",
        "type": "short_answer",
        "stem": "质量 2 kg 的小球从 20 m 高处自由下落，落地时速度大小为 ______ m/s。（g 取 10 m/s²，不计空气阻力）",
        "options": None,
        "answer": "20",
        "explanation": "自由落体运动：v² = 2gh = 2 × 10 × 20 = 400，故落地速度 v = 20 m/s。",
    },
)

# (question stem, how many wrong attempts the demo user should have)
DEMO_WRONG_TARGETS = {
    DEMO_QUESTIONS[0]["stem"]: 3,
    DEMO_QUESTIONS[1]["stem"]: 2,
    DEMO_QUESTIONS[2]["stem"]: 1,
    DEMO_QUESTIONS[4]["stem"]: 1,
    DEMO_QUESTIONS[5]["stem"]: 1,
    DEMO_QUESTIONS[6]["stem"]: 1,
}


PAGE_TITLES = (
    "第三章 TCP 传输层实验讲义",
    "3.1 TCP 报文段结构",
    "3.2 三次握手：建立连接",
    "3.3 三次握手的异常场景",
    "3.4 四次挥手：断开连接",
    "3.5 TIME_WAIT 与 2MSL",
    "3.6 拥塞控制：慢启动与拥塞避免",
    "3.7 快重传、快恢复与实验小结",
)

PAGE_BODIES = (
    "本讲义围绕传输层的连接管理展开，重点讨论 TCP 三次握手、四次挥手与拥塞控制三个主题。"
    "实验环境使用两台主机，通过抓包工具观察每一个报文段的序号、确认号与标志位。"
    "阅读时请结合报文结构理解状态迁移，再通过课后练习检验掌握程度。",
    "TCP 报文段由首部与数据两部分组成。首部包含源端口、目的端口、序号、确认号、数据偏移、"
    "控制位与窗口字段。SYN、ACK、FIN、RST 四个控制位决定连接的建立、确认与释放。"
    "窗口字段用于流量控制，接收方通过它告诉发送方当前还能接收多少字节，避免缓冲区溢出。",
    "三次握手用于同步双方的初始序号并确认彼此的收发能力。第一次握手，客户端发送 SYN 报文，"
    "携带初始序号并进入 SYN-SENT 状态。第二次握手，服务器回复 SYN+ACK，既确认客户端，"
    "也给出自己的初始序号。第三次握手，客户端发送 ACK 完成确认，双方进入 ESTABLISHED 状态。"
    "只有三次握手完成，连接才可以传输数据，这样设计可以避免历史连接请求造成错误建连。",
    "如果客户端发送 SYN 后长时间收不到响应，会按指数退避重传 SYN，多次失败后放弃连接。"
    "如果服务器收到 SYN 并回复 SYN+ACK 后客户端不再响应，服务器会保留半开连接并周期性重传，"
    "这就是 SYN 洪泛攻击利用的弱点，常见防御手段是 SYN Cookie。理解这些异常场景，"
    "有助于分析连接超时、端口耗尽与半开连接等线上故障。",
    "四次挥手用于安全地断开一条全双工连接。第一次挥手，主动关闭方发送 FIN，表示不再发送数据，"
    "但仍可以接收数据。第二次挥手，被动方回复 ACK，表示已收到关闭请求。第三次挥手，"
    "被动方处理完剩余数据后发送自己的 FIN。第四次挥手，主动方回复 ACK，连接进入关闭流程。"
    "两个方向的数据流必须分别关闭，因此断开连接需要四次交互而不是两次。",
    "主动关闭方在发送最后一个 ACK 后进入 TIME_WAIT 状态，并等待 2MSL 才真正关闭。"
    "2MSL 是报文最大生存时间的两倍，用于确保最后的确认能够到达，并让旧连接的重复报文在网络中消失。"
    "TIME_WAIT 过长会占用端口，过短则可能出现旧报文干扰新连接，实际系统通常通过端口复用缓解。"
    "在高并发服务器上，TIME_WAIT 数量是重要的观测指标。",
    "拥塞控制的目标是让发送方在不确定的网络中安全地提高发送速率。慢启动阶段，拥塞窗口从 1 个 MSS 开始，"
    "每收到一个确认就指数增长。达到慢启动门限后进入拥塞避免，窗口改为线性增长。"
    "当出现超时，发送方把门限减半并重新慢启动；当收到三个重复确认，则触发快重传与快恢复。"
    "这套机制把丢包视为网络拥塞的信号，在吞吐量与稳定性之间取得平衡。",
    "快重传要求接收方在收到乱序报文时立即发送重复确认，发送方连续收到三个重复确认后不必等待超时即可重传。"
    "快恢复在重传后把窗口减半并直接进入拥塞避免，避免重新慢启动带来的性能抖动。"
    "实验小结：三次握手保证可靠建连，四次挥手保证安全断开，拥塞控制保证网络稳定。"
    "请结合抓包结果记录每一步的序号变化，并尝试解释连接超时与吞吐下降的原因。",
)


def _resolve_fixtures_dir(value: str | None) -> Path:
    if value:
        return Path(value)
    configured = os.environ.get("FIXTURES_DIR")
    if configured:
        return Path(configured)
    for candidate in (
        Path.cwd() / "fixtures",
        Path("/app/fixtures"),
        Path(__file__).resolve().parents[1] / "fixtures",
    ):
        if candidate.is_dir():
            return candidate
    return Path("/app/fixtures")


def make_fixtures(fixtures_dir: Path) -> Path:
    """Render ``lec01.pdf`` (8 pages, Chinese, searchable text)."""
    import pymupdf

    fixtures_dir.mkdir(parents=True, exist_ok=True)
    target = fixtures_dir / "lec01.pdf"
    font = pymupdf.Font("cjk")
    document = pymupdf.open()
    for index, (title, body) in enumerate(zip(PAGE_TITLES, PAGE_BODIES, strict=True)):
        page = document.new_page()
        page.insert_font(fontname="F0", fontbuffer=font.buffer)
        page.insert_textbox(
            pymupdf.Rect(56, 56, 539, 786),
            f"{title}\n\n{body}\n\n页码：{index + 1} / {len(PAGE_TITLES)}",
            fontname="F0",
            fontsize=11.5,
            lineheight=1.5,
        )
    document.set_metadata(
        {
            "title": "计算机网络实验讲义（演示脱敏数据）",
            "author": "LearnRise 演示",
            "subject": "TCP 三次握手 / 四次挥手 / 拥塞控制",
        }
    )
    document.subset_fonts()
    # Subsetting is what keeps the CJK font from adding 1.7 MB to the fixture;
    # without it the whole Droid Sans Fallback face is embedded per file.
    document.save(target, garbage=4, deflate=True, clean=True)
    document.close()

    check = pymupdf.open(target)
    text = "".join(page.get_text() for page in check)
    check.close()
    if "握手" not in text or "拥塞控制" not in text:
        raise SystemExit("[demo-seed] ERROR: generated PDF text is not extractable")
    return target


def ensure_vector_extension() -> None:
    dsn = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")


def run_migrations() -> None:
    root = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        ["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True
    )
    if completed.returncode != 0:
        sys.stderr.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        raise SystemExit("[demo-seed] ERROR: alembic upgrade head failed")
    print("[demo-seed] migrations: head")


def ensure_user(db) -> tuple[User, bool]:
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    created = user is None
    if user is None:
        user = User(
            email=DEMO_EMAIL,
            display_name=DEMO_NAME,
            password_hash=hash_password(DEMO_PASSWORD),
        )
        db.add(user)
    else:
        user.display_name = user.display_name or DEMO_NAME
        user.password_hash = user.password_hash or hash_password(DEMO_PASSWORD)
    db.commit()
    db.refresh(user)
    print(f"[demo-seed] user {DEMO_EMAIL}: {'created' if created else 'exists'}")
    return user, created


def ensure_agent(db, user: User, spec: dict[str, object]) -> None:
    agent = db.scalar(
        select(AgentConfig).where(
            AgentConfig.user_id == user.id,
            AgentConfig.name == str(spec["name"]),
        )
    )
    action = "updated"
    if agent is None:
        agent = AgentConfig(user_id=user.id, name=str(spec["name"]))
        db.add(agent)
        action = "created"
    agent.provider_type = str(spec["provider_type"])
    agent.base_url = str(spec["base_url"])
    agent.model = str(spec["model"])
    agent.system_prompt = spec["system_prompt"]  # type: ignore[assignment]
    agent.temperature = float(spec["temperature"])  # type: ignore[arg-type]
    agent.is_default = False
    placeholder = str(spec.get("api_key") or "")
    agent.api_key_encrypted = agent.api_key_encrypted or encrypt(placeholder)
    db.commit()
    print(f"[demo-seed] agent {spec['name']}: {action}")


def remove_legacy_agents(db, user: User) -> int:
    legacy = [
        agent
        for agent in db.scalars(select(AgentConfig).where(AgentConfig.user_id == user.id))
        if agent.name == MOCK_AGENT_NAME
        or (urlparse(agent.base_url or "").hostname or "").lower() == "mock.invalid"
    ]
    for agent in legacy:
        db.delete(agent)
    db.commit()
    if legacy:
        print(f"[demo-seed] removed legacy agent(s): {len(legacy)}")
    return len(legacy)


def clear_defaults(db, user: User) -> None:
    for agent in db.scalars(select(AgentConfig).where(AgentConfig.user_id == user.id)):
        if agent.is_default:
            agent.is_default = False
    db.commit()


def ingest_fixture(db, user: User, path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"[demo-seed] ERROR: fixture not found: {path}")
    data = path.read_bytes()
    content_type = resolve_content_type(path.name, "")
    source_id = new_uuid()
    storage_key = make_storage_key(user.id, source_id, path.name)
    save_upload(storage_key, data, content_type)
    source = KnowledgeSource(
        id=source_id,
        user_id=user.id,
        title=title_from_filename(path.name),
        filename=path.name,
        content_type=content_type,
        size_bytes=len(data),
        storage_key=storage_key,
        status="pending",
    )
    db.add(source)
    db.flush()
    job = IngestionJob(source_id=source.id, user_id=user.id, status="queued", progress=0)
    db.add(job)
    db.commit()
    db.refresh(job)
    run_ingest(job.id)
    db.refresh(source)
    print(f"[demo-seed] ingest {path.name}: status={source.status}")


def ensure_user_account(db, email: str, name: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    created = user is None
    if user is None:
        user = User(email=email, display_name=name, password_hash=hash_password(password))
        db.add(user)
    else:
        user.display_name = user.display_name or name
        user.password_hash = user.password_hash or hash_password(password)
    db.commit()
    db.refresh(user)
    print(f"[demo-seed] user {email}: {'created' if created else 'exists'}")
    return user


def _days_between(target: datetime | None, now: datetime) -> int:
    if target is None:
        return 0
    return max(0, math.ceil((target - now).total_seconds() / 86400))


def _plan_payload(competition: Competition) -> dict:
    now = datetime.now(UTC)
    return {
        "stats": {
            "daysToStart": _days_between(competition.start_at, now),
            "startAt": competition.start_at.isoformat() if competition.start_at else "",
            "daysToEnd": _days_between(competition.end_at, now),
            "endAt": competition.end_at.isoformat() if competition.end_at else "",
            "awardQuota": competition.winner_count,
        },
        "intro": f"围绕《{competition.title}》的六阶段备赛路线，从基础到卓越。",
        "stages": [dict(stage) for stage in DEMO_STAGE_BLUEPRINT],
    }


def ensure_member(db, competition: Competition, user: User, role: str) -> None:
    member = db.scalar(
        select(CompetitionMember).where(
            CompetitionMember.competition_id == competition.id,
            CompetitionMember.user_id == user.id,
        )
    )
    if member is None:
        db.add(CompetitionMember(competition_id=competition.id, user_id=user.id, role=role))
        db.commit()
        print(f"[demo-seed] member {user.email} in {competition.title}: created ({role})")
    elif member.role != role:
        member.role = role
        db.commit()
        print(f"[demo-seed] member {user.email} in {competition.title}: role -> {role}")


def ensure_invite(db, competition: Competition, creator: User, code: str) -> None:
    invite = db.scalar(select(CompetitionInvite).where(CompetitionInvite.code == code))
    if invite is not None:
        if invite.competition_id != competition.id:
            raise SystemExit(f"[demo-seed] ERROR: invite code {code} belongs to another competition")
        return
    db.add(
        CompetitionInvite(
            competition_id=competition.id,
            created_by=creator.id,
            code=code,
        )
    )
    db.commit()
    print(f"[demo-seed] invite {code} for {competition.title}: created")


def ensure_competitions(db, demo: User) -> None:
    organizer = ensure_user_account(db, ORGANIZER_EMAIL, ORGANIZER_NAME, DEMO_PASSWORD)
    owners = {DEMO_EMAIL: demo, ORGANIZER_EMAIL: organizer}
    members = {DEMO_EMAIL: demo, ORGANIZER_EMAIL: organizer}
    now = datetime.now(UTC)

    for spec in DEMO_COMPETITIONS:
        owner = owners[str(spec["owner_email"])]
        competition = db.scalar(
            select(Competition).where(
                Competition.owner_id == owner.id,
                Competition.title == str(spec["title"]),
            )
        )
        created = competition is None
        if competition is None:
            competition = Competition(
                owner_id=owner.id,
                title=str(spec["title"]),
                description=str(spec["description"]),
                intro="",
                question_types=list(spec["question_types"]),
                difficulty=str(spec["difficulty"]),
                winner_count=int(spec["winner_count"]),
                rewards=list(spec["rewards"]),
                knowledge_prompt=str(spec["knowledge_prompt"]),
                start_at=now + timedelta(days=int(spec["start_days"])),
                end_at=now + timedelta(days=int(spec["end_days"])),
                plan_status="ready",
            )
            db.add(competition)
            db.flush()
        competition.plan_status = "ready"
        if not competition.plan_payload:
            competition.plan_payload = _plan_payload(competition)
        if competition.plan_generated_at is None:
            competition.plan_generated_at = now
        if not competition.rewards:
            competition.rewards = list(spec["rewards"])
        db.commit()
        db.refresh(competition)
        print(
            f"[demo-seed] competition {competition.title}: "
            f"{'created' if created else 'exists'}"
        )

        ensure_member(db, competition, owner, "leader")
        member = members[str(spec["member_email"])]
        if member.id != owner.id:
            ensure_member(db, competition, member, str(spec["member_role"]))
        ensure_invite(db, competition, owner, str(spec["invite_code"]))


def ensure_knowledge_points(db, user: User) -> dict[str, KnowledgePoint]:
    points: dict[str, KnowledgePoint] = {}
    for index, (title, content) in enumerate(DEMO_KNOWLEDGE):
        point = db.scalar(
            select(KnowledgePoint).where(
                KnowledgePoint.user_id == user.id,
                KnowledgePoint.source_id.is_(None),
                KnowledgePoint.title == title,
            )
        )
        if point is None:
            point = KnowledgePoint(
                user_id=user.id,
                title=title,
                content=content,
                level=0,
                sort_order=index,
                mastery_score=0.35,
            )
            db.add(point)
            db.commit()
            db.refresh(point)
            print(f"[demo-seed] knowledge point {title}: created")
        points[title] = point
    return points


def ensure_questions(db, user: User, points: dict[str, KnowledgePoint]) -> dict[str, QuizQuestion]:
    questions: dict[str, QuizQuestion] = {}
    for spec in DEMO_QUESTIONS:
        point = points[str(spec["knowledge"])]
        question = db.scalar(
            select(QuizQuestion).where(
                QuizQuestion.user_id == user.id,
                QuizQuestion.knowledge_point_id == point.id,
                QuizQuestion.question == str(spec["stem"]),
            )
        )
        if question is None:
            question = QuizQuestion(
                user_id=user.id,
                competition_id=None,
                knowledge_point_id=point.id,
                type=str(spec["type"]),
                question=str(spec["stem"]),
                options=spec["options"],
                answer=str(spec["answer"]),
                explanation=str(spec["explanation"]),
                difficulty="medium",
            )
            db.add(question)
            db.commit()
            db.refresh(question)
            print(f"[demo-seed] question {question.id}: created")
        questions[str(spec["stem"])] = question
    return questions


def _wrong_answer(question: QuizQuestion) -> str:
    if question.type == "choice":
        return "C" if question.answer.strip().upper() == "A" else "A"
    return "2026"


def ensure_wrong_attempts(db, user: User, questions: dict[str, QuizQuestion]) -> None:
    created = 0
    for stem, target in DEMO_WRONG_TARGETS.items():
        question = questions[stem]
        existing = int(
            db.scalar(
                select(func.count())
                .select_from(QuizAttempt)
                .where(
                    QuizAttempt.user_id == user.id,
                    QuizAttempt.question_id == question.id,
                    QuizAttempt.correct.is_(False),
                )
            )
            or 0
        )
        while existing < target:
            db.add(
                QuizAttempt(
                    question_id=question.id,
                    user_id=user.id,
                    answer=_wrong_answer(question),
                    correct=False,
                    response_time_ms=25_000,
                )
            )
            existing += 1
            created += 1
        db.commit()
    print(f"[demo-seed] wrong attempts: created {created}")


def ensure_review_cards(db, user: User, questions: dict[str, QuizQuestion]) -> None:
    today = datetime.now(ZoneInfo(settings.timezone)).date()
    created = 0
    for stem, question in questions.items():
        card = db.scalar(
            select(ReviewCard).where(
                ReviewCard.user_id == user.id,
                ReviewCard.quiz_question_id == question.id,
            )
        )
        if card is None:
            db.add(
                ReviewCard(
                    user_id=user.id,
                    knowledge_point_id=question.knowledge_point_id,
                    quiz_question_id=question.id,
                    question=stem,
                    answer=question.answer,
                    card_type="quiz_wrong",
                    difficulty=5.0,
                    stability=1.0,
                    retrievability=1.0,
                    state=0,
                    reps=0,
                    lapses=0,
                    due_date=today,
                    scheduler="dsr_lite",
                )
            )
            created += 1
        elif card.due_date is None or card.due_date > today:
            card.due_date = today
    db.commit()
    print(f"[demo-seed] review cards: created {created}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed the LearnRise demo workspace.")
    parser.add_argument("--make-fixtures", action="store_true", help="render fixtures/lec01.pdf")
    parser.add_argument("--fixtures-only", action="store_true", help="stop after fixtures")
    parser.add_argument("--fixtures-dir", default=None, help="fixtures directory")
    parser.add_argument("--ingest", action="store_true", help="ingest fixtures/lec01.pdf")
    args = parser.parse_args(argv)

    fixtures_dir = _resolve_fixtures_dir(args.fixtures_dir)
    if args.make_fixtures:
        target = make_fixtures(fixtures_dir)
        size_kb = target.stat().st_size / 1024
        print(f"[demo-seed] fixture {target} ({size_kb:.1f} KB)")
        if args.fixtures_only:
            return 0

    ensure_vector_extension()
    run_migrations()
    db = SessionLocal()
    try:
        user, _created = ensure_user(db)
        remove_legacy_agents(db, user)
        ensure_agent(db, user, REAL_AGENT)
        clear_defaults(db, user)
        ensure_competitions(db, user)
        points = ensure_knowledge_points(db, user)
        questions = ensure_questions(db, user, points)
        ensure_wrong_attempts(db, user, questions)
        ensure_review_cards(db, user, questions)
        if args.ingest:
            ingest_fixture(db, user, fixtures_dir / "lec01.pdf")
    finally:
        db.close()
    print(
        "[demo-seed] agents: demo uses the server-default (env) provider unless "
        f"'{REAL_AGENT['name']}' is configured with a real API key"
    )
    print("[demo-seed] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
