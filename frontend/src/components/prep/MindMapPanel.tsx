import { useEffect, useState } from 'react'
import {
  BookOpen,
  Eraser,
  ImageDown,
  Maximize,
  Pencil,
  Plus,
  RefreshCcw,
  RefreshCcwDot,
  Save,
  Sparkles,
} from 'lucide-react'
import { api } from '@/api/client'
import type { MindMapBranch, MindMapData } from '@/api/types'
import { useToast } from '../ui/Toast'

/** 分支锚点按数组索引分配（任意分支 id 均适用），与 SVG 连线共用同一百分比坐标系 */
const BRANCH_ANCHORS = [
  { x: 27, y: 20 },
  { x: 27, y: 64 },
  { x: 73, y: 20 },
  { x: 73, y: 64 },
  { x: 50, y: 86 },
]
const CENTER = { x: 50, y: 47 }

/** 分支在画布上的布局方向：0/1 叶子朝左，2/3 叶子朝右，4 叶子在下方 */
function branchSide(index: number): 'left' | 'right' | 'bottom' {
  const side = index % 5
  if (side === 0 || side === 1) return 'left'
  if (side === 2 || side === 3) return 'right'
  return 'bottom'
}

function BranchNode({
  branch,
  index,
  onAddLeaf,
}: {
  branch: MindMapBranch
  index: number
  onAddLeaf: (branchId: string) => void
}) {
  const side = branchSide(index)
  const anchor = BRANCH_ANCHORS[index % BRANCH_ANCHORS.length]

  const node = (
    <span
      className="flex shrink-0 cursor-default items-center gap-1.5 rounded-lg border-2 px-3.5 py-1.5 text-[13px] font-semibold shadow-sm"
      style={{ borderColor: branch.color, background: `${branch.color}14`, color: branch.color }}
    >
      {branch.label}
      <Pencil size={11} className="opacity-60" />
    </span>
  )

  const leaves = (
    <div className={`flex flex-col gap-1.5 ${side === 'left' ? 'items-end' : 'items-start'}`}>
      {branch.leaves.map((leaf, i) => (
        <span
          key={`${leaf}-${i}`}
          className="flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11.5px]"
          style={{ borderColor: `${branch.color}55`, background: `${branch.color}0d`, color: branch.color }}
        >
          {leaf}
          <Pencil size={9} className="opacity-50" />
        </span>
      ))}
    </div>
  )

  const addBtn = (
    <button
      aria-label={`在「${branch.label}」下添加知识点`}
      onClick={() => onAddLeaf(branch.id)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed text-ink-mute transition hover:border-primary hover:text-primary"
      style={{ borderColor: `${branch.color}88`, color: branch.color }}
    >
      <Plus size={13} />
    </button>
  )

  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
    >
      {side === 'left' && (
        <div className="flex items-center gap-2">
          {leaves}
          {node}
        </div>
      )}
      {side === 'right' && (
        <div className="flex items-center gap-2">
          {node}
          {leaves}
        </div>
      )}
      {side === 'bottom' && (
        <div className="flex flex-col items-center gap-2">
          {node}
          <div className="grid grid-cols-2 gap-1.5">
            {branch.leaves.map((leaf, i) => (
              <span
                key={`${leaf}-${i}`}
                className="flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11.5px]"
                style={{ borderColor: `${branch.color}55`, background: `${branch.color}0d`, color: branch.color }}
              >
                {leaf}
                <Pencil size={9} className="opacity-50" />
              </span>
            ))}
          </div>
        </div>
      )}
      <div className={`mt-1 ${side === 'left' ? 'text-right' : side === 'right' ? 'text-left' : 'text-center'}`}>
        {addBtn}
      </div>
    </div>
  )
}

