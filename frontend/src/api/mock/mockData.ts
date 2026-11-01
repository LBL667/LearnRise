import type {
  Competition,
  CompetitionPlan,
  CompetitionRecord,
  LeaderboardEntry,
  Member,
  MindMapData,
  PlanCard,
  PlanStage,
  ProfileInfo,
  ProfileStat,
  SettingGroup,
  StudyProgressItem,
  TrialExam,
  UserProgress,
  WrongQuestion,
} from '../types'

/**
 * 全部模拟数据集中于此。
 * 页面组件不允许硬编码数据，一律通过 api/client.ts 读取。
 */

export const competitions: Competition[] = [
  {
    id: 'comp-001',
    title: '2025 秋季学习挑战赛',
    level: '高中',
    description: '以学促赛，在挑战中遇见更强的自己!',
    host: '学习小能手',
    memberCount: 7,
    capacity: 10,
    startTime: '2025-09-01 14:00',
    endTime: '2025-09-15 23:59',
    awardQuota: 3,
    daysToStart: 12,
    daysToEnd: 26,
    cover: 'aurora',
    inviteCode: 'A7K9M2',
  },
  {
    id: 'comp-002',
    title: '全科知识联赛模拟赛',
    level: '高中',
    description: '覆盖多学科综合知识，全面提升学习竞争力。',
    host: '凌风徐来',
    memberCount: 7,
    capacity: 10,
    startTime: '2025-08-20 19:00',
    endTime: '2025-09-05 22:00',
    awardQuota: 5,
    daysToStart: 8,
    daysToEnd: 22,
    cover: 'blackboard',
    inviteCode: 'Q3X8R5',
  },
  {
    id: 'comp-003',
    title: '英语词汇冲顶营',
    level: '高中',
    description: '从基础到进阶，系统提升词汇量与阅读理解能力。',
    host: '词达意',
    memberCount: 7,
    capacity: 10,
    startTime: '2025-08-18 10:00',
    endTime: '2025-09-01 23:59',
    awardQuota: 3,
    daysToStart: 6,
    daysToEnd: 19,
    cover: 'geometry',
    inviteCode: 'B5N7K4',
  },
  {
    id: 'comp-004',
    title: '2025 跨学科研究挑战赛',
    level: '大学',
    description: '用跨学科思维解决真实问题，激发研究与协作能力。',
    host: '课题小队长',
    memberCount: 7,
    capacity: 10,
    startTime: '2025-08-25 09:00',
    endTime: '2025-09-12 18:00',
    awardQuota: 2,
    daysToStart: 10,
    daysToEnd: 24,
    cover: 'wave',
    inviteCode: 'M8T2W6',
  },
  {
    id: 'comp-005',
    title: '记忆与专注进阶赛',
    level: '高中',
    description: '挑战记忆极限，解锁高效学习方法与专注习惯。',
    host: '学海拾贝',
    memberCount: 6,
    capacity: 10,
    startTime: '2025-09-05 09:00',
    endTime: '2025-09-20 21:00',
    awardQuota: 4,
    daysToStart: 15,
    daysToEnd: 29,
    cover: 'forest',
    inviteCode: 'C9Y4F7',
  },
]

/** 竞赛成员表（comp-001 为设计稿完整名单，其余按人数生成占位） */
export const membersByCompetition: Record<string, Member[]> = {
  'comp-001': [
    { id: 'm-01', name: '林同学', role: 'leader', avatarHue: 212 },
    { id: 'm-02', name: '张雨欣', role: 'member', avatarHue: 330 },
    { id: 'm-03', name: '王梓轩', role: 'member', avatarHue: 150 },
    { id: 'm-04', name: '李思琪', role: 'member', avatarHue: 268 },
    { id: 'm-05', name: '陈子墨', role: 'member', avatarHue: 28 },
    { id: 'm-06', name: '刘宇航', role: 'member', avatarHue: 196 },
    { id: 'm-07', name: '赵心妍', role: 'member', avatarHue: 350 },
  ],
}

