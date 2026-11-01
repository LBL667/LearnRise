# deploy/ —— 生产部署产物

本目录只包含**部署相关**文件，不包含应用代码。完整方案见
[`../docs/deploy.md`](../docs/deploy.md)。

| 文件 | 作用 |
|---|---|
| `../docker-compose.prod.yml` | 生产编排：backend + web(nginx) + 可选 ocr-service，**无 db/minio** |
| `../.env.prod.example` | 生产环境变量模板（占位符 + 轮换标记） |
| `nginx.conf` | TLS、静态 SPA、`/api` 反代、SSE 无缓冲路由 |
| `Dockerfile.web` | 多阶段构建：`npm run build` → nginx 镜像 |
| `systemd/learnrise.service` | 开机自启（`docker compose up -d`） |
| `certs/` | 证书挂载点（`fullchain.pem` / `privkey.pem`，**不提交**） |
| `acme/` | certbot HTTP-01 webroot |
| `../scripts/provision_huawei.sh` | 华为云资源开通 runbook（默认 dry-run） |

---

## 快速开始

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

1. **TLS 终止**：80 只做 ACME 与 301；443 用 `deploy/certs/` 下证书。
2. **上传上限**：`client_max_body_size 20m`，与后端 `MAX_UPLOAD_MB=20` 对齐。
3. **SSE 无缓冲**（最重要）：

   ```nginx
   location ~ ^/api/knowledge-points/[^/]+/explain$ {
       proxy_pass http://api_backend;
       proxy_buffering off;
       proxy_request_buffering off;
       proxy_cache off;
       proxy_read_timeout 300s;
       add_header X-Accel-Buffering "no" always;
       gzip off;
   }
   ```

   真实路由来自 `backend/app/api/explain.py`：
   `POST /api/knowledge-points/{knowledge_point_id}/explain`。

4. **`/api` 关 gzip**：压缩会破坏分帧；静态资源仍走 gzip。
5. **SPA 回退**：`try_files $uri $uri/ /index.html`；`/assets/` 长缓存。
6. **健康检查**：`GET /healthz` 返回 200（容器内 wget 使用）。

> 禁止把 `/api` 或 SSE 放到 CDN / OBS 后面：CDN 的边缘缓冲会把逐 token 流
> 攒成一次性响应，OBS 静态托管不支持流式代理。详见 `docs/deploy.md` 第 5 节。

---

## 本地校验（无需云凭证）

```bash
# compose 语法 + 变量插值
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config -q

# nginx 语法：生成一次性自签证书，避免 ssl_certificate 缺失导致误报
tmp=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$tmp/privkey.pem" -out "$tmp/fullchain.pem" -subj "/CN=localhost" >/dev/null 2>&1
docker run --rm -v "$PWD/deploy/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$tmp:/etc/nginx/certs:ro" nginx:alpine nginx -t
rm -rf "$tmp"
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
