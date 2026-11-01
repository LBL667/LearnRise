# 华为云生产部署手册

本文描述「LearnRise」在华为云上的生产拓扑、开通步骤、验证方法、成本与回滚。
所有命令都以仓库根目录为工作目录。

> **状态提醒**：当前仓库的线上部署为 **BLOCKED（无华为云凭证）**，见
> [当前状态](#当前状态)。本文其余部分是已本地验证过的可执行方案，不是线上截图。

---

## 1. 拓扑

```
                            Internet
                               │ 443/80
                     ┌─────────▼──────────┐
                     │  DNS (A -> EIP)    │
                     └─────────┬──────────┘
                               │
                 ┌─────────────▼──────────────┐
                 │ EIP (5_bgp, 5 Mbps)        │
                 │  └─ ECS  c7.large.2        │
                 │     ├─ web (nginx:443)     │  TLS 终止 / 静态 SPA / 反代 /api
                 │     │    └─ /api/* ────────┼──┐   (SSE 直连，无缓冲)
                 │     └─ backend:8000        │  │
                 │          (仅 compose 内网) │◄─┘
                 └───────┬───────────┬────────┘
                         │ 5432      │ 443
              ┌──────────▼───┐   ┌───▼─────────────────────┐
              │ RDS PG15     │   │ ModelArts MaaS (LLM)     │
              │ + pgvector   │   │ 跨区域：cn-southwest-2   │
              │ 私网、HA     │   └──────────────────────────┘
              └──────────────┘   ┌──────────────────────────┐
                         │ 443   │ OBS（原始文件/切片）      │
                         └──────►│ 不承载 API，不承载 SSE    │
                                 └──────────────────────────┘
```

组件职责：

| 组件 | 位置 | 说明 |
|---|---|---|
| `web` (nginx) | ECS | TLS 终止、静态 SPA、`/api` 反代、`/healthz` |
| `backend` (FastAPI) | ECS，compose 内网 | 不发布宿主机端口，只被 `web` 访问 |
| `ocr-service` | ECS，可选 profile | 默认关闭，生产用华为云 OCR；`--profile ocr` 才启动 |
| RDS PostgreSQL 15 | 同 VPC 私网 | pgvector 向量检索，HA 主备 |
| OBS | 同 region | 文件存储 + CORS；**不参与 API/SSE** |
| MaaS | 跨区域 | OpenAI 兼容推理，`PROVIDER_PROFILE=huawei` 时默认走 MaaS |
| DNS / 证书 | 华为云 DNS + certbot | A 记录指向 EIP，Let's Encrypt 证书 |

### 1.1 区域划分

| 资源 | Region | 理由 |
|---|---|---|
| VPC / ECS / EIP / RDS / OBS / DNS | **cn-north-4（北京四）** | 主站与数据同 region，RDS 走私网，时延最低 |
| ModelArts MaaS | **cn-southwest-2（贵阳一）** | 当前 MaaS 供给区域；ECS 经 EIP/NAT 出网跨区域调用 |

跨区域调用要点：

- ECS 必须有公网出口（EIP 或 NAT 网关），否则无法访问 `api.modelarts-maas.com`；
- 跨区域会增加 20–60 ms 首 token 延迟，属于可接受范围；
- 如后续 MaaS 在 cn-north-4 开放，把 `MAAS_BASE_URL` 换成同区域端点即可，无需改代码；
- **RDS 与 ECS 必须同 VPC**，不要跨区域访问数据库。

---

## 2. 构建产物

### 2.1 前端静态文件

前端使用相对路径 `/api`（`frontend/src/api/client.ts` 的 `baseURL: '/api'`），
所以生产必须同源反代，不能把 API 拆到另一个域名（否则要改前端并处理 CORS）。

构建方式二选一：

**A. 打进 nginx 镜像（推荐，compose 默认）**

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build web
```

`deploy/Dockerfile.web` 内部执行：

```bash
cd frontend && npm ci && npm run build   # 产物在 frontend/dist
# 然后 COPY 到 nginx 镜像的 /usr/share/nginx/html
```

**B. 手工构建后上传 OBS + CDN（仅限静态资源）**

```bash
cd frontend && npm ci && npm run build
obsutil cp -r -f dist/ obs://<OBS_BUCKET>/static/
```

此时 CDN 只回源 `dist/` 的静态文件。**`/api` 与 SSE 绝不能挂到 CDN 或 OBS**，
原因见 [第 5 节](#5-sse-为什么不走-cdnobs)。

### 2.2 后端镜像

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build backend
```

镜像内运行 `uvicorn app.main:app --host 0.0.0.0 --port 8000`，无宿主机端口映射。

---

## 3. 部署步骤

### 3.1 开通云资源（dry-run 先看，再执行）

```bash
# 默认只打印命令，不做变更
scripts/provision_huawei.sh

# 确认无误后真正执行（需要 hcloud / obsutil / psql 与 AK/SK）
export RDS_PASSWORD='<strong-password>'
scripts/provision_huawei.sh --execute
```

脚本覆盖：VPC、子网、安全组（仅 22/80/443 对外，5432 仅 VPC 内）、ECS、EIP、
RDS PG15（含 `SELECT control_extension('create','vector');`）、OBS 桶与 CORS、
DNS A 记录、certbot 签发。参数可用环境变量覆盖（见脚本头部）。

### 3.2 配置环境变量

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod      # 替换全部 <...> 占位符
chmod 600 .env.prod
```

必填项与轮换要求见 `.env.prod.example` 中的 `[必须轮换]` / `[首次配置]` 注释：

```bash
openssl rand -hex 32                                   # JWT_SECRET / CRON_SIGNATURE_SECRET
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # AGENT_SECRET_KEY
```

`.env.prod` 不得提交（`.gitignore` 已忽略 `.env.*`，仍建议 `chmod 600`）。

### 3.3 证书

```bash
# 在 ECS 上（域名已解析到 EIP）
certbot certonly --webroot -w /opt/learnrise/deploy/acme -d <DOMAIN> \
  --email <ACME_EMAIL> --agree-tos --non-interactive

install -m 644 /etc/letsencrypt/live/<DOMAIN>/fullchain.pem deploy/certs/fullchain.pem
install -m 600 /etc/letsencrypt/live/<DOMAIN>/privkey.pem  deploy/certs/privkey.pem
```

`deploy/certs/` 与 `deploy/acme/` 以只读方式挂进 `web` 容器。
`deploy/certs` 已在 `.gitignore` 中通过 `*.pem` 排除，禁止提交证书。

### 3.4 启动

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

> `--env-file` 不能省：compose 用 `${MAAS_*}` 插值生成后端的 `LLM_*`，
> 不带该参数会得到空密钥。systemd 单元（`deploy/systemd/learnrise.service`）已经固定传入。

开机自启：

```bash
sudo cp deploy/systemd/learnrise.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now learnrise.service
```

### 3.5 数据库迁移

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm backend alembic upgrade head
```

首次部署需确认 `vector` 扩展已创建（由 provision 脚本执行）：

```bash
psql "$RDS_URL" -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
```

### 3.6 冒烟

```bash
curl -fsS https://<DOMAIN>/healthz                 # ok
curl -fsS https://<DOMAIN>/api/health              # {"status":"ok"}
curl -sI https://<DOMAIN>/ | head -1               # 200
```

---

## 4. 部署后验证

### 4.1 健康与重启策略

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
# backend/web 均应为 healthy；restart 策略为 unless-stopped
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' learnrise-prod-backend-1
```

### 4.2 SSE 直连验证（关键）

后端路由：`POST /api/knowledge-points/{id}/explain`，响应 `text/event-stream`，
并带 `X-Accel-Buffering: no`（见 `backend/app/api/explain.py`）。

```bash
TOKEN=$(curl -s -X POST https://<DOMAIN>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<EMAIL>","password":"<PASSWORD>"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')

KP_ID=$(curl -s "https://<DOMAIN>/api/knowledge-points?limit=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')

curl -sS -N -X POST "https://<DOMAIN>/api/knowledge-points/$KP_ID/explain" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"style":"concise"}' \
  | python3 -u -c '
import sys, time
t0 = time.monotonic()
for line in sys.stdin:
    line = line.rstrip("\n")
    if line.startswith("event:") or line.startswith("data:"):
        print(f"[{time.monotonic()-t0:6.3f}s] {line[:120]}")
'
```

**通过标准**：`event: token` 的时间戳应逐步递增（例如 0.2s / 0.3s / 0.5s ...），
而不是所有帧在同一时刻涌出。如果所有帧的时间戳几乎相同 → 链路存在缓冲
（CDN、nginx `proxy_buffering on`、或上层网关），必须修掉。

响应头检查：

```bash
curl -sS -N -D - -o /dev/null -X POST \
  "https://<DOMAIN>/api/knowledge-points/$KP_ID/explain" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"style":"concise"}' | grep -i -E 'content-type|x-accel-buffering|cache-control'
# 期望：content-type: text/event-stream
#       x-accel-buffering: no
#       cache-control: no-cache
```

> 本地无凭证时，用 `docker-compose.yml` 起的开发栈（mock provider）做同样验证，
> 见 `.sisyphus/evidence/task-36-sse.txt`。

---

## 5. SSE 为什么不走 CDN/OBS

SSE（Server-Sent Events）是**长连接、逐帧递增**的 HTTP 响应。CDN / OBS 的设计前提是
「完整对象、可缓存、可整段回源」，与 SSE 天然冲突：

1. **整段缓冲**：CDN 边缘节点和 OBS 静态托管通常等源站响应结束（或攒满缓冲区）
   才开始回传，前端会看到长时间空白后一次性出现全文 —— 流式讲解的体验直接消失。
2. **缓存语义**：CDN 会按 URL 缓存 `POST`/`GET` 响应，同一知识点的讲解可能被
   错误复用或跨用户返回；即使配置 `no-cache`，部分边缘仍会缓冲。
3. **超时与分块**：CDN 常见 30–60s 空闲超时，长讲解会被切断；OBS 静态托管根本
   不支持流式代理。
4. **鉴权与隐私**：讲解请求带 Bearer token 与用户上下文，不应落在共享缓存节点。

因此本方案的分层是：

```
浏览器 ──HTTPS──► ECS nginx ──内网HTTP──► backend (SSE, 无缓冲)
                    │
                    └─ 仅 /assets/* 静态文件可另挂 CDN/OBS
```

nginx 中对应配置（`deploy/nginx.conf`）：

```nginx
location ~ ^/api/knowledge-points/[^/]+/explain$ {
    proxy_pass http://api_backend;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_hide_header X-Accel-Buffering;
    add_header X-Accel-Buffering "no" always;
    gzip off;
}

location /api/ {
    proxy_pass http://api_backend;
    gzip off;          # 压缩会打乱 SSE 分帧
}
```

`/api` 全局 `gzip off`，讲解路由额外关闭缓冲并显式下发 `X-Accel-Buffering: no`，
形成「后端 + nginx」双重保证。

---

## 6. 成本估算（参考）

以 cn-north-4、按需/包月混合估算，**实际以华为云官网价格为准**：

| 资源 | 规格 | 估算（元/月） |
|---|---|---|
| ECS | c7.large.2（2 vCPU / 4 GiB）+ 80G SSD | ≈ 240 |
| EIP | 5 Mbps 按带宽 | ≈ 115 |
| RDS PostgreSQL 15 | 2 vCPU / 4 GiB，HA，100G SSD | ≈ 600 |
| OBS | 50 GB 标准存储 + 请求 | ≈ 10 |
| DNS | 托管区 + 解析 | ≈ 1 |
| ModelArts MaaS | 按 token 计费（演示量级） | ≈ 50–300 |
| 合计 | — | **≈ 1,000–1,300** |

降低成本选项：RDS 改单机（非 HA）约省 35%；EIP 改按流量计费；演示环境可把
`ECS` 降到 `c7.large.2` 以下，但 OCR 本地化会吃内存。

---

## 7. 回滚

### 7.1 应用回滚（镜像 tag）

`.env.prod` 中固定了 `BACKEND_IMAGE` / `WEB_IMAGE` / `OCR_IMAGE`：

```bash
# 回退到上一版
BACKEND_IMAGE=learnrise-backend:prod-20261030 WEB_IMAGE=learnrise-web:prod-20261030 \
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

### 7.2 配置回滚

```bash
git log -p -- .env.prod.example docker-compose.prod.yml deploy/nginx.conf
# 恢复旧版后重新 up -d（nginx 配置变更会重建 web 容器）
```

### 7.3 数据库回滚

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm backend alembic downgrade -1
```

RDS 建议同时开启自动备份（provision 时设置备份保留期），回滚前先做快照。

### 7.4 整体下线

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down
# 云资源按需释放：EIP -> ECS -> RDS -> OBS -> VPC
```

---

## 当前状态

**线上部署：BLOCKED —— 本环境没有华为云凭证，无法开通资源或访问公网域名。**

已完成的、可离线验证的部分：

| 项 | 证据 |
|---|---|
| `docker-compose.prod.yml` 语法与插值（无 db/minio，backend + web + 可选 ocr） | `.sisyphus/evidence/task-36-online.txt` |
| `deploy/nginx.conf` 真实 `nginx -t` 通过 | `.sisyphus/evidence/task-36-online.txt` |
| SSE 经真实 nginx（本仓库配置）逐帧到达 | `.sisyphus/evidence/task-36-sse.txt` |
| 开通 runbook（dry-run） | `scripts/provision_huawei.sh` |

**未完成 / 不可声称的部分**：没有真实 EIP、域名、证书、RDS 实例、OBS 桶，
因此没有线上 URL、没有线上截图、没有真实 MaaS 调用记录。这些必须在拿到凭证后执行。

### 拿到凭证后要执行的命令（按顺序）

```bash
# 1) 配置 CLI
hcloud configure init                  # 填 AK/SK、region=cn-north-4、project_id
obsutil config -i=<AK> -k=<SK> -e=obs.cn-north-4.myhuaweicloud.com

# 2) 资源开通（先 dry-run，再 --execute）
scripts/provision_huawei.sh
RDS_PASSWORD='<strong-password>' scripts/provision_huawei.sh --execute

# 3) 环境变量
cp .env.prod.example .env.prod && chmod 600 .env.prod
# 回填 RDS_URL / DATABASE_URL / OBS_* / MAAS_API_KEY / HUAWEI_AK / HUAWEI_SK /
#      HUAWEI_PROJECT_ID / JWT_SECRET / AGENT_SECRET_KEY / CRON_SIGNATURE_SECRET / SMTP_*
# 轮换命令：openssl rand -hex 32（JWT/CRON）；Fernet.generate_key()（AGENT）

# 4) 证书（在 ECS 上）
certbot certonly --webroot -w /opt/learnrise/deploy/acme -d <DOMAIN> --email <ACME_EMAIL> --agree-tos --non-interactive

# 5) 启动 + 迁移
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm backend alembic upgrade head

# 6) 冒烟 + SSE 验证（第 4 节命令）
curl -fsS https://<DOMAIN>/api/health
```

完成第 6 步并把输出写入 `.sisyphus/evidence/task-36-online.txt` 后，才能把
状态从 BLOCKED 改为 ONLINE；在此之前任何“已上线”的表述都不成立。