/** 规划图六阶（高等数学学习路径，含段位 Logo） */
export const defaultStages: PlanStage[] = [
  {
    no: '01',
    title: '初识',
    theme: '基础概念梳理',
    points: ['核心概念', '基础术语', '知识框架', '入门练习'],
    icon: 'book',
    logo: '/badges/01.png',
  },
  {
    no: '02',
    title: '启行',
    theme: '专项初步训练',
    points: ['基础题型', '课后练习', '专项训练', '错题整理'],
    icon: 'grid',
    logo: '/badges/02.png',
  },
  {
    no: '03',
    title: '明理',
    theme: '重难点突破',
    points: ['核心难点', '易错辨析', '方法总结', '典型例题'],
    icon: 'triangle',
    logo: '/badges/03.png',
  },
  {
    no: '04',
    title: '融会',
    theme: '知识综合运用',
    points: ['跨章综合', '知识串联', '综合练习', '思维导图'],
    icon: 'chart',
    logo: '/badges/04.png',
  },
  {
    no: '05',
    title: '贯通',
    theme: '真题模拟实战',
    points: ['历年真题', '模拟测试', '限时训练', '查漏补缺'],
    icon: 'pie',
    logo: '/badges/05.png',
  },
  {
    no: '06',
    title: '卓越',
    theme: '冲刺全面提升',
    points: ['高频考点', '综合模拟', '考前冲刺', '心态调整'],
    icon: 'crown',
    logo: '/badges/06.png',
  },
]

const planIntro = '六阶进阶，系统提升，从基础到卓越，全面备战学习竞赛'

/** comp-001 的完整规划 */
export const planByCompetition: Record<string, CompetitionPlan> = {
  'comp-001': {
    stats: {
      daysToStart: 12,
      startAt: '2025-09-01 14:00',
      daysToEnd: 26,
      endAt: '2025-09-15 23:59',
      awardQuota: 3,
    },
    rewards: [
      { rank: 1, name: '运动手环' },
      { rank: 2, name: '小风扇' },
      { rank: 3, name: '水杯' },
    ],
    intro: planIntro,
    stages: defaultStages,
  },
}

/** 未单独配置规划的竞赛，按竞赛字段推导一份默认规划 */
export function buildDefaultPlan(competition: Competition): CompetitionPlan {
  const quota = competition.awardQuota
  const fallbackRewards = [
    { rank: 1, name: '定制奖杯' },
    { rank: 2, name: '精美文具套装' },
    { rank: 3, name: '学习周边盲盒' },
  ].slice(0, Math.max(1, Math.min(3, quota)))
  return {
    stats: {
      daysToStart: competition.daysToStart,
      startAt: competition.startTime,
      daysToEnd: competition.daysToEnd,
      endAt: competition.endTime,
      awardQuota: quota,
    },
    rewards: fallbackRewards,
    intro: planIntro,
    stages: defaultStages,
  }
}

/** 按成员数生成占位名单（非 comp-001 的竞赛使用） */
export function buildDefaultMembers(competition: Competition): Member[] {
  const namePool = [
    '沈知行', '苏晚晴', '陆一鸣', '顾清源', '江晓棠', '方远志', '聂云帆', '宋星野', '孟思齐', '韩明轩',
  ]
  const huePool = [205, 320, 140, 275, 45, 185, 20, 300, 95, 240]
  const count = Math.max(1, Math.min(competition.memberCount, namePool.length))
  return Array.from({ length: count }, (_, i) => ({
    id: `${competition.id}-m-${i + 1}`,
    name: i === 0 ? competition.host : namePool[i],
    role: i === 0 ? ('leader' as const) : ('member' as const),
    avatarHue: huePool[i],
  }))
}

/* ==================== 备赛区：学习助手 ==================== */

export const chatWelcome =
  '你好！我是你的学习竞赛助手。我可以帮你制定学习计划、分析薄弱点、归纳错题知识点、解答疑难问题，以及提供学习方法建议。请告诉我你的目标或遇到的问题吧！'

export const chatSeedQuestion =
  '我下个月要参加校级的综合知识竞赛，请帮我制定一个为期 3 个月的备考计划，兼顾效率和方法。'

