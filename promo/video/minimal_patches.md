# minimal_patches.md — 本轮「最小必要修补」台账

> 规则：任何对应用源 / 配置 / 数据的改动都必须在此登记一行；未登记的文件出现在 `git -C LearnRise status --porcelain` 即视为越界。
> 当前修补数：**2**

## 修补台账

| # | 文件/路径 | 原因 | 命令 | 回滚 | 审批 |
|---|---|---|---|---|---|
| 1 | `LearnRise/docker-compose.recording.yml`（新增，untracked） | R7 合并后 `docker-compose.yml` 的 minio 镜像改为 `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`，本机未缓存该镜像；不改 tracked compose，仅用 override 把 minio 固定回本机已有的 `minio/minio:latest` 才能起栈 | `printf 'services:\n  minio:\n    image: minio/minio:latest\n' > docker-compose.recording.yml`；起栈用 `docker compose --env-file .env.demo -f docker-compose.yml -f docker-compose.recording.yml up -d` | `rm docker-compose.recording.yml` | 执行期授权，R3 最小修补 |
| 2 | `$FILM/node_modules/{playwright,playwright-core,@playwright/test}`（软链） | 录制脚手架需要 Playwright 1.64.1，而该版本仅装在 `LearnRise/frontend/node_modules`；建软链让 `$FILM` 下的 spec/config 可解析，且不联网安装 | `mkdir -p $FILM/node_modules/@playwright && ln -sfn $LR/frontend/node_modules/playwright $FILM/node_modules/playwright && ln -sfn $LR/frontend/node_modules/playwright-core $FILM/node_modules/playwright-core && ln -sfn $LR/frontend/node_modules/@playwright/test $FILM/node_modules/@playwright/test` | `rm $FILM/node_modules/playwright $FILM/node_modules/playwright-core $FILM/node_modules/@playwright/test` | 执行期授权，R3 最小修补 |

## Whitelist（本轮唯一允许修补的范围）

1. `$FILM/scripts/**` —— 录制脚手架（`record-ui.mjs`、`playwright.record.config.ts`）与切片/校验辅助脚本
2. `$FILM/public/clips/**` —— 生成的 11 段 clip 产物（不进 git）
3. 浏览器上下文注入：`addInitScript` / `page.clock` / `prefers-reduced-motion` / localStorage 预置 —— **只能写在录制脚本里**，严禁写入 Remotion `src/**`
4. `$FILM` 下的种子事实文件（`seed_facts.json`）
5. 展示层处置：`$LearnRise/frontend/src/**` —— **仅在录制被证明阻塞且经用户批准时**才允许，且必须登记回滚

## Forbidden scopes（禁止触碰）

- `$LearnRise/backend/app/**`（业务代码）
- `$LearnRise/backend/alembic/**`（迁移/schema）
- `openapi.json` / API 契约 / 端点语义
- `$LearnRise/frontend/src/**`（除第 5 条已批准且已登记的展示层修补）
- `/home/sky/文档` 父级 git 仓库（禁止任何 git 操作）
- `docker-compose.yml` 的端口/服务定义
- `src/content/facts.ts` 的数字（67/77/498/490/8/6）

## 记录格式（新增修补时复制此行并填满）

```
| 1 | <相对路径> | <为什么必须改，不改会阻塞什么> | <产生改动的那条命令/脚本> | <如何复原：git checkout -- <path> / 删除文件> | <用户批准时间/原话摘要> |
```

## 判定命令（Task 13/F3 复用）

```bash
# 1) LearnRise 工作区只应出现已登记文件
git -C /home/sky/竞赛/华为ICT/LearnRise status --porcelain
# 2) 台账外的文件数必须为 0
# 3) 父仓库 HEAD 不变
git -C /home/sky/竞赛/华为ICT rev-parse --short HEAD   # f15f8fc
```

## 实际登记修补

| # | 文件/路径 | 原因 | 命令 | 回滚 | 审批 |
|---|---|---|---|---|---|
| 1 | `LearnRise/docker-compose.recording.yml`（untracked） | R7 merge 把 minio 镜像改成 `pgsty/silo:RELEASE.2026-09-16...`，本机无此镜像且不联网拉取；用 override 固定回本地已有的 `minio/minio:latest`，不改受控 `docker-compose.yml` | `docker compose --env-file .env.demo -f docker-compose.yml -f docker-compose.recording.yml up -d` | `rm LearnRise/docker-compose.recording.yml` | 执行期授权（R3 最小修补） |
| 2 | `$FILM/node_modules/{playwright,playwright-core,@playwright/test}` → `$LR/frontend/node_modules/*` 符号链接 | Playwright 1.64.1 只装在 `LearnRise/frontend`，`$FILM` 无本地安装；符号链接使 `@playwright/test` 可解析且与浏览器版本一致（不联网新装） | `ln -sfn ...`（见 Task 4 记录） | `rm $FILM/node_modules/playwright $FILM/node_modules/playwright-core $FILM/node_modules/@playwright/test` | 执行期授权（录制脚手架） |
| 3 | `LearnRise/frontend/recording/record-ui.spec.ts` + `LearnRise/frontend/playwright.record.config.ts`（均为新增 untracked） | `@playwright/test` 在 `$FILM` 经符号链接解析会被识别成第二个实例（`test.beforeAll() ... here` 报错）；把 spec/config 放进 `frontend/` 才能单实例运行。**不修改** `playwright.config.ts`，不触碰 `src/**` | `cd LearnRise/frontend && npx playwright test --config playwright.record.config.ts` | `rm -rf LearnRise/frontend/recording LearnRise/frontend/playwright.record.config.ts` | 执行期授权（录制脚手架） |
