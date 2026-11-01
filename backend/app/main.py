"""LearnRise 学习竞赛平台后端。

与前端 src/api/client.ts 中 realApi 的路径一一对应：
- GET  /api/competitions                竞赛列表
- GET  /api/competitions/{cid}          竞赛详情
- GET  /api/competitions/{cid}/members  成员列表
- GET  /api/competitions/{cid}/plan     学习规划
- POST /api/competitions                创建竞赛（返回邀请码）
- POST /api/uploads/document            上传文档
- POST /api/roadmap/preview             规划图预览
- GET  /api/invite/{code}               邀请码查询
"""

from __future__ import annotations

import secrets
import string
import time
from datetime import datetime
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import data
from app import prep_data
from app import prep_data_hmath
from app import trial_data

app = FastAPI(title="LearnRise Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CODE_CHARS = string.ascii_uppercase.translate({ord(c): None for c in "IO01"}) + string.digits[2:]


def gen_code(length: int = 6) -> str:
    return "".join(secrets.choice(CODE_CHARS) for _ in range(length))


def gen_id() -> str:
    return f"comp-{int(time.time() * 1000):x}-{secrets.randbelow(10000)}"


class RewardIn(BaseModel):
    rank: int
    name: str = ""
    imageUrl: str | None = None


class CreateCompetitionIn(BaseModel):
    name: str = ""
    documentName: str | None = None
    knowledgePrompt: str = ""
    questionType: str = "both"
    difficulty: str = "medium"
    winnerCount: int = Field(default=3, ge=1, le=10)
    rewards: list[RewardIn] = []
    startTime: str
    endTime: str


class RoadmapPreviewIn(CreateCompetitionIn):
    pass


def _find(cid: str) -> dict[str, Any]:
    for c in data.competitions:
        if c["id"] == cid:
            return c
    raise HTTPException(status_code=404, detail="竞赛不存在")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/competitions")
def list_competitions() -> list[dict[str, Any]]:
    return list(data.competitions)


@app.get("/api/competitions/{cid}")
def get_competition(cid: str) -> dict[str, Any]:
    return _find(cid)


@app.get("/api/competitions/{cid}/members")
def list_members(cid: str) -> list[dict[str, Any]]:
    competition = _find(cid)
    return data.members_by_competition.get(cid) or data.build_default_members(competition)


@app.delete("/api/competitions/{cid}/members/{member_id}")
def remove_member(cid: str, member_id: str) -> list[dict[str, Any]]:
    """队长移除成员，队长本人不可移除。"""
    competition = _find(cid)
    members = data.members_by_competition.get(cid) or data.build_default_members(competition)
    target = next((m for m in members if m["id"] == member_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="成员不存在")
    if target["role"] == "leader":
        raise HTTPException(status_code=403, detail="队长不可被移除")
    remaining = [m for m in members if m["id"] != member_id]
    data.members_by_competition[cid] = remaining
    competition["memberCount"] = max(0, int(competition["memberCount"]) - 1)
    return remaining


@app.get("/api/competitions/{cid}/plan")
def get_plan(cid: str) -> dict[str, Any]:
    competition = _find(cid)
    return data.plan_by_competition.get(cid) or data.build_default_plan(competition)


@app.post("/api/competitions")
def create_competition(payload: CreateCompetitionIn) -> dict[str, str]:
    cid = gen_id()
    now = datetime.now()
    try:
        start = datetime.strptime(payload.startTime, "%Y-%m-%d %H:%M")
        end = datetime.strptime(payload.endTime, "%Y-%m-%d %H:%M")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="时间格式应为 YYYY-MM-DD HH:mm") from exc

    def days(ts: datetime) -> int:
        return max(0, round((ts - now).total_seconds() / 86400))

    covers = ["aurora", "geometry", "wave", "forest", "blackboard"]
    competition = {
        "id": cid,
        "title": payload.name.strip() or f"学习竞赛 {now.month} 月 {now.day} 日",
        "level": "高中",
        "description": (payload.knowledgePrompt[:30] or "从上传文档自动生成的学习竞赛。"),
        "host": "林同学",
        "memberCount": 1,
        "capacity": 10,
        "startTime": payload.startTime,
        "endTime": payload.endTime,
        "awardQuota": payload.winnerCount,
        "daysToStart": days(start),
        "daysToEnd": days(end),
        "cover": covers[secrets.randbelow(len(covers))],
        "inviteCode": gen_code(),
    }
    data.competitions.insert(0, competition)
    data.members_by_competition[cid] = [
        {"id": f"{cid}-m-1", "name": "林同学", "role": "leader", "avatarHue": 212}
    ]
    data.plan_by_competition[cid] = data.build_default_plan(competition)
    return {"id": cid, "inviteCode": competition["inviteCode"]}


@app.post("/api/uploads/document")
async def upload_document(file: UploadFile = File(...)) -> dict[str, str]:
    """预留接口：当前仅登记文件名，后续接入解析与 AI 生成。"""
    return {"documentId": f"doc-{int(time.time() * 1000):x}", "fileName": file.filename or "未命名"}


@app.post("/api/roadmap/preview")
def preview_roadmap(payload: RoadmapPreviewIn) -> list[dict[str, Any]]:
    """预留接口：真实场景由 AI 依据文档与知识点生成；当前按分句映射到六阶主题。"""
    import re

    chunks = [s.strip() for s in re.split(r"[\n;；。、,，]+", payload.knowledgePrompt) if s.strip()]
    if not chunks:
        return data.default_stages
    stages = []
    for i, stage in enumerate(data.default_stages):
        chunk = chunks[i % len(chunks)]
        stages.append(
            {
                **stage,
                "theme": chunk[:12],
            }
        )
    return stages


@app.get("/api/invite/{code}")
def find_by_invite_code(code: str) -> dict[str, Any]:
    upper = code.strip().upper()
    for c in data.competitions:
        if c["inviteCode"].upper() == upper:
            return c
    raise HTTPException(status_code=404, detail="邀请码无效或竞赛不存在")


# ==================== 备赛区：学习助手 ====================

import random as _random


class ChatMessageIn(BaseModel):
    text: str


class MindMapGenerateIn(BaseModel):
    topic: str


@app.get("/api/chat/history")
def chat_history() -> list[dict[str, Any]]:
    return prep_data.chat_history


@app.get("/api/chat/suggestions")
def chat_suggestions(batch: int = 0) -> dict[str, Any]:
    batches = prep_data.chat_suggestion_batches
    return {"questions": batches[batch % len(batches)]}


@app.post("/api/chat/messages")
def chat_messages(payload: ChatMessageIn) -> dict[str, Any]:
    text = payload.text.strip()
    if any(kw in text for kw in ("计划", "规划", "备考", "复习安排")):
        return {
            "reply": "好的！我已根据你的描述整理了一个通用备考框架。你可以告诉我具体科目和当前水平，我来帮你进一步细化。",
            "planCard": prep_data.chat_seed_plan_card,
        }
    if any(kw in text for kw in ("错题", "错题本", "归纳")):
        return {
            "reply": "关于错题整理，建议按三步走：第一，按知识点归类错题，找出集中失分的模块；第二，每道错题写下错误原因与正确思路，标注易错点；第三，每周重做一次错题本中的题目，连续两次做对再移出。你也可以把错题添加到错题收藏，我会帮你自动归纳知识点与高频错因。",
        }
    snippet = text[:24]
    variants = [
        f"收到！关于「{snippet}」，建议先明确目标和现有基础，把大目标拆解成周计划，优先补齐最薄弱的模块。遇到具体题目或知识点随时发给我，我会帮你分析归纳；也可以让我为你生成对应章节的思维导图。",
        f"明白你的问题。针对「{snippet}」，可以先做一次自测定位薄弱点，再按「概念梳理 → 专项练习 → 综合检验」的节奏推进。需要的话，我可以为相关章节生成思维导图，或把要点整理成复习清单。",
    ]
    return {"reply": _random.choice(variants)}


# ==================== 备赛区：错题收藏 ====================

@app.get("/api/wrong-questions")
def list_wrong_questions() -> list[dict[str, Any]]:
    return prep_data_hmath.wrong_questions


@app.delete("/api/wrong-questions/{wid}")
def delete_wrong_question(wid: str) -> list[dict[str, Any]]:
    """删除一道错题，返回删除后的列表。"""
    questions = prep_data_hmath.wrong_questions
    idx = next((i for i, q in enumerate(questions) if q["id"] == wid), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="错题不存在")
    questions.pop(idx)
    return questions


# ==================== 备赛区：思维导图 ====================

@app.get("/api/mindmap/default")
def mindmap_default() -> dict[str, Any]:
    return prep_data_hmath.default_mind_map


@app.post("/api/mindmap/generate")
def mindmap_generate(payload: MindMapGenerateIn) -> dict[str, Any]:
    topic = payload.topic.strip() or "新章节"
    return prep_data.build_mindmap_template(topic)


# ==================== 赛题试炼 / 晋级赛 / 个人中心 ====================

@app.get("/api/trial/exam")
def trial_exam() -> dict[str, Any]:
    return prep_data_hmath.trial_exam


@app.post("/api/trial/submit")
def trial_submit() -> dict[str, Any]:
    """交卷：赛题试炼完成数 +1，积分 +10，返回最新进度。"""
    p = trial_data.user_progress
    p["trialDone"] = min(p["trialTotal"], p["trialDone"] + 1)
    p["points"] = min(p["pointsTarget"], p["points"] + 10)
    return p


@app.get("/api/progress")
def get_progress() -> dict[str, Any]:
    return trial_data.user_progress


@app.get("/api/profile/info")
def profile_info() -> dict[str, Any]:
    return trial_data.profile_info


@app.get("/api/profile/stats")
def profile_stats() -> list[dict[str, Any]]:
    return trial_data.profile_stats


@app.get("/api/profile/competition-records")
def profile_competition_records() -> list[dict[str, Any]]:
    return trial_data.competition_records


@app.get("/api/profile/study-progress")
def profile_study_progress() -> list[dict[str, Any]]:
    return trial_data.study_progress


@app.get("/api/profile/settings")
def profile_settings() -> list[dict[str, Any]]:
    return trial_data.setting_groups


@app.get("/api/leaderboard/{competition_id}")
def leaderboard(competition_id: str) -> list[dict[str, Any]]:
    _find(competition_id)
    return trial_data.leaderboard