export const chatSeedPlanCard: PlanCard = {
  title: '3 个月备考计划',
  months: [
    {
      no: 1,
      name: '基础巩固',
      period: '第 1-4 周',
      items: [
        '梳理各科目的核心概念',
        '整理知识框架与思维导图',
        '完成基础练习与课后习题',
        '建立错题本，归纳易错点',
      ],
    },
    {
      no: 2,
      name: '专项提升',
      period: '第 5-8 周',
      items: [
        '深入研究高频题型与技巧',
        '按专题进行系统训练',
        '每周完成 2-3 套综合练习',
        '总结解题思路，形成方法体系',
      ],
    },
    {
      no: 3,
      name: '模拟冲刺',
      period: '第 9-12 周',
      items: [
        '历年真题与模拟题训练',
        '限时模拟与全卷演练',
        '针对薄弱点专项突破',
        '整理高频考点与常用结论',
      ],
    },
  ],
  tail: '如果你有更个性化的计划需求（例如：每周具体安排、题目推荐、参考资料），可以告诉我目前的基础和可用学习时间，我可以进一步细化方案。',
}

export const chatSuggestionBatches: string[][] = [
  [
    '帮我制定本周的学习计划',
    '总结最近错题中的高频知识点',
    '如何提高英语写作的表达能力？',
    '推荐一些提升专注力的训练方法',
    '分析这道题的思路和正确解法',
  ],
  [
    '如何安排高效的复习节奏？',
    '帮我梳理历史时间线的记忆方法',
    '考试总是时间不够用怎么办？',
    '推荐一套错题整理的模板',
    '如何缓解考前紧张情绪？',
  ],
]

/* ==================== 备赛区：错题收藏（均为选择题 / 填空题） ==================== */

