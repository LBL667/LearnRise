import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, FileText, Loader2, RotateCw } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, parseApiDetail, TIMEOUTS } from '@/api/client'
import { createSourceNotes, getSource, getSourceTree, reprocessSource } from '@/api/sources'
import type { SourceDetail, TreeNode } from '@/api/types/sources'
import { ErrorView, LoadingView, NotFoundView } from '@/components/ui/StateViews'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'

const POLL_INTERVAL_MS = 800
const POLL_TIMEOUT_MS = 120_000
const TERMINAL_STATUSES = new Set(['ready', 'ready_empty', 'failed'])
const BUSY_STATUSES = new Set(['parsing', 'embedding'])

interface PollSession {
  cancelled: boolean
  timer: number | null
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const parsed = parseApiDetail(error.detail)
    return parsed.message || error.detail
  }
  if (error instanceof Error && error.message) return error.message
  return '资料加载失败，请稍后重试'
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-mute">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{children}</dd>
    </div>
  )
}

interface TreeNodesProps {
  nodes: TreeNode[]
  depth: number
  visited: Set<string>
  highlighted: Set<string>
  onOpen: (id: string) => void
}

function TreeNodes({ nodes, depth, visited, highlighted, onOpen }: TreeNodesProps) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 space-y-1 border-l border-line pl-4'}>
      {nodes.map((node) => {
        if (visited.has(node.id)) return null
        const nextVisited = new Set(visited)
        nextVisited.add(node.id)
        const mastery = Math.max(0, Math.min(100, Math.round(node.mastery_score * 100)))
        return (
          <li key={node.id}>
            <button
              type="button"
              data-testid="tree-node"
              onClick={() => onOpen(node.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] text-ink transition hover:border-line hover:bg-page ${
                highlighted.has(node.id) ? 'border-primary/40 bg-primary-soft-2' : ''
              }`}
            >
              <span className="truncate">{node.title}</span>
              <span className="chip shrink-0" title="掌握度">
                {mastery}%
              </span>
            </button>
            {node.children && node.children.length > 0 && (
              <TreeNodes
                nodes={node.children}
                depth={depth + 1}
                visited={nextVisited}
                highlighted={highlighted}
                onOpen={onOpen}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function SourceDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [source, setSource] = useState<SourceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState('')
  const [treeReloadKey, setTreeReloadKey] = useState(0)
  const [notesPending, setNotesPending] = useState(false)
  const [newRootIds, setNewRootIds] = useState<Set<string>>(new Set())
  const pollRef = useRef<PollSession | null>(null)

  const cancelPolling = useCallback(() => {
    const session = pollRef.current
    if (session) {
      session.cancelled = true
      if (session.timer !== null) window.clearTimeout(session.timer)
    }
    pollRef.current = null
  }, [])

  useEffect(() => () => cancelPolling(), [cancelPolling])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setNotFound(false)
    getSource(id)
      .then((body) => {
        if (!cancelled) setSource(body)
      })
      .catch((caught) => {
        if (cancelled) return
        setSource(null)
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true)
        } else {
          setError(describeError(caught))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setTreeLoading(true)
    setTreeError('')
    getSourceTree(id)
      .then((nodes) => {
        if (!cancelled) setTree(nodes)
      })
      .catch((caught) => {
        if (cancelled) return
        setTree([])
        setTreeError(describeError(caught))
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, treeReloadKey])

  const handleGenerateNotes = useCallback(async () => {
    if (!source || notesPending) return
    setNotesPending(true)
    setActionError('')
    try {
      const result = await createSourceNotes(source.id, {}, { timeoutMs: TIMEOUTS.notes })
      showToast(`${result.knowledge_points_created} 个知识点已生成`, 'success')
      setNewRootIds(new Set(result.root_ids))
      setTreeReloadKey((key) => key + 1)
    } catch (caught) {
      setActionError(describeError(caught))
    } finally {
      setNotesPending(false)
    }
  }, [source, notesPending, showToast])

  const waitForJob = useCallback(async (jobId: string, session: PollSession) => {
    const startedAt = Date.now()
    while (!session.cancelled) {
      const job = await api.getJob(jobId)
      if (session.cancelled) return
      if (TERMINAL_STATUSES.has(job.status)) return
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error('重新解析超时，请稍后在资料库中刷新查看')
      }
      await new Promise<void>((resolve) => {
        session.timer = window.setTimeout(resolve, POLL_INTERVAL_MS)
      })
      session.timer = null
    }
  }, [])

  const handleReprocess = useCallback(async () => {
    if (!source || processing || BUSY_STATUSES.has(source.status)) return
    cancelPolling()
    const session: PollSession = { cancelled: false, timer: null }
    pollRef.current = session
    setProcessing(true)
    setActionError('')
    try {
      const accepted = await reprocessSource(source.id)
      if (session.cancelled) return
      setSource((prev) =>
        prev ? { ...prev, status: 'pending', error_message: null } : prev,
      )
      await waitForJob(accepted.job_id, session)
      if (session.cancelled) return
      const fresh = await getSource(source.id)
      if (!session.cancelled) setSource(fresh)
    } catch (caught) {
      if (!session.cancelled) setActionError(describeError(caught))
    } finally {
      if (!session.cancelled) setProcessing(false)
      if (pollRef.current === session) pollRef.current = null
    }
  }, [cancelPolling, processing, source, waitForJob])

  const busy = source !== null && BUSY_STATUSES.has(source.status)
  const disabled = processing || busy

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6" data-testid="page-source-detail">
      <Link
        to="/library"
        className="flex w-fit items-center gap-0.5 text-[13px] text-ink-soft transition hover:text-primary"
      >
        <ChevronLeft size={16} />
        返回资料库
      </Link>

      {loading ? (
        <div className="mt-4">
          <LoadingView />
        </div>
      ) : notFound ? (
        <NotFoundView title="资料不存在" description="该资料不存在，或你无权访问。" />
      ) : error ? (
        <div className="mt-4">
          <ErrorView message={error} onRetry={retry} />
        </div>
      ) : source ? (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-bold text-ink">{source.title}</h1>
              <p className="mt-1 text-[13px] text-ink-soft">{source.filename}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                className="btn-primary gap-1.5"
                data-testid="source-reprocess"
                onClick={() => void handleReprocess()}
                disabled={disabled}
              >
                {processing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RotateCw size={15} />
                )}
                {processing ? '处理中…' : '重新解析'}
              </button>
              {busy && !processing && (
                <p className="text-[11.5px] text-ink-mute" data-testid="source-reprocess-hint">
                  该资料正在解析中，完成前无法重新解析。
                </p>
              )}
            </div>
          </div>

          {actionError && (
            <div
              role="alert"
              data-testid="source-action-error"
              className="mt-3 flex items-center gap-2 rounded-lg border border-[#f3c9c9] bg-[#fdecec] px-3 py-2 text-[12.5px] text-[#c24545]"
            >
              <AlertTriangle size={14} />
              {actionError}
            </div>
          )}

          <section className="card mt-5 p-5" data-testid="source-meta">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem label="标题">{source.title}</DetailItem>
              <DetailItem label="文件名">{source.filename}</DetailItem>
              <DetailItem label="类型">{source.content_type}</DetailItem>
              <DetailItem label="大小">{formatSize(source.size_bytes)}</DetailItem>
              <DetailItem label="页数">{source.page_count ?? '—'}</DetailItem>
              <DetailItem label="状态">
                <span data-testid="source-status">
                  <StatusBadge status={source.status} />
                </span>
              </DetailItem>
              <DetailItem label="创建时间">{formatTime(source.created_at)}</DetailItem>
              <DetailItem label="更新时间">{formatTime(source.updated_at)}</DetailItem>
            </dl>

            {source.status === 'failed' && (
              <div
                data-testid="source-error-message"
                className="mt-4 rounded-lg border border-[#f3c9c9] bg-[#fdecec] px-3 py-2 text-[12.5px] leading-6 text-[#c24545]"
              >
                <div className="font-semibold">解析失败</div>
                <p className="whitespace-pre-wrap">
                  {source.error_message ?? '解析失败，未返回错误信息。'}
                </p>
              </div>
            )}
          </section>

          <section className="card mt-4 p-5" data-testid="source-knowledge-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-bold text-ink">知识结构</h2>
                <p className="mt-1 text-[12.5px] text-ink-mute">
                  知识点树来自「生成笔记」，点击节点可查看详情。
                </p>
              </div>
              <button
                type="button"
                className="btn-primary gap-1.5"
                data-testid="source-generate-notes"
                onClick={() => void handleGenerateNotes()}
                disabled={notesPending || source.status === 'failed'}
              >
                {notesPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FileText size={15} />
                )}
                {notesPending ? '生成中…' : '生成笔记'}
              </button>
            </div>

            <div className="mt-4" data-testid="source-tree">
              {treeLoading ? (
                <p
                  className="py-6 text-center text-[13px] text-ink-mute"
                  data-testid="source-tree-loading"
                >
                  正在加载知识点…
                </p>
              ) : treeError ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-[13px] text-ink-soft">{treeError}</p>
                  <button
                    type="button"
                    className="btn-ghost h-8 px-3 text-[12.5px]"
                    data-testid="source-tree-retry"
                    onClick={() => setTreeReloadKey((key) => key + 1)}
                  >
                    重试
                  </button>
                </div>
              ) : tree.length === 0 ? (
                <p
                  className="py-6 text-center text-[13px] text-ink-mute"
                  data-testid="source-tree-empty"
                >
                  该资料还没有知识点，点击「生成笔记」自动生成。
                </p>
              ) : (
                <TreeNodes
                  nodes={tree}
                  depth={0}
                  visited={new Set()}
                  highlighted={newRootIds}
                  onOpen={(kpId) => navigate(`/kp/${kpId}`)}
                />
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
