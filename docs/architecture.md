# 架构设计

本文描述「LearnRise」的分层、依赖规则、闭环数据流、SSE 路径、部署拓扑、安全模型，以及
保证云无关性的 CI 不变量。目标读者是维护者与评审：读完应能指出任一需求应落在哪一层。

---

## 1. 分层

```
backend/app/
├── api/            HTTP 边界：路由、鉴权、请求校验、响应模型、SSE 封装
├── services/       领域逻辑：解析、切片、笔记、出题、DSR、聚合、邮件、Agent 解析
├── ports/          抽象接口（typing.Protocol）：LLM / Embedding / VectorStore /
│                   ObjectStorage / OCR / Scheduler / EmailSender / AgentResolver
├── adapters/       具体实现：mock、openai_compatible、maas、pgvector、minio、obs、
│                   local、paddle、huawei
├── security/       Fernet 加解密、密钥掩码、日志脱敏
├── models/         SQLAlchemy ORM
├── worker/         APScheduler 独立进程（不在 web 进程内启动）
├── config.py       pydantic-settings，环境变量唯一来源
├── db.py           引擎 / Session
└── main.py         应用工厂 + 路由自动发现
```

依赖方向：

```
api  ──►  services  ──►  ports  ◄──  adapters  ──►  外部服务
 │            │
 └────────────┴──►  models / config / security
```

### 1.1 依赖倒置规则

1. `services/` 只依赖 `ports/` 里的 Protocol，不 import 任何厂商 SDK。
2. `adapters/` 实现 Protocol，可以 import 厂商 SDK，但不得反向依赖 `api/`。
3. `api/` 负责把 HTTP 语义翻译成 service 调用；不写业务规则（例如 DSR 数学、切片边界）。
4. `config.py` 是所有配置的唯一入口；适配器工厂（`adapters/*/factory.py`）根据
   `settings` 选择实现，业务代码不感知具体类。
5. 领域纯函数优先：DSR 计算、切片、Agent 解析、密码学与掩码都有冻结时钟 / 无 DB 的单元测试。

工厂选择规则（真实实现）：

| 能力 | 工厂 | 识别值 |
|---|---|---|
| LLM | `adapters/llm/factory.py` | `mock` / `offline` → MockLLM；`maas` / `modelarts` / `huawei*` → MaaS；其余 → OpenAI-compatible；配置了 fallback 时包一层 `FallbackLLM` |
| Embedding | `adapters/embedding/factory.py` | `openai_compatible` / `local` / `mock`（`offline`、`hash` 视为 mock） |
| VectorStore | `adapters/vector/factory.py` | 永远 `PgVectorStore`，local 与 huawei 只差 `DATABASE_URL` |
| Storage | `adapters/storage/factory.py` | `local` / `minio` / `obs`，未知值直接抛错，不静默回退 |
| OCR | `adapters/ocr/factory.py` | `paddle`（本地 HTTP 服务）/ `huawei`（RecognizeHandwriting） |

`PROVIDER_PROFILE` 只决定「留空时的默认档位」：`huawei` 时 LLM 默认 MaaS，其它默认
OpenAI-compatible。显式的 `LLM_PROVIDER` / `EMBEDDING_PROVIDER` 等永远优先。

---

## 2. 闭环数据流

```
上传 ──► 解析 ──► 切片 ──► 向量化 ──► 入库
                                        │
                    ┌───────────────────┴──────────────────┐
                    ▼                                      ▼
              生成笔记树（知识点）                     RAG 检索（pgvector）
                    │                                      │
          ┌─────────┼──────────┐                           │
          ▼         ▼          ▼                           ▼
       思维导图    出题       Agent 讲解 ◄──────────── 知识点 / 出处切片
                    │
                    ▼
              答题（对/错）
                    │ 错题
                    ▼
              复习卡片（DSR）
                    │
                    ▼
              到期列表 ──► 评分 ──► 下次到期日
                    │
                    ▼
              仪表盘聚合 / 每日邮件提醒
```

关键路径与代码：

1. **摄入**：`POST /api/sources/upload` → `services/ingest.py` 落原始文件（Storage），
   创建 job；解析（`services/parsing.py`，PDF 文本层用 PyMuPDF，扫描页走 OCR）→
   切片（`services/chunking.py`）→ embedding → 写入 `chunks`（pgvector）。
   `GET /api/jobs/{id}` 轮询到 `ready` / `failed`。
2. **笔记树**：`POST /api/sources/{id}/notes` → `services/notes.py` 调 LLM，产出层级知识点；
   知识点带来源切片引用，供「答错看出处」使用。
