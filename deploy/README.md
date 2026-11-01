# deploy/ —— 生产部署产物

本目录只包含**部署相关**文件，不包含应用代码。完整方案见
[`../docs/deploy.md`](../docs/deploy.md)。

| 文件 | 作用 |
|---|---|
| `../docker-compose.prod.yml` | 生产编排：backend + web(nginx) + 可选 ocr-service，**无 db/minio** |
| `../.env.prod.example` | 生产环境变量模板（占位符 + 轮换标记） |
| `nginx.conf` | 单栈 compose 入口：`/` 反代 Vite dev server、`/api` 反代后端、SSE 无缓冲路由 |
| `Dockerfile.web` | 多阶段构建：`npm run build` → nginx 镜像 |
| `systemd/learnrise.service` | 开机自启（`docker compose up -d`） |
| `certs/` | 证书挂载点（`fullchain.pem` / `privkey.pem`，**不提交**） |
| `acme/` | certbot HTTP-01 webroot |
| `../scripts/provision_huawei.sh` | 华为云资源开通 runbook（默认 dry-run） |

---

## 单栈 compose（本地 / 演示）

根目录的 [`../docker-compose.yml`](../docker-compose.yml) 是唯一的编排文件，
`deploy/nginx.conf` 直接挂载为 nginx 容器的 `/etc/nginx/conf.d/default.conf`：

```
浏览器 :8080 → nginx → /        → frontend:5174 (Vite dev server, 含 HMR websocket)
                     → /api/    → backend:8000  (FastAPI)
                     → SSE 路径 → backend:8000  (proxy_buffering off)
```

| 服务 | 宿主机端口 | 说明 |
|---|---|---|
| `nginx` | 8080 | 唯一对外入口 |
| `backend` | 8000 | FastAPI；启动命令先 `alembic upgrade head` 再起 uvicorn |
| `frontend` | 5174 | React + Vite dev server（`frontend/Dockerfile.dev`） |
| `db` | 55433 | `pgvector/pgvector:0.8.0-pg15` |
| `minio` | 9000 / 19001 | API / 控制台（9001 已被宿主机其他容器占用） |
| `ocr-service` | 8001 | RapidOCR HTTP 服务 |

SSE（`/api/knowledge-points/<id>/explain`、`/api/assistant/conversations/<id>/stream`）
在 nginx 里单独关掉缓冲与压缩：`proxy_buffering off` + `gzip off` +
`proxy_read_timeout 300s`，逐 token 帧直达浏览器。任何反代层重新打开缓冲都会把流攒成
一次性响应。

### 首次启动必须重建数据卷

数据库用户名 / 库名已从旧名字改为 `learnrise`，而 `scripts/db-init/` 里的扩展初始化
只在**全新 datadir** 上执行；已有的 PostgreSQL 数据目录不会自动套用新凭据。因此本次
改动后的第一次启动**必须**：

```bash
docker compose down -v && docker compose up -d --wait
docker compose ps --format '{{.Service}} {{.Health}}'   # 6 个服务全部 healthy
```

`down -v` 只删除本项目（`learnrise`）的 `pgdata` / `minio_data`；其他项目的卷不受影响。

---

## 生产部署（docker-compose.prod.yml）


```bash
# 1) 配置环境
cp .env.prod.example .env.prod
$EDITOR .env.prod            # 替换所有 <...>
chmod 600 .env.prod

# 2) 证书（已有证书则跳过）
mkdir -p deploy/certs deploy/acme
certbot certonly --webroot -w "$PWD/deploy/acme" -d "$DOMAIN" \
  --email "$ACME_EMAIL" --agree-tos --non-interactive
install -m 644 "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" deploy/certs/fullchain.pem
install -m 600 "/etc/letsencrypt/live/$DOMAIN/privkey.pem"  deploy/certs/privkey.pem

# 3) 启动
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

**必须带 `--env-file .env.prod`**：compose 用 `${MAAS_BASE_URL}` / `${MAAS_API_KEY}` /
`${MAAS_MODEL}` 插值出后端读取的 `LLM_*`。不带时会得到空密钥（服务能起但讲解失败）。

只想校验文件本身（不需要真实 `.env.prod`）：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config -q
```

