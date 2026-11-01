# 已知限制与替代实现

本文件记录实现与计划的偏差、外部服务约束，以及无法在本机验证的部分。原则：没有真实验证
就不写 PASS。

## OCR 引擎：PaddleOCR → RapidOCR（同源 PP-OCR 模型的 ONNX 版本）

计划要求 `ocr-service` 使用 PaddleOCR。实测本机到清华镜像的带宽约 **370–490 kB/s**，
而 `paddlepaddle==3.0.0` 的 CPython 3.11 Linux wheel 单包就有 **192.8 MB**：

```
$ pip download paddlepaddle==3.0.0  # 镜像索引实际提供的最新 3.0.0
paddlepaddle-3.0.0-cp311-cp311-manylinux1_x86_64.whl (192.8 MB)
```

在 15 分钟（900 s）时间盒内执行完整安装探测（`paddlepaddle==3.0.0` + `paddleocr==2.8.1`），
超时后仍在下载 `paddleocr` 的传递依赖（`scipy` 35.3 MB、`opencv-contrib-python`、
`scikit-image` 等）：仅 paddlepaddle 本体就需约 7–9 分钟，加上依赖闭包必然超过时间盒。
（另：镜像不提供 `paddlepaddle==2.6.1`（cp311），可用版本为 3.x；模型权重还需在首次请求时
从 `paddleocr.bj.bcebos.com` 下载约 16 MB，增加运行时不确定性。）

因此按任务书允许的替代方案，`ocr-service` 使用 **`rapidocr-onnxruntime==1.2.3`**：

* 运行的是**同一套 PP-OCR 模型**（`ch_PP-OCRv3_det_infer.onnx` / `ch_PP-OCRv3_rec_infer.onnx`
  / `ch_ppocr_mobile_v2.0_cls_infer.onnx`），由官方 Paddle→ONNX 转换而来，识别效果同源；
* 模型权重**随 wheel 分发**（14.9 MB），首次请求不需要联网下载，离线可复现；
* 运行时不依赖 `paddlepaddle`，CPU 推理由 `onnxruntime` 承担，镜像更小、构建更快。

替代是显式的、可回滚的：把 `ocr-service/requirements.txt` 换回 PaddlePaddle + PaddleOCR，
并把 `ocr-service/app/engine.py` 的 `get_engine()` 实现换成 `PaddleOCR(...)` 即可，HTTP 契约
（`/ocr`、`/health`、`/convert`）与后端适配器不变。

镜像内不安装 `opencv-python`（依赖 libGL），改用 `opencv-python-headless`；`rapidocr-onnxruntime`
以 `--no-deps` 预装、依赖在 `requirements.txt` 中显式钉版本，因此无需任何 apt 系统库
（`python:3.11-slim` 上 `onnxruntime` 与 headless OpenCV 均可直接导入，已实测）。

## 服务契约与预处理

* 支持格式：PNG / JPG / JPEG / BMP / TIFF，单文件 ≤ 10 MB，短边 ≥ 15 px、长边 ≤ 8192 px，
  否则返回 **415**；长边 > 4000 px 时等比缩放到 4000 px。
* 预处理：EXIF 方向校正 → RGB → JPEG q85（`/ocr` 的引擎输入）。
* 行合并：按框的垂直中心、再按左边界排序；同一视觉行（垂直重叠 ≥ 50%）合并为一个 block，
  文本按 x 拼接（中文无空格，西文补空格）。
* `needs_review=true` 当 block 置信度 < 0.6（服务端计算，后端适配器对缺失该字段的响应按同一
  阈值兜底）。
* 引擎懒加载（首次 `/ocr` 才建模型，模块级缓存 + 线程锁），`/health` 不触发模型加载。
* OCR 执行超过 30 s 返回 **504**。

## 华为云手写 OCR（Phase B）

* 仅 `cn-north-4`（北京四）；`RecognizeHandwriting`，`detect_direction=true`。
* 原生只接受 JPEG/JPG/PNG/BMP/TIFF。**WEBP / HEIC / PDF 先经 `ocr-service` 的 `/convert`
  转 PNG** 再送华为（`huaweicloudsdkocr` 为可选依赖，默认镜像不安装）。
