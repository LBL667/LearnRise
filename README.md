# LearnRise 学习竞赛平台

以「团队竞赛」为组织方式的学习闭环：**建赛 → 上传资料 → 知识库 → 结构化笔记 → 智能出题 → 间隔复习 → 学习助手 → 排行榜**。

同一套业务代码与云厂商解耦：领域层只依赖 `ports/` 里的 Protocol，具体实现放在 `adapters/`，
因此可以在本地 Docker（零外部依赖）与云端托管服务之间切换，而不改动业务逻辑。

---

## 当前状态

> **迁移中（in progress）**。本仓库正在从两套独立工程合并为单一仓库，请以本节为准判断可用性。

| 部分 | 状态 |
|---|---|
| 后端（FastAPI） | ✅ 已并入本仓库；容器内测试全绿：**360 collected / 352 passed / 8 skipped / 0 failed** |
| 编排（Docker Compose / nginx） | ✅ 单套 compose，6 个服务全部 healthy；SSE 已确认不被缓冲 |
| API 契约与文档 | ✅ `openapi.json` + `docs/api/` 由脚本生成，可零漂移复现（27 个 path / 33 个 operation） |
| 前端（React） | 🚧 页面骨架与交互已就绪，**部分页面仍在读 mock 数据**，正按纵向切片逐个切换到真实接口 |
| 竞赛域 / 学习助手 / 试炼 / 诊断 | 🚧 设计已定稿，接口按切片逐个落地（尚未全部上线） |
| 华为云适配器 | ⛔ **未实现**，仅保留 `ports/` 抽象与 `PROVIDER_PROFILE` 开关位 |

没有「已上线」的部署：本仓库当前只保证**本地 Docker 全链路可运行**。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + React Router 7 |
| 后端 | FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 |
| 数据库 | PostgreSQL 15 + pgvector（`chunks.embedding` 1024 维 + HNSW） |
| OCR | 独立容器，RapidOCR（PP-OCR ONNX 模型）经 HTTP 调用 |
| 反代 | nginx（`/` → Vite dev server，`/api` → FastAPI，SSE 关闭缓冲） |
| 编排 | 单套 Docker Compose（`docker-compose.yml`，project `learnrise`） |

---

## 架构

```mermaid
flowchart TB
  subgraph Browser["浏览器"]
    UI["React 19 SPA"]
  end

  subgraph Edge["入口"]
    NGINX["nginx :8080<br/>/ → frontend:5174<br/>/api → backend:8000<br/>SSE 不缓冲"]
  end

  subgraph App["backend/app（FastAPI）"]
    API["api/<br/>路由 + 鉴权 + 校验"]
    SVC["services/<br/>领域逻辑"]
    PORTS["ports/<br/>Protocol 接口"]
    SEC["security/<br/>Fernet / 掩码 / 脱敏"]
  end

  subgraph Adapters["adapters/（唯一允许 import 厂商 SDK 的层）"]
    ALLM["llm/"]
    AEMB["embedding/"]
    AVEC["vector/"]
    ASTO["storage/"]
    AOCR["ocr/"]
  end

  subgraph Infra["基础设施"]
    PG[("PostgreSQL 15<br/>+ pgvector")]
    FS[("MinIO / 本地磁盘")]
    OCR["ocr-service :8001"]
    LLM["OpenAI 兼容端点<br/>或 mock"]
  end

  UI --> NGINX
  NGINX --> API
  API --> SVC
  API --> SEC
  SVC --> PORTS
  PORTS --> ALLM
  PORTS --> AEMB
  PORTS --> AVEC
  PORTS --> ASTO
  PORTS --> AOCR
  SVC --> PG
  AVEC --> PG
  ASTO --> FS
  AOCR --> OCR
  ALLM --> LLM
  AEMB --> LLM
```

