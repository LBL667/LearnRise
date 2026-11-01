# FunctionGraph 定时触发器（每日复习提醒）

华为云 FunctionGraph 在本项目里**只承担"闹钟"职责**：每天固定时刻触发一次，把请求转发给
后端已签名的内部端点 `POST /internal/reminders/run`。提醒的查询、去重、发信全部由后端
（`app/services/email.py`）完成。

```
FunctionGraph 定时触发器 (CRON_TZ)
        └─> scripts/functiongraph/handler.py   # 纯标准库，60s 超时
                └─> POST {INTERNAL_REMINDER_URL}
                        Header: X-Cron-Timestamp / X-Cron-Signature (HMAC-SHA256)
                                └─> app/api/internal.py -> run_reminders()
```

**函数内不连接 RDS / Redis / OBS，也不包含任何数据库驱动。** 因此函数包只有一个文件，
不需要 vendor 目录，也不受"VPC 内无法访问 RDS"的约束影响。

---

## 1. 定时触发器（6 段 cron）

FunctionGraph 定时触发器使用 **6 段**表达式：`秒 分 时 日 月 周`，**不是** 5 段。

| 目标 | 表达式 |
| --- | --- |
| 每天 08:00（北京时间） | `0 0 8 * * ?` |
| 每天 08:00 与 20:00 | `0 0 8,20 * * ?` |
| 每周一 09:30 | `0 30 9 ? * MON` |

要点：

- 共 6 段（`秒 分 时 日 月 周`），写成 5 段会被拒绝或语义错位；
- "日"与"周"必须有一个是 `?`；
- 时区由函数环境变量 `CRON_TZ=Asia/Shanghai` 决定，**不设置时默认按 UTC 解释**，
  08:00 会变成北京时间 16:00。

```
CRON_TZ=Asia/Shanghai
```

---

## 2. 事件结构（handler 接受的 Timer 形状）

真实定时触发器事件大致如下（字段随控制台/版本略有差异）：

```json
{
  "version": "v1.0",
  "time": "2026-10-31T08:00:00+08:00",
  "trigger_type": "TIMER",
  "trigger_name": "Timer_daily_reminders",
  "event_type": "Timer",
  "event_id": "0f1c2d3e-0000-0000-0000-000000000000"
}
```

`handler.is_timer_event` 接受以下任一标记（满足其一即可，便于控制台/手工测试）：

| 字段 | 取值 |
| --- | --- |
| `trigger_type` | `"TIMER"` |
| `event_type` | `"Timer"` |
| `Type` | `"Timer"` |

其余事件（例如 HTTP 调用、测试事件 `{}`）一律返回：

```json
{"ok": false, "reason": "not a timer trigger"}
```

这样可以避免误配 HTTP 触发器时把提醒任务当成接口暴露出去。

---

## 3. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CRON_SIGNATURE_SECRET` | 是 | 与后端 `CRON_SIGNATURE_SECRET` **完全一致**的共享密钥；只在函数配置里保存，不写进代码/仓库。 |
| `INTERNAL_REMINDER_URL` | 是 | 后端内部端点绝对地址，例如 `https://api.example.com/internal/reminders/run`。 |
| `CRON_TZ` | 建议 | `Asia/Shanghai`，决定 6 段 cron 的时区。 |

缺少 `CRON_SIGNATURE_SECRET` 或 `INTERNAL_REMINDER_URL` 时函数直接返回
`{"ok": false, "reason": "missing configuration"}`，不会发起网络请求。

签名头（由 handler 生成，后端校验）：

```text
X-Cron-Timestamp: <unix 秒>
X-Cron-Signature: hex(hmac_sha256(CRON_SIGNATURE_SECRET, f"{timestamp}.{raw_body}"))
```

后端要求时间戳偏差 ≤ 300 秒，并且同一签名只生效一次（重放返回 200 且 `sent = 0`）。

手工验证签名（本地）：

```bash
TS=$(date +%s)
BODY='{}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$CRON_SIGNATURE_SECRET" -r | cut -d' ' -f1)
curl -sS -X POST "$INTERNAL_REMINDER_URL" \
  -H "Content-Type: application/json" \
  -H "X-Cron-Timestamp: $TS" \
  -H "X-Cron-Signature: $SIG" \
  --data "$BODY"
# -> {"ok":true,"sent":N,"skipped":M,"failed":0,"replay":false}
```

---

## 4. 打包（无依赖）

`handler.py` 只使用标准库（`urllib.request` / `hmac` / `hashlib` / `json` / `os` / `time`），
因此不需要 `pip install`、不需要 vendor 目录、不需要 layer：

```bash
cd scripts/functiongraph
zip -r functiongraph.zip handler.py
```

控制台配置：

- 运行时：Python 3.10 及以上（与后端 3.11 语法兼容，未使用 3.11 专属特性）；
- 入口函数：`handler.handler`；
- 超时时间：≥ 60 秒（handler 自身请求超时也是 60 秒）；
- 内存 / 并发：128 MB、单实例即可（一天一次）。

本地干跑（不发起网络请求，除非已设置上面两个环境变量）：

```bash
python scripts/functiongraph/handler.py
# {"ok": false, "reason": "missing configuration"} 或真实执行结果
```

---

## 5. 网络：VPC 与公网出口（重要）

函数默认在**公网网络**中执行，可以直接访问公网 HTTPS 后端。

一旦给函数**配置 VPC**（例如为了访问内网资源），华为云会**移除默认公网出口**：

- 函数将无法访问公网 `INTERNAL_REMINDER_URL`，表现为超时 / `ok: false`；
- 若必须留在 VPC 内，需要额外配置 **NAT 网关 + 绑定 EIP** 才能出公网；
- 或者把后端也放进同一 VPC，用内网域名/私网 IP 访问（此时后端仍通过自己的连接池访问 RDS）。

推荐做法：**函数不加入 VPC**，仅通过公网 HTTPS（或已备案域名）回调后端。

---

## 6. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `{"ok": false, "reason": "not a timer trigger"}` | 事件不是定时触发器 | 检查触发器类型/测试事件 |
| `{"ok": false, "reason": "missing configuration"}` | 环境变量缺失 | 配置 `CRON_SIGNATURE_SECRET`、`INTERNAL_REMINDER_URL` |
| `401 {"detail":"未认证"}` | 密钥不一致或头缺失 | 两端 `CRON_SIGNATURE_SECRET` 对齐 |
| `401 {"detail":"签名已过期"}` | 主机时钟漂移 > 300s | 校准时间或检查 timestamp 单位（秒） |
| `503 {"detail":"提醒服务暂不可用"}` | 后端提醒任务异常 | 查看后端日志（异常文本已脱敏） |
| `200` 且 `replay: true` | 同一签名被重复投递 | 正常去重，无需处理 |

函数日志**不会**打印共享密钥或签名值；后端也只记录 `sent/skipped/failed` 计数。
