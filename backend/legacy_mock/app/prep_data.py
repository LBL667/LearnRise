"""备赛区数据：学习助手 / 错题收藏 / 思维导图。与前端 mockData 保持同构。"""

from __future__ import annotations

from typing import Any

chat_welcome = (
    "你好！我是你的学习竞赛助手。我可以帮你制定学习计划、分析薄弱点、归纳错题知识点、"
    "解答疑难问题，以及提供学习方法建议。请告诉我你的目标或遇到的问题吧！"
)

chat_seed_question = "我下个月要参加校级的综合知识竞赛，请帮我制定一个为期 3 个月的备考计划，兼顾效率和方法。"

chat_seed_plan_card: dict[str, Any] = {
    "title": "3 个月备考计划",
    "months": [
        {
            "no": 1,
            "name": "基础巩固",
            "period": "第 1-4 周",
            "items": ["梳理各科目的核心概念", "整理知识框架与思维导图", "完成基础练习与课后习题", "建立错题本，归纳易错点"],
        },
        {
            "no": 2,
            "name": "专项提升",
            "period": "第 5-8 周",
            "items": ["深入研究高频题型与技巧", "按专题进行系统训练", "每周完成 2-3 套综合练习", "总结解题思路，形成方法体系"],
        },
        {
            "no": 3,
            "name": "模拟冲刺",
            "period": "第 9-12 周",
            "items": ["历年真题与模拟题训练", "限时模拟与全卷演练", "针对薄弱点专项突破", "整理高频考点与常用结论"],
        },
    ],
    "tail": "如果你有更个性化的计划需求（例如：每周具体安排、题目推荐、参考资料），可以告诉我目前的基础和可用学习时间，我可以进一步细化方案。",
}

chat_history: list[dict[str, Any]] = [
    {"id": "msg-welcome", "role": "ai", "text": chat_welcome, "time": "14:18"},
    {"id": "msg-seed-q", "role": "user", "text": chat_seed_question, "time": "14:20"},
    {
        "id": "msg-seed-a",
        "role": "ai",
        "text": "好的！我已根据你的目标（综合知识竞赛）和时间安排，为你制定了为期 3 个月的备考计划。计划兼顾基础巩固、专项提升和模拟冲刺，帮助你稳步提升竞赛能力。",
        "planCard": chat_seed_plan_card,
        "time": "14:21",
    },
]

chat_suggestion_batches: list[list[str]] = [
    [
        "帮我制定本周的学习计划",
        "总结最近错题中的高频知识点",
        "如何提高英语写作的表达能力？",
        "推荐一些提升专注力的训练方法",
        "分析这道题的思路和正确解法",
    ],
    [
        "如何安排高效的复习节奏？",
        "帮我梳理历史时间线的记忆方法",
        "考试总是时间不够用怎么办？",
        "推荐一套错题整理的模板",
        "如何缓解考前紧张情绪？",
    ],
]

