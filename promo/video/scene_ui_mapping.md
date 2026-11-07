# scene_ui_mapping.md — 新 UI 存在性对账表

> 目标基线：`LearnRise origin/main @ 9309670`（已 merge 到 `promo/learnrise-video-mockups`，merge commit `f5a8629`）。
> 判定口径：`exists` = 新 UI 真实存在的路由/组件/端点；`redirected` = 旧路由重定向；`removed` = 已删除；`renamed` = 改名/并入其他页。
> 本表是任务 4（录制）、任务 14（提交四件套）、任务 15（16 页效果图）的前置输入。

## 1. 11 场景 × 新 UI 路由

| 场景 | 录屏路由 | 新 UI 页面组件 | 状态 | 证据 |
|---|---|---|---|---|
| S01 | `/` | `pages/CommunityPage.tsx` + `components/layout/Sidebar.tsx` | exists | `frontend/src/App.tsx:34`；Sidebar 一级「竞赛空间」 |
| S02 | `/prep`（默认 tab=assistant） | `pages/PrepPage.tsx` + `StudyAssistantPanel` | exists | `PrepPage.tsx:9-17` 六标签定义 |
| S03 | `/library` | `pages/LibraryPage.tsx`（上传 `library-upload-input`） | exists | `App.tsx:46`；testid `library-upload-input` |
| S04 | `/library/:id` | `pages/SourceDetailPage.tsx`（`source-generate-notes` / `tree-node`） | exists | `App.tsx:47` |
| S05 | `/prep?tab=mindmap` → 组件内 `/prep` | `PrepPage` → `MindMapPanel`（`mindmap-region` / `mindmap-node`） | exists | `PrepPage.tsx:62` |
| S06 | `/kp/:id` | `pages/KnowledgePointPage.tsx`（`explain-start` / `explain-output`） | exists | `App.tsx:42` |
| S07 | `/practice`（标签「陪练」） | `pages/PracticePage.tsx` | exists | `App.tsx:48`；testid `page-practice` |
| S08 | `/review`（标签「间隔复习」） | `pages/ReviewPage.tsx` | exists | `App.tsx:36` |
| S09 | `/rank` | `pages/LeaderboardPage.tsx`（`leaderboard-runner` / `Podium` / `LaurelAvatar`） | exists | `App.tsx:39`；`components/leaderboard/*` |
| S10 | `/profile` | `pages/ProfilePage.tsx`（资料卡 / 改密码 / Agent 掩码 / 竞赛记录） | exists | `App.tsx:40`；testid `profile-records` / `agent-key-masked` |
| S11 | `/dashboard`（标签「学习看板」） | `PrepPage` → `DashboardPage`（`dashboard-kpis` / `radar-svg` / `heatmap-svg` / `curve-svg`） | exists | `PrepPage.tsx:63` |

## 2. 16 个 Penpot page id 对账

| # | id | 旧 route | 新 UI 屏幕 | 状态 | 处置 |
|---|---|---|---|---|---|
| 1 | `login` | `/login` | `LoginPage` | exists | 重采 |
| 2 | `community` | `/` | `CommunityPage` | exists | 重采 |
| 3 | `competition` | `/competition/:id` | `CompetitionDetailPage` | exists | 重采 |
| 4 | `prep` | `/prep` | 六标签备赛区 | exists | 重绘（标签条 + 学习助手） |
| 5 | `trial` | `/trial` | `TrialPage` | exists | 重采 |
| 6 | `review` | `/review` | `PrepPage` 间隔复习 | exists | 重绘（标签态） |
| 7 | `promotion` | `/promo` | `PromotionPage` | exists | 重采 |
| 8 | `rank` | `/rank` | 新排行榜（Podium/奖牌/头像） | exists | 重绘 |
| 9 | `profile` | `/profile` | 新个人中心（资料卡/改密码/Agent/记录） | exists | 重绘（删 5 组 SettingCard 与主题切换） |
| 10 | `kp` | `/kp/:id` | `KnowledgePointPage` | exists | 重采 |
| 11 | `dashboard` | `/dashboard` | `PrepPage` 学习看板 | exists | 重绘（标签态） |
| 12 | `library` | `/library` | `LibraryPage`（含删除资料） | exists | 重绘 |
| 13 | `source` | `/library/:id` | `SourceDetailPage` | exists | 重采 |
| 14 | `quiz` | `/quiz` | `Navbar: /quiz → <Navigate to="/prep" replace>` | **redirected** | 改名重绘：`/prep?tab=practice`，禁画已删 QuizPage |
| 15 | `practice` | `/practice` | `PracticePage`（PrepPage 陪练标签） | exists | 重绘（会话/总结态） |
| 16 | `agents` | `/settings/agents` | `AgentsPage`（密钥掩码） | exists | 重采 |