export const wrongQuestions: WrongQuestion[] = [
  {
    id: 'wq-01',
    severity: 'repeat',
    type: 'choice',
    stem: '极限 lim(x→0) (e^x − 1) / x 的值为：',
    options: [
      { key: 'A', text: '0' },
      { key: 'B', text: '1' },
      { key: 'C', text: 'e' },
      { key: 'D', text: '∞' },
    ],
    tags: ['极限', '等价无穷小'],
    myMistake: '忘记使用等价无穷小替换 e^x − 1 ~ x，用洛必达法则时又求导出错。',
    wrongCount: 3,
    analysis: {
      choiceAnswer: 'B',
      optionNotes: [
        {
          key: 'A',
          verdict: 'wrong',
          text: '当 x→0 时分子分母是同阶无穷小，比值的极限不为 0。若极限为 0，说明分子是分母的高阶无穷小，与 e^x − 1 ~ x 矛盾，排除。',
        },
        {
          key: 'B',
          verdict: 'correct',
          text: '利用等价无穷小 e^x − 1 ~ x（x→0），故 lim(x→0) (e^x − 1)/x = lim(x→0) x/x = 1；用洛必达法则也得 e⁰/1 = 1，正确。',
        },
        {
          key: 'C',
          verdict: 'wrong',
          text: 'e 是重要极限 lim(x→0) (1+x)^(1/x) 的结果，与本题为不同的模型，混淆了两个重要极限，排除。',
        },
        {
          key: 'D',
          verdict: 'wrong',
          text: '分子分母在 x→0 时均趋于 0，为 0/0 型未定式，极限存在且有限，不可能为无穷大，排除。',
        },
      ],
      conclusion: '由等价无穷小 e^x − 1 ~ x 可知极限为 1，故选 B。',
    },
  },
  {
    id: 'wq-02',
    severity: 'general',
    type: 'blank',
    stem: '极限 lim(x→+∞) (1 + 2/x)^x = ______。',
    tags: ['极限', '重要极限'],
    myMistake: '只写出了 e，漏掉了指数上的 2，没有处理 (1 + 2/x)^x 与标准重要极限的差异。',
    wrongCount: 1,
    analysis: {
      answer: 'e²',
      steps: [
        '将幂指函数改写：(1 + 2/x)^x = [(1 + 2/x)^(x/2)]²。',
        '令 t = x/2，当 x→+∞ 时 t→+∞，由重要极限 lim(t→+∞) (1 + 1/t)^t = e，方括号内极限为 e。',
        '由指数函数的连续性，原极限 = e²。',
      ],
      conclusion: '极限为 e²。',
    },
  },
  {
    id: 'wq-03',
    severity: 'repeat',
    type: 'choice',
    stem: '设函数 f(x) = x³ − 3x，则 f(x) 的极大值为：',
    options: [
      { key: 'A', text: '−2' },
      { key: 'B', text: '2' },
      { key: 'C', text: '0' },
      { key: 'D', text: '3' },
    ],
    tags: ['导数应用', '极值'],
    myMistake: '求出驻点后没有区分极大值与极小值，把极小值 −2 误当成极大值。',
    wrongCount: 2,
    analysis: {
      choiceAnswer: 'B',
      optionNotes: [
        {
          key: 'A',
          verdict: 'wrong',
          text: '−2 = f(1)。在 x = 1 附近导数由负变正，函数先减后增，x = 1 是极小值点，−2 是极小值而非极大值，排除。',
        },
        {
          key: 'B',
          verdict: 'correct',
          text: 'f′(x) = 3x² − 3 = 3(x−1)(x+1)，驻点 x = ±1。在 x = −1 附近导数由正变负，函数先增后减，x = −1 为极大值点，极大值 f(−1) = −1 + 3 = 2，正确。',
        },
        {
          key: 'C',
          verdict: 'wrong',
          text: '0 = f(0)，但 x = 0 不是驻点（f′(0) = −3 ≠ 0），也不是极值点，排除。',
        },
        {
          key: 'D',
          verdict: 'wrong',
          text: '3 不是函数的极值，f(−1) = 2、f(1) = −2，均与 3 无关，排除。',
        },
      ],
      conclusion: '驻点 x = ±1，其中 x = −1 为极大值点，极大值为 2，故选 B。',
    },
  },
  {
    id: 'wq-04',
    severity: 'general',
    type: 'blank',
    stem: '曲线 y = ln x 在点 (1, 0) 处的切线方程为 ______。',
    tags: ['导数应用', '切线方程'],
    myMistake: '把切点纵坐标直接当成截距，写成了 y = x，没有用点斜式重新计算。',
    wrongCount: 1,
    analysis: {
      answer: 'y = x − 1',
      steps: [
        '求导：y′ = 1/x，切线斜率 k = y′(1) = 1。',
        '由点斜式：y − 0 = 1 × (x − 1)。',
        '整理得切线方程 y = x − 1。',
      ],
      conclusion: '切线方程为 y = x − 1。',
    },
  },
  {
    id: 'wq-05',
    severity: 'repeat',
    type: 'multiple',
    stem: '下列定积分中，值为 0 的是（多选）：',
    options: [
      { key: 'A', text: '∫₋₁¹ x³ dx' },
      { key: 'B', text: '∫₀^{2π} sin x dx' },
      { key: 'C', text: '∫₋₁¹ x dx' },
      { key: 'D', text: '∫₋₁¹ |x| dx' },
    ],
    tags: ['定积分', '奇偶对称性'],
    myMistake: '只记得奇函数在对称区间上积分为零，没有逐项验证 sin x 在 [0, 2π] 上的情况，错选了 B。',
    wrongCount: 2,
    analysis: {
      choiceAnswer: 'ABC',
      optionNotes: [
        {
          key: 'A',
          verdict: 'correct',
          text: 'x³ 是奇函数，积分区间 [−1, 1] 关于原点对称，由奇函数对称性，积分值为 0，应选。',
        },
        {
          key: 'B',
          verdict: 'correct',
          text: '∫₀^{2π} sin x dx = [−cos x]₀^{2π} = −1 − (−1) = 0，正弦在一个完整周期上正负面积相消，应选。',
        },
        {
          key: 'C',
          verdict: 'correct',
          text: 'x 是奇函数，积分区间 [−1, 1] 对称，积分值为 0，应选。',
        },
        {
          key: 'D',
          verdict: 'wrong',
          text: '|x| 是偶函数，∫₋₁¹ |x| dx = 2∫₀¹ x dx = 1 ≠ 0，不选。',
        },
      ],
      conclusion: 'A、B、C 的积分值均为 0，D 为 1，故选 ABC。',
    },
  },
  {
    id: 'wq-06',
    severity: 'general',
    type: 'judge',
    stem: '判断：若函数 f(x) 在点 x₀ 处可导，则 f(x) 在点 x₀ 处必连续。',
    options: [
      { key: 'T', text: '正确' },
      { key: 'F', text: '错误' },
    ],
    tags: ['导数', '连续性'],
    myMistake: '把「连续不一定可导」错误地反向理解，以为可导与连续互不蕴含。',
    wrongCount: 1,
    analysis: {
      choiceAnswer: 'T',
      optionNotes: [
        {
          key: 'T',
          verdict: 'correct',
          text: '可导必连续是微分学的基本定理：f′(x₀) 存在意味着 lim(Δx→0) Δy = 0，即 f 在 x₀ 处连续。反之不成立，如 y = |x| 在 x = 0 处连续但不可导。应选「正确」。',
        },
        {
          key: 'F',
          verdict: 'wrong',
          text: '该选项把「连续不一定可导」误当作「可导不一定连续」，方向弄反，错误。',
        },
      ],
      conclusion: '可导必连续，反之不一定成立，应选「正确」。',
    },
  },
  {
    id: 'wq-07',
    severity: 'general',
    type: 'blank',
    stem: '微分方程 y′ + 2y = 0 满足初始条件 y(0) = 3 的特解为 y = ______。',
    tags: ['微分方程', '可分离变量'],
    myMistake: '分离变量后积分时漏掉了任意常数，直接写出 y = e^(−2x)，没有代入初始条件确定 C。',
    wrongCount: 1,
    analysis: {
      answer: '3e^(−2x)',
      steps: [
        '分离变量：dy/y = −2 dx。',
        '两边积分：ln |y| = −2x + C₁，即 y = Ce^(−2x)。',
        '代入 y(0) = 3：C = 3。',
        '故特解为 y = 3e^(−2x)。',
      ],
      conclusion: '特解为 y = 3e^(−2x)。',
    },
  },
  {
    id: 'wq-08',
    severity: 'general',
    type: 'choice',
    stem: '反常积分 ∫₁^(+∞) (1/x²) dx 的值为：',
    options: [
      { key: 'A', text: '1' },
      { key: 'B', text: '收敛但无法求出具体值' },
      { key: 'C', text: '+∞，发散' },
      { key: 'D', text: '−1' },
    ],
    tags: ['反常积分', '收敛性'],
    myMistake: '见到积分上限是 +∞ 就认定发散，没有先求原函数再取极限判断。',
    wrongCount: 1,
    analysis: {
      choiceAnswer: 'A',
      optionNotes: [
        {
          key: 'A',
          verdict: 'correct',
          text: '∫₁^b x^(−2) dx = [−1/x]₁^b = 1 − 1/b，当 b→+∞ 时极限为 1，反常积分收敛于 1，正确。',
        },
        {
          key: 'B',
          verdict: 'wrong',
          text: '被积函数有初等原函数 −1/x，由牛顿—莱布尼茨公式取极限可求出确定值 1，并非无法求值，排除。',
        },
        {
          key: 'C',
          verdict: 'wrong',
          text: 'p-积分 ∫₁^∞ dx/x^p 仅当 p ≤ 1 时发散，此处 p = 2 > 1 收敛，排除。',
        },
        {
          key: 'D',
          verdict: 'wrong',
          text: '被积函数 1/x² 在 [1, +∞) 上恒正，积分值不可能为负，排除。',
        },
      ],
      conclusion: 'p = 2 > 1，反常积分收敛于 1，故选 A。',
    },
  },
];

