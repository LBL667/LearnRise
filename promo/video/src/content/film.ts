/**
 * The film model — the single authored source for narration and screen copy.
 *
 * Scene components must never contain a Chinese sentence of their own; they
 * import a scene from `SCENE_BY_ID` and render its fields. `npm run
 * lint-content` enforces that rule on `src/scenes/**`.
 *
 * Windows are fixed by the production script:
 *   12 + 20 + 24 + 24 + 26 + 24 + 22 + 20 + 20 + 16 + 16 = 224 s
 *   224 s × 30 fps = 6720 frames
 *
 * `FPS`, `CUTS`, `SCENE_FRAMES` and `TOTAL_FRAMES` are derived, never typed
 * twice, so changing one `minSeconds` moves every downstream cut.
 */

import {
  API_OPERATIONS,
  API_PATHS,
  SERVICES,
  TESTS_COLLECTED,
  TESTS_PASSED,
  TESTS_SKIPPED,
} from './facts';

export const FPS = 30;

export type SceneId =
  | 'S01'
  | 'S02'
  | 'S03'
  | 'S04'
  | 'S05'
  | 'S06'
  | 'S07'
  | 'S08'
  | 'S09'
  | 'S10'
  | 'S11';

export interface FilmAsset {
  readonly id: string;
  /** Path under `public/`, captured by T08 at 1920×1080. */
  readonly src: string;
  readonly kind: 'image';
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  /** What the capture must show, for T08 and for later replacement. */
  readonly note: string;
}

export interface FilmScene {
  readonly id: SceneId;
  /** Window length from the production script; frames derive from this. */
  readonly minSeconds: number;
  /** TTS text, verbatim from the production script. */
  readonly narration: string;
  /** The stacked on-screen headline. */
  readonly screenText: readonly string[];
  /** Supporting line under the headline. */
  readonly subline?: string;
  /** Mono kicker row above the headline. */
  readonly kicker?: string;
  /** Small provenance/technical line under the headline block. */
  readonly footnote?: string;
  /** Mono data strip used by S2, S9 and S11. */
  readonly dataStrip?: readonly string[];
  /** Production direction for the visual layer (not rendered verbatim). */
  readonly visual: string;
  /** Planned capture set; files land in `public/ui` during T08. */
  readonly assets: readonly FilmAsset[];
}

