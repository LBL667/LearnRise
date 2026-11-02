import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronLeft, Pencil, Search, Square, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { listAgents } from '@/api/agents'
import { ApiError, parseApiDetail } from '@/api/client'
import { streamExplain } from '@/api/explain'
import {
  getKnowledgePoint,
  removeKnowledgePoint,
  searchKnowledgePoints,
  updateKnowledgePoint,
} from '@/api/knowledge'
import type { AgentOut } from '@/api/types/agents'
import type {
  ExplainStyle,
  KnowledgePointOut,
  KnowledgePointUpdate,
} from '@/api/types/knowledge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyView, ErrorView, LoadingView, NotFoundView } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'

const TITLE_MAX_LENGTH = 500
const SEARCH_MAX_LENGTH = 200
const SEARCH_LIMIT = 20

const STYLE_OPTIONS: { value: ExplainStyle; label: string }[] = [
  { value: 'concise', label: '简洁' },
  { value: 'detailed', label: '详细' },
  { value: 'example', label: '举例' },
  { value: 'socratic', label: '苏格拉底' },
]

interface ExplainError {
  message: string
  raw?: string
}

interface EditErrors {
  title?: string
  sortOrder?: string
}

function describeError(
  error: unknown,
  fallback: string,
): { message: string; raw?: string } {
  if (error instanceof ApiError) {
    let detail: unknown = error.detail
    if (typeof detail === 'string') {
      try {
        detail = JSON.parse(detail)
      } catch {
        detail = error.detail
      }
    }
    const parsed = parseApiDetail(detail)
    return parsed.raw === undefined
      ? { message: parsed.message || fallback }
      : { message: parsed.message || fallback, raw: parsed.raw }
  }
  if (error instanceof Error && error.message) {
    return { message: error.message }
  }
  return { message: fallback }
}

