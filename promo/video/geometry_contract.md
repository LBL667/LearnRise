# geometry_contract.md — 几何契约（G3）

> 目标：成片 1920×1080 ← clip 1920×1080 ← 录制 viewport 1920×1080 / deviceScaleFactor 1。
> 硬约束：`maxUpscale 1.15`；任何环节的放大系数 `s ≤ 1.15`。本方案 **s = 1.00**（无放大）。

## 链路

| 环节 | 尺寸 | 说明 |
|---|---|---|
| 成片画布 | 1920×1080 | `src/Film.tsx` / `video.config.ts` |
| 场景可视区（WINDOW） | 1920×1080（全屏） | 场景组件根节点铺满 |
| clip 可视区 | 1920×1080 | `HtmlClip` 以 `objectFit:'cover'` 填满盒子 |
| clip 原生尺寸 | 1920×1080 | `clips_manifest.json` 实测 |
| 录制 viewport | 1920×1080 | `playwright.record.config.ts` |
| deviceScaleFactor | 1 | 同上（避免 dsf≠1 导致 2×/0.5× 缩放） |
| CROP | 无 | 录制即全屏，无需裁剪 |
| 缩放系数 s | **1.000** | `1920/1920 = 1`，`1080/1080 = 1` → ≤ 1.15 ✅ |

## 逐场景 WINDOW（成片坐标）

| 场景 | from | durationInFrames | 可视区(x,y,w,h) | s |
|---|---|---|---|---|
| S01 | 0 | 360 | 0,0,1920,1080 | 1.00 |
| S02 | 360 | 600 | 0,0,1920,1080 | 1.00 |
| S03 | 960 | 720 | 0,0,1920,1080 | 1.00 |
| S04 | 1680 | 720 | 0,0,1920,1080 | 1.00 |
| S05 | 2400 | 780 | 0,0,1920,1080 | 1.00 |
| S06 | 3180 | 720 | 0,0,1920,1080 | 1.00 |
| S07 | 3900 | 660 | 0,0,1920,1080 | 1.00 |
| S08 | 4560 | 600 | 0,0,1920,1080 | 1.00 |
| S09 | 5160 | 600 | 0,0,1920,1080 | 1.00 |
| S10 | 5760 | 480 | 0,0,1920,1080 | 1.00 |
| S11 | 6240 | 480 | 0,0,1920,1080 | 1.00 |

## 校验命令

```bash
python3 -c "import json;d=json.load(open('clips_manifest.json'));assert all(x['width']==1920 and x['height']==1080 for x in d);print('CLIP_GEOMETRY_OK')"
grep -n "deviceScaleFactor" LearnRise/frontend/playwright.record.config.ts   # 1
grep -RIn "maxUpscale" storyboard.json | head                                # 1.15（不放宽）
```

## 禁止事项

- 不得把 1280×720 录屏放大 1.5×（旧版录制配置 `frontend/playwright.record.config.ts` 是 1280×720，**不复用**）。
- 不得修改 `deviceScaleFactor` 为非 1，或通过 CSS `transform: scale()` 二次缩放。
- 不得在 clip 内引入地址栏 / DevTools / 浏览器 UI（Playwright 仅录 viewport，天然满足）。
