"""赛题试炼 / 晋级赛 / 个人中心数据，与前端 mockData 保持同构。"""

from __future__ import annotations

from typing import Any

trial_exam: dict[str, Any] = {
    "title": "全科综合能力模拟卷（一）",
    "level": "高中",
    "cover": "blackboard",
    "questionTotal": 8,
    "fullScore": 100,
    "durationLeft": 5316,
    "questions": [
        {
            "id": "tq-01", "no": 1, "type": "choice", "score": 10,
            "stem": "The new policy will take effect next month, ______ everyone has been discussing recently.",
            "options": [
                {"key": "A", "text": "that"},
                {"key": "B", "text": "which"},
                {"key": "C", "text": "what"},
                {"key": "D", "text": "as"},
            ],
            "answer": "B",
            "analysis": "考查非限制性定语从句。先行词为整个主句所述内容，且从句缺少主语，应用关系代词 which 引导，故选 B。that 不能引导非限制性定语从句；what 不能引导定语从句；as 引导定语从句时多与 such / the same 连用。",
        },
        {
            "id": "tq-02", "no": 2, "type": "blank", "score": 10,
            "stem": "一物体以 10 m/s 的初速度做匀减速直线运动，加速度大小为 2 m/s²，则它停止前最后 1 s 内的位移为 ______ m。",
            "placeholder": "请填入答案，如 5",
            "answer": "1",
            "analysis": "逆序处理：停止前最后 1 s 的运动可视为初速度为零、加速度 2 m/s² 的匀加速运动，位移 x = ½at² = ½ × 2 × 1² = 1 m。",
        },
        {
            "id": "tq-03", "no": 3, "type": "choice", "score": 10,
            "stem": "下列关于细胞分化、衰老与凋亡的叙述，正确的是：",
            "options": [
                {"key": "A", "text": "细胞分化导致细胞内遗传物质发生改变"},
                {"key": "B", "text": "衰老细胞内多种酶的活性降低"},
                {"key": "C", "text": "细胞凋亡是由外界不利因素引起的被动死亡"},
                {"key": "D", "text": "分化的细胞将失去全部分裂能力"},
            ],
            "answer": "B",
            "analysis": "细胞分化是基因选择性表达的结果，遗传物质不变，A 错；衰老细胞内多种酶活性降低、代谢减慢，B 正确；细胞凋亡是由基因决定的程序性死亡，属主动过程，C 错；部分分化细胞（如记忆细胞）仍保留分裂能力，D 错。故选 B。",
        },
        {
            "id": "tq-04", "no": 4, "type": "blank", "score": 10,
            "stem": "用所给词的适当形式填空：Hardly ______ (we arrive) at the station when the train began to pull away.",
            "placeholder": "请填入答案",
            "answer": "had we arrived",
            "analysis": "hardly…when… 句型中，hardly 置于句首引起部分倒装，且主句动作发生在从句动作之前，用过去完成时，故填 had we arrived。",
        },
        {
            "id": "tq-05", "no": 5, "type": "choice", "score": 10,
            "stem": "1927 年，八七会议确定的总方针是：",
            "options": [
                {"key": "A", "text": "建立农村革命根据地"},
                {"key": "B", "text": "土地革命和武装反抗国民党反动派"},
                {"key": "C", "text": "和平争取民主建国"},
                {"key": "D", "text": "全面开展工人运动"},
            ],
            "answer": "B",
            "analysis": "八七会议确立了土地革命和武装反抗国民党反动派的总方针，毛泽东在会上提出「政权是由枪杆子中取得的」著名论断，故选 B。建立农村革命根据地是会后逐渐探索的道路，A 不是会议确定的总方针。",
        },
        {
            "id": "tq-06", "no": 6, "type": "blank", "score": 10,
            "stem": "将 100 mL 2.0 mol/L 的盐酸与足量碳酸钙完全反应，标准状况下生成 CO₂ 的体积约为 ______ L（保留两位小数）。",
            "placeholder": "请填入答案，如 2.24",
            "answer": "2.24",
            "analysis": "n(HCl) = 2.0 mol/L × 0.1 L = 0.2 mol。由 CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑，生成 n(CO₂) = 0.1 mol。标准状况下 V = 0.1 × 22.4 = 2.24 L。",
        },
        {
            "id": "tq-07", "no": 7, "type": "choice", "score": 20,
            "stem": "下列句子中，加点成语使用恰当的一项是：",
            "options": [
                {"key": "A", "text": "他在辩论会上侃侃而谈，观点鲜明，令对手难以招架。"},
                {"key": "B", "text": "这篇论文的观点不伦不类，见解十分深刻。"},
                {"key": "C", "text": "晚会现场装饰得栩栩如生，充满了节日气氛。"},
                {"key": "D", "text": "他做事总是杯弓蛇影，从不轻易下结论。"},
            ],
            "answer": "A",
            "analysis": "侃侃而谈形容说话理直气壮、从容不迫，用于辩论场合恰当，A 正确。不伦不类指不像这一类也不像那一类，形容不规范、不像样，与「见解深刻」矛盾，B 错；栩栩如生形容形象生动逼真如活的一样，不能形容会场装饰，C 错；杯弓蛇影比喻疑神疑鬼、自相惊扰，含贬义且与「从不轻易下结论」语境不符，D 错。故选 A。",
        },
        {
            "id": "tq-08", "no": 8, "type": "blank", "score": 20,
            "stem": "质量 2 kg 的小球从 20 m 高处自由下落，落地时速度大小为 ______ m/s。（g 取 10 m/s²，不计空气阻力）",
            "placeholder": "请填入答案，如 20",
            "answer": "20",
            "analysis": "自由落体运动：v² = 2gh = 2 × 10 × 20 = 400，故落地速度 v = 20 m/s。",
        },
    ],
}