export default function KnowledgePointPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [point, setPoint] = useState<KnowledgePointOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [agents, setAgents] = useState<AgentOut[]>([])

  const [style, setStyle] = useState<ExplainStyle>('concise')
  const [agentId, setAgentId] = useState('')
  const [explainText, setExplainText] = useState('')
  const [explainError, setExplainError] = useState<ExplainError | null>(null)
  const [streaming, setStreaming] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgePointOut[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('0')
  const [editErrors, setEditErrors] = useState<EditErrors>({})
  const [saving, setSaving] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const streamSeq = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    abortRef.current?.abort()
    abortRef.current = null
    streamSeq.current += 1
    setStreaming(false)
    setLoading(true)
    setNotFound(false)
    setLoadError('')
    setPoint(null)
    setExplainText('')
    setExplainError(null)
    getKnowledgePoint(id)
      .then((body) => {
        if (!cancelled) setPoint(body)
      })
      .catch((caught) => {
        if (cancelled) return
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true)
        } else if (caught instanceof ApiError && caught.status === 403) {
          setLoadError('没有权限访问该知识点')
        } else {
          setLoadError(describeError(caught, '知识点加载失败').message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  useEffect(() => {
    let cancelled = false
    listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const cancelStream = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    streamSeq.current += 1
    setStreaming(false)
  }, [])

  const startExplain = useCallback(async () => {
    if (!point) return
    abortRef.current?.abort()
    const seq = ++streamSeq.current
    const controller = new AbortController()
    abortRef.current = controller
    setExplainText('')
    setExplainError(null)
    setStreaming(true)

    const isCurrent = () => mountedRef.current && streamSeq.current === seq

    try {
      await streamExplain(
        point.id,
        {
          onToken: ({ text }) => {
            if (!isCurrent()) return
            setExplainText((prev) => prev + text)
          },
          onDone: () => {
            if (!isCurrent()) return
            setStreaming(false)
            abortRef.current = null
          },
          onError: ({ message }) => {
            if (!isCurrent()) return
            setExplainError({ message })
            setStreaming(false)
            abortRef.current = null
          },
        },
        agentId === '' ? { style } : { agent_id: agentId, style },
        controller.signal,
      )
    } catch (caught) {
      if (!isCurrent() || controller.signal.aborted) return
      setExplainError(describeError(caught, '讲解生成失败'))
      setStreaming(false)
      abortRef.current = null
    } finally {
      if (isCurrent() && !controller.signal.aborted) {
        setStreaming(false)
      }
    }
  }, [point, agentId, style])

  const handleStyleChange = useCallback(
    (next: ExplainStyle) => {
      if (next === style) return
      if (abortRef.current !== null) cancelStream()
      setStyle(next)
      setExplainText('')
      setExplainError(null)
    },
    [style, cancelStream],
  )

  const handleAgentChange = useCallback(
    (next: string) => {
      if (next === agentId) return
      if (abortRef.current !== null) cancelStream()
      setAgentId(next)
      setExplainText('')
      setExplainError(null)
    },
    [agentId, cancelStream],
  )

  const runSearch = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const term = query.trim().slice(0, SEARCH_MAX_LENGTH)
      if (term === '' || searching) return
      setSearching(true)
      setSearchError('')
      try {
        const rows = await searchKnowledgePoints({ q: term, limit: SEARCH_LIMIT })
        if (!mountedRef.current) return
        setResults(rows)
      } catch (caught) {
        if (!mountedRef.current) return
        setResults([])
        setSearchError(describeError(caught, '搜索失败').message)
      } finally {
        if (mountedRef.current) setSearching(false)
      }
    },
    [query, searching],
  )

  const openEdit = useCallback(() => {
    if (!point) return
    setEditTitle(point.title)
    setEditContent(point.content)
    setEditSortOrder(String(point.sort_order))
    setEditErrors({})
    setEditOpen(true)
  }, [point])

  const closeEdit = useCallback(() => {
    if (saving) return
    setEditOpen(false)
  }, [saving])

  const submitEdit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!point || saving) return

      const title = editTitle.trim()
      const sortRaw = editSortOrder.trim()
      const sortOrder = Number(sortRaw)
      const errors: EditErrors = {}
      if (title === '') {
        errors.title = '标题不能为空'
      } else if (title.length > TITLE_MAX_LENGTH) {
        errors.title = `标题不能超过 ${TITLE_MAX_LENGTH} 个字符`
      }
      if (sortRaw !== '' && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
        errors.sortOrder = '排序必须是不小于 0 的整数'
      }
      setEditErrors(errors)
      if (Object.keys(errors).length > 0) return

      setSaving(true)
      try {
        const payload: KnowledgePointUpdate = {
          title,
          content: editContent,
          ...(sortRaw === '' ? {} : { sort_order: sortOrder }),
        }
        const updated = await updateKnowledgePoint(point.id, payload)
        if (!mountedRef.current) return
        setPoint(updated)
        setEditOpen(false)
        showToast('知识点已更新', 'success')
      } catch (caught) {
        showToast(describeError(caught, '知识点更新失败').message, 'error')
      } finally {
        if (mountedRef.current) setSaving(false)
      }
    },
    [point, saving, editTitle, editContent, editSortOrder, showToast],
  )

  const confirmDelete = useCallback(async () => {
    if (!point || deleting) return
    setDeleting(true)
    try {
      await removeKnowledgePoint(point.id)
      showToast('知识点已删除', 'success')
      navigate('/library')
    } catch (caught) {
      showToast(describeError(caught, '知识点删除失败').message, 'error')
      if (mountedRef.current) setDeleting(false)
    }
  }, [point, deleting, navigate, showToast])

  const socraticThinking = streaming && style === 'socratic' && explainText === ''

  return (
    <div className="w-full px-6 py-6" data-testid="page-knowledge-point">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-0.5 text-[13px] text-ink-soft transition hover:text-primary"
      >
        <ChevronLeft size={16} />
        返回
      </button>

      <form className="mt-3 flex items-center gap-2" onSubmit={(event) => void runSearch(event)}>
        <div className="relative w-full max-w-[520px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            className="field-input pl-9"
            data-testid="kp-search-input"
            placeholder="搜索知识点标题或内容…"
            value={query}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => setQuery(event.target.value.slice(0, SEARCH_MAX_LENGTH))}
          />
        </div>
        <button
          type="submit"
          className="btn-primary shrink-0 px-4"
          data-testid="kp-search-button"
          disabled={query.trim() === '' || searching}
        >
          {searching ? '搜索中…' : '搜索'}
        </button>
      </form>

      {searchError !== '' && (
        <p className="mt-2 text-[12px] text-[#e25050]" data-testid="kp-search-error">
          {searchError}
        </p>
      )}

      {results !== null && searchError === '' && (
        <section className="card mt-2 max-w-[520px] p-2" data-testid="kp-search-results">
          {results.length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] text-ink-mute">没有找到匹配的知识点。</p>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    data-testid="kp-search-result"
                    className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition hover:bg-primary-soft"
                    onClick={() => {
                      setResults(null)
                      navigate(`/kp/${result.id}`)
                    }}
                  >
                    <span className="truncate text-[13px] font-medium text-ink">
                      {result.title}
                    </span>
                    <span className="line-clamp-1 text-[11.5px] text-ink-mute">
                      {result.content || '暂无正文'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {notFound && <NotFoundView description="该知识点不存在或已被删除。" />}

      {!notFound && loading && <LoadingView />}

      {!notFound && !loading && loadError !== '' && (
        <ErrorView message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
      )}

      {!notFound && !loading && loadError === '' && point !== null && (
        <article className="card mt-3 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 data-testid="kp-title" className="text-lg font-bold text-ink">
                {point.title}
              </h1>
              <p className="mt-1 text-[12px] text-ink-mute">
                层级 {point.level} · 掌握度 {Math.round(point.mastery_score * 100)}%
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn-gray h-9 px-3"
                data-testid="kp-edit"
                onClick={openEdit}
              >
                <Pencil size={14} />
                编辑
              </button>
              <button
                type="button"
                className="btn-base h-9 gap-1.5 rounded-lg bg-[#fdecec] px-3 text-[#d24848] hover:bg-[#fbdcdc]"
                data-testid="kp-delete"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          </div>

          <div className="mt-4 whitespace-pre-wrap text-[13.5px] leading-7 text-ink-soft">
            {point.content || '该知识点暂无正文内容。'}
          </div>

          <section className="mt-6 border-t border-line pt-5" data-testid="kp-explain">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-mute">讲解风格</span>
                <select
                  className="field-input w-[130px]"
                  data-testid="explain-style"
                  value={style}
                  onChange={(event) =>
                    handleStyleChange(event.target.value as ExplainStyle)
                  }
                >
                  {STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-mute">Agent</span>
                <select
                  className="field-input w-[180px]"
                  data-testid="explain-agent"
                  value={agentId}
                  onChange={(event) => handleAgentChange(event.target.value)}
                >
                  <option value="">服务端默认</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="btn-primary h-9 px-4"
                data-testid="explain-start"
                disabled={streaming}
                onClick={() => void startExplain()}
              >
                开始讲解
              </button>

              {streaming && (
                <button
                  type="button"
                  className="btn-gray h-9 px-4"
                  data-testid="explain-stop"
                  onClick={cancelStream}
                >
                  <Square size={13} />
                  停止
                </button>
              )}
            </div>

            {streaming && (
              <div
                className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-mute"
                data-testid="explain-loading"
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary"
                />
                <span>{socraticThinking ? '思考中…' : '讲解生成中…'}</span>
              </div>
            )}

            {explainError !== null && (
              <div
                className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-[12.5px] text-[#c33f3f]"
                data-testid="explain-error"
                role="alert"
              >
                <p data-testid="explain-error-message">{explainError.message}</p>
                {explainError.raw !== undefined && (
                  <details className="mt-1" data-testid="explain-error-raw">
                    <summary className="cursor-pointer text-[11.5px]">查看原始错误</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[11px]">
                      {explainError.raw}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div
              className="mt-3 min-h-[48px] whitespace-pre-wrap rounded-lg bg-page px-4 py-3 text-[13.5px] leading-7 text-ink-soft"
              data-testid="explain-output"
            >
              {explainText}
            </div>

            {explainText === '' && !streaming && explainError === null && (
              <p className="mt-2 text-[12px] text-ink-mute">
                选择风格后点击「开始讲解」，讲解内容会流式显示在这里。
              </p>
            )}
          </section>
        </article>
      )}

      {editOpen && point !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(31,39,51,0.42)] p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="编辑知识点"
            data-testid="kp-edit-form"
            className="w-full max-w-[560px] rounded-[14px] border border-line bg-white p-5 shadow-xl"
            onSubmit={(event) => void submitEdit(event)}
          >
            <h2 className="text-[15px] font-bold text-ink">编辑知识点</h2>

            <label className="mt-4 block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">标题</span>
              <input
                className="field-input"
                data-testid="kp-edit-title"
                value={editTitle}
                maxLength={TITLE_MAX_LENGTH}
                disabled={saving}
                onChange={(event) => {
                  setEditTitle(event.target.value)
                  setEditErrors((prev) => ({ ...prev, title: undefined }))
                }}
              />
              {editErrors.title !== undefined && (
                <p className="mt-1 text-[11.5px] text-[#d24848]" data-testid="kp-edit-title-error">
                  {editErrors.title}
                </p>
              )}
            </label>

            <label className="mt-3 block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">正文</span>
              <textarea
                className="field-input h-40 resize-y py-2 leading-6"
                data-testid="kp-edit-content"
                value={editContent}
                disabled={saving}
                onChange={(event) => setEditContent(event.target.value)}
              />
            </label>

            <label className="mt-3 block w-[160px]">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">排序</span>
              <input
                type="number"
                min={0}
                step={1}
                className="field-input"
                data-testid="kp-edit-sort"
                value={editSortOrder}
                disabled={saving}
                onChange={(event) => {
                  setEditSortOrder(event.target.value)
                  setEditErrors((prev) => ({ ...prev, sortOrder: undefined }))
                }}
              />
              {editErrors.sortOrder !== undefined && (
                <p className="mt-1 text-[11.5px] text-[#d24848]" data-testid="kp-edit-sort-error">
                  {editErrors.sortOrder}
                </p>
              )}
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-gray"
                data-testid="kp-edit-cancel"
                disabled={saving}
                onClick={closeEdit}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-primary"
                data-testid="kp-edit-save"
                disabled={saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="删除知识点"
        description={
          <>
            删除后将<strong className="text-[#c33f3f]">级联删除子知识点</strong>
            ，且无法恢复。确认删除「{point?.title ?? ''}」吗？
          </>
        }
        confirmLabel="删除"
        danger
        pending={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
      />

      {!notFound && !loading && loadError === '' && point === null && (
        <EmptyView title="暂无内容" description="知识点数据不可用，请稍后重试。" />
      )}
    </div>
  )
}
