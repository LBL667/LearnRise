# Provider Parity 报告（local vs huawei）

同一套代码、同一套检查脚本，分别在 `PROVIDER_PROFILE=local` 与 `PROVIDER_PROFILE=huawei`
下运行 `scripts/parity_check.sh`。报告中的延迟全部来自本机实测（未取平均、未编造），
原始输出见 `.sisyphus/evidence/task-37-local.txt` 与 `.sisyphus/evidence/task-37-huawei.txt`。

- 运行日期：2026-11-01
- 本机栈：`docker compose up -d`（pgvector/pgvector:pg15、MinIO、Paddle/RapidOCR 服务、backend）
- local profile：`LLM_PROVIDER=mock`、`EMBEDDING_PROVIDER=mock`、`STORAGE_PROVIDER=local`
- huawei profile：**无凭据，全部检查 SKIP，退出码 3（BLOCKED）**

## 结果总表

| # | 检查 | local | local 延迟 | huawei | huawei 延迟 | 说明 |
|---|------|-------|-----------:|--------|------------:|------|
| 1 | health (`GET /api/health`) | PASS | 272 ms | SKIP | — | huawei 需要可访问的部署与 MaaS 凭据 |
| 2 | db vector extension | PASS | 119 ms | SKIP | — | local 扩展版本 `vector=0.8.7` |
| 3 | alembic 单 head + revision 一致 | PASS | 2222 ms | SKIP | — | `0004_quiz_attempts`，heads=1 |
| 4 | vector upsert + search（1024 维） | PASS | 1035 ms | SKIP | — | 自建唯一 source，测后删除；score=1.0000 |
| 5 | embedding 维度 | PASS | 627 ms | SKIP | — | `mock-hash` / 1024（离线） |
| 6 | LLM provider 可达 | PASS | 597 ms | SKIP | — | `mock`（离线，无网络调用） |
| 7 | storage put/get/sign | PASS | 680 ms | SKIP | — | local 磁盘，`sign` 为静态 URL |
| 8 | OCR `/health` | PASS | 293 ms | SKIP | — | `rapidocr-onnxruntime` 返回 ok |
| 9 | internal reminder 签名 | PASS | 2205 ms | SKIP | — | 篡改签名→401 未认证；有效签名+过期时间戳→401 签名已过期（不触发提醒副作用） |
| | **合计** | **9/9 PASS** | **8149 ms** | **0/9 实跑** | **—** | `local_exit=0`，`huawei_exit=3` |

> **huawei 列当前为 SKIP（无凭据）。** 本环境没有 `MAAS_API_KEY`、`RDS_URL`、OBS 与
> `HUAWEI_AK/SK`，脚本按每项检查实际缺失的变量输出
> `SKIP(huawei): missing ...`，并以退出码 **3** 表示 “blocked”，绝不伪装成 PASS。
> 计划中 “huawei 脚本 exit 0” 的验收项因此仍未满足；阻塞项记录在
> `.sisyphus/notepads/learnrise-merge/issues.md`。

### 退出码约定

| 退出码 | 含义 |
|--------|------|
| 0 | 所有检查都实际执行且通过 |
| 1 | 至少一项 FAIL（真实契约/连通性错误） |
| 3 | 无 FAIL，但至少一项 SKIP（被凭据阻塞，未转绿） |
| 2 | `PROVIDER_PROFILE` 取值非法 |

## 启动断言（STARTUP_CHECKS）

`STARTUP_CHECKS=1` 时 `create_app()` 会执行 `app.startup_checks.assert_runtime_contract(strict=True)`，
任何契约违例都会让进程非 0 退出；默认关闭。

实测（本机 compose 栈）：

```text
$ docker compose run --rm -T -e STARTUP_CHECKS=1 backend \
    python -c "from app.main import create_app; create_app(); print('startup ok')"
startup ok
exit=0

$ docker compose run --rm -T -e STARTUP_CHECKS=1 -e EMBEDDING_DIM=768 backend \
    python -c "from app.main import create_app; create_app(); print('startup ok')"
RuntimeError: runtime contract violated:
settings: EMBEDDING_DIM is 768, expected 1024
exit=1
```

断言覆盖：`EMBEDDING_DIM == 1024`；`vector` 扩展存在；`chunks.embedding` 的 typmod 为
`vector(1024)`；alembic 恰好一个 head 且数据库 `alembic_version` 等于该 head；所有 chunk 行
`embedding_model` 非空、`embedding_dim == 1024`；对象存储后端可达（local 目录可写 / MinIO
桶存在 / OBS 凭据完整）。不满足时不会静默降级，而是列出全部问题。

## Drift 清单

