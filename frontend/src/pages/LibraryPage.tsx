import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, parseApiDetail } from '@/api/client'
import { listSources } from '@/api/sources'
import type { SourceOut } from '@/api/types/sources'
import { DataTable } from '@/components/ui/DataTable'
import type { Column } from '@/components/ui/DataTable'
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews'
import { StatusBadge } from '@/components/ui/StatusBadge'

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

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6" data-testid="page-library">
      <h1 className="text-[20px] font-bold text-ink">资料库</h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        上传的资料、解析状态与知识点树将在这里管理。
      </p>

      <div className="mt-5">
        {loading ? (
          <LoadingView />
        ) : error ? (
          <ErrorView message={error} onRetry={retry} />
        ) : sources.length === 0 ? (
          <EmptyView
            title="暂无资料"
            description="还没有上传任何资料。上传资料请从建赛向导进入。"
          />
        ) : (
          <>
            <div className="mb-2 text-[12px] text-ink-mute" data-testid="source-count">
              共 {sources.length} 条
            </div>
            <DataTable
              columns={COLUMNS}
              rows={sources}
              rowKey={(row) => row.id}
              testIdPrefix="source"
              onRowClick={(row) => navigate(`/library/${row.id}`)}
            />
          </>
        )}
      </div>
    </div>
  )
}
