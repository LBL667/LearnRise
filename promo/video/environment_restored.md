# environment_restored.md — 停栈与环境复原（Task 13）

复原时间：2026-11-08T01:34:17+08:00

## 1. 停栈

```bash
docker compose --env-file .env.demo -f docker-compose.yml -f docker-compose.recording.yml down
```

结果：

- 6 个容器全部 Removed；网络 `learnrise_default` Removed。
- `docker ps | grep -c learnrise` → `0`
- `ss -ltnp | grep -E ':(5174|8000)'` → 无输出
- 5173 / 8080 / 55432 / 55433 亦无监听

## 2. 与基线（environment_baseline.md §1–§3）对照

| 项 | 基线 | 复原后 | 一致 |
|---|---|---|---|
| 端口 5174/8000/8080/5173 | 空闲 | 空闲 | ✅ |
| learnrise 容器数 | 0 | 0 | ✅ |
| 父仓库 HEAD | `f15f8fc` | `f15f8fc` | ✅ |
| `LearnRise` 分支 | `promo/learnrise-video-mockups` | 同（已含 merge `f5a8629` 与本轮提交） | ✅ |
| 遗留未跟踪文件 | `promo/video/scripts/fix-review-assets.py` | 同（另加本轮已登记脚手架） | ✅ |

## 3. 可回滚修补

见 `minimal_patches.md` 第 1–3 条：

1. `LearnRise/docker-compose.recording.yml` → `rm`
2. `/node_modules/{playwright,playwright-core,@playwright/test}` 符号链接 → `rm`
3. `LearnRise/frontend/recording/` + `playwright.record.config.ts` → `rm -rf`

> 停栈后这三个脚手架仍保留在磁盘上（便于复录），但**不进入 git**；还原命令见 `minimal_patches.md`。

## 4. 演示数据

- `seed_promo.py` 幂等灌入的 6 用户 / 3 竞赛 / 主竞赛排行榜保留在 `learnrise` 数据卷中（`docker compose down` 不删卷）。
- 为陪练链路补的 3×4 道 mock 题同样保留。
- 若要彻底清空：`docker compose down -v`（**不在本轮回滚范围**，因为下一轮演示仍需数据）。
