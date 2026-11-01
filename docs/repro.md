# 复现记录

本文件记录「LearnRise」的可复现性验证。原则：**只写真实执行过的结果**；未执行的一律标
`PENDING（未执行）` 并给出完整命令清单，不虚构数字、不补写日志。

复现分三档：

| 记录 | 场景 | 状态 |
|---|---|---|
| 1 | 本机（Fedora 44）复制工作树 + 复用已构建镜像跑后端全量测试与 8 镜 demo | **已完成（真实执行）** |
| 2 | 干净目录从零 `docker compose build` 全量复现（不含预构建镜像） | **已完成（真实执行，PASS）** |
| 3 | 华为云 ECS 上按生产手册复现（含 `STARTUP_CHECKS=1` 与 huawei parity） | `PENDING（未执行）` |

---

## 记录 1：本机复制工作树 + 复用镜像（真实执行）

### 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-11-01 |
| 机器 | 本机开发机，16 vCPU，x86_64 |
| OS | Fedora Linux 44 (Workstation Edition)，内核 `7.2.13-200.fc44.x86_64` |
| 宿主 Python | 3.14.8（**不用于运行项目**；项目容器固定 3.11.9） |
| 容器 Python | 3.11.9 |
| Node / npm | v20.20.2 / 10.8.2 |
| Docker | 29.9.2（build a82e528） |
| Docker Compose | v5.6.1 |
| Git | `4e1e864`（执行时的 HEAD，含 Task 37 parity 提交；本文档在随后的 docs 提交中归档） |
| 数据库 | 复用已在运行的 `learnrise-db-1`（`pgvector/pgvector:pg15`，宿主 55432） |

### 步骤（按实际执行顺序）

```bash
# 1) 复制工作树（排除依赖、运行时数据、git 与构建产物）
mkdir -p /tmp/learnrise-repro
rsync -a --delete \
  --exclude node_modules --exclude var --exclude '.git' --exclude frontend/dist \
  /home/sky/竞赛/华为ICT/ /tmp/learnrise-repro/

# 2) 校验 compose 配置（不启动任何容器）
cd /tmp/learnrise-repro
docker compose config -q

# 3) 用已构建的 learnrise-backend 镜像，把复制后的 backend 挂载进容器跑全量测试
docker compose run --rm --no-deps -T \
  -v /tmp/learnrise-repro/backend:/app \
  backend pytest -q

# 4) 回到源工作树，跑 8 镜闭环（mock provider）
cd /home/sky/竞赛/华为ICT
make demo
```

### 结果

| 命令 | 结果 | 耗时 |
|---|---|---|
| `rsync` | exit 0 | 0.09 s |
| `docker compose config -q` | exit 0 | < 1 s |
| `pytest -q`（复制树，复用镜像） | **352 passed, 8 skipped, 2 warnings** | 测试 15.41 s；含容器启动 18.9 s（首跑冷缓存 50.91 s / 1 m 5.5 s） |
| `make demo`（源树） | **8/8 通过** | 脚本内 1 s；含 seed 与容器启动 3.7 s（首跑 4 s / 17.5 s） |

`make demo` 真实输出（最后一次执行，数据库已累积多次演示数据，故 `due` / 雷达项数比首跑大）：

```
[demo-seed] agent DeepSeek 官方: updated
[demo-seed] done
bash scripts/demo.sh
✓ 1/8 上传 /home/sky/竞赛/华为ICT/fixtures/lec01.pdf → job ready (1s)
✓ 2/8 生成笔记树 → 20 个知识点 (1s)
✓ 3/8 导图接口 → 20 个节点 (1s)
✓ 4/8 生成 3 道选择题 → model=mock-local (1s)
✓ 5/8 答错 3 题 → 卡片 3，出处 3 (1s)
✓ 6/8 复习提交 rating=4 → 下次 2026-11-03（今天 2026-11-01） (1s)
✓ 7/8 仪表盘 → due=13，雷达 12 项 (1s)
✓ 8/8 Agent 讲解 → 16 个 token 帧 + done (1s)
全部 8 个阶段通过，总耗时 1s
```

`pytest` 尾部真实输出：

```
352 passed, 8 skipped, 2 warnings in 15.41s
```

两次执行的差异只来自缓存与数据库累积数据，结论一致：全量测试通过，8 镜闭环通过。
完整命令与输出见 `.sisyphus/evidence/task-38-repro.txt`。

