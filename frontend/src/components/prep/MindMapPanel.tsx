import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, ImageDown, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError, parseApiDetail } from '@/api/client'
import { getSourceTree, listSources } from '@/api/sources'
import type { SourceOut, TreeNode } from '@/api/types/sources'
import { EmptyView, ErrorView, LoadingView } from '../ui/StateViews'
import { useToast } from '../ui/Toast'

/**
 * 只读思维导图：数据来自 `GET /api/sources/{id}/tree`。
 *
 * 后端没有知识点写接口，所以这里只读渲染，不提供任何编辑能力；
 * 层级映射规则：
 * - 中心节点 = 资料标题；
 * - 一级知识点 = 分支，最多 5 条，超出部分渲染为「更多 N 项」文字节点；
 * - 更深层级全部拍平成叶子。
 */

/** 分支锚点按数组索引分配，与 SVG 连线共用同一百分比坐标系 */
const BRANCH_ANCHORS = [
  { x: 27, y: 20 },
  { x: 27, y: 64 },
  { x: 73, y: 20 },
  { x: 73, y: 64 },
  { x: 50, y: 86 },
]
const CENTER = { x: 50, y: 47 }
const MAX_BRANCHES = 5
const MAX_LEAVES = 6
const BRANCH_COLORS = ['#4d94ff', '#9b7ef4', '#f2a93b', '#4cb051', '#ef6f9e']

/** 分支在画布上的布局方向：0/1 叶子朝左，2/3 叶子朝右，4 叶子在下方 */
function branchSide(index: number): 'left' | 'right' | 'bottom' {
  const side = index % MAX_BRANCHES
  if (side === 0 || side === 1) return 'left'
  if (side === 2 || side === 3) return 'right'
  return 'bottom'
}

/** 收集某个分支下所有后代的标题（任意深度拍平成叶子）。 */
function collectDescendantTitles(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    acc.push(node.title)
    if (node.children && node.children.length > 0) {
      collectDescendantTitles(node.children, acc)
    }
  }
  return acc
}

function LeafChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      data-testid="mindmap-node"
      className="flex max-w-[190px] items-center gap-1 truncate whitespace-nowrap rounded-md border px-2 py-1 text-[11.5px]"
      style={{ borderColor: `${color}55`, background: `${color}0d`, color }}
      title={label}
    >
      {label}
    </span>
  )
}

