# LearnRise Penpot 页面规格编辑手册

本目录只负责「规格 + 构建器」，16 个页面 board 由 T13/T14 用本构建器生成。所有页面内容都在 `specs/pages.json`，不在 JS 里。

```
learnrise-penpot/
  specs/pages.json    16 页：id / name / route / blocks / copy / dataRefs / size
  specs/cast.json     4 名学生 + 2 名教师 + 竞赛 + 资料（来自 promo_manifest.json）
  specs/tokens.json   14 个设计 token（13 色 + radius.card=14）
  build.js            Penpot 插件 API 构建库（frame/card/table/badge/text/statCard/chartPlaceholder/sidebar/topbar…）
  build-page.js       单页入口；--dry-run 只读
  mcp.py              Penpot MCP 客户端
  export2x.py         批量导出：PNG @2x（2880×1800）+ SVG（viewBox 0 0 1440 900）
  make_contact_sheet.py  16 页拼版 → out/mockups/contact-sheet.png
```

**统一命令目录**（下文所有命令都从这里执行）：

```bash
cd /home/sky/竞赛/华为ICT-evidence/learnrise-penpot
```

**页面 id 速查**：

| id | 名称 | 路由 | board 名 |
|---|---|---|---|
| login | 登录 | `/login` | `PAGE / 登录` |
| community | 竞赛空间 | `/` | `PAGE / 竞赛空间` |
| competition | 竞赛详情 | `/competition/:id` | `PAGE / 竞赛详情` |
| prep | 备赛区 | `/prep` | `PAGE / 备赛区` |
| trial | 赛题试炼 | `/trial` | `PAGE / 赛题试炼` |
| review | 间隔复习 | `/review` | `PAGE / 间隔复习` |
| promotion | 晋级赛 | `/promo` | `PAGE / 晋级赛` |
| rank | 排行榜 | `/rank` | `PAGE / 排行榜` |
| profile | 个人中心 | `/profile` | `PAGE / 个人中心` |
| kp | 知识点 | `/kp/:id` | `PAGE / 知识点` |
| dashboard | 学习看板 | `/dashboard` | `PAGE / 学习看板` |
| library | 资料库 | `/library` | `PAGE / 资料库` |
| source | 资料详情 | `/library/:id` | `PAGE / 资料详情` |
| quiz | 刷题 | `/quiz` | `PAGE / 刷题` |
| practice | 陪练 | `/practice` | `PAGE / 陪练` |
| agents | Agent 设置 | `/settings/agents` | `PAGE / Agent 设置` |

`build-page.js` 接受 id、中文名、路由、board 名或序号（如 `8` / `08`）。查看全部：

```bash
node build-page.js --list
```

---

## 1. 改文案（copy）

**改哪里**：`specs/pages.json` → 对应页面的 `copy` 对象。块里的 `{{copy.xxx}}` 会自动取新值。

例：把排行榜副标题改成「本周榜单」。

```bash
python3 - <<'PY'
import json
p = 'specs/pages.json'
data = json.load(open(p, encoding='utf-8'))
for page in data['pages']:
    if page['id'] == 'rank':
        page['copy']['subtitle'] = '本周榜单'
json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
node build-page.js rank --dry-run
node build-page.js rank
```

只重建这一页；board 名 `PAGE / 排行榜` 不变，构建器会先删除同名旧 board 再原位置重建，不会产生副本。

**注意**：`copy` 只放文案；分数、姓名等数据放 `specs/cast.json`。

---

## 2. 改数据（cast）

**改哪里**：不要手改 `specs/cast.json`，它是生成物。源文件是
`/home/sky/竞赛/华为ICT-evidence/learnrise-promo/promo_manifest.json` 的 `students[]`
（`points` 决定排序，`rank` 由生成器重算；教师来自 `users[]` 中 `role === "teacher"`）。

在**视频工程**里执行生成器（它会同时重写视频侧和本目录的 cast）：