/* ==================== 备赛区：思维导图 ==================== */

/** 默认示例导图（英语时态体系） */
export const defaultMindMap: MindMapData = {
  title: '高等数学·微分学思维导图',
  center: '高等数学·微分学',
  branches: [
    {
      id: 'b1',
      label: '极限与连续',
      color: '#4d94ff',
      leaves: ['数列与函数极限', '无穷小与无穷大', '两个重要极限', '连续与间断点'],
    },
    {
      id: 'b2',
      label: '导数与微分',
      color: '#9b7ef4',
      leaves: ['导数的定义', '求导法则', '高阶导数', '微分与近似计算'],
    },
    {
      id: 'b3',
      label: '中值定理',
      color: '#f2a93b',
      leaves: ['罗尔定理', '拉格朗日中值定理', '柯西中值定理', '洛必达法则'],
    },
    {
      id: 'b4',
      label: '积分学',
      color: '#4cb051',
      leaves: ['不定积分公式', '换元积分法', '分部积分法', '定积分与反常积分'],
    },
    {
      id: 'b5',
      label: '综合应用',
      color: '#ef6f9e',
      leaves: ['单调性与极值', '切线与渐近线', '微分方程初步', '级数敛散性判别'],
    },
  ],
};

/** AI 生成导图的通用骨架 */
export function buildMindMapTemplate(topic: string): MindMapData {
  return {
    title: `${topic}思维导图`,
    center: topic,
    branches: [
      {
        id: 't1',
        label: '基础概念',
        color: '#4d94ff',
        leaves: ['核心定义', '基本术语', '概念辨析', '知识框架'],
      },
      {
        id: 't2',
        label: '重点难点',
        color: '#9b7ef4',
        leaves: ['高频考点', '易混淆点', '深层原理', '常见误区'],
      },
      {
        id: 't3',
        label: '方法技巧',
        color: '#f2a93b',
        leaves: ['通用解题步骤', '记忆口诀', '快速判断技巧', '答题模板'],
      },
      {
        id: 't4',
        label: '典型例题',
        color: '#4cb051',
        leaves: ['基础示例', '进阶示例', '真题节选', '变式训练'],
      },
      {
        id: 't5',
        label: '应用拓展',
        color: '#ef6f9e',
        leaves: ['跨章知识关联', '实际情境应用', '综合题型', '延伸阅读'],
      },
    ],
  }
}