### 说明与限制（必须如实记录）

- **镜像为预构建**：直接使用了本机已有的 `learnrise-backend:latest`，**没有执行**
  `docker compose build --no-cache`。因此本次验证的是「代码 + 依赖版本 + 已构建镜像」的组合，
  不是「从零构建」的完整复现。从零构建见记录 2。
- **数据库容器复用**：`--no-deps` 没有启动新的 db，测试连到本机已在运行的
  `learnrise-db-1`。该库已有历史数据，测试自身会创建/清理所需数据；这不是干净空库验证。
- **首次尝试的失败**：第一次同步时，并行任务 37 的 `startup_checks` 处于编辑中状态，
  `tests/unit/test_startup_checks.py` 出现 3 个 `AttributeError`。同步最新文件后复跑通过。
  记录保留这一过程，说明复现结果依赖工作树一致性；提交前应确保 `git status` 干净或已同步。
- **8 个 skipped**：需要华为云凭据的契约测试（`requires_huawei` 标记）按设计跳过，
  不代表通过。真实调用状态见 `docs/huawei-services.md`。
- 全程使用 mock provider（`LLM_PROVIDER=mock` / `EMBEDDING_PROVIDER=mock`），
  不联网、不需要任何 Key；因此耗时与输出**不代表真实模型质量或延迟**。

对应证据：`.sisyphus/evidence/task-38-repro.txt`、`.sisyphus/evidence/task-38-verify.txt`。

---

## 记录 2：干净目录从零构建（已执行，PASS）

- **日期**：2026-11-01
- **机器**：本开发机（Linux，Fedora）
- **OS**：Fedora Linux（内核实测见证据文件）
- **Python（宿主）**：3.14.8（不使用；应用容器内为 3.11.9）
- **Node / npm**：v20.20.2 / 10.8.2
- **Docker / Compose**：29.9.2 / v5.6.1
- **隔离手法**：独立 compose project `learnrise-repro2` + 独立宿主端口
  （db 55433、backend 18000、frontend 15173、minio 19000/19010、ocr 18001），
  通过 `/tmp/repro2.override.yml` 覆盖，**该文件未提交**；不影响正在运行的 `learnrise` 项目。

### 步骤与实测耗时

| # | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 1 | `rsync -a --exclude node_modules --exclude var --exclude .git --exclude frontend/dist --exclude __pycache__ --exclude .sisyphus/evidence ./ /tmp/learnrise-clean-<ts>/` | PASS | <1s |
| 2 | `docker compose -p learnrise-repro2 -f docker-compose.yml -f /tmp/repro2.override.yml config -q` | PASS | <1s |
| 3 | `docker compose -p learnrise-repro2 ... build --no-cache backend ocr-service` | PASS | **602s** |
| 4 | `... up -d db backend ocr-service` → `GET /api/health` 200 | PASS | 19s |
| 5 | `... run --rm backend alembic upgrade head` | PASS（0001→0004） | ~5s |
| 6 | `... run --rm backend python scripts/seed_demo.py` | PASS（幂等） | ~3s |
| 7 | `BASE_URL=http://localhost:18000 bash scripts/demo.sh` | **8/8 PASS** | 1s |
| 8 | `... run --rm backend pytest -q` | **352 passed, 8 skipped** | 13.86s |
| 9 | `cd frontend && npm ci && npm run build && npx vitest run` | PASS；build 9.32s；**150 tests passed** | 17s（命中本机 npm 缓存） |
| 10 | `docker compose -p learnrise-repro2 ... down -v` | PASS（无残留容器） | — |

### 演示输出（真实）

```
✓ 1/8 上传 fixtures/lec01.pdf → job ready
✓ 2/8 生成笔记树 → 20 个知识点
✓ 3/8 导图接口 → 20 个节点
✓ 4/8 生成 3 道选择题 → model=mock-local
✓ 5/8 答错 3 题 → 卡片 3，出处 3
✓ 6/8 复习提交 rating=4 → 下次 2026-11-03
✓ 7/8 仪表盘 → due=2，雷达 1 项
✓ 8/8 Agent 讲解 → 16 个 token 帧 + done
全部 8 个阶段通过，总耗时 1s
```

### 诚实说明

