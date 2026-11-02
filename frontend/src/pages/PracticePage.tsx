import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Flag,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Target,
} from 'lucide-react'
import { ApiError, parseApiDetail, request } from '@/api/client'
import { listKnowledgePoints } from '@/api/knowledge'
import { answerSession, createSession, endSession, getSession } from '@/api/practice'
import type {
  HistoryItemOut,
  PracticeQuestionOut,
  ProgressOut,
  SessionCreate,
  SessionEndOut,
} from '@/api/types/practice'
import type { KnowledgePointOut } from '@/api/types/knowledge'
import type { QuizDifficulty } from '@/api/types/quiz'
import { EmptyView, LoadingView } from '@/components/ui/StateViews'

const MIN_COUNT = 1
const MAX_COUNT = 50
const DEFAULT_COUNT = 5

const DIFFICULTIES: Array<{ value: QuizDifficulty; label: string; tone: string }> = [
  { value: 'easy', label: '简单', tone: 'bg-[#e5f6ec] text-[#188c5e] border-[#bfe8d1]' },
  { value: 'medium', label: '中等', tone: 'bg-[#fdf3e3] text-[#c07b1d] border-[#f0dcb6]' },
  { value: 'hard', label: '困难', tone: 'bg-[#fdecec] text-[#d24848] border-[#f5c2c2]' },
]

const TYPE_LABELS: Record<string, string> = {
  choice: '选择题',
  judge: '判断题',
  short_answer: '简答题',
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
}

interface PreferencesResponse {
  learning?: {
    default_difficulty?: QuizDifficulty
    default_quiz_num?: number
  }
}

interface PracticeErrorInfo {
  message: string
  code: string | null
}

interface AnsweredItem {
  id: string
  no: number
  type: string
  stem: string
  options: string[] | null
  answer: string
  correct: boolean
  correct_answer: string
  explanation: string
  difficulty: string
}

type Phase = 'loading' | 'setup' | 'session' | 'summary' | 'invalid'

function readPracticeError(caught: unknown): PracticeErrorInfo {
  if (caught instanceof ApiError) {
    let detail: unknown = caught.detail
    try {
      detail = JSON.parse(caught.detail)
    } catch {
      detail = caught.detail
    }
    const parsed = parseApiDetail(detail)
    switch (caught.code) {
      case 'NO_QUESTIONS':
        return {
          code: caught.code,
          message: '没有可用题目，请先为知识点生成题目',
        }
      case 'SESSION_LIMIT':
        return {
          code: caught.code,
          message: '已达 50 题上限，请结束本次练习',
        }
      case 'NOT_CURRENT_QUESTION':
      case 'SESSION_ENDED':
        return {
          code: caught.code,
          message: '该题不是当前题或会话已结束，请重新开始',
        }
      case 'NOT_FOUND':
        return {
          code: caught.code,
          message: '练习会话不存在或已失效，请重新开始',
        }
      default:
        return {
          code: caught.code,
          message: parsed.message || `请求失败（${caught.status}）`,
        }
    }
  }
  if (caught instanceof Error) {
    return { code: null, message: caught.message || '请求失败' }
  }
  return { code: null, message: '请求失败' }
}

function toAnsweredItem(item: HistoryItemOut): AnsweredItem | null {
  if (!item.answered) return null
  return {
    id: item.question_id,
    no: item.no,
    type: item.type,
    stem: item.stem,
    options: item.options ?? null,
    answer: item.answer ?? '',
    correct: item.correct === true,
    correct_answer: item.correct_answer ?? '',
    explanation: item.explanation ?? '',
    difficulty: item.difficulty,
  }
}

function formatAnswer(value: string, type: string): string {
  if (!value) return '未作答'
  if (type === 'judge') {
    const normalised = value.trim().toLowerCase()
    if (normalised === 'true' || normalised === 't') return '正确'
    if (normalised === 'false' || normalised === 'f') return '错误'
  }
  return value
}

function formatEndedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function difficultyTone(value: string): string {
  return DIFFICULTIES.find((item) => item.value === value)?.tone ?? 'bg-page text-ink-soft border-line'
}