/* ==================== 赛题试炼 ==================== */

export const trialExam: TrialExam = {
  title: '高等数学综合模拟卷（一）',
  level: '高中',
  cover: 'blackboard',
  questionTotal: 8,
  fullScore: 100,
  durationLeft: 5316,
  questions: [
    {
      id: 'tq-01',
      no: 1,
      type: 'choice',
      score: 10,
      stem: '极限 lim(x→0) sin(3x) / x 的值为：',
      options: [
        { key: 'A', text: '1/3' },
        { key: 'B', text: '1' },
        { key: 'C', text: '3' },
        { key: 'D', text: '0' },
      ],
      answer: 'C',
      analysis: '由重要极限 lim(x→0) sin x / x = 1，得 sin(3x)/x = 3 · sin(3x)/(3x)，当 x→0 时 sin(3x)/(3x)→1，故原极限为 3 × 1 = 3，选 C。',
    },
    {
      id: 'tq-02',
      no: 2,
      type: 'blank',
      score: 10,
      stem: '定积分 ∫₀^π sin x dx = ______。',
      placeholder: '请填入答案，如 2',
      answer: '2',
      analysis: '∫₀^π sin x dx = [−cos x]₀^π = −cos π − (−cos 0) = −(−1) + 1 = 2。正弦曲线在 [0, π] 上的面积恰为一个拱形，其值为 2。',
    },
    {
      id: 'tq-03',
      no: 3,
      type: 'choice',
      score: 10,
      stem: '函数 y = x² − 4x + 3 的单调递增区间为：',
      options: [
        { key: 'A', text: '(−∞, 2)' },
        { key: 'B', text: '(2, +∞)' },
        { key: 'C', text: '(−∞, +∞)' },
        { key: 'D', text: '(−2, 2)' },
      ],
      answer: 'B',
      analysis: 'y′ = 2x − 4，令 y′ > 0 得 x > 2，故单调递增区间为 (2, +∞)。也可以由抛物线开口向上、对称轴 x = 2 直接判断，选 B。',
    },
    {
      id: 'tq-04',
      no: 4,
      type: 'blank',
      score: 10,
      stem: '设 y = x·e^x，则 y′ = ______。',
      placeholder: '请填入答案，如 (1+x)e^x',
      answer: '(1+x)e^x',
      analysis: '由乘积求导法则：y′ = (x)′·e^x + x·(e^x)′ = e^x + x·e^x = (1 + x)e^x。',
    },
    {
      id: 'tq-05',
      no: 5,
      type: 'judge',
      score: 10,
      stem: '判断：若 f(x) 在 [a, b] 上连续，则 f(x) 在 [a, b] 上一定取得最大值和最小值。',
      options: [
        { key: 'T', text: '正确' },
        { key: 'F', text: '错误' },
      ],
      answer: 'T',
      analysis: '这是闭区间上连续函数的最值定理（有界性与最大值最小值定理）：闭区间上的连续函数必有界，且一定能取得最大值与最小值。注意区间必须是闭的，开区间上的连续函数不一定有最值，如 y = 1/x 在 (0, 1) 内无最大值。故判断正确。',
    },
    {
      id: 'tq-06',
      no: 6,
      type: 'blank',
      score: 10,
      stem: '微分方程 y″ − 4y = 0 的通解为 y = ______。',
      placeholder: '请填入答案，如 C1·e^(2x)+C2·e^(−2x)',
      answer: 'C1·e^(2x)+C2·e^(−2x)',
      analysis: '特征方程 r² − 4 = 0，特征根 r = ±2，为两个不相等实根。由二阶常系数齐次线性微分方程的通解结构，通解为 y = C₁e^(2x) + C₂e^(−2x)（C₁、C₂ 为任意常数）。',
    },
    {
      id: 'tq-07',
      no: 7,
      type: 'multiple',
      score: 20,
      stem: '下列积分中，值等于 1 的是（多选）：',
      options: [
        { key: 'A', text: '∫₁^e (1/x) dx' },
        { key: 'B', text: '∫₀¹ x dx' },
        { key: 'C', text: '∫₀^{π/2} cos x dx' },
        { key: 'D', text: '∫₀¹ 2x dx' },
      ],
      answer: 'ACD',
      analysis: 'A：∫₁^e dx/x = ln e − ln 1 = 1，应选；B：∫₀¹ x dx = 1/2，不选；C：∫₀^{π/2} cos x dx = sin(π/2) − sin 0 = 1，应选；D：∫₀¹ 2x dx = [x²]₀¹ = 1，应选。故选 ACD。',
    },
    {
      id: 'tq-08',
      no: 8,
      type: 'choice',
      score: 20,
      stem: '设 f(x) = x³ 在区间 [0, 1] 上满足拉格朗日中值定理，则定理中的 ξ = ：',
      options: [
        { key: 'A', text: '1/3' },
        { key: 'B', text: '√3/3' },
        { key: 'C', text: '1/2' },
        { key: 'D', text: '2/3' },
      ],
      answer: 'B',
      analysis: '拉格朗日中值定理：存在 ξ ∈ (0, 1)，使 f′(ξ) = [f(1) − f(0)]/(1 − 0) = 1。而 f′(x) = 3x²，令 3ξ² = 1，得 ξ = √3/3 ∈ (0, 1)，选 B。',
    },
  ],
};