3. **检索**：`GET /api/knowledge-points/search` 与 `GET /api/knowledge-points`；
   向量检索走 `VectorStore.search`，`PgVectorStore` 是唯一实现。
4. **出题**：`POST /api/quiz/generate` → `services/quiz.py`；`POST /api/quiz/{id}/answer`
   → `services/answer.py` 判定并返回 `source_chunk`；错题触发 `services/cards.py` 建卡。
5. **复习**：`GET /api/review/due`、`POST /api/review/{card_id}/submit`；
   `services/dsr.py` 是纯函数调度器（`dsr_lite`），评分写入新的到期日。
6. **仪表盘**：`GET /api/dashboard/summary` → `services/dashboard.py` 聚合到期数、连续天数、
   掌握度雷达、遗忘曲线、难度分布、90 天热力图。
7. **提醒**：`python -m app.worker.scheduler` 每日 08:00（`TIMEZONE`）调用
   `services/email.py:run_reminders`；PG advisory lock + `email_reminders` 唯一约束双重幂等。
   华为云由 FunctionGraph 定时触发器调用 `POST /internal/reminders/run`（HMAC 签名）。

---

## 3. SSE 路径

讲解是唯一的流式接口：

```
浏览器
  │ POST /api/knowledge-points/{kp_id}/explain   (Authorization: Bearer <JWT>)
  ▼
nginx（生产）或 Vite dev proxy
  │ /api 反代；proxy_buffering off；gzip off
  ▼
FastAPI  explain.py
  │ 解析 Agent（用户指定 agent_id 或默认 Agent）
  │ 解密该 Agent 的 API Key（Fernet）→ 构造 LLMProvider
  │ 按 agent / user 维度取信号量，限制并发
  ▼
LLMProvider.stream(messages)（在线程池中迭代同步流）
  │ event: token  data: {"text": "..."}   ← 多个
  │ event: done   data: {"chars": N}
  │ event: error  data: {"message": "..."}  ← 失败时
  ▼
浏览器 EventSource / fetch 流式读取
```

约束：

- SSE **不能**经过 CDN 或 OBS：它们会缓冲/改写响应。生产只走 ECS 上的 nginx 直连。
- nginx 必须关闭 `proxy_buffering` 与 `gzip`，并放宽读超时。
- 鉴权在建立流之前完成；流内不再做身份判断。
- 失败映射为稳定文案：鉴权失败、限流、超时、通用失败，不向上游回显原始错误或密钥。
- 每次讲解（成功或失败）写入解释日志，记录 `model`、字符数、状态与错误类别，便于仪表盘与审计。

---

## 4. 部署拓扑与区域

```
Internet ──443──► EIP ──► ECS (cn-north-4)
                            ├── nginx: TLS、静态 SPA、/api 反代、SSE 不缓冲
                            ├── backend:8000（仅 compose 内网）
                            └── (可选) ocr-service:8001
                                   │ 5432 私网
                                   ▼
                            RDS PostgreSQL 15 + pgvector (cn-north-4)
                                   │ 443
                                   ▼
                    OBS (cn-north-4)    MaaS (cn-southwest-2，经 EIP/NAT)
```

| 资源 | 区域 | 理由 |
|---|---|---|
| VPC / ECS / EIP / RDS / OBS / DNS | cn-north-4（北京四） | 主站与数据同区，RDS 走私网 |
| ModelArts MaaS | cn-southwest-2（贵阳一） | 当前唯一供给区域 |
| 手写 OCR | cn-north-4 | 该服务只在华北-北京四提供 |

设计取舍：

- **同一套 compose** 本地与 ECS 运行；生产用 `docker-compose.prod.yml` 覆盖端口、镜像与
  环境变量，不复制业务代码。
- **向量维度锁定 1024**：`bge-m3` 在 MaaS 与第三方同维，迁移不需要重新嵌入。
- **扩展安装按 profile 分流**：本地 `CREATE EXTENSION vector`，RDS 用
  `SELECT control_extension('create','vector')`；Alembic 迁移本身不建扩展。
- **SSE 与 API 同源**：前端 `baseURL: '/api'`，避免 CORS 与跨域 SSE 的兼容问题。
- 生产可设 `STARTUP_CHECKS=1`，启动时断言 `EMBEDDING_DIM=1024`、`vector` 扩展、
  `chunks.embedding` 为 `vector(1024)`、Alembic 单头且版本一致、存储后端可达；任一不符
  `create_app` 抛错，进程退出非 0。

---

## 5. 安全模型