| 差异点 | local | huawei | 影响 / 现状 |
|--------|-------|--------|-------------|
| MaaS 模型与区域 | mock / DeepSeek OpenAI-compatible（任意区域） | MaaS `deepseek-v4.1-flash`，仅 `cn-southwest-2`（贵阳一）；`bge-m3` 同区 | 模型名、base URL（`https://api.modelarts-maas.com/openai/v1`）与区域都不能照搬 local 配置；跨区调用需 EIP/NAT |
| RDS 扩展创建方式 | 镜像 `pgvector/pgvector:pg15` 预装 `vector` | 华为 RDS 需用 `SELECT control_extension('create','vector')` 开通，普通 `CREATE EXTENSION` 可能无权限 | 本项目 alembic 不创建扩展；迁移前置步骤必须在 RDS 执行 `control_extension` |
| OBS key 规则 | 磁盘路径 `root/key`，MinIO 同 key | 对象 key 只能 ASCII `[A-Za-z0-9/_.-]`，相对路径、无 `..`、无点开头段（见 `sanitize_key`）；endpoint 只写裸主机名，不带 `https://` | 中文/空格文件名必须先 slugify；OBS endpoint 带 scheme 会签名失败 |
| Huawei OCR | Paddle/RapidOCR HTTP 服务，格式较宽松 | `RecognizeHandwriting`，仅 `cn-north-4`；JPEG/JPG/PNG/BMP/TIFF，15–8192px，base64 ≤10MB；WEBP/HEIC/PDF 需先转 PNG | 超限图片与格式要在服务层拦截；区域固定北京四，与 MaaS 的贵阳一不同 |
| Embedding provider | `mock-hash`（确定性、离线、1024 维） | MaaS `bge-m3`（OpenAI 兼容 `/embeddings`，1024 维）；或 SiliconFlow `bge-m3` | 两者维度必须都是 1024；`chunks.embedding_model` 记录实际模型名，切换模型需重建向量，启动断言会拦截维度/空模型 |
| LLM fallback | `LLM_FALLBACK_*` 可接任意 OpenAI 兼容端点 | 主用 MaaS，fallback 视部署配置 | 两套 profile 的 key/模型名不同，不能共用一份 `.env` |
| 对象下载 URL | `sign()` 返回静态 `/files/{key}`（无过期语义） | OBS 预签名 URL（有过期时间） | 前端不能假设链接永久有效 |
| Cron 签名密钥 | compose 默认 `dev-only-cron-secret` | 部署时由 `.env.prod` 注入 | 两侧算法一致：`hex(hmac_sha256(secret, f"{ts}.{raw_body}"))` |

## 成本估算

> 以下为量级估算（按需/按量、未含税，依据华为云公开目录价与 demo 负载推断），**不是账单实测**；
> 正式预算以华为云价格计算器与控制台账单为准。

| 资源 | 规格 / 用量假设 | 估算（元/月） |
|------|------------------|--------------:|
| ECS（后端 + nginx） | 2 vCPU / 2 GB，按需 | 100–160 |
| RDS for PostgreSQL 15 | 2 vCPU / 4 GB 单机 + 40 GB SSD，含 pgvector | 250–420 |
| OBS | 标准存储 10 GB + 少量请求 | 5–15 |
| MaaS | demo 级别 token 量（DeepSeek-V3/v4.1-flash + bge-m3） | 5–30 |
| OCR 手写 | 每月约 1,000 次 | 10–50 |
| **合计** | | **约 370–675** |

省成本手段：demo 期间 OCR/LLM 用 mock 或本地 Paddle，MaaS 仅演示时开启；RDS 选最小规格并
按需停机；OBS 用低频访问存储。各项真实延迟与 token 用量需在凭据到位后由 parity harness 复测。

## Kill-switch

**若 2026-11-25 前 huawei profile 仍未能转绿（凭据补齐后 `scripts/parity_check.sh` 退出 0），
立即冻结新功能开发，把全部人力转向云端迁移与 parity 修复。** 本报告 huawei 列 9 项全部 SKIP、
退出码 3，即为当前“未绿”的书面证据；不得以“已知问题”名义放行。

## 复跑方法

```bash
docker compose up -d
PROVIDER_PROFILE=local  scripts/parity_check.sh; echo "local_exit=$?"   # 期望 0
PROVIDER_PROFILE=huawei scripts/parity_check.sh; echo "huawei_exit=$?"  # 无凭据时期望 3

# 凭据到位后（示例，真实值不要入库）：
export MAAS_API_KEY=... RDS_URL=postgresql://... OBS_ENDPOINT=... OBS_BUCKET=...
export OBS_ACCESS_KEY_ID=... OBS_SECRET_ACCESS_KEY=... HUAWEI_AK=... HUAWEI_SK=...
PROVIDER_PROFILE=huawei scripts/parity_check.sh; echo "huawei_exit=$?"  # 期望 0
```

脚本实现要点：DB 检查在 local 用 `docker compose exec -T db psql`，huawei 用 backend 容器按
`RDS_URL` 连接；Python 检查在 backend 容器执行；vector 往返使用唯一 source id 并在结束时删除
自建 chunk/source/user；提醒签名检查只用“篡改签名 + 有效但过期时间戳”两种 401，不触发真实发送。
