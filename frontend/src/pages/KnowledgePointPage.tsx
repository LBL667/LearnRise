import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, request } from '@/api/client'

interface KnowledgePoint {
  id: string
  source_id: string | null
  parent_id: string | null
  title: string
  content: string
  level: number
  mastery_score: number
}

export default function KnowledgePointPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [point, setPoint] = useState<KnowledgePoint | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPoint(null)
    setError('')
    request<KnowledgePoint>(`/knowledge-points/${id}`)
      .then((body) => {
        if (!cancelled) setPoint(body)
      })
      .catch((caught) => {
        if (!cancelled) {
          setPoint(null)
          setError(caught instanceof ApiError ? caught.detail : '知识点加载失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="w-full px-6 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-0.5 text-[13px] text-ink-soft transition hover:text-primary"
      >
        <ChevronLeft size={16} />
        返回
      </button>

      {error && <div className="card mt-3 p-10 text-center text-sm text-[#e25050]">{error}</div>}

      {!error && point === null && (
        <div className="card mt-3 p-10 text-center text-sm text-ink-mute">正在加载知识点…</div>
      )}

      {point !== null && (
        <article className="card mt-3 p-6">
          <h1 data-testid="kp-title" className="text-lg font-bold text-ink">
            {point.title}
          </h1>
          <p className="mt-1 text-[12px] text-ink-mute">
            层级 {point.level} · 掌握度 {Math.round(point.mastery_score * 100)}%
          </p>
          <div className="mt-4 whitespace-pre-wrap text-[13.5px] leading-7 text-ink-soft">
            {point.content || '该知识点暂无正文内容。'}
          </div>
        </article>
      )}
    </div>
  )
}
