# delivery_matrix.md — 交付物 × 落点矩阵

> 统一证据前缀：`newui-20261107-`。旧证据（`final-F1..F4.md`、上一轮 `task-*`）**只读保留**，不覆盖。
> 路径中 `$FILM` = `/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min`，
> `$EV` = `/home/sky/竞赛/华为ICT-evidence`，`$REPO` = `/home/sky/竞赛/华为ICT`。

| 交付物 | 路径 | 入库? | 落点 | 大小上限 | 生成命令 | 校验命令 |
|---|---|---|---|---|---|---|
| 主成片 | `$FILM/out/learnrise-promo.mp4` | ❌ | GitHub Release `promo-v1` | 500 MB | `npm run render` + `mix-audio.mjs` | `ffprobe` → 224.000000 / 6720 帧 |
| 无音轨母版 | `$FILM/out/film.mp4` | ❌ | Release 资产（可选） | 500 MB | `npm run render` | `ffprobe format=duration` → 224.000000 |
| 字幕 | `$FILM/out/learnrise-promo.srt` | ✅ | `promo/` 分支 | 20 KB | `npm run tts:all` | `cmp` 与 `narration.srt` |
| 11 段 clip | `$FILM/public/clips/S01..S11/clip.mp4` | ✅（6.6 MB） | `promo/` 分支 | 15 MB | `scripts/record-ui.mjs` + ffmpeg 固化 | `clips_manifest.json` sha256 |
| clip 清单 | `$FILM/clips_manifest.json` | ✅ | `promo/` 分支 | 20 KB | 固化脚本 | `len==11 && sum(frames)==6720` |
| 帧预算表 | `$FILM/frame_budget.md` | ✅ | `promo/` 分支 | 20 KB | 固化脚本 | 四列全等 |
| 素材矩阵 | `$FILM/scene_asset_matrix.md` | ✅ | `promo/` 分支 | 20 KB | 手工（任务 6） | 11/11 新 UI、0 旧 PNG |
| UI 对账表 | `$FILM/scene_ui_mapping.md` | ✅ | `promo/` 分支 | 30 KB | 手工（任务 6） | 16 页 id + 8 处重映射 |
| 几何契约 | `$FILM/geometry_contract.md` | ✅ | `promo/` 分支 | 10 KB | 手工（任务 6） | s ≤ 1.15 |
| 文案改写对照 | `$FILM/narration_rewrite.md` | ✅ | `promo/` 分支 | 30 KB | 手工（任务 6） | 11 段齐全 |
| 声明表 | `$FILM/claims.md` | ✅ | `promo/` 分支 | 20 KB | 手工（任务 6） | 36 行、禁用词 0 |
| 种子事实 | `$FILM/seed_facts.json` | ✅ | `promo/` 分支 | 20 KB | 手工（任务 2/3） | 排行榜 1000/960/916/876 |
| 修补台账 | `$FILM/minimal_patches.md` | ✅ | `promo/` 分支 | 10 KB | 任务 2–4 | 3 条登记 |
| 环境基线 | `$FILM/environment_baseline.md` | ✅ | `promo/` 分支 | 40 KB | 任务 2/3/4 | §9/§10/§11 实测 |
| 旧 UI PNG 哈希 | `$FILM/newui-20261107-old-ui-png.sha256` | ✅ | `promo/` 分支 | 10 KB | `sha256sum public/ui/*.png` | 58 行 |
| 音频基线（改写前） | `$FILM/newui-20261107-audio-baseline.before.sha256` | ✅ | `promo/` 分支 | 5 KB | 任务 2 | 11 行 |
| 音频基线（本轮生效） | `$FILM/newui-20261107-audio-baseline.sha256` | ✅ | `promo/` 分支 | 5 KB | 任务 8 | 11 行、F1 比对 |
| 提交四件套 | `$REPO/docs/submission/{template1.docx,slides.pptx,design.md,demo.mp4,demo.srt}` | ❌ mp4 / ✅ 其余 | `promo/` 分支（mp4 走 Release） | mp4 ≤ 180 s | `build_docx.py` / `build_pptx.py` / ffmpeg 衍生片 | 任务 14 QA |
| 提交截图 | `$REPO/docs/submission/assets/`（18 张） | ✅ | `promo/` 分支 | 每张 ≤ 2 MB | Playwright 截图 | 旧哈希全变 |
| 16 页效果图 | `$REPO/LearnRise/promo/mockups/*.png|*.svg` + contact sheet | ✅ | `promo/` 分支 | 每张 ≤ 3 MB | `build-page.js` + `export2x.py` | 16 PNG@2x + 16 SVG |
| Penpot 工程 | `$EV/learnrise-penpot/` | ❌（仓库外） | `$EV` | — | `build-page.js --all` | `--list` → 16 |
| 终验证据 | `$FILM/../.sisyphus` → 实际 `.sisyphus/evidence/final-F1..F4-newui.md` | ✅ | `$REPO/.sisyphus/evidence/` | 每份 ≤ 100 KB | F1–F4 | 四份齐全 |
| 逐帧 QA | `$REPO/.sisyphus/evidence/final-qa/newui/`（34 张 + `task9-psnr.md`） | ✅ | `$REPO/.sisyphus/` | 合计 ≤ 60 MB | 任务 9 | 11×3 抽帧 |
| 成片 contact sheet | `$FILM/out/contact-sheet.png` | ❌ | Release 附件 | ≤ 5 MB | `contact-sheet.mjs` | 非空 |
| boulder 状态 | `$REPO/.sisyphus/boulder.json` | ❌（本地状态） | 本地 | — | 执行模式维护 | `active_plan` 指向本计划 |

## 本轮新增证据命名规范

- 统一前缀 `newui-20261107-`：`clips_manifest.json` / `scene_asset_matrix.md` / `seed_facts.json` /
  `geometry_contract.md` / `frame_budget.md` / `minimal_patches.md` / `narration_rewrite.md` / `environment_baseline.md`。
- 终验文件用**新名** `final-F1-newui.md` … `final-F4-newui.md`；旧 `final-F1..F4.md` 只读。
- 逐帧抽帧与 PSNR 证据在 `.sisyphus/evidence/final-qa/newui/`。

## 禁止

- 不把 `*.mp4` / `*.wav` / `*.env` / `node_modules` / 密钥写进 `git ls-files`。
- 不在父仓库 `$REPO` 提交（HEAD 保持 `f15f8fc`）。
- 不覆盖旧 F1–F4 证据文件。
