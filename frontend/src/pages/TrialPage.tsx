import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, ListChecks, Lock, Star } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { TrialAnswerResult, TrialExam, TrialExamQuestion, TrialSubmission } from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { useToast } from '@/components/ui/Toast'

const EXAM_TITLE = '综合能力模拟卷（一）'
const EXAM_COVER = 'blackboard' as const
const QUESTION_COUNT = 10

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

function secondsUntil(iso: string): number {
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.floor((target - Date.now()) / 1000))
}

const TYPE_LABEL: Record<TrialExamQuestion['type'], string> = {
  choice: '单选题',
  blank: '填空题',
  multiple: '多选题',
  judge: '判断题',
}

function judgeText(value: string): string {
  const normalised = value.trim().toLowerCase()
  if (normalised === 'true' || normalised === 't') return '正确'
  if (normalised === 'false' || normalised === 'f') return '错误'
  return value
}

function answerText(value: string, type: TrialExamQuestion['type']): string {
  if (!value) return '未作答'
  return type === 'judge' ? judgeText(value) : value
}

function OptionMark({ multiple, active }: { multiple: boolean; active: boolean }) {
  if (multiple) {
    return (
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition ${
          active ? 'border-primary bg-primary' : 'border-[#c6d2e4]'
        }`}
      >
        {active && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5.2 L4 7.5 L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </span>
    )
  }
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
        active ? 'border-primary' : 'border-[#c6d2e4]'
      }`}
    >
      {active && <span className="h-2 w-2 rounded-full bg-primary" />}
    </span>
  )
}

