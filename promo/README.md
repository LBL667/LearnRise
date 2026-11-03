# LearnRise — Promo Assets (video mockups + handouts)

发布分支 `promo/learnrise-video-mockups` 顶层 `promo/` 目录，含三块素材：

| 目录 | 内容 | 来源 |
|---|---|---|
| `video/` | Remotion 3 分钟宣传片源码（`src/**`、`public/**`、配置、`storyboard.json`、`narration.json`、`EDITING.md`） | `remotion-video-pipeline/projects/learnrise-promo-3min`（不含 `node_modules/`、`*.mp4`、`*.wav`、`.env.json`） |
| `mockups/` | 16 页 Penpot mockup（`*@2x.png` 2880×1800 + `*.svg` 1440×900 + `contact-sheet.png`）、`pages.json`/`cast.json`/`tokens.json`、`EDITING.md` | `华为ICT-evidence/learnrise-penpot/out/mockups/` + `specs/` |
| `materials/` | 两份讲义 PDF（微观经济学 第3章 弹性与消费者行为 12p、固定收益证券 第2章 债券定价与久期 11p）+ `src/*.md` + `template.tex` + `build.sh` | `华为ICT-evidence/learnrise-promo/materials/`（不含 63 页课程章节 PDF） |

最终视频不入分支。Release `promo-v1` 尚未创建（缺少 GitHub Token）。成片位于沙箱
`out/learnrise-promo.mp4`（约 385 MB，sha256 见下），可手动上传：

```
/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min/out/learnrise-promo.mp4
size   384,387,620 bytes
sha256 5438eac62040584c97a140671728212f68fa78bdbe1dfc47a1f08e8b328dd9ab
```

（同画面的 xiaoxiao 配音版：`out/learnrise-promo-xiaoxiao.mp4`，384,361,704 bytes，sha256
`968408f43ca5feb124fa2274881dc3a9575bec4c5b8605c7485ffa21e62f11a9`。）

`out/learnrise-promo-video.mp4` 是无声视频流，`out/learnrise-promo-xiaoxiao.mp4` 是同一画面的
另一条配音（xiaoxiao）；两条成片都由 `scripts/mix-audio.mjs` 从同一视频流混音得到。

## 复现命令

```bash
# 1. 视频源码
cd promo/video
npm ci
npm run render            # 渲染无声视频流 out/film.mp4
node scripts/mix-audio.mjs # 混入配音，得到 out/learnrise-promo.mp4（*.wav / *.mp3 未入库）
npm run storyboard:build  # 重建 storyboard.json 契约
npm run lint-content      # 中文文案 guard（场景文件内 >12 字符中文串报错）

# 2. 讲义 PDF
cd promo/materials
./build.sh                # 需 xelatex 环境；按 build.sh 内说明生成两份 PDF

# 3. mockups：PNG/SVG 为 Penpot 导出结果，pages.json 定义 16 页，cast.json 定义角色，tokens.json 为设计令牌
#    注意：SVG 是 Penpot 的位图包装（<image> 内嵌 base64 PNG），不是可编辑矢量
```

详细改动说明见各子目录 `EDITING.md`（video 侧含 narration/scene 编辑规则）。

## 已知限制（口径）

- **mockups 的 SVG 是位图包装，不是可编辑矢量。** `promo/mockups/*.svg` 由 Penpot 导出；
  Penpot 的 SVG 导出器渲染不了 Noto Sans SC 文本（foreignObject 永远生成不出来），
  每个 SVG 实际是内嵌 base64 2x PNG 的 `<image>` 包装。要改画面回 Penpot 工程改，
  不要直接编辑这些 SVG。
- **S05 / S06 截图来自 `LLM_PROVIDER=mock` 演示环境。** 画面上的出题 / 讲解文本是 mock
  provider 的确定性网络主题输出，并非由会计资料来源生成的真实模型文本；
  出处切片来自已入库资料。该差异已在 S05、S06 画面内的脚注披露：“演示环境使用
  mock 模型；题目文本不代表真实模型输出，出处切片来自已入库资料”。
- **讲义只有 2 份生成 PDF（微观经济学 12p、固定收益证券 11p）；63 页课程章节 PDF
  （`第3章 应收款项及预防账款.pdf`）不入分支**，仅作为出处证据保留在 evidence 目录。
- **`origin/feature` 可能过期。** seed 提交 `883b790`（promo cast seed 与 manifest）位于
  本地 `feature` 分支上，并已包含在本分支的历史基线中；本分支相对 `feature` 只新增
  `promo/**` 下的内容。

## 排除项说明

- `promo/video` 不含 `node_modules/`（用 `npm ci` 由 `package-lock.json` 复现）；
- 不含任何 `*.mp4` / `*.wav`（成片与音频素材体积大，只保留在本机沙箱 `out/`，见上方路径）；
- 不含 `.env.json`（本地渲染环境配置，不入库）；
- `public/ui/**` 截图已包含：目录合计约 11 MB，其中**最大单文件 0.7 MB**
  （`s07-plan-panel.png`，715 KB），无 >50 MB 文件；
- `promo/materials` 不含 63 页课程章节 PDF（`第3章 应收款项及预防账款.pdf`）。
