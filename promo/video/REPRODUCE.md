# REPRODUCE — 从仓库复现这支宣传片（Windows / macOS / Linux）

> 目标：在一台干净机器上，从本目录的源码 + 已提交的 11 段 clip 重新渲染出
> `224.000000s / 6720 帧 / 1920×1080 / 30fps` 的成片。
> 实测环境：Fedora 44 · Node 20.20.2 · ffmpeg 8.1.3 · Chromium 1228（Remotion 用）。

## 0. 环境准备

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | `node -v` |
| npm | ≥ 10 | |
| ffmpeg | ≥ 6（推荐 8.1.3） | 必须在 `PATH` 里，`ffmpeg -version` |
| Chromium / Chrome | 任意近期版本 | Remotion 渲染用。二选一：设置 `REMOTION_CHROME=<可执行文件路径>`，或让 Remotion 自动下载 |
| Python | ≥ 3.10 + `numpy` `scipy` | **仅 `npm run mix`** 需要（合成 224s 低频 bed）；只渲染画面不需要 |
| edge-tts | 7.3.1 | **仅重新合成旁白时需要**；只渲染画面不需要 |

Windows 说明：

```powershell
# 示例：指向本机 Chrome
setx REMOTION_CHROME "C:\Program Files\Google\Chrome\Application\chrome.exe"

# 若 python3 不在 PATH，用 python 并告知脚本
setx PYTHON "python"
```

## 1. 取代码

```bash
git clone git@github.com:LBL667/LearnRise.git
cd LearnRise
git checkout promo/learnrise-video-mockups
cd promo/video
```

## 2. 安装依赖

```bash
npm ci        # 或 npm install
```

> 本目录已把渲染闸门（`render.mjs` / `lint-determinism.mjs` /
> `determinism-check.mjs` / `font-check.mjs`）内置在 `scripts/vendor/`，
> **不再依赖本机 skill 目录**。

## 3. 静态自检（约 10 秒）

```bash
npm run lint-content      # 场景文件不得自带中文长文案
npm run timeline:check    # 11 段旁白窗口预算
npm run storyboard:build  # 11 scenes / 6720 frames
npm run check-facts -- --learnrise="<你的 LearnRise 仓库路径>"
```

> `check-facts` 需要 LearnRise 应用仓库来核对 `openapi.json` / `test-baseline.json` /
> `docker-compose.yml`。三种传参方式任选：
> `-- --learnrise=/path/to/LearnRise`、环境变量 `LEARNRISE_ROOT`，或默认路径。

## 4. 预览单场景（约 1 分钟）

```bash
npm run render:scene -- S01      # 输出 out/scenes/s01.mp4
npm run render:scene -- S09      # 排行榜
```

## 5. 渲染全片（约 30–50 分钟，视 CPU）

```bash
npm run render       # out/film.mp4（无音轨，224.000000s / 6720 帧）
```

> 渲染前会自动跑两道确定性闸门：`lint-determinism` + 30 帧双渲 PSNR 比对。
> 若机器内存紧张导致中途失败，可分段渲染后无损拼接：
>
> ```bash
> node scripts/vendor/render.mjs --project=. --composition=Film --concurrency=1 --frames=0-959   --output=out/seg/seg00.mp4
> # … 每 960 帧一段 …
> ffmpeg -f concat -safe 0 -i out/seg/list.txt -map 0:v -c copy -an out/film.mp4
> ```
> 注意：`ffmpeg` concat 必须带 `-map 0:v -an`，否则分段自带的 AAC 会让成片音轨只有第一段长度。

## 6. 旁白与合成

```bash
# 仅当 film.ts 文案改动过才需要重跑（文本哈希决定是否复用缓存）
pip install edge-tts==7.3.1 numpy scipy
set EDGE_TTS=edge-tts          # 或 edge-tts 可执行文件的绝对路径
npm run tts:all                # out/audio/yunyang/s01..s11.mp3 + narration.json/srt

npm run mix                    # out/learnrise-promo.mp4（aac 48k 2ch，-14 LUFS）
```

> **只想看画面、不想装 Python？**
> 跳过第 6 步，直接播放 `out/film.mp4`（无音轨）。成片带旁白需要 edge-tts + numpy/scipy。

## 7. 验收（与 CI 同一套阈值）

```bash
node scripts/vendor/render.mjs --help    # 查看参数
ffprobe -v error -show_entries format=duration -of csv=p=0 out/learnrise-promo.mp4   # 224.000000
```

外部闸门（可选，需另装 skill 脚本）：

```bash
node <skill>/scripts/gate.mjs out/learnrise-promo.mp4 --json \
  --fps=30 --frames=6720 --width=1920 --height=1080      # 期望 pass:true 7/7
```

## 8. 素材说明

| 素材 | 在仓库？ | 位置 |
|---|---|---|
| 11 段冻结 clip（30fps CFR，合计 6720 帧） | ✅ 6.6 MB | `public/clips/S01..S11/clip.mp4` |
| 字体子集 | ✅ | `public/fonts/*.woff2` |
| 颗粒贴图 | ✅ | `public/grain/fine-256.png` |
| 原始录屏 WebM（25fps VFR） | ❌ | Release 附件 / 证据目录（复现**不需要**） |
| 成片 / 母版 mp4 | ❌ | Release 附件 |
| 旧 UI 历史截图 | ✅ | `public/ui/*.png`（已无任何场景引用） |

## 9. 想从头重录（而不是复用 clip）

需要 LearnRise 应用栈（Docker：db/minio/backend/ocr-service/frontend/nginx）+ 演示数据：

```bash
# 1) 起栈（在 LearnRise 仓库根）
docker compose --env-file .env.demo up -d
# 2) 灌演示数据（幂等）
docker compose exec -T backend python scripts/seed_promo.py
# 3) 录制（需要 Playwright 1.64.1 与 Chromium）
npm i -D @playwright/test@1.64.1
npx playwright test --config scripts/playwright.record.config.ts
# 4) 固化到精确帧数（详见 frame_budget.md 的 ffmpeg 命令）
```

重录的产物同样要满足 `clips_manifest.json` 里的帧数与 sha256 约定。