**关键证据**：`frontend/src/App.tsx` 中 `/quiz` 与 `/quiz/session` 均为 `Navigate → /prep`；`pages/QuizPage.tsx`、`api/quiz.ts` 文件已不存在（`test ! -f` 通过）。

## 3. 18 张 `docs/submission/assets` 对账

| 旧文件 | 旧能力 | 新 UI 对应截图 | 状态 |
|---|---|---|---|
| 01-login.png | 登录 | `LoginPage` | 重采 |
| 02-upload.png | 上传入口 | `LibraryPage` 上传按钮 | 重采 |
| 03-upload-progress.png | 上传进度 | 状态徽标 parsing/embedding | 重采 |
| 04-upload-ready.png | 上传完成 | 状态徽标 ready | 重采 |
| 05-mindmap.png | 思维导图 | `PrepPage?tab=mindmap` | 重采 |
| 06-library.png | 资料库 | `LibraryPage` | 重采 |
| 07-quiz-setup.png | **/quiz 出题设置** | —— | **removed**（新 UI 无出题页） |
| 08-quiz-question.png | **/quiz 答题** | `PracticePage?tab=practice` | **renamed** |
| 09-quiz-wrong-answer.png | **/quiz 错题解析** | `PrepPage?tab=wrong` 错题收藏 | **renamed** |
| 10-review-front.png | 复习正面 | `ReviewPage` 正面 | 重采 |
| 11-review-answer.png | 复习答案 | `ReviewPage` 翻面 + 评分 | 重采 |
| 12-dashboard.png | 看板 | `PrepPage?tab=dashboard` | 重采 |
| 13-agent-settings.png | Agent 设置 | `AgentsPage` 掩码 | 重采 |
| 14-agent-dropdown.png | Agent 下拉 | `KnowledgePointPage` Agent 选择 | 重采 |
| 14b-agent-dropdown-crop.png | 裁剪图 | 同上（重新裁剪） | 重采 |
| 15-kp-explain.png | 知识点讲解 | `KnowledgePointPage` | 重采 |
| 16-explain-streaming.png | 流式讲解 | SSE 输出中 | 重采 |
| 16-explain-stream.png | 流式讲解（重复） | 同上 | 重采/去重 |

## 4. `docs/submission/build_pptx.py` 8 处旧引用重映射

| 行 | 旧引用 | 新引用 |
|---|---|---|
| 274 | `03-upload-progress.png` | `03-upload-parsing.png`（新 UI 状态徽标 parsing） |
| 276 | `04-upload-ready.png` | `04-upload-ready.png`（重采同名） |
| 278 | `05-mindmap.png` | `05-mindmap.png`（重采同名，新 UI 标签态） |
| 299 | `06-library.png` | `06-library.png`（重采同名，新侧边栏） |
| 323 | `09-quiz-wrong-answer.png` | `09-wrong-questions.png`（错题收藏标签） |
| 373 | `11-review-answer.png` | `11-review-answer.png`（重采同名，新翻卡评分） |
| 379 | `13-agent-settings.png` | `13-agent-settings.png`（重采同名，密钥掩码） |
| 380 | `14b-agent-dropdown-crop.png` | `14b-agent-dropdown-crop.png`（重新裁剪） |

> 任务 14 执行时按此表改脚本，并以 `grep -cE '03-upload-progress|04-upload-ready|05-mindmap|06-library|09-quiz-wrong|11-review-answer|13-agent-settings|14b-agent' build_pptx.py → 0` 验收（旧名全部消失）。