依赖方向固定为 **`api → services → ports ← adapters → 外部服务`**。
业务层永远不 import 具体 SDK；`scripts/check_import_isolation.sh` 会机械地守住这条边界。

---

## 目录结构

```
backend/            FastAPI 应用（Python 3.11，容器内运行）
  app/api/          路由层：按模块自动发现，router 自带 prefix/tags
  app/services/     领域逻辑（纯函数优先）
  app/models/       SQLAlchemy 模型
  app/ports/        对外部能力的 Protocol 定义
  app/adapters/     唯一允许出现厂商 SDK 的目录（llm/embedding/vector/storage/ocr）
  app/security/     加密、掩码、日志脱敏
  app/worker/       定时任务（APScheduler）
  alembic/          数据库迁移（versions/0001…0004）
  tests/            unit / services / api / contracts 四层
  scripts/          种子数据与运维脚本
frontend/           React 19 + Vite 单页应用
  src/api/          请求层与域注册（真实接口 / mock）
  src/pages/        页面
  src/components/   组件（layout / competition / create / plan / prep / ui）
ocr-service/        RapidOCR HTTP 服务（独立镜像）
deploy/             nginx 配置、Web 镜像、systemd 单元
docs/               架构、部署、复现、限制等文档
docs/api/           由 OpenAPI 生成的接口文档（勿手改）
scripts/            CI 闸门、API 文档生成、演示与运维脚本
fixtures/           演示用 PDF / 图片（合成数据）
```

---

## 快速开始

前置：Docker + Compose v2 以上，约 8 GB 内存、3 GB 磁盘。

```bash
# 1) 启动全部服务（db / minio / backend / ocr-service / frontend / nginx）
docker compose up -d --build

# 2) 等健康检查变绿（6 个服务都应是 healthy）
docker compose ps

# 3) 写入演示数据（幂等，可重复执行）
docker compose exec -T backend python scripts/seed_demo.py
```

> **首次启动（或数据库用户/库名变更后）必须先 `docker compose down -v`。**
> PostgreSQL 的数据目录不会自动应用新的 `POSTGRES_USER` / `POSTGRES_DB`，
> 复用旧卷会导致后端启动即报认证失败。

后端容器启动时会自动执行 `alembic upgrade head`，无需手工迁移。

### 访问地址

| 服务 | 地址 |
|---|---|
| Web（经 nginx） | http://localhost:8080 |
| Vite dev server | http://localhost:5174 |
| API 文档（Swagger） | http://localhost:8000/api/docs |
| 健康检查 | http://localhost:8000/api/health |
| OCR | http://localhost:8001/health |
| MinIO 控制台 | http://localhost:19001（`minioadmin` / `minioadmin`） |
| PostgreSQL | `localhost:55433`（`learnrise` / `learnrise`） |

演示账号：`demo@example.com` / `demo1234`（仅本地，由种子脚本写入）。

---

## 常用命令

```bash
make up            # docker compose up -d --build
make down          # 停止并移除容器（保留卷）
make logs          # 跟随日志
make test          # 容器内跑后端全量 pytest
make lint          # 容器内跑 ruff + mypy
make migrate       # alembic upgrade head
make demo          # 种子数据 + 端到端冒烟
make compose-check # 校验 compose 文件可解析
```

`make verify` 是提交前的一站式门禁：三道闸门 + ruff + mypy + 容器内 pytest（并对基线做回归比对）
+ 前端 `tsc --noEmit` 与 `vite build` + gitleaks。它**要求工作区已提交干净**（最后一步会校验
`git status` 为空），因此请在 `git commit` 之后运行。

> 后端测试**必须**在容器内运行：宿主机 Python 版本与本项目固定的 3.11 不一致，
> 且测试直接连接数据库。请使用 `docker compose run --rm backend pytest -q`。

测试基线记录在 `scripts/test-baseline.json`：`passed` 只允许增加，`skipped` 只允许减少，
`failed` / `errors` 必须为 0。任何存量断言的变更都要在任务行与提交正文里登记理由。