- 构建使用 `--no-cache`（不复用镜像层），仅复用 BuildKit 的 pip 缓存挂载与 Tsinghua PyPI 镜像；
  首次冷缓存构建会更慢，但功能结果一致。
- `npm ci` 命中本机 npm 缓存，因此 17s；无缓存的新机器预计 1–3 分钟。
- 全程 mock provider（`LLM_PROVIDER=mock` / `EMBEDDING_PROVIDER=mock`），不联网、不需要 Key；
  8 个 skipped 是 `requires_huawei` 契约测试（无凭据），不代表通过。
- 真实模型质量、华为云部署仍未验证，见 `docs/huawei-services.md` 与 `docs/parity-report.md`。

**结论：PASS** —— 干净目录从零构建到 8 镜闭环演示全绿。
对应证据：`.sisyphus/evidence/task-38-repro.txt` 的 `[record2]` 段落。

---

## 记录 3：华为云 ECS 生产复现（PENDING，未执行）

**未执行原因**：本环境没有华为云账号与凭据（ECS/EIP、RDS、OBS、MaaS API Key、OCR AK/SK），
无法开通资源，也无法执行真实 parity。详见 `docs/huawei-services.md` 与
`.sisyphus/evidence/huawei-spike.md`。

具备账号后按 [docs/deploy.md](deploy.md) 执行，最小命令清单：

```bash
# 0) 前置：KooCLI / obsutil / psql 已配置，环境变量已导出（不要写入仓库）
export HUAWEI_AK=... HUAWEI_SK=... HUAWEI_PROJECT_ID=... REGION=cn-north-4

# 1) 资源开通（默认 dry-run；核对输出后加 --execute）
scripts/provision_huawei.sh
scripts/provision_huawei.sh --execute

# 2) 5 项 canary（真实 PASS 才可继续）
docker compose run --rm -T \
  -e MAAS_BASE_URL -e MAAS_API_KEY -e MAAS_REGION \
  -e RDS_URL -e HUAWEI_AK -e HUAWEI_SK -e HUAWEI_PROJECT_ID -e HUAWEI_REGION \
  -e OBS_ENDPOINT -e OBS_BUCKET -e OBS_ACCESS_KEY_ID -e OBS_SECRET_ACCESS_KEY \
  -v "$PWD:/repo:ro" -w /repo backend python scripts/huawei_canary.py --canary all

# 3) 生产配置与启动
cp .env.prod.example .env.prod
# 编辑 .env.prod：MAAS_*、OBS_*、DATABASE_URL(RDS)、JWT_SECRET、AGENT_SECRET_KEY、
# CRON_SIGNATURE_SECRET、DOMAIN 等；确保 STARTUP_CHECKS=1
chmod 600 .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml build web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d

# 4) 启动断言与健康检查
curl -fsS https://<domain>/healthz
docker compose --env-file .env.prod -f docker-compose.prod.yml logs backend | tail -50

# 5) 双 profile parity
PROVIDER_PROFILE=local  scripts/parity_check.sh
PROVIDER_PROFILE=huawei scripts/parity_check.sh

# 6) 线上 8 镜（指向 ECS 域名）
BASE_URL=https://<domain> DEMO_EMAIL=demo@example.com DEMO_PASSWORD=demo1234 \
  bash scripts/demo.sh
```

**通过判据**：

- 5 项 canary 全部 `PASS` 且 `exit=0`（任何 `BLOCKED`/`FAIL` 都不得继续）；
- `STARTUP_CHECKS=1` 下后端启动无 `RuntimeError`；
- 两个 profile 的 `parity_check.sh` 均 exit 0；
- 线上 `scripts/demo.sh` 8/8，SSE 逐 token 输出（不是一次性返回）；
- 控制台截图、资源 ID、账单页按 `docs/huawei-services.md` 的占位路径归档。

**待补证据**：`.sisyphus/evidence/wave-7/repro-huawei-ecs.txt`（尚未产生）。

---

## 附：环境信息采集命令

复跑前建议先记录环境，便于对照：

```bash
uname -srm
grep PRETTY_NAME /etc/os-release
python3 --version          # 宿主版本仅供参考，不用于运行
node --version && npm --version
docker --version && docker compose version
git rev-parse --short HEAD
git status --short
nproc
```

容器内版本：

```bash
docker compose run --rm --no-deps -T backend python -V
docker compose run --rm --no-deps -T backend sh -c 'ruff --version; mypy --version; pytest --version'
```
