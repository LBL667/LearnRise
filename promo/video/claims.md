# claims.md — 36 条可核验声明（新 UI 口径）

> 每条声明都必须能在仓库或实测证据中找到出处；不得出现任何未实现能力的表述。
> 变动记录：R7 merge 后 `API_PATHS` 由 67 修正为 66（openapi 实测）；其余 facts 数字不变。

| # | 声明 | 证据 |
|---|---|---|
| 1 | **S01 主题**：「你不缺资料，你缺一条闭环」作为开场主张，画面为新 UI 竞赛空间首页。 | film.ts S01.screenText；clips/S01 |
| 2 | **S02 八环节**：建赛、资料、知识库、笔记、陪练、复习、助手、排行榜八个环节共用同一份数据。 | film.ts S02.narration；PrepPage 六标签 + Community/Leaderboard |
| 3 | **S03 多格式摄入**：支持 PDF / Word / Markdown / 拍照讲义上传，后端执行 OCR、分块、向量化。 | backend/app/api/sources.py；README §1 模块 1 |
| 4 | **S03 状态机**：上传后状态依次为 queued → parsing → embedding → ready。 | 前端 `status-badge[data-status]`；录制 S03 实测四种状态 |
| 5 | **S04 知识树**：资料可生成章节/知识点层级树，每个知识点绑定原文切片。 | `source-generate-notes`、`tree-node`；backend notes API |
| 6 | **S05 思维导图**：思维导图从资料结构自动生长，支持平移、缩放与逐层展开。 | PrepPage?tab=mindmap；`mindmap-region`/`mindmap-node` |
| 7 | **S06 苏格拉底讲解**：知识点讲解支持苏格拉底模式与流式（SSE）逐字输出。 | KnowledgePointPage；`explain-style`/`explain-output` |
| 8 | **S06 多 Agent**：讲解可切换不同 Agent（模型 / base_url / 系统提示词）。 | AgentsPage；backend agents API |
| 9 | **S07 陪练会话**：陪练按知识点 + 难度 + 题量创建会话，逐题作答并给出解析。 | PracticePage；`practice-start`/`practice-question` |
| 10 | **S07 自适应难度**：陪练过程中按作答表现自动调整难度。 | PracticePage 源码 `sessionDifficulty` 自适应逻辑 |
| 11 | **S08 DSR 调度**：复习用 DSR 模型按难度与稳定性计算下次到期时间。 | backend review 服务；`review-card`/`review-progress` |
| 12 | **S08 评分 1–5**：复习评分 1–5，间隔可在 1–365 天范围调整。 | ReviewPage 评分控件；backend review submit |
| 13 | **S09 竞赛与排行榜**：支持创建竞赛、邀请码入班、按 10×答对 + 4×复习计分的排行榜。 | backend/app/api/profile.py `_competition_points` |
| 14 | **S09 排行榜实测值**：主竞赛排行榜为 小红 1000 / 小明 960 / 张三 916 / 李四 876。 | seed_facts.json verifiedLive；实测 API 返回 |
| 15 | **S10 个人中心**：个人中心展示资料卡、竞赛记录、改密码与 Agent 设置入口。 | ProfilePage；`profile-records`/`profile-agent-settings` |
| 16 | **S10 密钥掩码**：Agent API Key 加密存储，接口只回显掩码。 | `agent-key-masked`；backend security 掩码 |
| 17 | **S11 收尾主张**：「不是题库，是一套会记住你的学习系统」。 | film.ts S11.screenText |
| 18 | **Prep 六标签**：备赛区聚合六个标签：学习助手 / 错题收藏 / 思维导图 / 学习看板 / 陪练 / 间隔复习。 | PrepPage.tsx:9-17 |
| 19 | **备赛区路由**：`/review`、`/practice`、`/dashboard` 均渲染 PrepPage 对应标签。 | App.tsx:36,45,48 |
| 20 | **出题页已删除**：旧 `/quiz` 页面已删除，路由重定向到 `/prep`。 | App.tsx:44-45 `Navigate`；`QuizPage.tsx` 不存在 |
| 21 | **个人中心精简**：个人中心已删除 5 组设置卡片与主题切换。 | ProfilePage 源码；`grep -c SettingCard` → 0 |
| 22 | **本地偏好**：UI 偏好存于 localStorage，不再依赖服务端 `preferences/ui`。 | frontend theme/provider 源码 |
| 23 | **资料删除**：资料库支持删除资料（`DELETE /api/sources/{id}`）。 | openapi.json 路径；LibraryPage 删除交互 |
| 24 | **晋级进度端点**：新增 `promotion-progress` 端点用于晋级进度。 | openapi.json `/api/profile/promotion-progress` |
| 25 | **知识点搜索**：知识点支持按标题搜索（`GET /api/knowledge-points/search`）。 | openapi.json；`kp-search-input` |
| 26 | **错题收藏**：错题收藏标签展示答错题目并可回到出处。 | PrepPage wrong 标签；`wrong-question-item` |
| 27 | **学习看板**：学习看板含 KPI、雷达图、热力图与遗忘曲线。 | DashboardPage；`dashboard-kpis`/`radar-svg`/`heatmap-svg`/`curve-svg` |
| 28 | **API 规模**：当前 OpenAPI 文档 66 个路径 / 77 个操作（含 1 个 HEAD）。 | `npm run check-facts` PASS；openapi.json |
| 29 | **服务规模**：docker-compose 共 6 个服务：db / minio / backend / ocr-service / frontend / nginx。 | docker-compose.yml；`SERVICE_NAMES` |
| 30 | **测试基线**：测试基线 498 收集 / 490 通过 / 8 跳过 / 0 失败。 | LearnRise/scripts/test-baseline.json；check-facts PASS |
| 31 | **技术栈**：FastAPI + React + PostgreSQL/pgvector + Docker。 | facts.ts STACK_LINE |
| 32 | **本地可运行**：本地 Docker 全链路可运行（本机实测 6 服务 healthy）。 | environment_baseline.md §9 |
| 33 | **权限隔离**：跨用户访问个人资源返回 404 而非 403，竞赛权限按成员身份校验。 | backend profile/sources 权限逻辑 |
| 34 | **mock 说明**：演示环境使用 mock 模型；界面 `model` 字段显示 `mock-local`。 | .env.demo LLM_PROVIDER=mock；README §4 |
| 35 | **云部署状态**：华为云在线部署未完成（本机无云凭据），仅本地链路可运行。 | README 顶部状态说明；docs/deploy.md |
| 36 | **截图口径**：提交材料与效果图均按新 UI 采集/重绘，旧 UI 截图不再使用。 | scene_asset_matrix.md；任务 14/15 验收 |

> 校验：`grep -c '^| [0-9]' claims.md` → 36；未实现能力关键词命中 → 0。