function DifficultyBadge({ value }: { value: string }) {
  return (
    <span
      data-testid="practice-difficulty"
      data-difficulty={value}
      className={`inline-flex h-5 shrink-0 items-center rounded border px-2 text-[11px] font-medium leading-none transition-colors ${difficultyTone(
        value,
      )}`}
    >
      {DIFFICULTY_LABELS[value] ?? value}
    </span>
  )
}

function AnswerControls({
  question,
  value,
  disabled,
  onChange,
}: {
  question: PracticeQuestionOut
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  if (question.type === 'short_answer') {
    return (
      <textarea
        data-testid="practice-answer-input"
        className="field-input mt-3 h-24 resize-y py-2"
        placeholder="写下你的答案…"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (question.type === 'judge') {
    return (
      <div className="mt-3 flex gap-2">
        {[
          { value: 'true', label: '正确' },
          { value: 'false', label: '错误' },
        ].map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              data-testid="practice-option"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`flex h-10 flex-1 items-center justify-center rounded-lg border text-[13.5px] font-medium transition ${
                active
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-line bg-white text-ink-soft hover:border-primary/40 hover:text-ink'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }

  const options = question.options ?? []
  if (options.length === 0) {
    return (
      <input
        data-testid="practice-answer-input"
        className="field-input mt-3"
        placeholder="写下你的答案…"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <div className="mt-3 space-y-2">
      {options.map((option, index) => {
        const letter = String.fromCharCode(65 + index)
        const active = value === letter
        return (
          <button
            key={`${question.id}-${index}`}
            type="button"
            data-testid="practice-option"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(letter)}
            className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[13.5px] leading-6 transition ${
              active
                ? 'border-primary bg-primary-soft text-ink'
                : 'border-line bg-white text-ink-soft hover:border-primary/40 hover:text-ink'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                active ? 'bg-primary text-white' : 'bg-page text-ink-mute'
              }`}
            >
              {letter}
            </span>
            <span className="min-w-0 flex-1">{option}</span>
          </button>
        )
      })}
    </div>
  )
}

function AnsweredCard({ item }: { item: AnsweredItem }) {
  return (
    <article data-testid="practice-result" className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-page text-[12px] font-bold text-ink-soft">
          {item.no}
        </span>
        <span className={`chip ${item.correct ? 'text-[#188c5e]' : 'text-[#d24848]'}`}>
          {item.correct ? '回答正确' : '回答错误'}
        </span>
        <span className="chip">{TYPE_LABELS[item.type] ?? item.type}</span>
        <DifficultyBadge value={item.difficulty} />
      </div>
      <p className="mt-2.5 text-[13.5px] leading-6 text-ink">{item.stem}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-page/70 px-3 py-2 text-[12.5px]">
        <span className="text-ink-soft">
          你的答案
          <span className="ml-2 font-semibold text-ink">
            {formatAnswer(item.answer, item.type)}
          </span>
        </span>
        <span className="text-ink-soft">
          正确答案
          <span className="ml-2 font-semibold text-primary">
            {formatAnswer(item.correct_answer, item.type)}
          </span>
        </span>
      </div>
      <p
        data-testid="practice-explanation"
        className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-6 text-ink-soft"
      >
        {item.explanation}
      </p>
    </article>
  )
}

