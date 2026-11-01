"""由 frontend/src/api/mock/mockData.ts 同步生成的备赛区数据（高等数学内容）。"""

from __future__ import annotations

from typing import Any

wrong_questions: list[dict[str, Any]] = [
    {
        "id": "wq-01",
        "severity": "repeat",
        "type": "choice",
        "stem": "极限 lim(x→0) (e^x − 1) / x 的值为：",
        "options": [
            {
                "key": "A",
                "text": "0",
            },
            {
                "key": "B",
                "text": "1",
            },
            {
                "key": "C",
                "text": "e",
            },
            {
                "key": "D",
                "text": "∞",
            },
        ],
        "tags": [
            "极限",
            "等价无穷小",
        ],
        "myMistake": "忘记使用等价无穷小替换 e^x − 1 ~ x，用洛必达法则时又求导出错。",
        "wrongCount": 3,
        "analysis": {
            "choiceAnswer": "B",
            "optionNotes": [
                {
                    "key": "A",
                    "verdict": "wrong",
                    "text": "当 x→0 时分子分母是同阶无穷小，比值的极限不为 0。若极限为 0，说明分子是分母的高阶无穷小，与 e^x − 1 ~ x 矛盾，排除。",
                },
                {
                    "key": "B",
                    "verdict": "correct",
                    "text": "利用等价无穷小 e^x − 1 ~ x（x→0），故 lim(x→0) (e^x − 1)/x = lim(x→0) x/x = 1；用洛必达法则也得 e⁰/1 = 1，正确。",
                },
                {
                    "key": "C",
                    "verdict": "wrong",
                    "text": "e 是重要极限 lim(x→0) (1+x)^(1/x) 的结果，与本题为不同的模型，混淆了两个重要极限，排除。",
                },
                {
                    "key": "D",
                    "verdict": "wrong",
                    "text": "分子分母在 x→0 时均趋于 0，为 0/0 型未定式，极限存在且有限，不可能为无穷大，排除。",
                },
            ],
            "conclusion": "由等价无穷小 e^x − 1 ~ x 可知极限为 1，故选 B。",
        },
    },
    {
        "id": "wq-02",
        "severity": "general",
        "type": "blank",
        "stem": "极限 lim(x→+∞) (1 + 2/x)^x = ______。",
        "tags": [
            "极限",
            "重要极限",
        ],
        "myMistake": "只写出了 e，漏掉了指数上的 2，没有处理 (1 + 2/x)^x 与标准重要极限的差异。",
        "wrongCount": 1,
        "analysis": {
            "answer": "e²",
            "steps": [
                "将幂指函数改写：(1 + 2/x)^x = [(1 + 2/x)^(x/2)]²。",
                "令 t = x/2，当 x→+∞ 时 t→+∞，由重要极限 lim(t→+∞) (1 + 1/t)^t = e，方括号内极限为 e。",
                "由指数函数的连续性，原极限 = e²。",
            ],
            "conclusion": "极限为 e²。",
        },
    },
    {
        "id": "wq-03",
        "severity": "repeat",
        "type": "choice",
        "stem": "设函数 f(x) = x³ − 3x，则 f(x) 的极大值为：",
        "options": [
            {
                "key": "A",
                "text": "−2",
            },
            {
                "key": "B",
                "text": "2",
            },
            {
                "key": "C",
                "text": "0",
            },
            {
                "key": "D",
                "text": "3",
            },
        ],
        "tags": [
            "导数应用",
            "极值",
        ],
        "myMistake": "求出驻点后没有区分极大值与极小值，把极小值 −2 误当成极大值。",
        "wrongCount": 2,
        "analysis": {
            "choiceAnswer": "B",
            "optionNotes": [
                {
                    "key": "A",
                    "verdict": "wrong",
                    "text": "−2 = f(1)。在 x = 1 附近导数由负变正，函数先减后增，x = 1 是极小值点，−2 是极小值而非极大值，排除。",
                },
                {
                    "key": "B",
                    "verdict": "correct",
                    "text": "f′(x) = 3x² − 3 = 3(x−1)(x+1)，驻点 x = ±1。在 x = −1 附近导数由正变负，函数先增后减，x = −1 为极大值点，极大值 f(−1) = −1 + 3 = 2，正确。",
                },
                {
                    "key": "C",
                    "verdict": "wrong",
                    "text": "0 = f(0)，但 x = 0 不是驻点（f′(0) = −3 ≠ 0），也不是极值点，排除。",
                },
                {
                    "key": "D",
                    "verdict": "wrong",
                    "text": "3 不是函数的极值，f(−1) = 2、f(1) = −2，均与 3 无关，排除。",
                },
            ],
            "conclusion": "驻点 x = ±1，其中 x = −1 为极大值点，极大值为 2，故选 B。",
        },
    },
    {
        "id": "wq-04",
        "severity": "general",
        "type": "blank",
        "stem": "曲线 y = ln x 在点 (1, 0) 处的切线方程为 ______。",
        "tags": [
            "导数应用",
            "切线方程",
        ],
        "myMistake": "把切点纵坐标直接当成截距，写成了 y = x，没有用点斜式重新计算。",
        "wrongCount": 1,
        "analysis": {
            "answer": "y = x − 1",
            "steps": [
                "求导：y′ = 1/x，切线斜率 k = y′(1) = 1。",
                "由点斜式：y − 0 = 1 × (x − 1)。",
                "整理得切线方程 y = x − 1。",
            ],
            "conclusion": "切线方程为 y = x − 1。",
        },
    },
    {
        "id": "wq-05",
        "severity": "repeat",
        "type": "multiple",
        "stem": "下列定积分中，值为 0 的是（多选）：",
        "options": [
            {
                "key": "A",
                "text": "∫₋₁¹ x³ dx",
            },
            {
                "key": "B",
                "text": "∫₀^{2π} sin x dx",
            },
            {
                "key": "C",
                "text": "∫₋₁¹ x dx",
            },
            {
                "key": "D",
                "text": "∫₋₁¹ |x| dx",
            },
        ],
        "tags": [
            "定积分",
            "奇偶对称性",
        ],
        "myMistake": "只记得奇函数在对称区间上积分为零，没有逐项验证 sin x 在 [0, 2π] 上的情况，错选了 B。",
        "wrongCount": 2,
        "analysis": {
            "choiceAnswer": "ABC",
            "optionNotes": [
                {
                    "key": "A",
                    "verdict": "correct",
                    "text": "x³ 是奇函数，积分区间 [−1, 1] 关于原点对称，由奇函数对称性，积分值为 0，应选。",
                },
                {
                    "key": "B",
                    "verdict": "correct",
                    "text": "∫₀^{2π} sin x dx = [−cos x]₀^{2π} = −1 − (−1) = 0，正弦在一个完整周期上正负面积相消，应选。",
                },
                {
                    "key": "C",
                    "verdict": "correct",
                    "text": "x 是奇函数，积分区间 [−1, 1] 对称，积分值为 0，应选。",
                },
                {
                    "key": "D",
                    "verdict": "wrong",
                    "text": "|x| 是偶函数，∫₋₁¹ |x| dx = 2∫₀¹ x dx = 1 ≠ 0，不选。",
                },
            ],
            "conclusion": "A、B、C 的积分值均为 0，D 为 1，故选 ABC。",
        },
    },
    {
        "id": "wq-06",
        "severity": "general",
        "type": "judge",
        "stem": "判断：若函数 f(x) 在点 x₀ 处可导，则 f(x) 在点 x₀ 处必连续。",
        "options": [
            {
                "key": "T",
                "text": "正确",
            },
            {
                "key": "F",
                "text": "错误",
            },
        ],
        "tags": [
            "导数",
            "连续性",
        ],
        "myMistake": "把「连续不一定可导」错误地反向理解，以为可导与连续互不蕴含。",
        "wrongCount": 1,
        "analysis": {
            "choiceAnswer": "T",
            "optionNotes": [
                {
                    "key": "T",
                    "verdict": "correct",
                    "text": "可导必连续是微分学的基本定理：f′(x₀) 存在意味着 lim(Δx→0) Δy = 0，即 f 在 x₀ 处连续。反之不成立，如 y = |x| 在 x = 0 处连续但不可导。应选「正确」。",
                },
                {
                    "key": "F",
                    "verdict": "wrong",
                    "text": "该选项把「连续不一定可导」误当作「可导不一定连续」，方向弄反，错误。",
                },
            ],
            "conclusion": "可导必连续，反之不一定成立，应选「正确」。",
        },
    },
    {
        "id": "wq-07",
        "severity": "general",
        "type": "blank",
        "stem": "微分方程 y′ + 2y = 0 满足初始条件 y(0) = 3 的特解为 y = ______。",
        "tags": [
            "微分方程",
            "可分离变量",
        ],
        "myMistake": "分离变量后积分时漏掉了任意常数，直接写出 y = e^(−2x)，没有代入初始条件确定 C。",
        "wrongCount": 1,
        "analysis": {
            "answer": "3e^(−2x)",
            "steps": [
                "分离变量：dy/y = −2 dx。",
                "两边积分：ln |y| = −2x + C₁，即 y = Ce^(−2x)。",
                "代入 y(0) = 3：C = 3。",
                "故特解为 y = 3e^(−2x)。",
            ],
            "conclusion": "特解为 y = 3e^(−2x)。",
        },
    },
    {
        "id": "wq-08",
        "severity": "general",
        "type": "choice",
        "stem": "反常积分 ∫₁^(+∞) (1/x²) dx 的值为：",
        "options": [
            {
                "key": "A",
                "text": "1",
            },
            {
                "key": "B",
                "text": "收敛但无法求出具体值",
            },
            {
                "key": "C",
                "text": "+∞，发散",
            },
            {
                "key": "D",
                "text": "−1",
            },
        ],
        "tags": [
            "反常积分",
            "收敛性",
        ],
        "myMistake": "见到积分上限是 +∞ 就认定发散，没有先求原函数再取极限判断。",
        "wrongCount": 1,
        "analysis": {
            "choiceAnswer": "A",
            "optionNotes": [
                {
                    "key": "A",
                    "verdict": "correct",
                    "text": "∫₁^b x^(−2) dx = [−1/x]₁^b = 1 − 1/b，当 b→+∞ 时极限为 1，反常积分收敛于 1，正确。",
                },
                {
                    "key": "B",
                    "verdict": "wrong",
                    "text": "被积函数有初等原函数 −1/x，由牛顿—莱布尼茨公式取极限可求出确定值 1，并非无法求值，排除。",
                },
                {
                    "key": "C",
                    "verdict": "wrong",
                    "text": "p-积分 ∫₁^∞ dx/x^p 仅当 p ≤ 1 时发散，此处 p = 2 > 1 收敛，排除。",
                },
                {
                    "key": "D",
                    "verdict": "wrong",
                    "text": "被积函数 1/x² 在 [1, +∞) 上恒正，积分值不可能为负，排除。",
                },
            ],
            "conclusion": "p = 2 > 1，反常积分收敛于 1，故选 A。",
        },
    },
]