```bash
cd /home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min
npm run sync-cast
```

`sync-cast` 只写两个文件：
`src/content/cast.ts` 和
`/home/sky/竞赛/华为ICT-evidence/learnrise-penpot/specs/cast.json`；
不会修改 `specs/pages.json` 或其它 spec。默认读取上面的 manifest，也可显式指定：

```bash
node scripts/sync-cast.mjs \
  --manifest=/home/sky/竞赛/华为ICT-evidence/learnrise-promo/promo_manifest.json \
  --penpot=/home/sky/竞赛/华为ICT-evidence/learnrise-penpot/specs
```

例：把李四的分数从 876 改成 877，然后只重建排行榜页：

```bash
python3 - <<'PY'
import json
p = '/home/sky/竞赛/华为ICT-evidence/learnrise-promo/promo_manifest.json'
data = json.load(open(p, encoding='utf-8'))
for row in data['students']:
    if row['name'] == '李四':
        row['points'] = 877
json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
cd /home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min
npm run sync-cast
cd /home/sky/竞赛/华为ICT-evidence/learnrise-penpot
node build-page.js rank --dry-run
node build-page.js rank
python3 export2x.py --page rank --force
```

回归视频时再执行 `npm run render:scene -- S09`（排行榜场景读 `cast.ts`）。

排行榜块的 `names` / `points` 数组只是 dry-run 可读性快照；实际渲染始终以
`rowsRef: "cast.leaderboard"` 为准。所以 `sync-cast` 后直接重建 `rank` 就会反映新分数，
无需同步 `specs/pages.json`（若想消除陈旧快照，可删除这两个字段，构建不受影响）。

**禁止**：不要把王老师/周老师加进 `leaderboard`；不要给排行榜加「加载更多 / 分页」文案，规格里
`pagination` 固定为 `false`。教师只放在 `teachers` 数组。

---

## 3. 改颜色 / 圆角 token

**改哪里（两处，必须一致）**：

1. `specs/tokens.json` 的 `tokens`（构建器绘制用的值）。
2. Penpot 文件里的 token set `LearnRise Foundations`（12 个组件实例用的值）。

只改第 1 处，新建的页面文字/占位块会用新色，但 12 个组件的 master 仍是旧色。

例：把主色改成 `#2F7DF7`。

```bash
python3 - <<'PY'
import json
p = 'specs/tokens.json'
data = json.load(open(p, encoding='utf-8'))
data['tokens']['color.primary'] = '#2F7DF7'
json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
```

然后在 Penpot UI 打开 `LearnRise Foundations` token set，把 `color.primary` 改成同一个值；或者用 MCP：

```bash
cat > /tmp/update-primary-token.js <<'JS'
(() => {
  const set = penpot.library.local.tokens.sets['LearnRise Foundations'];
  const token = set.tokens.find(t => t.name === 'color.primary');
  token.value = '#2F7DF7';
  return { name: token.name, value: token.value };
})()
JS
python3 mcp.py exec /tmp/update-primary-token.js
```

最后全量重建（16 页）：

```bash
node build-page.js --all
```

**约束**：只能使用 `specs/tokens.json` 里的 14 个 token；不要引入 Tailwind 通用色或新的魔法色值。
`radius.card` 当前是 `14`，对应 `frontend/src/index.css` 的 `--radius-card: 14px`。

---

## 4. 增加一页

1. 从 `LearnRise/frontend/src/App.tsx` 抄真实路由；从 `frontend/src/pages/*.tsx` 抄真实标题、按钮、表头。
2. 在 `specs/pages.json` 的 `pages` 数组末尾追加一项（16 → 17）：

