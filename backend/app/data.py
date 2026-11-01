"""LearnRise 后端种子数据，与前端 src/api/mock/mockData.ts 保持同构。"""

from __future__ import annotations

from typing import Any

competitions: list[dict[str, Any]] = [
    {
        "id": "comp-001",
        "title": "2025 秋季学习挑战赛",
        "level": "高中",
        "description": "以学促赛，在挑战中遇见更强的自己!",
        "host": "学习小能手",
        "memberCount": 7,
        "capacity": 10,
        "startTime": "2025-09-01 14:00",
        "endTime": "2025-09-15 23:59",
        "awardQuota": 3,
        "daysToStart": 12,
        "daysToEnd": 26,
        "cover": "aurora",
        "inviteCode": "A7K9M2",
    },
    {
        "id": "comp-002",
        "title": "全科知识联赛模拟赛",
        "level": "高中",
        "description": "覆盖多学科综合知识，全面提升学习竞争力。",
        "host": "凌风徐来",
        "memberCount": 7,
        "capacity": 10,
        "startTime": "2025-08-20 19:00",
        "endTime": "2025-09-05 22:00",
        "awardQuota": 5,
        "daysToStart": 8,
        "daysToEnd": 22,
        "cover": "blackboard",
        "inviteCode": "Q3X8R5",
    },
    {
        "id": "comp-003",
        "title": "英语词汇冲顶营",
        "level": "高中",
        "description": "从基础到进阶，系统提升词汇量与阅读理解能力。",
        "host": "词达意",
        "memberCount": 7,
        "capacity": 10,
        "startTime": "2025-08-18 10:00",
        "endTime": "2025-09-01 23:59",
        "awardQuota": 3,
        "daysToStart": 6,
        "daysToEnd": 19,
        "cover": "geometry",
        "inviteCode": "B5N7K4",
    },
    {
        "id": "comp-004",
        "title": "2025 跨学科研究挑战赛",
        "level": "大学",
        "description": "用跨学科思维解决真实问题，激发研究与协作能力。",
        "host": "课题小队长",
        "memberCount": 7,
        "capacity": 10,
        "startTime": "2025-08-25 09:00",
        "endTime": "2025-09-12 18:00",
        "awardQuota": 2,
        "daysToStart": 10,
        "daysToEnd": 24,
        "cover": "wave",
        "inviteCode": "M8T2W6",
    },
    {
        "id": "comp-005",
        "title": "记忆与专注进阶赛",
        "level": "高中",
        "description": "挑战记忆极限，解锁高效学习方法与专注习惯。",
        "host": "学海拾贝",
        "memberCount": 6,
        "capacity": 10,
        "startTime": "2025-09-05 09:00",
        "endTime": "2025-09-20 21:00",
        "awardQuota": 4,
        "daysToStart": 15,
        "daysToEnd": 29,
        "cover": "forest",
        "inviteCode": "C9Y4F7",
    },
]

members_by_competition: dict[str, list[dict[str, Any]]] = {
    "comp-001": [
        {"id": "m-01", "name": "林同学", "role": "leader", "avatarHue": 212},
        {"id": "m-02", "name": "张雨欣", "role": "member", "avatarHue": 330},
        {"id": "m-03", "name": "王梓轩", "role": "member", "avatarHue": 150},
        {"id": "m-04", "name": "李思琪", "role": "member", "avatarHue": 268},
        {"id": "m-05", "name": "陈子墨", "role": "member", "avatarHue": 28},
        {"id": "m-06", "name": "刘宇航", "role": "member", "avatarHue": 196},
        {"id": "m-07", "name": "赵心妍", "role": "member", "avatarHue": 350},
    ],
}

default_stages: list[dict[str, Any]] = [
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
]

PLAN_INTRO = "六阶进阶，系统提升，从基础到卓越，全面备战学习竞赛"

plan_by_competition: dict[str, dict[str, Any]] = {
    "comp-001": {
        "stats": {
            "daysToStart": 12,
            "startAt": "2025-09-01 14:00",
            "daysToEnd": 26,
            "endAt": "2025-09-15 23:59",
            "awardQuota": 3,
        },
        "rewards": [
            {"rank": 1, "name": "运动手环"},
            {"rank": 2, "name": "小风扇"},
            {"rank": 3, "name": "水杯"},
        ],
        "intro": PLAN_INTRO,
        "stages": default_stages,
    },
}


def build_default_plan(competition: dict[str, Any]) -> dict[str, Any]:
    """未单独配置规划的竞赛，按竞赛字段推导默认规划。"""
    quota = int(competition["awardQuota"])
    fallback = [
        {"rank": 1, "name": "定制奖杯"},
        {"rank": 2, "name": "精美文具套装"},
        {"rank": 3, "name": "学习周边盲盒"},
    ][: max(1, min(3, quota))]
    return {
        "stats": {
            "daysToStart": competition["daysToStart"],
            "startAt": competition["startTime"],
            "daysToEnd": competition["daysToEnd"],
            "endAt": competition["endTime"],
            "awardQuota": quota,
        },
        "rewards": fallback,
        "intro": PLAN_INTRO,
        "stages": default_stages,
    }


def build_default_members(competition: dict[str, Any]) -> list[dict[str, Any]]:
    """按成员数生成占位名单。"""
    pool = ["沈知行", "苏晚晴", "陆一鸣", "顾清源", "江晓棠", "方远志", "聂云帆", "宋星野", "孟思齐", "韩明轩"]
    hues = [205, 320, 140, 275, 45, 185, 20, 300, 95, 240]
    count = max(1, min(int(competition["memberCount"]), len(pool)))
    result = []
    for i in range(count):
        result.append(
            {
                "id": f"{competition['id']}-m-{i + 1}",
                "name": competition["host"] if i == 0 else pool[i],
                "role": "leader" if i == 0 else "member",
                "avatarHue": hues[i],
            }
        )
    return result
