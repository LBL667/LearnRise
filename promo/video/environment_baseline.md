# environment_baseline.md — LearnRise 宣传片换新 UI（执行期基线）

> 冻结时间：2026-11-07 15:5x（Task 2）
> 本文件是 Task 13「环境复原」与 F3「分支清洁」的对照基准。**任何后续变更都必须能在本文件找到基线。**

## 1. Git 状态

| 对象 | 值 |
|---|---|
| 父仓库 `/home/sky/竞赛/华为ICT` HEAD | `f15f8fc`（**永不提交，执行期不得改变**） |
| `LearnRise` 当前分支 | `promo/learnrise-video-mockups` |
| `LearnRise` HEAD | `c035a87` (`fix(promo): make documented repro commands runnable`) |
| `LearnRise` `origin/main` | `9309670`（新 UI 目标基线，R7 待 merge） |
| `LearnRise` 工作区 | `?? promo/video/scripts/fix-review-assets.py` — **上一轮遗留**，非本轮修补，不删除、不登记为 patch |

### `$FILM` 的 git 归属（重要）

- `$FILM` = `/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min`
- `git -C $FILM rev-parse --is-inside-work-tree` → `true`，但它**不是独立仓库**，而是 `/home/sky/文档` 这个父级 git 仓库的工作区子目录。
- `/home/sky/文档` 仓库 **零提交**（`git rev-list --count HEAD` → 报错 `ambiguous argument 'HEAD'`）。
- **纪律：执行期禁止在 `/home/sky/文档` 里 `git add/commit/stash/checkout`。** `$FILM` 的所有产物仅以文件形式落盘与归档。

## 2. 端口与容器基线（空闲态）

`ss -ltnp | grep -E ':(5173|5174|8000|8080|55432|55433)'` → **无输出（全部空闲）**

docker-compose 服务与端口（`LearnRise/docker-compose.yml`，`docker compose config --services`）：

| service | 端口 | 说明 |
|---|---|---|
| `db` | `55433:5432` | pgvector/pgvector:0.8.0-pg15（注意宿主端口是 **55433**，不是 55432） |
| `minio` | `9000`, `19001` | minio/minio |
| `backend` | `8000` | 启动命令自带 `alembic upgrade head` |
| `ocr-service` | `8001` | |
| `frontend` | `5174` | Vite dev server（**录制目标端口**） |
| `nginx` | `8080` | 反向代理 |

Docker 镜像（已存在，无需外网拉取）：

```
learnrise-frontend:latest
learnrise-backend:latest
learnrise-ocr-service:latest
pgvector/pgvector:pg15
pgvector/pgvector:0.8.0-pg15
minio/minio:latest
swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/pgvector/pgvector:0.8.0-pg15
```

去重仓库数（`sed 's|.*/||' | sort -u`）= **5**：`learnrise-frontend` / `learnrise-backend` / `learnrise-ocr-service` / `pgvector` / `minio`。

## 3. 环境文件

- `LearnRise/.env.demo` **存在**（769 B，10 个变量：`LLM_PROVIDER LLM_MODEL EMBEDDING_PROVIDER EMBEDDING_MODEL EMBEDDING_DIM PROVIDER_PROFILE STORAGE_PROVIDER TIMEZONE DEMO_EMAIL DEMO_PASSWORD`）— 值不记录、不入日志。
- `LearnRise/.env` **不存在**。
- 起栈命令：`docker compose --env-file .env.demo up -d`（在 `LearnRise/` 下执行）。

## 4. 工具链 pin（与 Task 1 一致）

| 工具 | 版本 / 路径 |
|---|---|
| ffmpeg | 8.1.3 |
| node | v20.20.2 |
| npm | 10.8.2 |
| edge-tts | 7.3.1（venv `~/.local/share/remotion-video/ttsvenv`） |
| Chromium | `/home/sky/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`（可执行） |
| Playwright | 1.64.1 @ `/home/sky/竞赛/华为ICT/LearnRise/frontend/node_modules/playwright`（**不在 `$FILM/node_modules`**） |

## 5. 影片源码基线（本轮改动前）

| 指标 | 值 |
|---|---|
| 场景文件 | `src/scenes/S*.tsx` = **11** |
| `HtmlClip` 在 `src/scenes/` 引用数 | **0** |
| `staticFile` 在 `src/scenes/` 出现次数 | **19**（全部为 PNG 静帧） |
| `public/clips/demo/demo.mp4` | h264 / 1920×1080 / 30-1 / 90 帧 / 仅 video / **未被引用**（仅 HtmlClip.tsx 两处注释提及） |
| `src/components/HtmlClip.tsx` props | `{src, width, height?, style?}`；`OffthreadVideo muted`；`staticFile`；无 `durationInFrames` |
| `public/ui/*.png` | **58 张**（2026-11-02 旧 UI 截图残留；计划正文旧记数为 46，实际 58，以实测为准） |

旧 UI PNG 全量哈希：`newui-20261107-old-ui-png.sha256`（58 行，用于 F1/F3「0 张旧 PNG 残留」比对）。