| 面 | 机制 | 实现 |
|---|---|---|
| 身份认证 | JWT（HS256，可配过期时间） | `api/auth.py`、`deps.py`；`Authorization: Bearer` |
| 横向越权 | 所有资源查询都带 `user_id` 过滤；`require_owner` 二次校验 | `deps.py:require_owner` |
| Agent 密钥 | Fernet 对称加密存库；API 只返回掩码 `sk-****abcd` | `security/crypto.py`、`api/agents.py` |
| 日志泄漏 | logging filter 屏蔽 `api_key`、`Authorization`、`Bearer` 等模式 | `security/redaction.py`，`create_app` 时安装 |
| SSRF | 用户提供的 `base_url` 必须 HTTPS、无 userinfo、端口合法，且 DNS 解析出的**每个**地址都必须是全局可路由；拒绝回环、RFC1918、链路本地、`169.254.169.254`、CGNAT 等 | `services/agent_security.py` |
| 上游错误回显 | 只返回类别化文案（鉴权失败 / 限流 / 超时 / 通用失败） | `api/explain.py`、`api/agents.py` |
| 并发保护 | 按 agent / user 取信号量，限制单 Agent 并发流 | `api/explain.py` |
| 内部端点 | `/internal/reminders/run` 不走用户 JWT，改用 HMAC-SHA256（时间戳 + 原始请求体），带重放缓存与 ±300s 时钟窗口 | `api/internal.py`、`scripts/functiongraph/handler.py` |
| 上传 | 大小上限 `MAX_UPLOAD_MB`、类型白名单、OCR 格式与尺寸校验 | `api/sources.py`、`ocr-service` |
| 邮件 | 密码不落日志；SMTP 失败不抛出而是记录状态 | `services/email.py` |
| 密钥入库 | `.env` 忽略、gitleaks 扫描、占位值白名单 | `.gitignore`、`.gitleaks.toml` |

原则：**不可信输入只在一处校验，失败一律 fail closed**。例如 `base_url` 非法时直接 422，
不会回退到默认端点；`STORAGE_PROVIDER` 拼错时启动即报错，不会静默写本地磁盘。

---

## 6. 云无关性不变量与 CI gate

**不变量**：`backend/app/adapters/` 之外的任何 Python 文件都不得 import 厂商 SDK
（`openai`、`huaweicloudsdk*`、`obs`、`minio`、`boto3`）。

强制手段是 [`scripts/check_import_isolation.sh`](../scripts/check_import_isolation.sh)：

```bash
scripts/check_import_isolation.sh
# isolation: clean (no forbidden imports outside backend/app/adapters/)
```

脚本扫描 `backend/app/**/*.py`，排除 `backend/app/adapters/`，用
`^\s*(import|from)\s+(huaweicloudsdk...|openai|boto3|minio|obs)` 匹配违规并以
`文件:行号` 输出、退出 1。CI（`.pre-commit-config.yaml` / 流水线）调用它，
因此「业务层直连华为云」在合并前就会被拦下。

配套约束：

- 厂商 SDK 是可选依赖 `backend/pyproject.toml` 的 `[project.optional-dependencies].huawei`，
  默认镜像不安装；只有 `PROVIDER_PROFILE=huawei` 且需要 OBS/OCR 时才安装。
- 新增 Provider 的步骤固定：先加 `ports/` Protocol，再写 `adapters/` 实现，最后在 factory
  注册；`services/` 不需要改动。
- 契约测试（`backend/tests/contracts/`）对同一套用例参数化 `PROVIDER_PROFILE`，
  local 与 huawei 的差异只能体现在环境变量与凭据，不能体现在接口形状。

---

## 7. 关键设计决策

| 决策 | 原因 | 代价 |
|---|---|---|
| 自建 Provider 层而非直接用 SDK | 换云不改业务代码，评审可验证 | 多一层抽象与契约测试 |
| mock 作为默认 provider | 无 Key 可演示、CI 稳定、离线可复现 | 演示质量不代表真实模型 |
| 向量维度固定 1024 | local / huawei 同构，迁移零重嵌入 | 换模型需重建索引 |
| OCR 独立容器 | 依赖重、模型大，隔离构建与故障 | 多一个服务与网络跳转 |
| APScheduler 独立进程 | 避免 uvicorn 多 worker 重复发信 | 单节点，需 PG advisory lock 兜底 |
| FunctionGraph 只做触发器 | 规避 VPC 无公网出口与函数冷启动直连 DB 的问题 | 多一跳 HMAC 请求 |
| 思维导图 render-only | 控制 MVP 范围 | 用户不能编辑节点 |
| SSE 直连 ECS | CDN/OBS 会缓冲，破坏流式 | 不能用 CDN 分担讲解流量 |