user_progress: dict[str, Any] = {
    "prepDone": True,
    "trialDone": 2,
    "trialTotal": 5,
    "points": 30,
    "pointsTarget": 100,
}

profile_info: dict[str, Any] = {
    "name": "林同学",
    "school": "南山大学",
    "badge": "钻石级",
    "motto": "每一次练习，都是向目标更近的一步。",
    "joinTime": "2024年3月",
    "grade": "大学二年级",
    "strengths": ["英语", "物理", "编程"],
    "homepage": "未设置",
}

profile_stats: list[dict[str, Any]] = [
    {"key": "points", "label": "我的积分", "value": "1,280", "delta": "+120", "tone": "blue"},
    {"key": "joined", "label": "已参加竞赛", "value": "12", "delta": "+3", "tone": "green"},
    {"key": "favorites", "label": "收藏题目", "value": "86", "delta": "+12", "tone": "violet"},
    {"key": "wrong", "label": "错题数量", "value": "32", "delta": "-8", "tone": "red"},
]

competition_records: list[dict[str, Any]] = [
    {"id": "cr-01", "cover": "aurora", "title": "2025 秋季学习挑战赛", "level": "高中",
     "timeRange": "2025-09-01 14:00 - 2025-09-15 23:59", "award": "全国三等奖", "rankText": "排名 3 / 856"},
    {"id": "cr-02", "cover": "blackboard", "title": "全科知识联赛模拟赛", "level": "高中",
     "timeRange": "2025-08-20 19:00 - 2025-09-05 22:00", "award": "省级一等奖", "rankText": "排名 5 / 1203"},
    {"id": "cr-03", "cover": "wave", "title": "2025 跨学科研究挑战赛", "level": "大学",
     "timeRange": "2025-08-25 09:00 - 2025-09-12 18:00", "award": "全国二等奖", "rankText": "排名 12 / 642"},
]

study_progress: list[dict[str, Any]] = [
    {"id": "sp-01", "cover": "geometry", "title": "英语词汇冲顶营", "level": "高中",
     "lastLesson": "第 3 讲 词根词缀记忆法", "percent": 72},
    {"id": "sp-02", "cover": "blackboard", "title": "历史时间线专题", "level": "高中",
     "lastLesson": "第 2 讲 近代史框架梳理", "percent": 45},
    {"id": "sp-03", "cover": "wave", "title": "跨学科研究挑战赛", "level": "大学",
     "lastLesson": "第 1 讲 选题与研究思路", "percent": 28},
]

setting_groups: list[dict[str, Any]] = [
    {
        "title": "账号设置",
        "items": [
            {"icon": "user", "title": "基本信息", "desc": "修改昵称、学校、年级等个人信息"},
            {"icon": "shield", "title": "安全设置", "desc": "修改密码、绑定邮箱、账号安全"},
            {"icon": "bell", "title": "通知设置", "desc": "管理系统通知、邮件提醒"},
        ],
    },
    {
        "title": "偏好设置",
        "items": [
            {"icon": "sliders", "title": "学习偏好", "desc": "选择感兴趣的学科方向和难度范围"},
            {"icon": "monitor", "title": "界面设置", "desc": "调整网站主题、显示偏好"},
            {"icon": "lock", "title": "隐私设置", "desc": "管理个人资料的可见范围"},
        ],
    },
]

leaderboard: list[dict[str, Any]] = [
    {"rank": 1, "name": "流云逐梦者", "tier": "卓越", "division": "I", "points": 2860, "avatarHue": 215},
    {"rank": 2, "name": "星云下的旅人", "tier": "卓越", "division": "II", "points": 2720, "avatarHue": 330},
    {"rank": 3, "name": "风过山海", "tier": "卓越", "division": "III", "points": 2640, "avatarHue": 20},
    {"rank": 4, "name": "追风少年", "tier": "贯通", "division": "I", "points": 2580, "avatarHue": 150},
    {"rank": 5, "name": "云端的守望者", "tier": "贯通", "division": "II", "points": 2520, "avatarHue": 205},
    {"rank": 6, "name": "知行者", "tier": "贯通", "division": "III", "points": 2480, "avatarHue": 268},
    {"rank": 7, "name": "山海行者", "tier": "贯通", "division": "IV", "points": 2430, "avatarHue": 350},
    {"rank": 8, "name": "书海逐光", "tier": "明理", "division": "I", "points": 2370, "avatarHue": 190},
    {"rank": 9, "name": "青山之下", "tier": "明理", "division": "II", "points": 2320, "avatarHue": 240},
    {"rank": 10, "name": "向光而行", "tier": "明理", "division": "III", "points": 2280, "avatarHue": 95},
]
