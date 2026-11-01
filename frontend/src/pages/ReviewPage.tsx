import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Flame, Layers, Link2, Loader2, RotateCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api/client'
import type { DueReviewCard, ReviewStats } from '@/api/types'
import { useToast } from '@/components/ui/Toast'

const RATINGS: { value: number; label: string; className: string }[] = [
  { value: 1, label: '忘记', className: 'border-[#f3c9c9] text-[#c24545] hover:bg-[#fdecec]' },
  { value: 2, label: '困难', className: 'border-[#f2ddbb] text-[#b0741d] hover:bg-[#fdf3e3]' },
  { value: 3, label: '一般', className: 'border-[#cddffb] text-[#2e7cf6] hover:bg-primary-soft' },
  { value: 4, label: '良好', className: 'border-[#bfe6d2] text-[#188c5e] hover:bg-[#e5f6ec]' },
  { value: 5, label: '简单', className: 'border-[#bfe6d2] text-[#0f7a4d] hover:bg-[#dff3e8]' },
]

function predictedEntries(card: DueReviewCard): [string, number][] {
  const raw = card.predicted_intervals
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((days, index) => [String(index + 1), days])
  return Object.entries(raw)
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </span>
      <div>
        <div className="text-[11.5px] text-ink-mute">{label}</div>
        <div className="text-[18px] font-bold leading-tight text-ink">{value}</div>
      </div>
    </div>
  )
}

export default function ReviewPage() {
  const [due, setDue] = useState<DueReviewCard[]>([])
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getDueCards(), api.getReviewStats()])
      .then(([queue, counters]) => {
        if (cancelled) return
        setDue(queue.cards)
        setStats(counters)
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.detail : '复习队列加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const current = index < due.length ? due[index] : undefined

  const submit = async (rating: number) => {
    if (!current || !flipped || submitting) return
    setSubmitting(true)
    try {
      const result = await api.submitReview(current.id, rating)
      showToast(`下次复习：${result.next_due_date}`, 'success')
      setStats((prev) =>
        prev
          ? {
              ...prev,
              due_count: Math.max(0, prev.due_count - 1),
              reviewed_today: prev.reviewed_today + 1,
            }
          : prev,
      )
      setFlipped(false)
      setIndex((value) => value + 1)
    } catch (caught) {
      showToast(caught instanceof ApiError ? caught.detail : '提交失败，请重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!flipped || submitting || !current) return
      if (event.key >= '1' && event.key <= '5') {
        event.preventDefault()
        void submit(Number(event.key))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const predicted = current ? predictedEntries(current) : []

  return (
    <div className="mx-auto flex h-full w-full max-w-[980px] flex-col px-6 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-ink">间隔复习</h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            按 DSR 调度复习到期卡片，评分会决定下次出现的时间。
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-[12px] font-medium text-primary">
          <CalendarClock size={14} />
          今日待复习 {stats?.due_count ?? due.length} 张
        </span>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        <StatCard icon={<CalendarClock size={17} />} label="待复习" value={stats?.due_count ?? 0} />
        <StatCard icon={<CheckCircle2 size={17} />} label="今日已复习" value={stats?.reviewed_today ?? 0} />
        <StatCard icon={<Flame size={17} />} label="连续天数" value={stats?.streak_days ?? 0} />
        <StatCard icon={<Layers size={17} />} label="卡片总数" value={stats?.total_cards ?? 0} />
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {loading && (
          <div className="card flex flex-1 items-center justify-center text-[13px] text-ink-mute">
            正在加载复习队列…
          </div>
        )}

        {!loading && error && (
          <div className="card flex flex-1 items-center justify-center text-[13px] text-[#d24848]">{error}</div>
        )}

        {!loading && !error && due.length === 0 && (
          <div className="card flex flex-1 flex-col items-center justify-center gap-2 py-16">
            <CheckCircle2 size={38} className="text-[#188c5e]" />
            <div className="text-[15px] font-semibold text-ink">今天没有到期卡片</div>
            <p className="text-[13px] text-ink-mute">完成练习或答错题目后，这里会自动出现待复习内容。</p>
          </div>
        )}

        {!loading && !error && due.length > 0 && !current && (
          <div className="card flex flex-1 flex-col items-center justify-center gap-2 py-16">
            <CheckCircle2 size={38} className="text-[#188c5e]" />
            <div className="text-[15px] font-semibold text-ink">本轮复习已完成</div>
            <p className="text-[13px] text-ink-mute">明天再来看看新的到期卡片吧。</p>
          </div>
        )}

        {!loading && !error && current && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center justify-between text-[12.5px] text-ink-mute">
              <span data-testid="review-progress">
                第 {index + 1} / {due.length} 张
              </span>
              <span>连续评分 1 忘记 · 5 简单</span>
            </div>

            <div className="[perspective:1600px]">
              <div
                role="button"
                tabIndex={0}
                aria-label={flipped ? '已翻面，显示答案' : '点击翻面查看答案'}
                data-testid="review-card"
                data-flipped={flipped ? 'true' : 'false'}
                onClick={() => setFlipped((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setFlipped((value) => !value)
                  }
                }}
                className="relative h-[320px] w-full cursor-pointer outline-none"
              >
                <div
                  className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${
                    flipped ? '[transform:rotateY(180deg)]' : ''
                  }`}
                >
                  <div className="absolute inset-0 flex flex-col rounded-2xl border border-line bg-white p-7 shadow-[0_18px_44px_-28px_rgba(31,39,51,0.45)] [backface-visibility:hidden]">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11.5px] font-medium text-primary">
                        问题
                      </span>
                      <RotateCw size={15} className="text-ink-mute" />
                    </div>
                    <p
                      data-testid="review-question"
                      className="mt-6 flex-1 overflow-y-auto whitespace-pre-line text-[18px] font-semibold leading-8 text-ink"
                    >
                      {current.question}
                    </p>
                    <div className="text-center text-[12px] text-ink-mute">点击卡片或按 Enter 翻面查看答案</div>
                  </div>

                  <div className="absolute inset-0 flex flex-col rounded-2xl border border-primary/25 bg-primary-soft-2 p-7 shadow-[0_18px_44px_-28px_rgba(46,124,246,0.5)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-medium text-white">
                        答案
                      </span>
                      {current.knowledge_point_id && (
                        <Link
                          to={`/kp/${current.knowledge_point_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="flex items-center gap-1 text-[12px] text-primary hover:text-primary-deep"
                        >
                          <Link2 size={13} />
                          查看知识点
                        </Link>
                      )}
                    </div>
                    <p
                      data-testid="review-answer"
                      className="mt-6 flex-1 overflow-y-auto whitespace-pre-line text-[15px] leading-7 text-ink"
                    >
                      {current.answer}
                    </p>
                    {predicted.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {predicted.map(([rating, days]) => (
                          <span key={rating} className="chip">
                            评分 {rating} → {days} 天后
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-[12px] text-ink-mute">
                <span>{flipped ? '请为这次回忆打分（键盘 1–5）' : '先翻面查看答案，评分才会解锁'}</span>
                {submitting && (
                  <span className="flex items-center gap-1 text-primary">
                    <Loader2 size={13} className="animate-spin" />
                    提交中…
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {RATINGS.map((rating) => (
                  <button
                    key={rating.value}
                    data-testid={`rating-${rating.value}`}
                    disabled={!flipped || submitting}
                    onClick={() => void submit(rating.value)}
                    className={`flex h-12 flex-col items-center justify-center rounded-xl border bg-white text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${rating.className}`}
                  >
                    {rating.label}
                    <span className="text-[10.5px] font-normal opacity-70">{rating.value}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