```json
{
  "id": "example",
  "order": 17,
  "name": "示例页",
  "route": "/example",
  "layout": "app",
  "size": { "width": 1440, "height": 900 },
  "aliases": ["example", "示例页", "ExamplePage", "/example"],
  "copy": { "title": "示例页", "subtitle": "这是示例页副标题。" },
  "dataRefs": [],
  "blocks": [
    { "id": "sidebar", "type": "sidebar", "name": "侧边栏", "span": 12, "props": { "active": "竞赛空间" } },
    { "id": "topbar", "type": "topbar", "name": "顶栏", "span": 12, "props": { "user": "小红" } },
    { "id": "header", "type": "pageHeader", "name": "页面标题", "span": 12, "height": 72, "props": { "title": "{{copy.title}}", "subtitle": "{{copy.subtitle}}" } },
    { "id": "body", "type": "card", "name": "正文", "span": 12, "height": 240, "props": { "title": "{{copy.title}}", "body": "{{copy.subtitle}}" } }
  ]
}
```

3. 先 dry-run 确认 block 顺序和坐标，再构建：

```bash
node build-page.js example --dry-run
node build-page.js example
```

**可用 block type**：`sidebar`、`topbar`、`pageHeader`、`card`、`statCard`、`table`、`badge`、`text`、
`chartPlaceholder`、`chartCard`、`button`、`input`、`emptyState`、`avatar`、`toolbar`、`tabs`、
`backLink`、`heroCard`、`leaderboard`、`questionCard`、`frame`。

自动排版：12 栏网格，`span` 控制列宽，`height` 控制高度；`at: {x,y,w,h}` 可绝对定位（登录页使用）；
`break: true` 强制换行。

---

## 5. 删除一页

1. 从 `specs/pages.json` 的 `pages` 数组删掉该对象（保留其余页面 `order` 连续即可）。
2. dry-run 确认解析不到它，并检查列表少了一页：

```bash
node build-page.js --list
node build-page.js example --dry-run   # 应报「未知页面」并退出 1
```

3. Penpot 里的旧 board 不会自动消失。到 Penpot `Pages` 页删除名为 `PAGE / <名称>` 的 board，或用 MCP：

```bash
cat > /tmp/remove-board.js <<'JS'
(() => {
  const name = 'PAGE / 示例页';
  const root = penpot.currentPage.root;
  const target = (root.children || []).find(s => s.name === name);
  if (target) target.remove();
  return { removed: !!target, name };
})()
JS
python3 mcp.py exec /tmp/remove-board.js
```

---

## 6. `--dry-run`：只读预览（不碰 Penpot）

```bash
node build-page.js rank --dry-run
node build-page.js 08 --dry-run
node build-page.js PAGE\ /\ 排行榜 --dry-run
node build-page.js --all --dry-run
```

输出包含：

- `[dry-run] PAGE / 排行榜` —— 即将构建的 board 名
- `board: 1440×900 @ origin …` —— 尺寸与画布位置
- `blocks (N)` 与每个块的 type / name / 坐标 / 尺寸
- `dataRefs` 与 `copy keys`

**dry-run 是纯读路径**：不调用 `mcp.py`，不创建/删除任何图层。可以随时用它检查规格。

未知页面会退出码 1，并列出全部 16 个合法页面名：

```bash
node build-page.js does-not-exist --dry-run; echo "exit=$?"
```

---

## 7. 构建前置条件与排错

- Penpot 文件已打开，MCP 插件已连接（`python3 mcp.py init` 能返回 session id）。
- 12 个组件必须存在：`Sidebar`、`TopBar`、`PageHeader`、`Card`、`StatCard`、`Table`、`Badge`、
  `Button`、`Input`、`EmptyState`、`ChartCard`、`Avatar`。
- 构建器会把目标页切到 `Pages`（不存在则创建）。Penpot 插件只能在 **当前页** 修改图层；如果
  `build-page.js` 报 `Could not activate the Penpot "Pages" page`，在 Penpot 里手动切到 `Pages` 再重跑。
