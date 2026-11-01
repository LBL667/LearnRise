import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, ListChecks, Lock, Star } from 'lucide-react'
import { api } from '@/api/client'
import type { TrialExam, TrialQuestion } from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { useToast } from '@/components/ui/Toast'

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

const TYPE_LABEL: Record<TrialQuestion['type'], string> = {
  choice: '单选题',
  blank: '填空题',
  multiple: '多选题',
  judge: '判断题',
}

/** 题目卡 */
function QuestionCard({
  question,
  index,
  answer,
  starred,
  unlocked,
  onAnswer,
  onToggleStar,
}: {
  question: TrialQuestion
  index: number
  answer?: string
  starred: boolean
  unlocked: boolean
  onAnswer: (value: string) => void
  onToggleStar: () => void
}) {
  const [open, setOpen] = useState(false)
  const fourCols =
    question.type === 'choice' && (question.options ?? []).every((o) => o.text.length <= 6)
  const isMultiple = question.type === 'multiple'
  const selectedKeys = (answer ?? '').split('')

  /** 多选题切换一个选项；单选 / 判断题直接设置 */
  const pick = (key: string) => {
    if (isMultiple) {
      const next = selectedKeys.includes(key)
        ? selectedKeys.filter((k) => k !== key)
        : (question.options ?? [])
            .map((o) => o.key)
            .filter((k) => k === key || selectedKeys.includes(k))
      onAnswer(next.join(''))
    } else {
      onAnswer(key)
    }
  }

  const answerText = () => {
    if (question.type === 'judge') return question.answer === 'T' ? '正确' : '错误'
    return question.answer
  }

  return (
    <article className="card p-4">
      {/* 头行 */}
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[#4a90ff] to-primary text-[13px] font-bold text-white">
          {index + 1}
        </span>
        <span className="rounded bg-primary-soft px-2 py-0.5 text-[11.5px] font-medium text-primary">
          {TYPE_LABEL[question.type]}
        </span>
        <span className="rounded bg-page px-2 py-0.5 text-[11.5px] text-ink-mute">{question.score} 分</span>
        <button
          aria-label={starred ? '取消收藏' : '收藏本题'}
          className="ml-auto text-ink-mute transition hover:text-gold"
          onClick={onToggleStar}
        >
          <Star size={18} className={starred ? 'fill-gold text-gold' : ''} />
        </button>
      </div>

      {/* 题干 */}
      <p className="mt-3 text-[14px] leading-6 text-ink">{question.stem}</p>

      {/* 选项 / 填空 */}
      {question.type === 'blank' ? (
        <input
          className="field-input mt-3"
          placeholder={question.placeholder ?? '请填入答案'}
          value={answer ?? ''}
          onChange={(e) => onAnswer(e.target.value)}
        />
      ) : (
        <div className={`mt-3 grid gap-2.5 ${fourCols ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {question.options?.map((o) => {
            const active = selectedKeys.includes(o.key)
            return (
              <button
                key={o.key}
                onClick={() => pick(o.key)}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition ${
                  active
                    ? 'border-primary bg-primary-soft text-ink'
                    : 'border-line bg-white text-ink-soft hover:border-primary/50'
                }`}
              >
                {isMultiple ? (
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
                ) : (
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      active ? 'border-primary' : 'border-[#c6d2e4]'
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">{o.text}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 答案与解析 */}
      <div className="mt-3">
        <button
          disabled={!unlocked}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left transition ${
            unlocked ? 'bg-page hover:bg-primary-soft' : 'cursor-not-allowed bg-page opacity-70'
          }`}
        >
          <Lock size={14} className={unlocked ? 'text-[#2bb673]' : 'text-ink-mute'} />
          <span className="text-[13px] font-semibold text-ink-soft">答案与解析</span>
          {!unlocked && (
            <span className="text-[12px] text-ink-mute">交卷后可查看答案与详细解析</span>
          )}
          <span
            className={`ml-auto text-ink-mute transition-transform ${open && unlocked ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
        {unlocked && open && (
          <div className="mt-2 rounded-xl bg-primary-soft/50 p-4">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">正确答案</span>
              <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-[13px] font-bold text-white">
                {answerText()}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-6 text-ink-soft">{question.analysis}</p>
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
  const [unlocked, setUnlocked] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { showToast } = useToast()
  const submittedRef = useRef(false)

  useEffect(() => {
    void (async () => {
      const data = await api.getTrialExam()
      setExam(data)
      setSecondsLeft(data.durationLeft)
    })()
  }, [])

  const submit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setConfirmOpen(false)
    await api.submitExam()
    setUnlocked(true)
    showToast('已交卷，答案与解析已解锁', 'success')
  }, [showToast])

  // 倒计时
  useEffect(() => {
    if (unlocked) return
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer)
          void submit()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [unlocked, submit])

  const answeredCount = useMemo(
    () => (exam ? exam.questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length : 0),
    [exam, answers],
  )

  if (!exam) {
    return <div className="w-full px-6 py-6"><div className="card p-10 text-center text-sm text-ink-mute">正在加载试卷…</div></div>
  }

  const progressPercent = Math.round((answeredCount / exam.questionTotal) * 100)

  return (
    <div className="w-full px-6 py-6">
      {/* 考试信息头卡 */}
      <section className="card flex items-center gap-5 p-4">
        <div className="relative shrink-0">
          <CoverArt variant={exam.cover} className="h-[84px] w-[128px] rounded-xl" />
          <span className="absolute left-2 top-2 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-white">
            进行中
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[16px] font-bold text-ink">{exam.title}</h2>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            共 {exam.questionTotal} 题 <span className="mx-1.5 text-line">|</span> 满分 {exam.fullScore} 分
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
            <span className="text-[14px] font-medium text-ink-mute"> / {exam.questionTotal}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-page">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button className="btn-primary shrink-0 px-6" onClick={() => setConfirmOpen(true)} disabled={unlocked}>
          {unlocked ? '已交卷' : '交卷'}
        </button>
      </section>

      {/* 题目列表 */}
      <div className="mt-5 flex flex-col gap-4">
        {exam.questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={i}
            answer={answers[q.id]}
            starred={!!stars[q.id]}
            unlocked={unlocked}
            onAnswer={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
            onToggleStar={() => setStars((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
          />
        ))}
      </div>

      {/* 交卷确认 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(23,32,48,0.45)] p-6" onClick={() => setConfirmOpen(false)}>
          <div className="modal-panel w-[380px] rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-ink">确认交卷？</h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-soft">
              当前已作答 {answeredCount} / {exam.questionTotal} 题。交卷后将解锁答案与解析，答案不可再修改。
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