export function MindMapPanel() {
  const [data, setData] = useState<MindMapData | null>(null)
  const [input, setInput] = useState('')
  const [zoom, setZoom] = useState(100)
  const [generating, setGenerating] = useState(false)
  const [cleared, setCleared] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    void (async () => {
      setData(await api.getDefaultMindMap())
    })()
  }, [])

  const generate = async () => {
    const topic = input.trim()
    if (!topic) {
      showToast('请输入需要生成思维导图的章节内容', 'error')
      return
    }
    setGenerating(true)
    try {
      setData(await api.generateMindMap(topic))
      setCleared(false)
      showToast('思维导图已生成')
    } finally {
      setGenerating(false)
    }
  }

  const addLeaf = (branchId: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        branches: prev.branches.map((b) =>
          b.id === branchId ? { ...b, leaves: [...b.leaves, '新知识点'] } : b,
        ),
      }
    })
    showToast('已添加节点，可点击节点文字编辑')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 生成输入行 */}
      <div className="flex items-center gap-3">
        <input
          className="field-input flex-1"
          placeholder="请输入需要生成思维导图的章节内容…"
          maxLength={200}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void generate()}
        />
        <span className="shrink-0 text-[12px] text-ink-mute">{input.length}/200</span>
        <button className="btn-primary shrink-0 px-5" disabled={generating} onClick={() => void generate()}>
          <Sparkles size={15} />
          {generating ? '生成中…' : 'AI生成思维导图'}
        </button>
      </div>

      {/* 画布 */}
      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 工具行 */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen size={16} className="shrink-0 text-primary" />
            <span className="truncate text-[14px] font-bold text-ink">{data?.title ?? '思维导图'}</span>
            <button
              aria-label="重命名"
              className="text-ink-mute transition hover:text-primary"
              onClick={() => showToast('重命名功能即将上线')}
            >
              <Pencil size={13} />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="撤销"
              disabled
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute opacity-40"
            >
              <RefreshCcw size={15} />
            </button>
            <button
              aria-label="重做"
              disabled
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute opacity-40"
            >
              <RefreshCcwDot size={15} />
            </button>
            <button
              aria-label="全屏"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-page hover:text-ink"
              onClick={() => showToast('全屏预览即将上线')}
            >
              <Maximize size={15} />
            </button>
            <div className="mx-1 flex h-8 items-center rounded-lg border border-line">
              <button
                aria-label="缩小"
                className="flex h-full w-8 items-center justify-center text-ink-soft hover:text-primary"
                onClick={() => setZoom((z) => Math.max(60, z - 10))}
              >
                −
              </button>
              <span className="w-11 text-center text-[12px] text-ink-soft">{zoom}%</span>
              <button
                aria-label="放大"
                className="flex h-full w-8 items-center justify-center text-ink-soft hover:text-primary"
                onClick={() => setZoom((z) => Math.min(150, z + 10))}
              >
                +
              </button>
            </div>
            <button
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] text-ink-soft transition hover:bg-page hover:text-[#e25050]"
              onClick={() => {
                setCleared(true)
                showToast('画布已清空，可在上方输入章节重新生成')
              }}
            >
              <Eraser size={14} />
              清空画布
            </button>
            <button
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] text-ink-soft transition hover:bg-page hover:text-ink"
              onClick={() => showToast('导出图像功能即将上线')}
            >
              <ImageDown size={14} />
              导出图像
            </button>
            <button
              className="flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-[12.5px] text-ink transition hover:border-primary hover:text-primary"
              onClick={() => showToast('思维导图已保存')}
            >
              <Save size={14} />
              保存
            </button>
          </div>
        </div>

        {/* 画布主体 */}
        <div className="dot-grid relative min-h-0 flex-1 overflow-hidden">
          {cleared ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-mute">
              <Eraser size={28} className="opacity-50" />
              <span className="text-[13px]">画布已清空，输入章节内容后点击「AI生成思维导图」</span>
            </div>
          ) : !data ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-mute">
              正在加载思维导图…
            </div>
          ) : (
            <div
              className="h-full w-full transition-transform duration-200"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              {/* 连接线 */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {data.branches.map((b, i) => {
                  const a = BRANCH_ANCHORS[i % BRANCH_ANCHORS.length]
                  const dx = a.x > CENTER.x ? 14 : a.x < CENTER.x ? -14 : 0
                  const dy = a.y > CENTER.y ? 16 : -16
                  return (
                    <path
                      key={b.id}
                      d={`M ${CENTER.x} ${CENTER.y} C ${CENTER.x + dx} ${CENTER.y + dy * 0.3}, ${a.x - dx * 0.4} ${a.y - dy * 0.6}, ${a.x} ${a.y}`}
                      fill="none"
                      stroke={b.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      opacity={0.75}
                    />
                  )
                })}
              </svg>

              {/* 中心节点 */}
              <div
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${CENTER.x}%`, top: `${CENTER.y}%` }}
              >
                <span className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-br from-[#4a90ff] to-primary px-6 py-2.5 text-[16px] font-bold text-white shadow-[0_6px_20px_rgba(46,124,246,0.35)]">
                  {data.center}
                  <Pencil size={13} className="opacity-70" />
                </span>
              </div>

              {/* 分支 */}
              {data.branches.map((b, i) => (
                <BranchNode key={b.id} branch={b} index={i} onAddLeaf={addLeaf} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
