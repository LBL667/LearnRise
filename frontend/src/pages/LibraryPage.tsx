import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, parseApiDetail } from '@/api/client'
import { deleteSource, listSources } from '@/api/sources'
import type { SourceOut } from '@/api/types/sources'
import { DataTable } from '@/components/ui/DataTable'
import type { Column } from '@/components/ui/DataTable'
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'

const COLUMNS: Column<SourceOut>[] = [
  {
    key: 'title',
    header: '标题',
    render: (row) => <span className="font-medium text-ink">{row.title}</span>,
  },
  {
    key: 'filename',
    header: '文件名',
    render: (row) => <span className="text-ink-soft">{row.filename}</span>,
  },
  {
    key: 'status',
    header: '状态',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'page_count',
    header: '页数',
    render: (row) => <span className="text-ink-soft">{row.page_count ?? '—'}</span>,
  },
  {
    key: 'size_bytes',
    header: '大小',
    render: (row) => <span className="text-ink-soft">{formatSize(row.size_bytes)}</span>,
  },
  {
    key: 'created_at',
    header: '上传时间',
    render: (row) => <span className="text-ink-soft">{formatTime(row.created_at)}</span>,
  },
]

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

export default function LibraryPage() {
  const navigate = useNavigate()
  const [sources, setSources] = useState<SourceOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SourceOut | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    listSources()
      .then((rows) => {
        if (cancelled) return
        setSources(rows)
      })
      .catch((caught) => {
        if (!cancelled) setError(describeError(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  useEffect(() => {
    if (!sources.some((source) => ['pending', 'parsing', 'embedding'].includes(source.status))) return
    const timer = window.setTimeout(retry, 3000)
    return () => window.clearTimeout(timer)
  }, [sources, retry])

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return
    setUploading(true)
    try {
      await api.uploadDocument(file)
      showToast('资料已上传，正在后台处理', 'success')
      retry()
    } catch (caught) {
      showToast(describeError(caught), 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteSource(deleteTarget.id)
      setSources((current) => current.filter((source) => source.id !== deleteTarget.id))
      setDeleteTarget(null)
      showToast('资料已删除', 'success')
    } catch (caught) {
      showToast(describeError(caught), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<SourceOut>[] = [...COLUMNS, {
    key: 'actions', header: '操作',
    render: (row) => <button type="button" aria-label={`删除资料：${row.title}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[#c24545] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={['pending', 'parsing', 'embedding'].includes(row.status)} title={['pending', 'parsing', 'embedding'].includes(row.status) ? '资料正在处理，请稍后删除' : '删除资料'} onClick={(event) => { event.stopPropagation(); setDeleteTarget(row) }}><Trash2 size={14} />删除</button>,
  }]

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6" data-testid="page-library">
      <div className="mb-4 flex justify-end">
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" className="sr-only" aria-label="选择要上传的资料" data-testid="library-upload-input" onChange={(event) => void upload(event.target.files?.[0])} />
        <button type="button" className="btn-primary h-10 px-5" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="library-upload">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? '上传中…' : '上传资料'}
        </button>
      </div>
      <div>
        {loading ? (
          <LoadingView />
        ) : error ? (
          <ErrorView message={error} onRetry={retry} />
        ) : sources.length === 0 ? (
          <EmptyView
            title="暂无资料"
            description="支持 PDF、Word、文本和图片，上传后将自动处理。"
          />
        ) : (
          <>
            <div className="mb-2 text-[12px] text-ink-mute" data-testid="source-count">
              共 {sources.length} 条
            </div>
            <DataTable
              columns={columns}
              rows={sources}
              rowKey={(row) => row.id}
              testIdPrefix="source"
              onRowClick={(row) => navigate(`/library/${row.id}`)}
            />
          </>
        )}
      </div>
      {deleteTarget && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(31,39,51,0.42)] p-4" onClick={() => { if (!deleting) setDeleteTarget(null) }}>
        <div role="dialog" aria-modal="true" aria-labelledby="delete-source-title" className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
          <h2 id="delete-source-title" className="text-lg font-bold text-ink">删除这份资料？</h2>
          <p className="mt-3 break-words text-sm font-semibold text-ink">{deleteTarget.title}</p>
          <p className="mt-2 text-[13px] leading-6 text-ink-soft">删除后，原文件以及由此资料生成的知识点、题目和相关作答记录将一并删除，无法恢复。</p>
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" className="btn-gray h-9 px-4" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button>
            <button type="button" className="btn-base h-9 bg-[#d45151] px-4 text-white hover:bg-[#ba3535]" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '删除中…' : '确认删除'}</button>
          </div>
        </div>
      </div>}

    </div>
  )
}