/* ==================== 晋级赛 / 个人中心 ==================== */

export const userProgress: UserProgress = {
  prepDone: true,
  trialDone: 2,
  trialTotal: 5,
  points: 30,
  pointsTarget: 100,
}

export const profileInfo: ProfileInfo = {
  name: '林同学',
  school: '南山大学',
  badge: '钻石级',
  motto: '每一次练习，都是向目标更近的一步。',
  joinTime: '2024年3月',
  grade: '大学二年级',
  strengths: ['英语', '物理', '编程'],
  homepage: '未设置',
}

export const profileStats: ProfileStat[] = [
  { key: 'points', label: '我的积分', value: '1,280', delta: '+120', tone: 'blue' },
  { key: 'joined', label: '已参加竞赛', value: '12', delta: '+3', tone: 'green' },
  { key: 'favorites', label: '收藏题目', value: '86', delta: '+12', tone: 'violet' },
  { key: 'wrong', label: '错题数量', value: '32', delta: '-8', tone: 'red' },
]

export const competitionRecords: CompetitionRecord[] = [
  {
    id: 'cr-01',
    cover: 'aurora',
    title: '2025 秋季学习挑战赛',
    level: '高中',
    timeRange: '2025-09-01 14:00 - 2025-09-15 23:59',
    award: '全国三等奖',
    rankText: '排名 3 / 856',
  },
  {
    id: 'cr-02',
    cover: 'blackboard',
    title: '全科知识联赛模拟赛',
    level: '高中',
    timeRange: '2025-08-20 19:00 - 2025-09-05 22:00',
    award: '省级一等奖',
    rankText: '排名 5 / 1203',
  },
  {
    id: 'cr-03',
    cover: 'wave',
    title: '2025 跨学科研究挑战赛',
    level: '大学',
    timeRange: '2025-08-25 09:00 - 2025-09-12 18:00',
    award: '全国二等奖',
    rankText: '排名 12 / 642',
  },
]