---

## API 文档

- **契约真源**：FastAPI 应用本身 → `openapi.json`（仓库根，由脚本导出）。
- **生成文档**：`docs/api/*.md`，按 tag 分文件，每个端点含鉴权、请求/响应字段表、错误码与 curl 示例。
- **生成物禁止手改**：每个生成文件头部都有 `GENERATED BY scripts/gen_api_docs.py — DO NOT EDIT`。

重新生成（幂等，连跑两次 `git diff` 应为空）：

```bash
docker compose run --rm -v "$PWD:/repo" -w /repo backend python scripts/gen_api_docs.py
```

- 新端点的统一规范见 [`docs/api/conventions.md`](docs/api/conventions.md)：错误体 `{code, detail}`、
  分页 `limit`/`offset` + `X-Total-Count`、时间 ISO-8601、越权一律返回 404 而非 403。
- 存量端点保持路径、状态码与 `detail` 文案逐字不变（`code` 只作为新增字段出现在新端点上）。

---

## 质量闸门

三道机械闸门，均已注册到 `.pre-commit-config.yaml`：

| 脚本 | 作用 |
|---|---|
| `scripts/check_legacy_name.sh` | 旧项目名零残留：内容、文件名、二进制、分支名、提交信息五类扫描 |
| `scripts/check_repo_hygiene.sh` | 工作区必须干净；diff 在白名单内；不跟踪 `node_modules/.venv/dist/var`；仓库内只有一个 `.git`；无未申报的大文件 |
| `scripts/check_import_isolation.sh` | 厂商 SDK（华为云 / openai / boto3 / minio / obs）只允许出现在 `backend/app/adapters/` 内 |

```bash
bash scripts/check_legacy_name.sh
bash scripts/check_repo_hygiene.sh
bash scripts/check_import_isolation.sh
```

---

## 环境变量

- 完整模板：[`.env.example`](.env.example)（接真实模型时使用）。
- 离线演示档：[`.env.demo`](.env.demo)（默认 `mock` provider，**零 Key 即可跑通全链路**）。

`mock` 是确定性的离线实现（同一输入同一输出、不联网），用于演示与测试；
返回体的 `model` 字段会明确标注 `mock-local`，不会伪装成真实模型。

`.env` 已被 `.gitignore` 忽略，**任何密钥都不要写进仓库**。

---

## 贡献

提交规范、提交粒度、生成物处理与提交前检查见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
要点：Conventional Commits；一次提交只做一件事；重命名与逻辑改动分开提交；依赖变更单独提交。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | 分层、依赖倒置、数据流、SSE、安全模型 |
| [`docs/api/README.md`](docs/api/README.md) | 接口文档的生成方式与预览方法 |
| [`docs/api/conventions.md`](docs/api/conventions.md) | 新端点的错误码、分页、鉴权与题型映射约定 |
| [`docs/deploy.md`](docs/deploy.md) | 部署手册（ECS / 数据库 / 对象存储 / nginx / 证书） |
| [`docs/privacy.md`](docs/privacy.md) | 数据脱敏与隐私边界 |
| [`docs/limitations.md`](docs/limitations.md) | 已知偏差、替代实现与未验证项 |
| [`docs/scope.md`](docs/scope.md) | 范围冻结与演示脚本 |
| [`docs/repro.md`](docs/repro.md) | 可复现性记录（只写真实执行过的结果） |
| [`docs/parity-report.md`](docs/parity-report.md) | 双 profile 契约对比结果 |
| [`docs/functiongraph.md`](docs/functiongraph.md) | 定时触发器与签名内部端点契约 |

---

## 许可与数据

`fixtures/` 内为合成演示数据，不含真实个人信息。运行时不抓取用户数据；
上传文件只写入配置的对象存储。隐私策略见 [`docs/privacy.md`](docs/privacy.md)。
