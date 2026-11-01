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
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import AgentConfig, IngestionJob, KnowledgeSource, User, new_uuid
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