export const studyProgress: StudyProgressItem[] = [
  { id: 'sp-01', cover: 'geometry', title: '英语词汇冲顶营', level: '高中', lastLesson: '第 3 讲 词根词缀记忆法', percent: 72 },
  { id: 'sp-02', cover: 'blackboard', title: '历史时间线专题', level: '高中', lastLesson: '第 2 讲 近代史框架梳理', percent: 45 },
  { id: 'sp-03', cover: 'wave', title: '跨学科研究挑战赛', level: '大学', lastLesson: '第 1 讲 选题与研究思路', percent: 28 },
]

export const settingGroups: SettingGroup[] = [
  {
    title: '账号设置',
    items: [
      { icon: 'user', title: '基本信息', desc: '修改昵称、学校、年级等个人信息' },
      { icon: 'shield', title: '安全设置', desc: '修改密码、绑定邮箱、账号安全' },
      { icon: 'bell', title: '通知设置', desc: '管理系统通知、邮件提醒' },
    ],
  },
  {
    title: '偏好设置',
    items: [
      { icon: 'sliders', title: '学习偏好', desc: '选择感兴趣的学科方向和难度范围' },
      { icon: 'monitor', title: '界面设置', desc: '调整网站主题、显示偏好' },
      { icon: 'lock', title: '隐私设置', desc: '管理个人资料的可见范围' },
    ],
  },
]

/* ==================== 排行榜 ==================== */

/** 段位 Logo 映射（段位名 → /badges/XX.png） */
export const tierLogos: Record<string, string> = {
  初识: '/badges/01.png',
  启行: '/badges/02.png',
  明理: '/badges/03.png',
  融会: '/badges/04.png',
  贯通: '/badges/05.png',
  卓越: '/badges/06.png',
}

/** 排行榜名单（2025 秋季学习挑战赛） */
export const leaderboard: LeaderboardEntry[] = [
  { rank: 1, name: '流云逐梦者', tier: '卓越', division: 'I', points: 2860, avatarHue: 215 },
  { rank: 2, name: '星云下的旅人', tier: '卓越', division: 'II', points: 2720, avatarHue: 330 },
  { rank: 3, name: '风过山海', tier: '卓越', division: 'III', points: 2640, avatarHue: 20 },
  { rank: 4, name: '追风少年', tier: '贯通', division: 'I', points: 2580, avatarHue: 150 },
  { rank: 5, name: '云端的守望者', tier: '贯通', division: 'II', points: 2520, avatarHue: 205 },
  { rank: 6, name: '知行者', tier: '贯通', division: 'III', points: 2480, avatarHue: 268 },
  { rank: 7, name: '山海行者', tier: '贯通', division: 'IV', points: 2430, avatarHue: 350 },
  { rank: 8, name: '书海逐光', tier: '明理', division: 'I', points: 2370, avatarHue: 190 },
  { rank: 9, name: '青山之下', tier: '明理', division: 'II', points: 2320, avatarHue: 240 },
  { rank: 10, name: '向光而行', tier: '明理', division: 'III', points: 2280, avatarHue: 95 },
]