export default function PracticePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionParam = searchParams.get('session')

  const [phase, setPhase] = useState<Phase>(() => (sessionParam ? 'loading' : 'setup'))
  const [resumeError, setResumeError] = useState('')

  const [points, setPoints] = useState<KnowledgePointOut[]>([])
  const [pointsLoading, setPointsLoading] = useState(true)
  const [pointsError, setPointsError] = useState('')
  const [pointsReloadKey, setPointsReloadKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [kpQuery, setKpQuery] = useState('')

  const [setupDifficulty, setSetupDifficulty] = useState<QuizDifficulty>('easy')
  const [countInput, setCountInput] = useState('')
  const [prefsReady, setPrefsReady] = useState(false)
  const touchedRef = useRef({ difficulty: false, count: false })

  const [starting, setStarting] = useState(false)
  const [setupError, setSetupError] = useState('')

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionDifficulty, setSessionDifficulty] = useState<string>('easy')
  const [progress, setProgress] = useState<ProgressOut | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<PracticeQuestionOut | null>(null)
  const [answered, setAnswered] = useState<AnsweredItem[]>([])
  const [finished, setFinished] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ending, setEnding] = useState(false)
  const [sessionError, setSessionError] = useState('')

  const [summary, setSummary] = useState<SessionEndOut | null>(null)

  const aliveRef = useRef(true)
  const hydratedRef = useRef<string | null>(null)
  const startingRef = useRef(false)
  const submittingRef = useRef(false)
  const endingRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setPointsLoading(true)
    setPointsError('')
    listKnowledgePoints({ limit: 500 })
      .then((list) => {
        if (!cancelled) setPoints(list)
      })
      .catch((caught) => {
        if (!cancelled) setPointsError(readPracticeError(caught).message)
      })
      .finally(() => {
        if (!cancelled) setPointsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pointsReloadKey])

  useEffect(() => {
    let cancelled = false
    request<PreferencesResponse>('/profile/preferences')
      .then((prefs) => {
        if (cancelled) return
        const learning = prefs.learning
        if (!learning) return
        if (!touchedRef.current.difficulty) {
          const preferred = learning.default_difficulty
          if (preferred === 'easy' || preferred === 'medium' || preferred === 'hard') {
            setSetupDifficulty(preferred)
          }
        }
        if (!touchedRef.current.count) {
          const preferred = Number(learning.default_quiz_num)
          if (Number.isInteger(preferred) && preferred >= MIN_COUNT && preferred <= MAX_COUNT) {
            setCountInput(String(preferred))
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPrefsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionParam) return
    if (hydratedRef.current === sessionParam) return
    let cancelled = false
    setPhase('loading')
    setResumeError('')
    void getSession(sessionParam)
      .then((detail) => {
        if (cancelled) return
        hydratedRef.current = detail.session_id
        if (detail.status !== 'active') {
          setResumeError('该练习会话已结束，请重新开始。')
          setPhase('invalid')
          return
        }
        const items = detail.items
          .map(toAnsweredItem)
          .filter((item): item is AnsweredItem => item !== null)
        setSessionId(detail.session_id)
        setSessionDifficulty(detail.difficulty)
        setProgress(detail.progress)
        setCurrentQuestion(detail.current_question ?? null)
        setAnswered(items)
        setFinished(detail.current_question == null)
        setDraft('')
        setSessionError('')
        setSummary(null)
        setPhase('session')
      })
      .catch((caught) => {
        if (cancelled) return
        hydratedRef.current = sessionParam
        setResumeError(readPracticeError(caught).message)
        setPhase('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [sessionParam])

  const filteredPoints = useMemo(() => {
    const keyword = kpQuery.trim().toLowerCase()
    if (!keyword) return points
    return points.filter((point) => point.title.toLowerCase().includes(keyword))
  }, [points, kpQuery])

  const togglePoint = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    )
  }

  const startPractice = async () => {
    if (startingRef.current) return
    if (selectedIds.length === 0) {
      setSetupError('请至少选择一个知识点')
      return
    }

    const payload: SessionCreate = {
      knowledge_point_ids: selectedIds,
      difficulty: setupDifficulty,
    }
    const trimmedCount = countInput.trim()
    if (trimmedCount !== '') {
      const parsed = Number(trimmedCount)
      if (!Number.isInteger(parsed) || parsed < MIN_COUNT || parsed > MAX_COUNT) {
        setSetupError(`题目数量需在 ${MIN_COUNT}-${MAX_COUNT} 之间，或留空使用学习偏好`)
        return
      }
      payload.count = parsed
    }

    setSetupError('')
    startingRef.current = true
    setStarting(true)
    try {
      const data = await createSession(payload)
      if (!aliveRef.current) return
      hydratedRef.current = data.session_id
      setSessionId(data.session_id)
      setSessionDifficulty(data.difficulty)
      setProgress(data.progress)
      setCurrentQuestion(data.current_question ?? null)
      setAnswered([])
      setFinished(data.current_question == null)
      setDraft('')
      setSessionError('')
      setSummary(null)
      setPhase('session')
      setSearchParams({ session: data.session_id })
    } catch (caught) {
      if (aliveRef.current) setSetupError(readPracticeError(caught).message)
    } finally {
      startingRef.current = false
      if (aliveRef.current) setStarting(false)
    }
  }

  const submitAnswer = async () => {
    if (!sessionId || !currentQuestion || submittingRef.current) return
    const value = draft.trim()
    if (value === '') return

    const question = currentQuestion
    submittingRef.current = true
    setSubmitting(true)
    setSessionError('')
    try {
      const response = await answerSession(sessionId, {
        question_id: question.id,
        answer: value,
      })
      if (!aliveRef.current) return
      setAnswered((prev) => [
        ...prev,
        {
          id: question.id,
          no: question.no,
          type: question.type,
          stem: question.stem,
          options: question.options ?? null,
          answer: value,
          correct: response.correct,
          correct_answer: response.correct_answer,
          explanation: response.explanation,
          difficulty: question.difficulty,
        },
      ])
      setProgress(response.progress)
      setSessionDifficulty(response.difficulty)
      setCurrentQuestion(response.current_question ?? null)
      setFinished(response.finished)
      setDraft('')
    } catch (caught) {
      if (!aliveRef.current) return
      const mapped = readPracticeError(caught)
      setSessionError(mapped.message)
      if (caught instanceof ApiError && caught.code === 'SESSION_ENDED') {
        setFinished(true)
        setCurrentQuestion(null)
      }
    } finally {
      submittingRef.current = false
      if (aliveRef.current) setSubmitting(false)
    }
  }

  const finishPractice = async () => {
    if (!sessionId || endingRef.current) return
    endingRef.current = true
    setEnding(true)
    setSessionError('')
    try {
      const data = await endSession(sessionId)
      if (!aliveRef.current) return
      setSummary(data)
      setPhase('summary')
      hydratedRef.current = null
      setSearchParams({}, { replace: true })
    } catch (caught) {
      if (aliveRef.current) setSessionError(readPracticeError(caught).message)
    } finally {
      endingRef.current = false
      if (aliveRef.current) setEnding(false)
    }
  }

  const backToSetup = () => {
    hydratedRef.current = null
    setPhase('setup')
    setSessionId(null)
    setSessionDifficulty('easy')
    setProgress(null)
    setCurrentQuestion(null)
    setAnswered([])
    setFinished(false)
    setDraft('')
    setSessionError('')
    setSummary(null)
    setResumeError('')
    setSearchParams({}, { replace: true })
  }

  const rootClass = 'mx-auto w-full max-w-[1100px] px-6 py-6'

  if (phase === 'loading') {
    return (
      <div className={rootClass} data-testid="page-practice">
        <LoadingView className="py-24" />
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div className={rootClass} data-testid="page-practice">
        <div className="card p-8 text-center" data-testid="practice-invalid">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-page">
            <AlertCircle size={20} className="text-ink-mute" />
          </div>
          <h1 className="mt-4 text-[17px] font-bold text-ink">练习会话不可用</h1>
          <p
            data-testid="practice-invalid-message"
            className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6 text-ink-soft"
          >
            {resumeError || '练习会话不存在或已失效，请重新开始。'}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button type="button" className="btn-primary px-5" onClick={backToSetup}>
              返回练习设置
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'summary' && summary) {
    const accuracyPercent = Math.round(summary.accuracy * 100)
    return (
      <div className={rootClass} data-testid="page-practice">
        <div className="card overflow-hidden" data-testid="practice-summary">
          <div className="bg-gradient-to-r from-[#2e7cf6] to-[#5a9bff] px-6 py-6 text-white">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-white/80">
              <Flag size={15} />
              本次练习成绩
            </div>
            <div className="mt-1 flex items-end gap-3">
              <span className="text-[42px] font-bold leading-none">{accuracyPercent}%</span>
              <span className="pb-1 text-[13px] text-white/85">
                正确率 · 答对 {summary.correct} / {summary.answered} 题
              </span>
            </div>
          </div>
          <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
            <div className="rounded-xl bg-page px-4 py-3">
              <div className="text-[12px] text-ink-mute">已作答</div>
              <div className="mt-1 text-[20px] font-bold text-ink">{summary.answered}</div>
            </div>
            <div className="rounded-xl bg-page px-4 py-3">
              <div className="text-[12px] text-ink-mute">答对</div>
              <div className="mt-1 text-[20px] font-bold text-[#188c5e]">{summary.correct}</div>
            </div>
            <div className="rounded-xl bg-page px-4 py-3">
              <div className="text-[12px] text-ink-mute">结束时间</div>
              <div className="mt-1 text-[13px] font-semibold text-ink">
                {formatEndedAt(summary.ended_at)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
            <p className="text-[12.5px] text-ink-mute">
              练习会话已结束，本次数据已保存到服务端。
            </p>
            <button type="button" className="btn-primary px-6" onClick={backToSetup}>
              <RotateCcw size={15} />
              再来一组
            </button>
          </div>
        </div>

        <section className="mt-5 space-y-3">
          <h2 className="text-[14px] font-bold text-ink">本次作答回顾</h2>
          {answered.length === 0 ? (
            <div className="card px-5 py-8 text-center text-[13px] text-ink-mute">
              本次还没有作答记录。
            </div>
          ) : (
            answered.map((item) => <AnsweredCard key={`${item.id}-${item.no}`} item={item} />)
          )}
        </section>
      </div>
    )
  }

  if (phase === 'session') {
    return (
      <div className={rootClass} data-testid="page-practice">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-ink">陪练</h1>
            <p className="mt-1 text-[13px] text-ink-soft">
              服务端自适应出题：连续答对 2 题升难度，连续答错 2 题降难度。
            </p>
          </div>
        </div>

        <section className="card mt-5 flex flex-wrap items-center gap-4 p-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Target size={16} />
              </span>
              <div>
                <div className="text-[12px] text-ink-mute">当前难度</div>
                <DifficultyBadge value={sessionDifficulty} />
              </div>
            </div>
            <div className="h-9 w-px bg-line" />
            <div data-testid="practice-progress" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[12.5px] text-ink-soft">
                已答
                <span className="ml-1.5 text-[18px] font-bold text-ink">
                  {progress ? `${progress.answered}/${progress.total}` : '0/0'}
                </span>
              </span>
              <span className="text-[12.5px] text-ink-soft">
                答对
                <span className="ml-1.5 text-[15px] font-bold text-[#188c5e]">
                  {progress?.correct ?? 0}
                </span>
              </span>
            </div>
          </div>
          <button
            type="button"
            data-testid="practice-end"
            className="btn-gray px-5"
            disabled={ending || submitting}
            onClick={() => void finishPractice()}
          >
            {ending ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />}
            {ending ? '结束中…' : '结束练习'}
          </button>
        </section>

        {sessionError && (
          <div
            data-testid="practice-error"
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-[#f5c2c2] bg-[#fdecec] px-4 py-3 text-[12.5px] leading-5 text-[#c24545]"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{sessionError}</span>
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            {currentQuestion && !finished ? (
              <article data-testid="practice-question" className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#4a90ff] to-primary text-[13px] font-bold text-white">
                    {currentQuestion.no}
                  </span>
                  <span className="chip">
                    {TYPE_LABELS[currentQuestion.type] ?? currentQuestion.type}
                  </span>
                  <DifficultyBadge value={currentQuestion.difficulty} />
                  <span className="ml-auto text-[11.5px] text-ink-mute">
                    提交后才会显示答案与解析
                  </span>
                </div>

                <p className="mt-3 text-[14.5px] leading-7 text-ink">{currentQuestion.stem}</p>

                <AnswerControls
                  question={currentQuestion}
                  value={draft}
                  disabled={submitting}
                  onChange={setDraft}
                />

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    data-testid="practice-submit"
                    className="btn-primary h-9 px-5"
                    disabled={submitting || draft.trim() === ''}
                    onClick={() => void submitAnswer()}
                  >
                    {submitting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    {submitting ? '提交中…' : '提交答案'}
                  </button>
                  <span className="text-[11.5px] text-ink-mute">
                    难度会随连续答对 / 答错自动调整。
                  </span>
                </div>
              </article>
            ) : (
              <div data-testid="practice-finished" className="card px-6 py-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e5f6ec] text-[#188c5e]">
                  <CheckCircle2 size={22} />
                </div>
                <h2 className="mt-4 text-[16px] font-bold text-ink">本轮题目已完成</h2>
                <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6 text-ink-soft">
                  当前知识点暂时没有更多未作答的题目。可以结束本次练习查看成绩，或返回设置换一组知识点。
                </p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    className="btn-primary px-5"
                    disabled={ending}
                    onClick={() => void finishPractice()}
                  >
                    {ending ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                    {ending ? '结束中…' : '结束并查看成绩'}
                  </button>
                  <button type="button" className="btn-ghost px-5" onClick={backToSetup}>
                    返回设置
                  </button>
                </div>
              </div>
            )}

            {answered.length > 0 && (
              <section className="mt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13.5px] font-bold text-ink">已作答（{answered.length}）</h2>
                  <span className="text-[11.5px] text-ink-mute">答案在提交后才解锁</span>
                </div>
                {answered.map((item) => (
                  <AnsweredCard key={`${item.id}-${item.no}`} item={item} />
                ))}
              </section>
            )}
          </section>

          <aside className="h-fit space-y-4">
            <div className="card p-4">
              <h2 className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
                <Sparkles size={15} className="text-primary" />
                自适应规则
              </h2>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-5 text-ink-soft">
                <li>连续答对 2 题：难度升一档</li>
                <li>连续答错 2 题：难度降一档</li>
                <li>单次练习最多 50 题</li>
                <li>刷新页面会从服务端恢复进度</li>
              </ul>
            </div>
            <div className="card p-4">
              <h2 className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
                <Target size={15} className="text-[#2bb673]" />
                当前进度
              </h2>
              <div className="mt-2.5 text-[12.5px] text-ink-soft">
                已作答 {progress?.answered ?? 0} 题，答对 {progress?.correct ?? 0} 题。
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-mute">
                总题数由服务端动态追加，不是固定上限。
              </p>
            </div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className={rootClass} data-testid="page-practice">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-ink">陪练</h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            选择知识点开始自适应练习，答完即时讲解；刷新页面也能接着做。
          </p>
        </div>
        {selectedIds.length > 0 && (
          <span className="rounded-full bg-primary-soft px-3 py-1 text-[11.5px] text-primary">
            已选 {selectedIds.length} 个知识点
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <aside className="card h-fit p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <span className="h-3.5 w-[3px] rounded-full bg-primary" />
              练习设置
            </h2>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="practice-kp-search">
                知识点（可多选）
              </label>
              <span className="text-[11px] text-ink-mute">至少选择 1 个</span>
            </div>

            {points.length > 8 && (
              <div className="relative mt-2">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
                <input
                  id="practice-kp-search"
                  data-testid="practice-kp-search"
                  className="field-input h-8 pl-8 text-[12.5px]"
                  placeholder="按标题筛选知识点…"
                  value={kpQuery}
                  onChange={(event) => setKpQuery(event.target.value)}
                />
              </div>
            )}

            <div className="mt-2">
              {pointsLoading && <LoadingView className="py-6" />}
              {!pointsLoading && pointsError && (
                <div className="rounded-lg border border-[#f5c2c2] bg-[#fdecec] px-3 py-2 text-[12.5px] text-[#c24545]">
                  <p>{pointsError}</p>
                  <button
                    type="button"
                    className="mt-2 text-[12px] font-semibold underline underline-offset-2"
                    onClick={() => setPointsReloadKey((value) => value + 1)}
                  >
                    重新加载
                  </button>
                </div>
              )}
              {!pointsLoading && !pointsError && points.length === 0 && (
                <EmptyView
                  title="还没有知识点"
                  description="上传资料并生成笔记后，这里会出现可练习的知识点。"
                  className="py-6"
                />
              )}
              {!pointsLoading && !pointsError && points.length > 0 && (
                <>
                  {filteredPoints.length === 0 ? (
                    <p className="rounded-lg bg-page px-3 py-6 text-center text-[12.5px] text-ink-mute">
                      没有匹配的知识点
                    </p>
                  ) : (
                    <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
                      {filteredPoints.map((point) => {
                        const checked = selectedIds.includes(point.id)
                        return (
                          <label
                            key={point.id}
                            data-testid={`practice-kp-${point.id}`}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                              checked
                                ? 'border-primary bg-primary-soft'
                                : 'border-line bg-white hover:border-primary/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[#2e7cf6]"
                              checked={checked}
                              onChange={() => togglePoint(point.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink">
                                {point.title}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-ink-mute">
                                掌握度 {Math.round(point.mastery_score * 100)}%
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-5">
            <label className="text-[12.5px] font-semibold text-ink">起始难度</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((item) => {
                const active = setupDifficulty === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    data-testid={`practice-difficulty-${item.value}`}
                    aria-pressed={active}
                    onClick={() => {
                      touchedRef.current.difficulty = true
                      setSetupDifficulty(item.value)
                    }}
                    className={`h-9 rounded-lg border text-[13px] font-medium transition ${
                      active
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-line bg-white text-ink-soft hover:border-primary/40 hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-mute">
              默认取自学习偏好；练习中会随答题表现自动调整。
            </p>
          </div>

          <div className="mt-5">
            <label className="text-[12.5px] font-semibold text-ink" htmlFor="practice-count-input">
              题目数量（可选，1-50）
            </label>
            <input
              id="practice-count-input"
              data-testid="practice-count-input"
              className="field-input mt-1.5"
              type="number"
              min={MIN_COUNT}
              max={MAX_COUNT}
              step={1}
              placeholder={`留空使用学习偏好（默认 ${DEFAULT_COUNT}）`}
              value={countInput}
              onChange={(event) => {
                touchedRef.current.count = true
                setCountInput(event.target.value)
              }}
            />
          </div>

          <button
            type="button"
            data-testid="practice-start"
            className="btn-primary mt-5 w-full"
            disabled={starting || points.length === 0 || !prefsReady || selectedIds.length === 0}
            onClick={() => void startPractice()}
          >
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {starting ? '创建中…' : '开始练习'}
          </button>

          {setupError && (
            <div
              data-testid="practice-error"
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-[#f5c2c2] bg-[#fdecec] px-3 py-2 text-[12.5px] leading-5 text-[#c24545]"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{setupError}</span>
            </div>
          )}
        </aside>

        <section className="h-fit space-y-4">
          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <Sparkles size={16} className="text-primary" />
              怎么练
            </h2>
            <ol className="mt-3 space-y-2.5 text-[12.5px] leading-5 text-ink-soft">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                  1
                </span>
                从知识点里选一个或多个范围，服务端挑出第一题。
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                  2
                </span>
                提交后立即判分，并展示正确答案与解析。
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                  3
                </span>
                连续答对 2 题升难度，连续答错 2 题降难度。
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                  4
                </span>
                结束练习后查看正确率与本次作答回顾。
              </li>
            </ol>
          </div>

          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <Target size={16} className="text-[#2bb673]" />
              学习偏好
            </h2>
            <div className="mt-3 space-y-2 text-[12.5px] text-ink-soft">
              <div className="flex items-center justify-between">
                <span>默认难度</span>
                <DifficultyBadge value={setupDifficulty} />
              </div>
              <div className="flex items-center justify-between">
                <span>默认题量</span>
                <span className="font-semibold text-ink">
                  {countInput.trim() === '' ? '未设置' : `${countInput} 题`}
                </span>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] leading-5 text-ink-mute">
              这里只预填学习偏好；你在左侧的显式选择会覆盖偏好值。
            </p>
          </div>

          <div className="rounded-xl border border-line bg-primary-soft-2 px-4 py-3 text-[11.5px] leading-5 text-ink-soft">
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              <ArrowRight size={13} />
              续做提示
            </span>
            <p className="mt-1">进行中的练习会写入地址栏（?session=…），刷新或重新打开可恢复进度。</p>
          </div>
        </section>
      </div>
    </div>
  )
}