## 6. 音频基线（本轮改写前）

`newui-20261107-audio-baseline.before.sha256`（11 行，sha256sum 排序）。

| 段 | 文件 | 时长(s) | 窗口(s) | 余量 |
|---|---|---|---|---|
| S01 | s01.mp3 | 6.288 | 12 | 5.712 |
| S02 | s02.mp3 | 12.888 | 20 | 7.112 |
| S03 | s03.mp3 | 21.024 | 24 | 2.976 |
| S04 | s04.mp3 | 20.280 | 24 | 3.720 |
| S05 | s05.mp3 | 20.928 | 26 | 5.072 |
| S06 | s06.mp3 | 18.528 | 24 | 5.472 |
| S07 | s07.mp3 | 14.784 | 22 | 7.216 |
| S08 | s08.mp3 | 15.600 | 20 | 4.400 |
| S09 | s09.mp3 | 15.840 | 20 | 4.160 |
| S10 | s10.mp3 | 14.712 | 16 | 1.288 |
| S11 | s11.mp3 | 12.312 | 16 | 3.688 |

> 注：`timeline-check` 的约束是 `audioDuration + 0.8s ≤ windowSeconds`，故上表「余量」必须 ≥ 0.8。
> **S10 余量 1.288s 是全场最紧的一段**；S10 改写文案时字数上限最严（约 14 字/秒 × 14.7s 已接近上限）。

## 7. 本轮允许的最小修补白名单

见 `minimal_patches.md`。当前修补数 = **0**。

## 8. 复原判定（Task 13 用）

1. `ss -ltnp | grep -E ':(5174|8000)'` → 无输出
2. `docker ps --format '{{.Names}}' | grep -c learnrise` → `0`
3. `git -C LearnRise status --short` → 仍只有 `?? promo/video/scripts/fix-review-assets.py` + 本轮登记的 `promo/` 产物
4. `git -C /home/sky/竞赛/华为ICT rev-parse --short HEAD` → `f15f8fc`
5. 端口 5173/8080/55432/55433 均空闲（若 docker compose 未启动过）

## 9. R7 merge + stack bring-up

- merge commit: `f5a8629ab5bbe872e81a05bb42f2c654fb761102`（parents: `c035a87139477233b31acb810933afdff1e8091b` `9309670524606232f5b4a3e38f8a9efb5c3f58e0`）
- merge-base is-ancestor 9309670: OK（`NEWUI_BASE_OK`），合并 0 冲突
- PrepPage present: OK / QuizPage absent: OK / api/quiz.ts absent: OK
- promo scenes preserved: 11
- compose override: `docker-compose.recording.yml`（minio image pinned to `minio/minio:latest`，tracked `docker-compose.yml` 未改）
- services: 6 (db, minio, backend, ocr-service, frontend, nginx) all healthy
- frontend 5174: 200 / backend 8000 /api/health: 200 / nginx 8080: 200
- `docker ps --filter name=learnrise` count: 6
- 最终 `docker compose ps`（2026-11-07）：

```
NAME                      IMAGE                          COMMAND                   SERVICE       STATUS                    PORTS
learnrise-backend-1       learnrise-backend:latest       "sh -c 'alembic upgr…"   backend       Up 46 seconds (healthy)   0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp
learnrise-db-1            pgvector/pgvector:0.8.0-pg15   "docker-entrypoint.s…"   db            Up 51 seconds (healthy)   0.0.0.0:55433->5432/tcp, [::]:55433->5432/tcp
learnrise-frontend-1      learnrise-frontend             "docker-entrypoint.s…"   frontend      Up 35 seconds (healthy)   0.0.0.0:5174->5174/tcp, [::]:5174->5174/tcp
learnrise-minio-1         minio/minio:latest             "/usr/bin/docker-ent…"   minio         Up 51 seconds (healthy)   0.0.0.0:9000->9000/tcp, [::]:9000->9000/tcp, 0.0.0.0:19001->9001/tcp, [::]:19001->9001/tcp
learnrise-nginx-1         nginx:alpine                   "/docker-entrypoint.…"   nginx         Up 24 seconds (healthy)   0.0.0.0:8080->80/tcp, [::]:8080->80/tcp
learnrise-ocr-service-1   learnrise-ocr-service:latest   "uvicorn app.main:ap…"   ocr-service   Up 51 seconds (healthy)   0.0.0.0:8001->8001/tcp, [::]:8001->8001/tcp
```

## 10. Seed + live API verification（2026-11-07 实测）

### Seed（幂等性已证）
- run 1: `docker compose ... exec -T backend python scripts/seed_promo.py` → exit 0
  - 六用户 exists / 三竞赛 exists / invites `LR-2026 / LR-2026-C1 / LR-2026-C2`
  - main members: 4（仅学生）
  - source `第3章 应收款项及预防账款` exists, status=ready
  - knowledge points +0 (total 24) / questions +0 (total 100) / attempts rebuilt 402 / review cards rebuilt 18, logs 18
  - leaderboard: 小红 1000 / 小明 960 / 张三 916 / 李四 876
