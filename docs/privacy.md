# 隐私与数据说明

本文说明「LearnRise」在演示与部署时的数据类型、隔离边界、凭据处理和外发范围。
适用于仓储内的演示数据（`fixtures/`、`scripts/seed_demo.py`）以及本地/云端部署。

## 1. 演示数据全部为合成数据

- `fixtures/lec01.pdf`：由 `scripts/seed_demo.py --make-fixtures` 用 PyMuPDF 现场生成的
  《计算机网络》讲义，8 页，内容为 TCP 三次握手 / 四次挥手 / 拥塞控制的教学性文字，
  不含任何真实姓名、学号、邮箱、电话、身份证号或第三方版权材料。
- `fixtures/board.png`：同一主题的合成板书图片，仅用于 OCR 冒烟测试。
- 演示账号 `demo@example.com / demo1234` 是公开的演示凭据，不对应真实个人；
  密码哈希写入 `users.password_hash`（bcrypt/passlib），明文只存在于种子脚本和演示文档中。
- 演示 Agent `本地 Mock` / `DeepSeek 官方` 使用占位配置；`本地 Mock` 的 base_url
  `https://mock.invalid/v1` 故意不可解析，避免误把演示流量发到真实服务。

因此：**演示环境不含 PII**。生产环境若导入真实课件，请先确认已获得授权并完成脱敏。

## 2. 用户隔离

- 所有业务表（资料、任务、知识点、题目、答题、复习卡片、讲解日志、Agent 配置）
  都带 `user_id`，查询按 `user.id` 过滤。
- 已加载对象通过 `require_owner` 校验：访问他人资源统一返回 **404**（不是 403），
  因此接口不会泄露「该资源是否存在」。
- 认证使用 JWT（`JWT_SECRET`，默认 24h 过期）；缺失/过期/伪造 token 一律 401。

## 3. 凭据与密钥

- **Agent API Key**：以 Fernet 对称加密后存于 `agent_configs.api_key_encrypted`
  （密钥来自 `AGENT_SECRET_KEY`）。接口只返回不可逆掩码（如 `sk-****abcd`），
  前端编辑时留空即保持原值，不会把明文回传。
- **服务级密钥**（`LLM_API_KEY`、`EMBEDDING_API_KEY`、华为云 AK/SK 等）只通过环境变量注入，
  仓库中不提交 `.env`；`.env.demo` 仅含非敏感的演示开关。
- **日志脱敏**：`SecretRedactionFilter` 在日志落盘前替换 `Bearer <token>`、`sk-...`、
  `api_key=...`、`Authorization: ...`、长 AK/SK 等模式。业务日志只记录数量、耗时、
  job id、模型名，不记录提示词正文、文档内容或密钥。
- SSE 讲解的错误只返回固定中文提示（如「模型鉴权失败」），不返回上游响应体、URL 或 key。

## 4. 数据外发范围（按配置枚举）

演示配置（`.env.demo` / docker-compose 默认值）下，**没有任何文档内容离开本机**：

| 环节 | 演示配置 | 生产可替换为 | 外发内容 |
|---|---|---|---|
| 笔记 / 出题 / 讲解 | `LLM_PROVIDER=mock`（进程内） | `openai_compatible`：DeepSeek、ModelArts MaaS、任意 OpenAI 兼容网关 | 资料片段、知识点标题与正文、用户提问 |
| 向量化 | `EMBEDDING_PROVIDER=mock`（进程内） | `openai_compatible`：SiliconFlow bge-m3 等；或 `local`（本地 FlagEmbedding） | 文本块内容 |
| OCR | 自建 `ocr-service`（内网 PaddleOCR） | 同上，或华为云 OCR（需 AK/SK） | 图片内容（仅发往自建服务或选定的云 OCR） |
| 对象存储 | `STORAGE_PROVIDER=local`（本地磁盘） | MinIO（自建）或华为云 OBS | 原始文件（仅发往选定存储） |
| 复习提醒邮件 | SMTP 未配置时只记录日志 | 选定的 SMTP 服务商 | 收件人邮箱、提醒摘要 |

除上表列出的模型 / 向量 / OCR / 存储 / 邮件提供方外，系统不会把用户文档上传到任何第三方
（无遥测、无统计分析、无第三方 CDN 上传）。切换到真实提供方时，请在其隐私政策下评估
数据驻留与合规要求。

## 5. 数据删除

演示数据可随时整体清除：

```bash
docker compose down -v          # 删除 PostgreSQL 与 MinIO 卷
rm -rf backend/var/storage      # 本地对象存储文件（STORAGE_PROVIDER=local）
```

单个演示用户的数据（当前没有删除账号的 API）：

```sql
-- 在 learnrise 库执行；级联删除由外键 ON DELETE CASCADE 完成
DELETE FROM users WHERE email = 'demo@example.com';
```

单个资料可在代码层调用 `KnowledgeSource`/`Chunk` 的级联删除；删除知识点可使用
`DELETE /api/knowledge-points/{id}`。若使用 MinIO/OBS，请同时删除对应的
`<user_id>/<source_id>/` 前缀对象。

## 6. 演示与截图规范

- 录屏、截图只使用上面列出的合成数据与演示账号。
- 截图前确认 Agent 设置页显示的是掩码（`sk-****`），不要展开 `.env`、终端历史或数据库连接串。
- 分享日志前先经过 `redact_text()` 或人工检查，避免带出 Bearer token。

## 7. 保留与备份

演示环境不承诺数据保留期，重启或 `down -v` 即清空。生产环境请按组织要求配置数据库备份、
对象存储生命周期和日志保留期，并在备份介质上沿用同样的访问控制。