wrong_questions: list[dict[str, Any]] = [
    {
        "id": "wq-01", "severity": "repeat", "type": "choice",
        "stem": "______ by the beauty of the West Lake, the tourists decided to stay for another two days.",
        "options": [
            {"key": "A", "text": "Astonishing"},
            {"key": "B", "text": "Astonished"},
            {"key": "C", "text": "To astonish"},
            {"key": "D", "text": "Having astonished"},
        ],
        "tags": ["非谓语动词", "过去分词", "状语"],
        "myMistake": "混淆了现在分词与过去分词表主动、被动的区别，误选了 A。",
        "wrongCount": 3,
        "analysis": {
            "choiceAnswer": "B",
            "optionNotes": [
                {"key": "A", "verdict": "wrong", "text": "Astonishing 为现在分词，表示主动含义「令人惊讶」。句中主语 the tourists 与 astonish 之间是被动关系（人被美景震撼），主动形式与逻辑不符，排除。"},
                {"key": "B", "verdict": "correct", "text": "Astonished 为过去分词短语作原因状语，表示被动与状态，即「被美景震撼」，与主语逻辑关系一致，为正确答案。"},
                {"key": "C", "verdict": "wrong", "text": "To astonish 是不定式，通常表示目的或出乎意料的结果。此处并非目的状语，且不定式置句首语义不通，排除。"},
                {"key": "D", "verdict": "wrong", "text": "Having astonished 强调该动作先于谓语动词发生且为主动完成。主语并没有「使别人惊讶」，逻辑主语关系错误，排除。"},
            ],
            "conclusion": "过去分词短语作原因状语，表被动与状态，故选 B。",
        },
    },
    {
        "id": "wq-02", "severity": "general", "type": "choice",
        "stem": "一物体沿粗糙斜面匀速下滑，关于它的受力与运动状态，下列说法正确的是：",
        "options": [
            {"key": "A", "text": "物体只受重力和支持力"},
            {"key": "B", "text": "物体所受合力沿斜面向下"},
            {"key": "C", "text": "物体受到沿斜面向上的摩擦力"},
            {"key": "D", "text": "物体的机械能守恒"},
        ],
        "tags": ["牛顿运动定律", "摩擦力", "受力分析"],
        "myMistake": "忽略了匀速运动合力为零这一关键条件，误以为沿斜面下滑方向存在合力。",
        "wrongCount": 1,
        "analysis": {
            "choiceAnswer": "C",
            "optionNotes": [
                {"key": "A", "verdict": "wrong", "text": "若只受重力和支持力，重力沿斜面的分力会使物体加速下滑，与「匀速」矛盾。匀速下滑必受摩擦力，排除。"},
                {"key": "B", "verdict": "wrong", "text": "物体做匀速直线运动，处于平衡状态，所受合力为零，不可能沿斜面向下，排除。"},
                {"key": "C", "verdict": "correct", "text": "物体相对斜面向下滑动，滑动摩擦力方向与相对运动方向相反，即沿斜面向上，与重力分力平衡，正确。"},
                {"key": "D", "verdict": "wrong", "text": "摩擦力对物体做负功，机械能转化为内能，机械能不守恒，排除。"},
            ],
            "conclusion": "匀速下滑时摩擦力与重力沿斜面分力平衡，故选 C。",
        },
    },
    {
        "id": "wq-03", "severity": "repeat", "type": "blank",
        "stem": "配制 100 mL 1.0 mol/L 的 NaCl 溶液，需要称量 NaCl 的质量为 ______ g。（NaCl 摩尔质量按 58.5 g/mol 计算，托盘天平精确到 0.1 g）",
        "tags": ["物质的量", "溶液配制"],
        "myMistake": "忘记把 mL 换算成 L，且没有按天平精度对计算结果取近似值。",
        "wrongCount": 2,
        "analysis": {
            "answer": "5.9",
            "steps": [
                "先统一单位：100 mL = 0.1 L。",
                "求物质的量：n = c·V = 1.0 mol/L × 0.1 L = 0.1 mol。",
                "求质量：m = n·M = 0.1 mol × 58.5 g/mol = 5.85 g。",
                "按托盘天平精度（0.1 g）保留一位小数：5.85 g ≈ 5.9 g。",
            ],
            "conclusion": "需要称量 NaCl 约 5.9 g。",
        },
    },
    {
        "id": "wq-04", "severity": "general", "type": "choice",
        "stem": "1895 年《马关条约》签订。下列条款中，最能反映列强对华经济侵略方式发生变化的是：",
        "options": [
            {"key": "A", "text": "赔偿日本军费白银二亿两"},
            {"key": "B", "text": "开放沙市、重庆、苏州、杭州为通商口岸"},
            {"key": "C", "text": "允许日本在通商口岸开设工厂"},
            {"key": "D", "text": "割辽东半岛、台湾及附属岛屿给日本"},
        ],
        "tags": ["中国近代史", "马关条约", "列强侵略"],
        "myMistake": "对「商品输出」与「资本输出」两种侵略方式的区别理解不清。",
        "wrongCount": 1,
        "analysis": {
            "choiceAnswer": "C",
            "optionNotes": [
                {"key": "A", "verdict": "wrong", "text": "巨额赔款属于传统的战争勒索，加重人民负担，但侵略方式并没有新变化，排除。"},
                {"key": "B", "verdict": "wrong", "text": "开放通商口岸延续了鸦片战争以来的口岸开放思路，便于商品倾销，属于既有方式的延伸，排除。"},
                {"key": "C", "verdict": "correct", "text": "允许在通商口岸开设工厂，意味着列强侵略由商品输出转变为资本输出，直接利用中国原料和劳动力生产，是侵略方式升级的标志，正确。"},
                {"key": "D", "verdict": "wrong", "text": "割地属于领土主权的破坏，反映了侵略程度的加深，但不属于经济侵略方式的变化，排除。"},
            ],
            "conclusion": "开设工厂条款标志列强由商品输出转向资本输出，故选 C。",
        },
    },
    {
        "id": "wq-05", "severity": "general", "type": "blank",
        "stem": "用所给词的适当形式填空：The bridge ______ (repair) at the moment, so we have to take another road.",
        "tags": ["被动语态", "现在进行时"],
        "myMistake": "漏掉了进行时态中的 being，误写成 is repaired。",
        "wrongCount": 1,
        "analysis": {
            "answer": "is being repaired",
            "steps": [
                "由时间状语 at the moment（此刻）确定时态为现在进行时。",
                "桥梁与「修理」之间是被动关系，应用被动语态。",
                "现在进行时的被动语态结构为：am/is/are + being + 过去分词。",
                "主语 the bridge 为单数，故填 is being repaired。",
            ],
            "conclusion": "应填 is being repaired，表示「此刻正在被修理」。",
        },
    },
    {
        "id": "wq-06", "severity": "repeat", "type": "choice",
        "stem": "细胞有氧呼吸过程中，产生 ATP 最多的阶段是：",
        "options": [
            {"key": "A", "text": "葡萄糖分解为丙酮酸"},
            {"key": "B", "text": "丙酮酸和水彻底分解成二氧化碳"},
            {"key": "C", "text": "[H] 与氧气结合生成水"},
            {"key": "D", "text": "丙酮酸转变为乳酸"},
        ],
        "tags": ["细胞呼吸", "ATP"],
        "myMistake": "误以为分解有机物的阶段产能最多，忽略了第三阶段才是产能高峰。",
        "wrongCount": 3,
        "analysis": {
            "choiceAnswer": "C",
            "optionNotes": [
                {"key": "A", "verdict": "wrong", "text": "这是有氧呼吸第一阶段，在细胞质基质中进行，只释放少量能量，生成少量 ATP，排除。"},
                {"key": "B", "verdict": "wrong", "text": "这是第二阶段，在线粒体基质中进行，同样只释放少量能量，排除。"},
                {"key": "C", "verdict": "correct", "text": "这是第三阶段，[H] 与氧气结合生成水，释放大量能量，生成的 ATP 最多，正确。"},
                {"key": "D", "verdict": "wrong", "text": "丙酮酸转变成乳酸属于无氧呼吸第二阶段，该阶段不生成 ATP，且场所不在有氧呼吸过程中，排除。"},
            ],
            "conclusion": "第三阶段 [H] 与 O₂ 结合释放大量能量，故选 C。",
        },
    },
    {
        "id": "wq-07", "severity": "general", "type": "blank",
        "stem": "质量 2 kg 的物体静止在光滑水平面上，受水平恒力作用 4 s 后速度达到 8 m/s，则该恒力大小为 ______ N。",
        "tags": ["牛顿第二定律", "运动学"],
        "myMistake": "把末速度当成加速度直接代入公式，算成了 16 N。",
        "wrongCount": 1,
        "analysis": {
            "answer": "4",
            "steps": [
                "先求加速度：a = Δv / Δt = 8 m/s ÷ 4 s = 2 m/s²。",
                "再用牛顿第二定律：F = ma = 2 kg × 2 m/s² = 4 N。",
                "验算：4 s 内位移 x = ½at² = 16 m，末速 v = at = 8 m/s，与题设一致。",
            ],
            "conclusion": "水平恒力大小为 4 N。",
        },
    },
    {
        "id": "wq-08", "severity": "general", "type": "choice",
        "stem": "下列句子中，没有语病的一项是：",
        "options": [
            {"key": "A", "text": "通过这次社会实践活动，使我们开阔了眼界，增长了见识。"},
            {"key": "B", "text": "能否培养学生的思维能力，是提高课堂效率的关键。"},
            {"key": "C", "text": "学校开展的安全教育活动，增强了同学们的安全意识和防护能力。"},
            {"key": "D", "text": "为了避免今后不再发生类似的事故，我们必须严格遵守操作规程。"},
        ],
        "tags": ["病句辨析", "句式杂糅"],
        "myMistake": "对「两面词搭配不当」和「否定不当」两类病句特征不够敏感。",
        "wrongCount": 2,
        "analysis": {
            "choiceAnswer": "C",
            "optionNotes": [
                {"key": "A", "verdict": "wrong", "text": "「通过……使……」连用导致主语残缺，应删去「通过」或「使」，二者只能保留一个。"},
                {"key": "B", "verdict": "wrong", "text": "「能否」是两面词，而「提高课堂效率」是一面，两面对一面，搭配不当，应在「提高」前加「能否」或删去「能否」。"},
                {"key": "C", "verdict": "correct", "text": "句子主干为「活动增强了意识和能力」，主谓宾完整，「增强……意识和能力」搭配得当，没有语病，正确。"},
                {"key": "D", "verdict": "wrong", "text": "「避免」与「不再」连用造成否定失当，实际含义变成「让事故再次发生」，应删去「不再」。"},
            ],
            "conclusion": "只有 C 项主谓宾完整、搭配得当，故选 C。",
        },
    },
]