function BranchNode({
  label,
  leaves,
  index,
}: {
  label: string
  leaves: string[]
  index: number
}) {
  const side = branchSide(index)
  const anchor = BRANCH_ANCHORS[index % BRANCH_ANCHORS.length]
  const color = BRANCH_COLORS[index % BRANCH_COLORS.length]
  const shown = leaves.slice(0, MAX_LEAVES)
  const hidden = leaves.length - shown.length

  const node = (
    <span
      data-testid="mindmap-node"
      className="flex max-w-[210px] shrink-0 items-center gap-1.5 truncate rounded-lg border-2 px-3.5 py-1.5 text-[13px] font-semibold shadow-sm"
      style={{ borderColor: color, background: `${color}14`, color }}
      title={label}
    >
      {label}
    </span>
  )

  const leafList = (
    <div className={`flex flex-col gap-1.5 ${side === 'left' ? 'items-end' : 'items-start'}`}>
      {shown.map((leaf, i) => (
        <LeafChip key={`${leaf}-${i}`} label={leaf} color={color} />
      ))}
      {hidden > 0 && (
        <span className="text-[11px] text-ink-mute">…共 {leaves.length} 项</span>
      )}
    </div>
  )

  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
    >
      {side === 'left' && (
        <div className="flex items-center gap-2">
          {leafList}
          {node}
        </div>
      )}
      {side === 'right' && (
        <div className="flex items-center gap-2">
          {node}
          {leafList}
        </div>
      )}
      {side === 'bottom' && (
        <div className="flex flex-col items-center gap-2">
          {node}
          {shown.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {shown.map((leaf, i) => (
                <LeafChip key={`${leaf}-${i}`} label={leaf} color={color} />
              ))}
            </div>
          )}
          {hidden > 0 && (
            <span className="text-[11px] text-ink-mute">…共 {leaves.length} 项</span>
          )}
        </div>
      )}
    </div>
  )
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const parsed = parseApiDetail(error.detail)
    return parsed.message || error.detail
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function MindMapPanel({ sourceId }: { sourceId?: string }) {
  const [sources, setSources] = useState<SourceOut[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(!sourceId)
  const [sourcesError, setSourcesError] = useState('')
  const [selectedId, setSelectedId] = useState(sourceId ?? '')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [treeReloadKey, setTreeReloadKey] = useState(0)
  const [zoom, setZoom] = useState(100)
  const { showToast } = useToast()

  useEffect(() => {
    if (sourceId) {
      setSelectedId(sourceId)
      setSources([])
      setSourcesLoading(false)
      setSourcesError('')
      return
    }
    let cancelled = false
    setSourcesLoading(true)
    setSourcesError('')
    listSources()
      .then((list) => {
        if (cancelled) return
        setSources(list)
        const preferred = list.find((item) => item.status === 'ready') ?? list[0]
        setSelectedId((prev) => prev || preferred?.id || '')
      })
      .catch((caught) => {
        if (!cancelled) setSourcesError(describeError(caught, '资料列表加载失败'))
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId])

  useEffect(() => {
    if (!selectedId) {
      setTree([])
      setTreeError('')
      setTreeLoading(false)
      return
    }
    let cancelled = false
    setTreeLoading(true)
    setTreeError('')
    getSourceTree(selectedId)
      .then((nodes) => {
        if (!cancelled) setTree(nodes)
      })
      .catch((caught) => {
        if (cancelled) return
        setTree([])
        setTreeError(describeError(caught, '知识点加载失败'))
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, treeReloadKey])

  const selectedSource = useMemo(
    () => sources.find((item) => item.id === selectedId) ?? null,
    [sources, selectedId],
  )
  const centerTitle = selectedSource?.title ?? '思维导图'

  const branches = tree.slice(0, MAX_BRANCHES)
  const overflow = tree.length - branches.length

  const retry = useCallback(() => setTreeReloadKey((key) => key + 1), [])

  if (sourcesLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" data-testid="mindmap-region">
        <LoadingView />
      </div>
    )
  }

  if (sourcesError) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" data-testid="mindmap-region">
        <ErrorView message={sourcesError} onRetry={() => setTreeReloadKey((key) => key + 1)} />
      </div>
    )
  }

  if (!sourceId && sources.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" data-testid="mindmap-region">
        <EmptyView
          title="去资料库选择资料"
          description="上传并解析资料后，知识点树会自动出现在这里。"
          action={
            <Link to="/library" className="btn-primary h-9 px-4">
              前往资料库
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="mindmap-region">
      {/* 资料来源选择行 */}
      <div className="flex flex-wrap items-center gap-3">
        {!sourceId && (
          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            资料
            <select
              className="field-input w-[280px]"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              data-testid="mindmap-source-select"
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.status === 'ready' ? '' : '（未就绪）'}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="text-[12px] text-ink-mute">思维导图由知识点树自动生成，只读</span>
      </div>

      {/* 画布 */}
      <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 工具行 */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen size={16} className="shrink-0 text-primary" />
            <span className="truncate text-[14px] font-bold text-ink" data-testid="mindmap-title">
              {centerTitle}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="刷新知识点"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-page hover:text-ink"
              onClick={() => setTreeReloadKey((key) => key + 1)}
            >
              <RefreshCw size={15} />
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
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] text-ink-soft transition hover:bg-page hover:text-ink"
              onClick={() => showToast('导出图像功能即将上线')}
            >
              <ImageDown size={14} />
              导出图像
            </button>
          </div>
        </div>

        {/* 画布主体 */}
        <div className="dot-grid relative min-h-0 flex-1 overflow-hidden">
          {treeLoading ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-mute">
              正在加载思维导图…
            </div>
          ) : treeError ? (
            <ErrorView message={treeError} onRetry={retry} />
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
                {branches.map((b, i) => {
                  const a = BRANCH_ANCHORS[i % BRANCH_ANCHORS.length]
                  const dx = a.x > CENTER.x ? 14 : a.x < CENTER.x ? -14 : 0
                  const dy = a.y > CENTER.y ? 16 : -16
                  return (
                    <path
                      key={b.id}
                      d={`M ${CENTER.x} ${CENTER.y} C ${CENTER.x + dx} ${CENTER.y + dy * 0.3}, ${a.x - dx * 0.4} ${a.y - dy * 0.6}, ${a.x} ${a.y}`}
                      fill="none"
                      stroke={BRANCH_COLORS[i % BRANCH_COLORS.length]}
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
                <span
                  data-testid="mindmap-node"
                  className="flex max-w-[260px] items-center gap-2 truncate whitespace-nowrap rounded-xl bg-gradient-to-br from-[#4a90ff] to-primary px-6 py-2.5 text-[16px] font-bold text-white shadow-[0_6px_20px_rgba(46,124,246,0.35)]"
                  title={centerTitle}
                >
                  {centerTitle}
                </span>
              </div>

              {/* 分支 */}
              {branches.map((b, i) => (
                <BranchNode
                  key={b.id}
                  label={b.title}
                  leaves={collectDescendantTitles(b.children ?? [])}
                  index={i}
                />
              ))}

              {overflow > 0 && (
                <div className="absolute inset-x-0 bottom-3 z-10 text-center text-[12px] text-ink-mute">
                  更多 {overflow} 项
                </div>
              )}

              {tree.length === 0 && (
                <div
                  className="absolute inset-x-0 bottom-8 z-10 text-center text-[12.5px] text-ink-mute"
                  data-testid="mindmap-empty-hint"
                >
                  该资料还没有知识点，可在资料详情页点击「生成笔记」。
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