default_mind_map: dict[str, Any] = {
    "title": "高等数学·微分学思维导图",
    "center": "高等数学·微分学",
    "branches": [
        {
            "id": "b1",
            "label": "极限与连续",
            "color": "#4d94ff",
            "leaves": [
                "数列与函数极限",
                "无穷小与无穷大",
                "两个重要极限",
                "连续与间断点",
            ],
        },
        {
            "id": "b2",
            "label": "导数与微分",
            "color": "#9b7ef4",
            "leaves": [
                "导数的定义",
                "求导法则",
                "高阶导数",
                "微分与近似计算",
            ],
        },
        {
            "id": "b3",
            "label": "中值定理",
            "color": "#f2a93b",
            "leaves": [
                "罗尔定理",
                "拉格朗日中值定理",
                "柯西中值定理",
                "洛必达法则",
            ],
        },
        {
            "id": "b4",
            "label": "积分学",
            "color": "#4cb051",
            "leaves": [
                "不定积分公式",
                "换元积分法",
                "分部积分法",
                "定积分与反常积分",
            ],
        },
        {
            "id": "b5",
            "label": "综合应用",
            "color": "#ef6f9e",
            "leaves": [
                "单调性与极值",
                "切线与渐近线",
                "微分方程初步",
                "级数敛散性判别",
            ],
        },
    ],
}