default_mind_map: dict[str, Any] = {
    "title": "英语时态体系思维导图",
    "center": "英语时态体系",
    "branches": [
        {"id": "b1", "label": "一般时态", "color": "#4d94ff",
         "leaves": ["一般现在时", "一般过去时", "一般将来时", "一般过去将来时"]},
        {"id": "b2", "label": "进行时态", "color": "#9b7ef4",
         "leaves": ["现在进行时", "过去进行时", "将来进行时", "完成进行时概述"]},
        {"id": "b3", "label": "完成时态", "color": "#f2a93b",
         "leaves": ["现在完成时", "过去完成时", "将来完成时", "完成时时间标志词"]},
        {"id": "b4", "label": "语态与虚拟", "color": "#4cb051",
         "leaves": ["主动与被动", "被动语态转换", "虚拟语气概述", "虚拟条件句"]},
        {"id": "b5", "label": "综合应用", "color": "#ef6f9e",
         "leaves": ["时态一致原则", "语境中的时态选择", "常见易错点辨析", "写作中的时态运用"]},
    ],
}

MINDMAP_TEMPLATE_BRANCHES = [
    ("基础概念", "#4d94ff", ["核心定义", "基本术语", "概念辨析", "知识框架"]),
    ("重点难点", "#9b7ef4", ["高频考点", "易混淆点", "深层原理", "常见误区"]),
    ("方法技巧", "#f2a93b", ["通用解题步骤", "记忆口诀", "快速判断技巧", "答题模板"]),
    ("典型例题", "#4cb051", ["基础示例", "进阶示例", "真题节选", "变式训练"]),
    ("应用拓展", "#ef6f9e", ["跨章知识关联", "实际情境应用", "综合题型", "延伸阅读"]),
]


def build_mindmap_template(topic: str) -> dict[str, Any]:
    return {
        "title": f"{topic}思维导图",
        "center": topic,
        "branches": [
            {"id": f"t{i + 1}", "label": label, "color": color, "leaves": leaves}
            for i, (label, color, leaves) in enumerate(MINDMAP_TEMPLATE_BRANCHES)
        ],
    }