* PDF 不直接送华为 OCR：PDF 文本层由 `app/services/parsing.py`（PyMuPDF）提取，扫描页才走
  图片 OCR。
* AK/SK 只在构造客户端时使用，异常消息只包含异常类型名，不打印凭证。
* 本机无华为云账号，`RecognizeHandwriting` 的真实调用记为 **BLOCKED**（见
  `.sisyphus/evidence/huawei-spike.md`）；adapter 以 fake SDK 的契约测试覆盖映射逻辑。

## 未验证项

* 华为云真实 OCR 响应（缺 AK/SK，见 `scripts/ocr_smoke.py` 复跑方式）。
* PaddleOCR 原生运行时（因时间盒改用 RapidOCR，见上）。

---

## 汇总：实现偏差与未验证项（Task 38 归档）

以下条目汇总前文，便于评审快速核对。**未执行的验证一律标为未验证，不写 PASS。**

| # | 项目 | 现状 | 影响 | 依据 / 复跑 |
|---|---|---|---|---|
| 1 | OCR 引擎 | `rapidocr-onnxruntime`（同源 PP-OCR 模型 ONNX 版）替代 PaddlePaddle 原生 | 识别效果同源；无 Paddle 运行时与模型下载依赖 | 本文首节；`ocr-service/requirements.txt`、`ocr-service/app/engine.py` |
| 2 | mock provider | `LLM_PROVIDER=mock` / `EMBEDDING_PROVIDER=mock` 为默认 | 演示与 CI 稳定、零 Key；输出为确定性模板，**不代表真实模型质量** | `backend/app/adapters/llm/mock.py`、`backend/app/adapters/embedding/mock.py` |
| 3 | RDS pgvector HNSW | 本地 Docker pgvector 自检通过；**RDS 上 HNSW 未实测** | RDS 可能只支持 `ivfflat`，需实测后确认索引类型 | `docs/huawei-canary.md` 第 6 节；`scripts/huawei_canary.py` 的 `rds_vector` |
| 4 | 调度器 | 单节点 APScheduler 独立进程 + PG advisory lock + 唯一约束 | 不是分布式调度；多节点需外部分布式锁或只跑一个 worker | `backend/app/worker/scheduler.py`、`backend/app/services/email.py` |
| 5 | rerank / 混合检索 | 未启用（feature flag 默认关）；无 BM25 / query rewrite | 检索质量为纯向量检索，长尾 query 可能弱于混合方案 | `docs/scope.md` 的 OUT 清单 |
| 6 | 思维导图 | render-only（知识点树 → 前端渲染），不可编辑 | 用户不能调整节点结构；需回到笔记生成重跑 | `frontend/src/views/MindMap.vue` |
| 7 | MaaS 跨区域延迟 | 未实测（无 MaaS API Key） | ECS(cn-north-4) → MaaS(cn-southwest-2) 的首 token 延迟与成本未知 | `docs/huawei-services.md` 第 6 节；`docs/huawei-canary.md` |
| 8 | 华为云在线部署 | BLOCKED（无凭据） | 无法提供线上可运行证明；`docs/deploy.md` 仅为可执行方案 | `.sisyphus/evidence/huawei-spike.md`、`docs/huawei-services.md` |
| 9 | 华为云真实 OCR | BLOCKED（无 AK/SK）；仅 fake SDK 契约测试 | `RecognizeHandwriting` 的真实响应映射未经端到端验证 | `scripts/ocr_smoke.py` |
| 10 | CodeArts / 码道 | PENDING（无华为云账号） | 赛题硬性证据缺失；本地仓库与规范已就绪 | `docs/codearts-evidence.md`「当前状态」 |
| 11 | 华为云 SMS/SMN | 未接入；提醒仅 SMTP | 无 SMN 通道；SMTP 未配置时仅保留站内提醒记录 | `backend/app/ports/email.py` |
| 12 | 复现完整度 | 已做「复用镜像 + 复制工作树」；**未做「从零构建」** | 依赖版本漂移风险未被本次验证覆盖 | `docs/repro.md` 记录 1 / 记录 2（PENDING） |