trial_exam: dict[str, Any] = {
    "title": "高等数学综合模拟卷（一）",
    "level": "高中",
    "cover": "blackboard",
    "questionTotal": 8,
    "fullScore": 100,
    "durationLeft": 5316,
    "questions": [
        {
            "id": "tq-01",
            "no": 1,
            "type": "choice",
            "score": 10,
            "stem": "极限 lim(x→0) sin(3x) / x 的值为：",
            "options": [
                {
                    "key": "A",
                    "text": "1/3",
                },
                {
                    "key": "B",
                    "text": "1",
                },
                {
                    "key": "C",
                    "text": "3",
                },
                {
                    "key": "D",
                    "text": "0",
                },
            ],
            "answer": "C",
            "analysis": "由重要极限 lim(x→0) sin x / x = 1，得 sin(3x)/x = 3 · sin(3x)/(3x)，当 x→0 时 sin(3x)/(3x)→1，故原极限为 3 × 1 = 3，选 C。",
        },
        {
            "id": "tq-02",
            "no": 2,
            "type": "blank",
            "score": 10,
            "stem": "定积分 ∫₀^π sin x dx = ______。",
            "placeholder": "请填入答案，如 2",
            "answer": "2",
            "analysis": "∫₀^π sin x dx = [−cos x]₀^π = −cos π − (−cos 0) = −(−1) + 1 = 2。正弦曲线在 [0, π] 上的面积恰为一个拱形，其值为 2。",
        },
        {
            "id": "tq-03",
            "no": 3,
            "type": "choice",
            "score": 10,
            "stem": "函数 y = x² − 4x + 3 的单调递增区间为：",
            "options": [
                {
                    "key": "A",
                    "text": "(−∞, 2)",
                },
                {
                    "key": "B",
                    "text": "(2, +∞)",
                },
                {
                    "key": "C",
                    "text": "(−∞, +∞)",
                },
                {
                    "key": "D",
                    "text": "(−2, 2)",
                },
            ],
            "answer": "B",
            "analysis": "y′ = 2x − 4，令 y′ > 0 得 x > 2，故单调递增区间为 (2, +∞)。也可以由抛物线开口向上、对称轴 x = 2 直接判断，选 B。",
        },
        {
            "id": "tq-04",
            "no": 4,
            "type": "blank",
            "score": 10,
            "stem": "设 y = x·e^x，则 y′ = ______。",
            "placeholder": "请填入答案，如 (1+x)e^x",
            "answer": "(1+x)e^x",
            "analysis": "由乘积求导法则：y′ = (x)′·e^x + x·(e^x)′ = e^x + x·e^x = (1 + x)e^x。",
        },
        {
            "id": "tq-05",
            "no": 5,
            "type": "judge",
            "score": 10,
            "stem": "判断：若 f(x) 在 [a, b] 上连续，则 f(x) 在 [a, b] 上一定取得最大值和最小值。",
            "options": [
                {
                    "key": "T",
                    "text": "正确",
                },
                {
                    "key": "F",
                    "text": "错误",
                },
            ],
            "answer": "T",
            "analysis": "这是闭区间上连续函数的最值定理（有界性与最大值最小值定理）：闭区间上的连续函数必有界，且一定能取得最大值与最小值。注意区间必须是闭的，开区间上的连续函数不一定有最值，如 y = 1/x 在 (0, 1) 内无最大值。故判断正确。",
        },
        {
            "id": "tq-06",
            "no": 6,
            "type": "blank",
            "score": 10,
            "stem": "微分方程 y″ − 4y = 0 的通解为 y = ______。",
            "placeholder": "请填入答案，如 C1·e^(2x)+C2·e^(−2x)",
            "answer": "C1·e^(2x)+C2·e^(−2x)",
            "analysis": "特征方程 r² − 4 = 0，特征根 r = ±2，为两个不相等实根。由二阶常系数齐次线性微分方程的通解结构，通解为 y = C₁e^(2x) + C₂e^(−2x)（C₁、C₂ 为任意常数）。",
        },
        {
            "id": "tq-07",
            "no": 7,
            "type": "multiple",
            "score": 20,
            "stem": "下列积分中，值等于 1 的是（多选）：",
            "options": [
                {
                    "key": "A",
                    "text": "∫₁^e (1/x) dx",
                },
                {
                    "key": "B",
                    "text": "∫₀¹ x dx",
                },
                {
                    "key": "C",
                    "text": "∫₀^{π/2} cos x dx",
                },
                {
                    "key": "D",
                    "text": "∫₀¹ 2x dx",
                },
            ],
            "answer": "ACD",
            "analysis": "A：∫₁^e dx/x = ln e − ln 1 = 1，应选；B：∫₀¹ x dx = 1/2，不选；C：∫₀^{π/2} cos x dx = sin(π/2) − sin 0 = 1，应选；D：∫₀¹ 2x dx = [x²]₀¹ = 1，应选。故选 ACD。",
        },
        {
            "id": "tq-08",
            "no": 8,
            "type": "choice",
            "score": 20,
            "stem": "设 f(x) = x³ 在区间 [0, 1] 上满足拉格朗日中值定理，则定理中的 ξ = ：",
            "options": [
                {
                    "key": "A",
                    "text": "1/3",
                },
                {
                    "key": "B",
                    "text": "√3/3",
                },
                {
                    "key": "C",
                    "text": "1/2",
                },
                {
                    "key": "D",
                    "text": "2/3",
                },
            ],
            "answer": "B",
            "analysis": "拉格朗日中值定理：存在 ξ ∈ (0, 1)，使 f′(ξ) = [f(1) − f(0)]/(1 − 0) = 1。而 f′(x) = 3x²，令 3ξ² = 1，得 ξ = √3/3 ∈ (0, 1)，选 B。",
        },
    ],
}
