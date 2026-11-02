# LearnRise — Promo Assets (video mockups + handouts)

发布分支 `promo/learnrise-video-mockups` 顶层 `promo/` 目录，含三块素材：

| 目录 | 内容 | 来源 |
|---|---|---|
| `video/` | Remotion 3 分钟宣传片源码（`src/**`、`public/**`、配置、`storyboard.json`、`narration.json`、`EDITING.md`） | `remotion-video-pipeline/projects/learnrise-promo-3min`（不含 `node_modules/`、`*.mp4`、`*.wav`、`.env.json`） |
| `mockups/` | 16 页 Penpot mockup（`*@2x.png` 2880×1800 + `*.svg` 1440×900 + `contact-sheet.png`）、`pages.json`/`cast.json`/`tokens.json`、`EDITING.md` | `华为ICT-evidence/learnrise-penpot/out/mockups/` + `specs/` |
| `materials/` | 两份讲义 PDF（微观经济学 第3章 弹性与消费者行为 12p、固定收益证券 第2章 债券定价与久期 11p）+ `src/*.md` + `template.tex` + `build.sh` | `华为ICT-evidence/learnrise-promo/materials/`（不含 63 页课程章节 PDF） |

最终视频（408 MB）不入分支，见 GitHub Release：
**https://github.com/LBL667/LearnRise/releases/tag/promo-v1**（`learnrise-promo.mp4`）。

## 复现命令

```bash
# 1. 视频源码
cd promo/video
npm ci
npm run render            # 需先准备 public/audio 语音与 out/audio 混音（*.wav 未入库）
npm run storyboard:build  # 重建 storyboard.json 契约
npm run lint-content      # 中文文案 guard（场景文件内 >12 字符中文串报错）

# 2. 讲义 PDF
cd promo/materials
./build.sh                # 需 xelatex 环境；按 build.sh 内说明生成两份 PDF

# 3. mockups：PNG/SVG 为 Penpot 导出结果，pages.json 定义 16 页，cast.json 定义角色，tokens.json 为设计令牌
```

详细改动说明见各子目录 `EDITING.md`（video 侧含 narration/scene 编辑规则）。

## 排除项说明

- `promo/video` 不含 `node_modules/`（用 `npm ci` 由 `package-lock.json` 复现）；
- 不含任何 `*.mp4` / `*.wav`（成片与音频素材体积大，走 Release）；
- 不含 `.env.json`（本地渲染环境配置，不入库）；
- `public/ui/**` 截图（1920×1080 PNG）已包含，最大文件 11 MB（`public/ui` 目录合计 11 MB，无 >50 MB 文件）；
- `promo/materials` 不含 63 页课程章节 PDF（`第3章 应收款项及预防账款.pdf`）。