---

## nginx 配置要点

1. **入口**：单栈只用 `nginx:alpine` + `deploy/nginx.conf`（挂到
   `/etc/nginx/conf.d/default.conf`），`8080:80` 对外。
2. **上传上限**：`client_max_body_size 25m`，与后端 `MAX_UPLOAD_MB=20` 留出余量。
3. **SSE 无缓冲**（最重要）：

   ```nginx
   location ~ ^/api/knowledge-points/[^/]+/explain$ {
       proxy_pass http://backend:8000;
       proxy_buffering off;
       proxy_cache off;
       proxy_read_timeout 300s;
       proxy_send_timeout 300s;
       proxy_set_header Connection "";
       gzip off;
   }
   ```

   真实路由来自 `backend/app/api/explain.py`：
   `POST /api/knowledge-points/{knowledge_point_id}/explain`。同理
   `^/api/assistant/conversations/[^/]+/stream$` 也单独关缓冲。
   正则 location 优先于 `/api/` 前缀匹配，因此 SSE 不会被通用 API 的配置吃掉。
4. **`/api/` 关 gzip**：压缩会破坏分帧。
5. **`/` 反代 Vite dev server**：dev 容器没有构建产物，必须走
   `proxy_pass http://frontend:5174;`，并透传 `Upgrade` / `Connection` 让 HMR websocket 生效。
6. **健康检查**：compose 用 `/api/health` 探活 nginx → backend 链路。

> 禁止把 `/api` 或 SSE 放到 CDN / OBS 后面：CDN 的边缘缓冲会把逐 token 流
> 攒成一次性响应，OBS 静态托管不支持流式代理。详见 `docs/deploy.md` 第 5 节。

---

## 本地校验（无需云凭证）

```bash
# compose 语法 + 变量插值
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config -q

# nginx 语法（conf.d server 片段）
docker run --rm -v "$PWD/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine nginx -t
```

---

## systemd

```bash
sudo cp deploy/systemd/learnrise.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now learnrise.service
sudo systemctl status learnrise.service
```

单元假设代码位于 `/opt/learnrise`；如路径不同，修改 `WorkingDirectory` 与
`ExecStart`/`ExecStop`/`ExecReload` 中的绝对路径。

---

## 排障

| 现象 | 排查 |
|---|---|
| `web` 健康检查失败 | `docker compose logs web`；确认 `deploy/certs/*.pem` 存在且可读 |
| 502 `/api` | `docker compose logs backend`；`depends_on` 需 backend healthy |
| SSE 一次性返回 | 检查是否经过 CDN；`curl -D -` 看 `X-Accel-Buffering`；确认 nginx 未改动 explain location |
| 讲解报鉴权错误 | 是否漏了 `--env-file`，导致 `MAAS_API_KEY` 为空 |
| 数据库连不上 | RDS 安全组是否放通 5432（仅 VPC 网段）；`DATABASE_URL` 是否 `sslmode=require` |
| 上传 413 | `client_max_body_size` 与 `MAX_UPLOAD_MB` 是否一致 |
| 健康检查一直 starting | `start_period` 40s 内完成首次迁移/导入属正常 |

日志：`docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200`。
容器日志已配置 `json-file` 轮转（50m × 5）。

---

## 安全约定

- `.env.prod`、`deploy/certs/*.pem`、`*.key` 一律不入库（`.gitignore` 已覆盖）。
- 生产密钥必须重新生成，不能沿用 `dev-only-*` 示例值。
- ECS 安全组只开 22（限管理员 CIDR）/ 80 / 443；8000 与 5432 不对外。
- 后端容器不映射宿主机端口，仅通过 compose 内网被 `web` 访问。
- 建议 IAM 子用户最小权限（OBS + OCR），不要用主账号 AK/SK。
