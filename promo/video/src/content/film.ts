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

const capture = (id: string, src: string, note: string): FilmAsset => ({
  id,
  src,
  kind: 'image',
  nativeWidth: 1920,
  nativeHeight: 1080,
  note,
});

export const SCENES: readonly FilmScene[] = [
  {
    id: 'S01',
    minSeconds: 12,
    kicker: '// 2026 · 智学闭环',
    screenText: ['你不缺资料。', '你缺一条闭环。'],
    narration:
      '备考最痛苦的，从来不是没有资料。而是资料看完就忘，错了还错。',
    visual:
      '近黑背景。三张当前 UI 截图压到 8% 亮度，缓慢上浮；两行字上浮，第二行下方 accent 线扫出。',
    assets: [
      capture('library', 'ui/library.png', '资料库列表'),
      capture('quiz', 'ui/quiz.png', '刷题页'),
      capture('review', 'ui/review.png', '复习页'),
    ],
  },
  {
    id: 'S02',
    minSeconds: 20,
    kicker: '01 / 闭环',
    screenText: ['建赛 · 资料 · 知识库 · 笔记', '出题 · 复习 · 助手 · 排行榜'],
    subline: '八个环节，共用同一份数据。',
    dataStrip: [
      `${API_PATHS} API · ${API_OPERATIONS} OPERATIONS · ${SERVICES} SERVICES`,
    ],
    narration:
      '智学闭环 LearnRise，把建赛、资料、知识库、笔记、出题、复习、助手和排行榜，串成一条完整的学习流水线。八个环节，共用同一份数据。',
    visual:
      '深色舞台。八个节点横向排成流水线，依次点亮并连线，最后收束成一个环，环心出现 LearnRise。',
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
      '左侧上传卡片拖入第3章 应收款项及预防账款.pdf，出现格式徽章；状态机 queued → parsing → embedding → ready 逐格点亮。右侧资料库解析完成态。',
    assets: [
      capture('upload', 'ui/upload.png', '上传弹窗与格式徽章'),
      capture('library-ready', 'ui/library-ready.png', '资料库 ready 状态'),
    ],
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
      '三连拍：资料详情页知识结构树逐级展开；笔记编辑面板保存成功 toast；思维导图节点从中心向外生长。',
    assets: [
      capture('knowledge-tree', 'ui/knowledge-tree.png', '资料详情知识树'),
      capture('note-edit', 'ui/note-edit.png', '笔记编辑与保存 toast'),
      capture('mindmap', 'ui/mindmap.png', '思维导图'),
    ],
  },
  {
    id: 'S05',
    minSeconds: 26,
    kicker: '04 / 可溯源',
    screenText: ['答错，也要知道错在哪一句。'],
    subline: 'RAG top-3 出题 · chunk 级溯源 · 自动建卡',
    footnote: '演示环境使用 mock 模型；题目文本不代表真实模型输出，出处切片来自已入库资料',
    narration:
      '接下来是最关键的一步：出题。选定知识点，AI 会先在你的资料里检索最相关的三段原文，再据此生成题目。答错时，它不只告诉你正确答案，还会把错因定位到原文的哪一页、哪一句。每一道错题，都会自动进入复习队列。',
    visual:
      '选择知识点「坏账准备的计提」→ 生成 3 道选择题 → 故意选错 → 红色反馈与已加入复习卡片 → 展开 chunk 出处并轻微推近。',
    assets: [
      capture('quiz-generate', 'ui/quiz-generate.png', '出题加载态'),
      capture('quiz-wrong', 'ui/quiz-wrong.png', '答错反馈与建卡提示'),
      capture('source-chunk', 'ui/source-chunk.png', 'chunk 级原文出处'),
    ],
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
      '知识点页选择讲解风格与 Agent；苏格拉底追问气泡逐条出现；点揭晓后答案逐字流式出现；只做定性流式，不标首 token 数字。',
    assets: [
      capture('socratic', 'ui/socratic.png', '苏格拉底追问气泡'),
      capture('explain-stream', 'ui/explain-stream.png', '揭晓答案流式输出'),
    ],
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
      '陪练会话连续提问、进度条推进；会话结束回顾；薄弱点列表与补救计划卡片；备考计划分配到日历/时间轴。',
    assets: [
      capture('practice', 'ui/practice.png', '陪练会话'),
      capture('practice-review', 'ui/practice-review.png', '会话回顾'),
      capture('prep-weakness', 'ui/prep-weakness.png', '薄弱点与补救计划'),
      capture('plan', 'ui/plan.png', '备考计划时间轴'),
    ],
  },
  {
    id: 'S08',
    minSeconds: 20,
    kicker: '07 / 记得住',
    screenText: ['复习不是重复，是调度。'],
    subline: '难度 · 稳定性 · 1–365 天 · 邮件提醒',
    footnote: 'DSR · 评分 1–5 · 下次到期日',
    narration:
      '复习不是简单重复。每张卡片都有难度和稳定性，系统用 DSR 模型计算下一次出现的时间。评分一到五，间隔从一天到一年，自动调整。邮件提醒可在设置里开关。',
    visual:
      '复习页卡片翻面；评分条 1 忘记 · 2 · 3 · 4 · 5 简单，点 4；卡片上浮 3 天后；邮件提醒开关与文案特写，不展示真实投递。',
    assets: [
      capture('review-card', 'ui/review-card.png', '复习卡翻面'),
      capture('review-rating', 'ui/review-rating.png', '评分与下次到期'),
      capture('email-reminder', 'ui/email-reminder.png', '邮件提醒开关'),
    ],
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
      '创建竞赛弹窗（2026 春季 · 财务会计班级联赛 / LR-2026 / 一班 王老师）；排行榜恰好 4 位学生；学习看板 4 KPI + 热力图 + 遗忘曲线 + 雷达 + 难度分布依次亮起。',
    assets: [
      capture('competition-create', 'ui/competition-create.png', '创建竞赛弹窗'),
      capture('leaderboard', 'ui/leaderboard.png', '四行学生排行榜'),
      capture('dashboard', 'ui/dashboard.png', '学习看板'),
    ],
  },
  {
    id: 'S10',
    minSeconds: 16,
    kicker: '09 / 你的',
    screenText: ['模型、密钥、主题、隐私，你说了算。'],
    subline: '多 Agent · 密钥掩码 · 主题 · 隐私 · 头像',
    footnote: 'Fernet 加密 · 掩码回显 · 404 而非 403',
    narration:
      '模型、密钥、主题、隐私，由你掌控。Agent 密钥加密存储，只回显掩码。个人资源跨用户访问返回 404，竞赛权限按成员身份校验。',
    visual:
      '个人中心六项设置逐项高亮；主题浅色→深色实时切换；Agent 表密钥只显示 sk-****1234；头像上传后排行榜同步。',
    assets: [
      capture('profile-settings', 'ui/profile-settings.png', '个人中心设置项'),
      capture('theme-dark', 'ui/theme-dark.png', '深色主题'),
      capture('agents', 'ui/agents.png', 'Agent 设置与密钥掩码'),
      capture('avatar', 'ui/avatar.png', '头像与排行榜同步'),
    ],
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
