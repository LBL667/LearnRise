# scene_asset_matrix.md — 场景 × 素材矩阵（R6 量化）

> 判定口径（R6）：**11/11 场景主体均为新 UI 真实录屏；0 张上一轮（2026-11-02）旧 UI 截图残留。**
> 旧 PNG 哈希清单：`newui-20261107-old-ui-png.sha256`（58 张，`public/ui/*.png`）。
> clip 清单：`clips_manifest.json`（11 段，6720 帧，sha256 冻结）。

## 矩阵

| 场景 | 主体素材 | 类型 | clip | 帧数 | 静态图 | 叠加/过渡 | 新 UI | 旧 PNG 残留 |
|---|---|---|---|---|---|---|---|---|
| S01 | `clips/S01/clip.mp4` | 真实录屏 | ✅ | 360 | 0 | Backdrop / GrainOverlay / 标题层 | ✅ | 0 |
| S02 | `clips/S02/clip.mp4` | 真实录屏 | ✅ | 600 | 0 | 数据条 / 标题层 | ✅ | 0 |
| S03 | `clips/S03/clip.mp4` | 真实录屏 | ✅ | 720 | 0 | 状态徽标字幕层 | ✅ | 0 |
| S04 | `clips/S04/clip.mp4` | 真实录屏 | ✅ | 720 | 0 | 标题层 | ✅ | 0 |
| S05 | `clips/S05/clip.mp4` | 真实录屏 | ✅ | 780 | 0 | 标题层 | ✅ | 0 |
| S06 | `clips/S06/clip.mp4` | 真实录屏 | ✅ | 720 | 0 | 标题层 / 流式标注 | ✅ | 0 |
| S07 | `clips/S07/clip.mp4` | 真实录屏 | ✅ | 660 | 0 | 进度标注 | ✅ | 0 |
| S08 | `clips/S08/clip.mp4` | 真实录屏 | ✅ | 600 | 0 | 评分标注 | ✅ | 0 |
| S09 | `clips/S09/clip.mp4` | 真实录屏 | ✅ | 600 | 0 | Podium 高亮 / 数据条 | ✅ | 0 |
| S10 | `clips/S10/clip.mp4` | 真实录屏 | ✅ | 480 | 0 | 掩码标注 | ✅ | 0 |
| S11 | `clips/S11/clip.mp4` | 真实录屏 | ✅ | 480 | 0 | cluster / wordmark / 数据条 | ✅ | 0 |

**合计**：clip 11/11 · 帧数 6720 · 静态 PNG 0 · 旧 UI 残留 0。

## 「为主」量化

| 指标 | 目标 | 实测 |
|---|---|---|
| 主体为新 UI 真实录屏的场景数 | 11/11 | **11/11** |
| 上一轮旧 UI 截图（58 张）在成片链路中被引用 | 0 | **0**（`grep -RIn 'ui/' src/` → 0；`staticFile` 仅引用 `clips/**`） |
| 已删除页面/能力出现 | 0 | **0**（`/quiz` 仅以重定向存在，未入片） |

## 旧 PNG 残留核验方法（F1/F3 复用）

```bash
cd $FILM
# 1) 源码里不再引用旧 ui/ 目录
grep -RIn "ui/" src/ | grep -c png            # 期望 0
# 2) 场景组件不再用 staticFile 挂 png
grep -RIn "staticFile" src/scenes/ | grep -c png   # 期望 0（任务 7 完成后）
# 3) 旧 PNG 哈希集合与 product 中出现的素材比对
sha256sum public/ui/*.png | sort -k2 | diff - newui-20261107-old-ui-png.sha256 && echo OLD_PNG_SET_UNCHANGED
```

> `public/ui/*.png` 仅作为历史资产保留（不参与渲染）；若后续清理，须先确认 `grep -RIn 'ui/' src/` 为 0。