function QuestionCard({
  question,
  index,
  answer,
  starred,
  result,
  submitted,
  expired,
  onAnswer,
  onToggleStar,
}: {
  question: TrialExamQuestion
  index: number
  answer?: string
  starred: boolean
  result?: TrialAnswerResult
  submitted: boolean
  expired: boolean
  onAnswer: (value: string) => void
  onToggleStar: () => void
}) {
  const [open, setOpen] = useState(false)
  const options =
    question.type === 'judge'
      ? [
          { key: 'T', text: '正确' },
          { key: 'F', text: '错误' },
        ]
      : question.options ?? []
  const fourCols = question.type === 'choice' && options.every((o) => o.text.length <= 6)
  const selectedKeys = (answer ?? '').split('')

  const pick = (key: string) => {
    if (submitted || expired) return
    onAnswer(selectedKeys.includes(key) ? '' : key)
  }

  return (
    <article className="card p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[#4a90ff] to-primary text-[13px] font-bold text-white">
          {index + 1}
        </span>
        <span className="rounded bg-primary-soft px-2 py-0.5 text-[11.5px] font-medium text-primary">
          {TYPE_LABEL[question.type]}
        </span>
        <span className="rounded bg-page px-2 py-0.5 text-[11.5px] text-ink-mute">{question.score} 分</span>
        {submitted && result && (
          <span
            className={`rounded px-2 py-0.5 text-[11.5px] font-medium ${
              result.correct ? 'bg-[#e5f6ec] text-[#188c5e]' : 'bg-[#fdecec] text-[#c24545]'
            }`}
          >
            {result.correct ? '回答正确' : '回答错误'}
          </span>
        )}
        <button
          aria-label={starred ? '取消收藏' : '收藏本题'}
          className="ml-auto text-ink-mute transition hover:text-gold"
          onClick={onToggleStar}
        >
          <Star size={18} className={starred ? 'fill-gold text-gold' : ''} />
        </button>
      </div>

      <p className="mt-3 text-[14px] leading-6 text-ink">{question.stem}</p>

      {question.type === 'blank' ? (
        <input
          className="field-input mt-3"
          placeholder="请填入答案"
          value={answer ?? ''}
          readOnly={submitted || expired}
          onChange={(e) => onAnswer(e.target.value)}
        />
      ) : (
        <div className={`mt-3 grid gap-2.5 ${fourCols ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {options.map((o) => {
            const active = selectedKeys.includes(o.key)
            return (
              <button
                key={o.key}
                disabled={submitted || expired}
                onClick={() => pick(o.key)}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition disabled:cursor-not-allowed ${
                  active
                    ? 'border-primary bg-primary-soft text-ink'
                    : 'border-line bg-white text-ink-soft hover:border-primary/50'
                }`}
              >
                <OptionMark multiple={question.type === 'multiple'} active={active} />
                <span className="min-w-0 flex-1">{o.text}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-3">
        <button
          disabled={!submitted}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left transition ${
            submitted ? 'bg-page hover:bg-primary-soft' : 'cursor-not-allowed bg-page opacity-70'
          }`}
        >
          <Lock size={14} className={submitted ? 'text-[#2bb673]' : 'text-ink-mute'} />
          <span className="text-[13px] font-semibold text-ink-soft">答案与解析</span>
          {!submitted && (
            <span className="text-[12px] text-ink-mute">
              {expired ? '考试已结束' : '交卷后可查看答案与详细解析'}
            </span>
          )}
          <span
            className={`ml-auto text-ink-mute transition-transform ${open && submitted ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
        {submitted && open && (
          <div className="mt-2 rounded-xl bg-primary-soft/50 p-4">
            {result ? (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-[13px] text-ink-soft">
                    你的答案
                    <span className="ml-2 font-semibold text-ink">
                      {answerText(result.my_answer, question.type)}
                    </span>
                  </span>
                  <span className="text-[13px] text-ink-soft">
                    正确答案
                    <span className="ml-2 font-semibold text-primary">
                      {answerText(result.correct_answer, question.type)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-6 text-ink-soft">{result.explanation}</p>
                {result.source_chunk && (
                  <p className="mt-2 text-[12px] leading-5 text-ink-mute">
                    来源：{result.source_chunk.heading ?? result.source_chunk.content.slice(0, 80)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-ink-mute">本次考试未提交答案，暂无解析。</p>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

export default function TrialPage() {
  const [exam, setExam] = useState<TrialExam | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [stars, setStars] = useState<Record<string, boolean>>({})
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [submission, setSubmission] = useState<TrialSubmission | null>(null)
  const [expired, setExpired] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToast()
  const answersRef = useRef<Record<string, string>>({})
  const startedRef = useRef(false)
  const submittedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        const data = await api.startTrialExam({ count: QUESTION_COUNT })
        setExam(data)
        setSecondsLeft(secondsUntil(data.expiresAt))
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'NO_QUESTIONS') {
          setError('当前没有可用的题目，请先在备赛区完成练习。')
        } else {
          setError(caught instanceof ApiError ? caught.detail : '试卷加载失败，请稍后重试')
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const updateAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value }
      answersRef.current = next
      return next
    })
  }, [])

  const submit = useCallback(async () => {
    if (!exam || submittedRef.current || submitting) return
    submittedRef.current = true
    setSubmitting(true)
    setConfirmOpen(false)
    try {
      const result = await api.submitTrialExam(exam.examId, answersRef.current)
      setSubmission(result)
      showToast('已交卷，答案与解析已解锁', 'success')
    } catch (caught) {
      submittedRef.current = false
      if (caught instanceof ApiError && caught.code === 'EXAM_EXPIRED') {
        setExpired(true)
        setSecondsLeft(0)
        try {
          const state = await api.getTrialExam(exam.examId)
          setSecondsLeft(state.remaining_seconds)
          if (state.results) {
            setSubmission({
              exam_id: state.exam_id,
              score: state.score ?? 0,
              total: state.total,
              submitted_at: state.submitted_at ?? new Date().toISOString(),
              results: state.results,
            })
          }
        } catch {
          setSecondsLeft(0)
        }
        showToast('考试已结束，答案不可再提交', 'error')
      } else {
        showToast(caught instanceof ApiError ? caught.detail : '交卷失败，请重试', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }, [exam, showToast, submitting])

  useEffect(() => {
    if (!exam || submission) return
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          void submit()
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [exam, submission, submit])

  const answeredCount = useMemo(
    () => (exam ? exam.questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length : 0),
    [exam, answers],
  )

  if (loading) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center text-sm text-ink-mute">正在加载试卷…</div>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-soft">{error || '试卷加载失败'}</p>
        </div>
      </div>
    )
  }

  const submitted = submission !== null
  const results = new Map((submission?.results ?? []).map((row) => [row.question_id, row]))
  const fullScore = exam.questions.reduce((sum, q) => sum + q.score, 0)
  const progressPercent = exam.total > 0 ? Math.round((answeredCount / exam.total) * 100) : 0

  return (
    <div className="w-full px-6 py-6">
      <section className="card flex items-center gap-5 p-4">
        <div className="relative shrink-0">
          <CoverArt variant={EXAM_COVER} className="h-[84px] w-[128px] rounded-xl" />
          <span className="absolute left-2 top-2 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-white">
            {submitted ? '已交卷' : expired ? '已结束' : '进行中'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[16px] font-bold text-ink">{EXAM_TITLE}</h2>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            共 {exam.total} 题 <span className="mx-1.5 text-line">|</span> 满分 {fullScore} 分
            {submission && (
              <>
                <span className="mx-1.5 text-line">|</span>
                答对 {submission.score} / {submission.total} 题
              </>
            )}
          </p>
        </div>
        <div className="w-px self-stretch bg-line" />
        <div className="shrink-0 px-2">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-mute">
            <Clock size={14} className="text-primary" />
            剩余时间
          </div>
          <div className="mt-1 font-mono text-[24px] font-bold leading-none tracking-tight text-primary">
            {fmtTime(secondsLeft)}
          </div>
        </div>
        <div className="w-px self-stretch bg-line" />
        <div className="w-[150px] shrink-0 px-2">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-mute">
            <ListChecks size={14} className="text-[#2bb673]" />
            答题进度
          </div>
          <div className="mt-1 text-[20px] font-bold leading-none text-primary">
            {answeredCount}
            <span className="text-[14px] font-medium text-ink-mute"> / {exam.total}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-page">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button
          className="btn-primary shrink-0 px-6"
          onClick={() => setConfirmOpen(true)}
          disabled={submitted || expired || submitting}
        >
          {submitted ? '已交卷' : expired ? '已结束' : submitting ? '交卷中…' : '交卷'}
        </button>
      </section>

      <div className="mt-5 flex flex-col gap-4">
        {exam.questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={i}
            answer={answers[q.id]}
            starred={!!stars[q.id]}
            result={results.get(q.id)}
            submitted={submitted}
            expired={expired}
            onAnswer={(value) => updateAnswer(q.id, value)}
            onToggleStar={() => setStars((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
          />
        ))}
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(23,32,48,0.45)] p-6"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="modal-panel w-[380px] rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-ink">确认交卷？</h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-soft">
              当前已作答 {answeredCount} / {exam.total} 题。交卷后将解锁答案与解析，答案不可再修改。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>
                继续作答
              </button>
              <button className="btn-primary px-6" onClick={() => void submit()}>
                确认交卷
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