- 单页构建可能接近 MCP 30 秒上限；超时用 `--dry-run` 检查规格，或分页构建，不要并行跑 MCP。
- 幂等键是 board 名 `PAGE / <名称>`：同名旧 board 会先删除再重建，不会重复。
- 所有 board 固定 `1440×900`；规格里 `size` 不匹配会被 dry-run 暴露。

---

## 8. 最小验证命令

```bash
node --check build.js
node --check build-page.js
node build-page.js rank --dry-run
node build-page.js does-not-exist --dry-run; test $? -ne 0
for p in login community competition prep trial review promotion rank profile kp dashboard library source quiz practice agents; do
  node build-page.js "$p" --dry-run >/dev/null || exit 1
done
echo "16/16 dry-runs ok"
```

---

## 9. 导出 mockup（PNG @2x / SVG / 拼版）

**产物目录**：`out/mockups/`

| 文件 | 规格 |
|---|---|
| `<pageId>@2x.png` | 2880×1800（原生 2x，`Board.export({type:'png',scale:2})`，不是放大） |
| `<pageId>.svg` | `viewBox="0 0 1440 900"`，内嵌同一张原生 2x PNG（见下方说明） |
| `exports.json` | 16 页清单：boardId / PNG 路径·尺寸·字节·sha256 / SVG 路径·字节 |
| `contact-sheet.png` | 4×4 拼版，每格下方标注中文页名 + 路由 |

**全量导出（保留已验证的 `rank@2x.png`）**：

```bash
python3 export2x.py --all --keep-rank
```

**单页重导**（例如改完文案/数据后）：

```bash
node build-page.js rank
python3 export2x.py --page rank --force
```

> `--keep-rank` 只对 `rank` 生效：若 `rank@2x.png` 仍是 2880×1800 且 sha256 为
> `a85983f9f5ae78714c74c7c347a8b34e716db9e4ad2dc11c070a0a72db7cc9d5`，则跳过重导，避免回归。

**为什么不用 `mcp.py export <boardId> png 2 out.png`**：
MCP 的 `export_shape` 工具 schema 只有 `shapeId/format/mode`，`scale` 参数被忽略，永远只出
1440×900。`export2x.py` 走插件 API：`Board.export({type:'png',scale:2})`，
把 Promise 结果暂存 `globalThis`，再按 45 KB 分块拉 base64 落盘。这是唯一可靠的原生 2x 路径。

**关于 SVG**：Penpot 2.16 的 SVG 导出会把每个文本节点替换成 `foreignObject` 截图，而
`gfont-noto-sans-sc`（10.5 MB TTF）在 exporter 里始终无法完成该截图（30 s 和 180 s 预算均
实测超时，exporter 日志 `waiting for locator('#screenshot-text-… foreignObject')`）。
因此 `<pageId>.svg` 用 `<image>` 内嵌 **同一张原生 2880×1800 PNG**，`viewBox` 仍为
`0 0 1440 900`，像素保真且无放大。若后续 Penpot 修复该 exporter 缺陷，可把
`export2x.py#write_svg_from_png` 换回 `export_board(name, 'svg', ...)`。

**拼版**：

```bash
python3 make_contact_sheet.py     # → out/mockups/contact-sheet.png (2072×1672, 16 cells)
```

**导出后自检（必须全 PASS）**：

```bash
python3 - <<'PY'
import json, re
from PIL import Image
m = json.load(open('out/mockups/exports.json'))['pages']
assert len(m) == 16, len(m)
for pid, rec in m.items():
    assert Image.open(rec['png']['path']).size == (2880, 1800), pid
    assert 'viewBox="0 0 1440 900"' in open(rec['svg']['path'], encoding='utf-8').read(2048), pid
print('16/16 PNG 2880x1800 + 16/16 SVG viewBox 0 0 1440 900')
PY
```

**注意**：重建任何页面都会改变其 boardId。重跑 `python3 mcp.py exec t14-assert.js` 后，
同步刷新 `state.json` 与 `out/mockups/exports.json`（`export2x.py` 会自动写后者）。