- run 2: exit 0，行数 dict 与 run1 **完全一致**（见下）→ 幂等成立
- 行数（run1 后 = run2 后）:
  `{'User': 35, 'Competition': 32, 'KnowledgeSource': 16, 'KnowledgePoint': 310, 'QuizQuestion': 130, 'ReviewCard': 32, 'ReviewLog': 24, 'QuizAttempt': 443}`

### Vite 实际服务的是新 UI
| 请求 | Content-Type | 结论 |
|---|---|---|
| `/src/pages/PrepPage.tsx` | `text/javascript` | 真实文件（新 UI 六标签备赛区） |
| `/src/pages/QuizPage.tsx` | `text/html`（SPA fallback） | **文件不存在**，已被删除 ✅ |
| `/src/App.tsx` 引用 | LeaderboardPage×3 / PrepPage×6 / ProfilePage×3 | 新路由已生效 |

> 注意：Vite dev server 对缺失的 `.tsx` 返回 index.html（200），因此**不能只看状态码**，必须看 `Content-Type`。

### 排行榜 API（真实鉴权后）
`POST /api/auth/login`（xiaohong@example.com + `.env.demo` 的 DEMO_PASSWORD）→ token `eyJhbGciOiJI...`

`GET /api/leaderboard/e298b09b-de28-432c-9e37-7376a5f31623` →

| rank | name | points | tier | division | avatarHue |
|---|---|---|---|---|---|
| 1 | 小红 | 1000 | 卓越 | IV | 300 |
| 2 | 小明 | 960 | 贯通 | I | 259 |
| 3 | 张三 | 916 | 贯通 | I | 264 |
| 4 | 李四 | 876 | 贯通 | I | 309 |

- 断言通过：4 行、points `[1000,960,916,876]`、rank `1..4`、姓名 小红/小明/张三/李四。
- `avatarUrl` 全为 null（无自定义头像）→ 排行榜使用 `avatarHue` 生成的确定性头像色。
- 结果已写入 `seed_facts.json` 的 `verifiedLive` 块。

### 本轮新增修补
**0**（仅 compose override 一项，已于 §9/`minimal_patches.md` 登记）

## 11. Recording harness（Task 4 实测）

### 交付文件
- `$FILM/scripts/record-scenes.mjs` — 11 场景真实交互定义（无 playwright 依赖）
- `$FILM/scripts/record-ui.mjs` — CLI：跑 playwright → 校验 11 段 → 写 `recordings/raw_manifest.json`
- `$LR/frontend/recording/record-ui.spec.ts` — 11 个 Playwright 用例（模块解析必须留在 frontend 内）
- `$LR/frontend/playwright.record.config.ts` — 1920×1080 / dsf=1 / video on / 5174 / workers 1
- `$FILM/recordings/raw/S01..S11.webm` — 11 段真实录屏

### `--list` 结果
`Total: 11 tests in 1 file`（S01…S11 各一条）

### 11 段原始录屏（ffprobe 实测）
全部 `1920×1080`；容器帧率 `25/1`（Playwright recordVideo 的 VFR 输出，Task 5 会转 CFR 30 并裁到精确帧数）；时长均 ≥ 目标 + 4s。

| scene | duration(s) | bytes |
|---|---|---|
| S01 | 16.92 | 2.03 MB |
| S02 | ~24 | 9.91 MB |
| S03 | ~28 | 2.01 MB |
| S04 | ~28 | 3.79 MB |
| S05 | ~30 | 6.50 MB |
| S06 | ~28 | 2.62 MB |
| S07 | ~26 | 3.91 MB |
| S08 | 24.12 | 3.53 MB |
| S09 | 28.80 | 4.94 MB |
| S10 | 20.24 | 1.62 MB |
| S11 | 20.32 | 2.13 MB |

### 录制中修复的 4 个真实问题（记录，避免复发）
1. `@playwright/test` 经 `$FILM` 符号链接解析 → Playwright 报 "did not expect test.beforeAll()"，`--list` 0 用例。**解法**：spec/config 放进 `LearnRise/frontend/`。
2. `[data-testid^="practice-kp-"]` 会同时匹配 `practice-kp-search` 输入框 → 首元素点错、开始按钮一直 disabled。**解法**：用 `label[data-testid^="practice-kp-"]`。
3. 陪练场景选中的知识点无题目 → 后端 409 `NO_QUESTIONS`。**解法**：录制前用 `POST /api/quiz/generate` 给可访问知识点补齐 mock 题目（演示数据，非代码改动）。
4. S11 看板雷达为空时 hover `radar-polygon` 会一直等元素 → 300s 超时。**解法**：`hoverIfPresent()` 先 count 再 hover（2.5s 短超时）。

### 演示数据补种（非 schema 改动）
为 3 个可访问知识点各生成 4 道 mock 选择题：
- `89cda61b…`（流量控制）、`d9d51a0c…`（三次握手位）、`cbdf399a…`（可靠传输位）
- 生成端点：`POST /api/quiz/generate`（201），随后 `POST /api/assistant/practice/sessions` → 201，陪练链路可用。