export const SCENES: readonly FilmScene[] = [
  {
    id: 'S01',
    minSeconds: 12,
    kicker: '// 2026 · 智学闭环',
    screenText: ['你不缺资料。', '你缺一条闭环。'],
    narration:
      '备考最痛苦的，从来不是没有资料。而是资料看完就忘，错了还错。',
    visual:
      '新 UI 竞赛空间首页：侧边栏（竞赛空间 / 备赛区 / 赛题试炼 / 晋级赛 / 排行榜 / 资料库）展开收起，竞赛卡悬停与班级切换，背景压到 8% 亮度缓慢上浮。',
    assets: [],
  },
  {
    id: 'S02',
    minSeconds: 20,
    kicker: '01 / 闭环',
    screenText: ['建赛 · 资料 · 知识库 · 笔记', '陪练 · 复习 · 助手 · 排行榜'],
    subline: '八个环节，共用同一份数据。',
    dataStrip: [
      `${API_PATHS} API · ${API_OPERATIONS} OPERATIONS · ${SERVICES} SERVICES`,
    ],
    narration:
      '智学闭环 LearnRise，把建赛、资料、知识库、笔记、陪练、复习、助手和排行榜，串成一条完整的学习流水线。八个环节，共用同一份数据。',
    visual:
      '备赛区六个标签（学习助手 / 错题收藏 / 思维导图 / 学习看板 / 陪练 / 间隔复习）依次点亮，最后收束成一个环，环心出现 LearnRise。',
    assets: [],
  },
  {
    id: 'S03',
    minSeconds: 24,
    kicker: '02 / 消化',
    screenText: ['上传，然后它开始理解。'],
    subline: 'PDF · Word · Markdown · 拍照讲义',
    footnote: '本地 OCR · 分块 · 向量化 · 后台任务',
    narration:
      '第一步，上传。PDF、Word、Markdown，甚至拍照的讲义，都能直接进来。系统会自动 OCR、按标题分块、向量化，并实时告诉你：排队、解析、嵌入、就绪。你看到的不是上传进度，是一份资料正在变成可检索的知识。',
    visual:
      '新 UI 资料库：打开上传对话框选择 PDF，状态徽标 queued → parsing → embedding → ready 依次点亮，列表刷新为 ready。',
    assets: [],
  },
  {
    id: 'S04',
    minSeconds: 24,
    kicker: '03 / 结构化',
    screenText: ['从一份资料，长出一棵树。'],
    subline: '章节 · 知识点 · 原文出处 · 笔记 · 导图',
    footnote: '每个知识点都能回到原文',
    narration:
      '解析完成后，它会生成一棵知识树：章节、知识点、层级关系一目了然。每个知识点都绑定原文切片，点开就能看到出处。笔记可以编辑，思维导图随资料结构自动生长。你甚至可以手动补一张复习卡，把老师的口头重点也留下来。',
    visual:
      '新 UI 资料详情：点击「生成笔记」，知识结构树逐级展开并高亮节点；页面停留展示章节层级。',
    assets: [],
  },
  {
    id: 'S05',
    minSeconds: 26,
    kicker: '04 / 有出处',
    screenText: ['把知识结构，摊开来看。'],
    subline: '思维导图 · 知识点节点 · 原文出处',
    footnote: '演示环境使用 mock 模型；笔记文本不代表真实模型输出，出处切片来自已入库资料',
    narration:
      '把知识结构摊开来看，更容易发现缺口。思维导图从资料结构自动生长，可以平移、缩放、逐层展开；点开任一节点，就能回到对应的知识点和原文出处。你看到的不是一堆文件，是一份能追问、能回溯的知识网络。',
    visual:
      '新 UI 备赛区「思维导图」标签：选择来源后导图节点逐层展开，画布平移与缩放，悬停高亮节点。',
    assets: [],
  },
  {
    id: 'S06',
    minSeconds: 24,
    kicker: '05 / 会追问',
    screenText: ['不直接给答案，先让你想明白。'],
    subline: '苏格拉底模式 · 揭晓答案 · SSE 逐字输出',
    footnote: '演示环境使用 mock 模型；题目文本不代表真实模型输出，出处切片来自已入库资料',
    narration:
      '遇到不懂的地方，可以进入苏格拉底模式。它不直接给答案，而是一步步追问，直到你自己想明白；想不通，再点揭晓。讲解以流式输出，第一个字几乎立刻出现，不用盯着转圈。你还可以为它配置不同的模型和人格。',
    visual:
      '新 UI 知识点页：选择 Agent 与讲解风格，点击开始后答案以 SSE 逐字流入；切换一次风格再跑一段短输出。',
    assets: [],
  },
  {
    id: 'S07',
    minSeconds: 22,
    kicker: '06 / 练到点上',
    screenText: ['练你真正不会的。'],
    subline: '陪练会话 · 薄弱点 · 补救计划 · 备考计划',
    footnote: '从"刷了很多"到"补上了"',
    narration:
      '陪练模式会把薄弱知识点变成一场连续对话。系统根据你的作答，找出真正的薄弱点，生成补救计划。临近考试，还可以一键生成备考计划，把时间分配到每一天。',
    visual:
      '新 UI 备赛区「陪练」标签：勾选知识点、设定难度与题量，逐题作答并提交，进度条推进，结束后来到成绩页。',
    assets: [],
  },
  {
    id: 'S08',
    minSeconds: 20,
    kicker: '07 / 记得住',
    screenText: ['复习不是重复，是调度。'],
    subline: '难度 · 稳定性 · 1–365 天 · 评分 1–5',
    footnote: 'DSR · 评分 1–5 · 下次到期日',
    narration:
      '复习不是简单重复。每张卡片都有难度和稳定性，系统用 DSR 模型计算下一次出现的时间。评分一到五，间隔从一天到一年，自动调整。',
    visual:
      '新 UI 备赛区「间隔复习」标签：卡片翻面显示答案，点 4 分评分，进度条前进，续到下一张卡。',
    assets: [],
  },
  {
    id: 'S09',
    minSeconds: 20,
    kicker: '08 / 一起走',
    screenText: ['一个人刷题，一群人备赛。'],
    subline: '竞赛空间 · 班级排行榜 · 学习看板',
    dataStrip: ['90D HEATMAP · 30D CURVE · MASTERY RADAR'],
    narration:
      '学习也可以是一个人的事，但一群人走得更远。创建竞赛、邀请队友、一起刷题，排行榜自动计分，刷新后更新。学习看板把到期量、掌握度、热力图和遗忘曲线放在同一屏。',
    visual:
      '新 UI 排行榜：领奖台 + 恰好 4 行学生（小红 1000 / 小明 960 / 张三 916 / 李四 876），逐行悬停，滚动展示名次与奖牌。',
    assets: [],
  },
  {
    id: 'S10',
    minSeconds: 16,
    kicker: '09 / 你的',
    screenText: ['模型、密钥、数据，你说了算。'],
    subline: '多 Agent · 密钥掩码 · 个人资源隔离 · 头像同步',
    footnote: 'Fernet 加密 · 掩码回显 · 404 而非 403',
    narration:
      '模型和密钥，由你掌控。Agent 密钥加密存储，只回显掩码。个人资源跨用户访问返回 404，竞赛权限按成员身份校验。头像更新后，排行榜同步显示。',
    visual:
      '新 UI 个人中心：资料卡与头像、修改密码对话框开关、Agent 设置里的密钥掩码、竞赛记录列表；不展示已删的设置卡片与主题切换。',
    assets: [],
  },
  {
    id: 'S11',
    minSeconds: 16,
    screenText: ['不是题库。', '是会记住你的学习系统。'],
    subline: '本地 Docker 全链路可运行 · 多 Agent 可配置',
    dataStrip: [
      `${API_PATHS} API / ${API_OPERATIONS} OPS / ${TESTS_COLLECTED} TESTS / ${TESTS_PASSED} PASSED / ${TESTS_SKIPPED} SKIPPED`,
    ],
    narration: `${API_PATHS} 个 API、${API_OPERATIONS} 个操作、${TESTS_PASSED} 个测试通过、${TESTS_SKIPPED} 个跳过，六个服务一键启动。智学闭环，不是又一个题库，而是一套会记住你的学习系统。`,
    visual:
      '深色收尾。中央 cluster：顶部 stack 行、两行主张、几何 wordmark LearnRise、数据条；末帧切纯背景，不留黑帧。',
    assets: [],
  },
];

export const SCENE_BY_ID: Record<SceneId, FilmScene> = SCENES.reduce(
  (acc, scene) => {
    acc[scene.id] = scene;
    return acc;
  },
  {} as Record<SceneId, FilmScene>,
);

export const SCENE_FRAMES: readonly number[] = SCENES.map(
  (scene) => scene.minSeconds * FPS,
);

export const CUTS: readonly number[] = SCENE_FRAMES.reduce<number[]>(
  (cuts, frames) => {
    cuts.push(cuts.length === 0 ? 0 : cuts[cuts.length - 1] + SCENE_FRAMES[cuts.length - 1]);
    return cuts;
  },
  [],
);

export const TOTAL_FRAMES = SCENE_FRAMES.reduce((sum, frames) => sum + frames, 0);
export const TOTAL_SECONDS = TOTAL_FRAMES / FPS;

export interface SceneWindow {
  readonly id: SceneId;
  readonly from: number;
  readonly durationInFrames: number;
}

export const SCENE_WINDOWS: readonly SceneWindow[] = SCENES.map((scene, index) => ({
  id: scene.id,
  from: CUTS[index],
  durationInFrames: SCENE_FRAMES[index],
}));
