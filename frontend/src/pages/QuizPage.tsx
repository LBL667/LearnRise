import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError, TIMEOUTS, parseApiDetail, request } from '@/api/client'
import { listKnowledgePoints } from '@/api/knowledge'
import { answerQuiz, generateQuiz, listQuizAttempts } from '@/api/quiz'
import type {
  AnswerResponse,
  AttemptOut,
  QuizDifficulty,
  QuizGenerateRequest,
  QuizItemOut,
  QuizQuestionType,
} from '@/api/types/quiz'
import type { KnowledgePointOut } from '@/api/types/knowledge'
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'

const SESSION_KEY = 'learnrise.quiz.session'
const SESSION_VERSION = 1
const MAX_NUM = 20
const MIN_NUM = 1
const DEFAULT_NUM = 5

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

const TYPE_OPTIONS: Array<{ value: QuizQuestionType; label: string }> = [
  { value: 'choice', label: '选择题' },
  { value: 'judge', label: '判断题' },
  { value: 'short_answer', label: '简答题' },
]

interface QuizItemView {
  id: string
  type: string
  question: string
  options: string[] | null
  difficulty: string
}

interface StoredSession {
  version: number
  items: QuizItemView[]
  drafts: Record<string, string>
  results: Record<string, AnswerResponse>
  model: string | null
}

interface ErrorInfo {
  message: string
  raw?: string
}

interface PreferencesResponse {
  learning?: {
    default_difficulty?: QuizDifficulty
    default_question_types?: QuizQuestionType[]
    default_quiz_num?: number
  }
}

interface AttemptsState {
  status: 'loading' | 'ready' | 'error'
  items: AttemptOut[]
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAnswerResponse(value: unknown): value is AnswerResponse {
  return (
    isRecord(value) &&
    typeof value.correct === 'boolean' &&
    typeof value.correct_answer === 'string' &&
    typeof value.explanation === 'string'
  )
}

/** Keep only the fields that are safe to render before submission. */
function toView(item: QuizItemOut): QuizItemView {
  return {
    id: item.id,
    type: item.type,
    question: item.question,
    options: item.options ?? null,
    difficulty: item.difficulty,
  }
}

/** FastAPI serialises object details to JSON; unwrap them before parsing. */
function readError(caught: unknown): ErrorInfo {
  if (caught instanceof ApiError) {
    let detail: unknown = caught.detail
    try {
      detail = JSON.parse(caught.detail)
    } catch {
      detail = caught.detail
    }
    return parseApiDetail(detail)
  }
  if (caught instanceof Error) return { message: caught.message || '请求失败' }
  return { message: '请求失败' }
}

function loadSession(): StoredSession | null {
  try {
    const text = window.sessionStorage.getItem(SESSION_KEY)
    if (!text) return null
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || parsed.version !== SESSION_VERSION || !Array.isArray(parsed.items)) {
      window.sessionStorage.removeItem(SESSION_KEY)
      return null
    }

    const items: QuizItemView[] = []
    for (const candidate of parsed.items) {
      if (!isRecord(candidate)) continue
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.type !== 'string' ||
        typeof candidate.question !== 'string' ||
        typeof candidate.difficulty !== 'string'
      ) {
        continue
      }
      const options = Array.isArray(candidate.options)
        ? candidate.options.filter((option): option is string => typeof option === 'string')
        : null
      items.push({
        id: candidate.id,
        type: candidate.type,
        question: candidate.question,
        options: options && options.length > 0 ? options : null,
        difficulty: candidate.difficulty,
      })
    }

    if (items.length === 0) {
      window.sessionStorage.removeItem(SESSION_KEY)
      return null
    }

    const ids = new Set(items.map((item) => item.id))
    const drafts: Record<string, string> = {}
    if (isRecord(parsed.drafts)) {
      for (const [id, value] of Object.entries(parsed.drafts)) {
        if (ids.has(id) && typeof value === 'string') drafts[id] = value
      }
    }

    const results: Record<string, AnswerResponse> = {}
    if (isRecord(parsed.results)) {
      for (const [id, value] of Object.entries(parsed.results)) {
        if (ids.has(id) && isAnswerResponse(value)) results[id] = value
      }
    }

    return {
      version: SESSION_VERSION,
      items,
      drafts,
      results,
      model: typeof parsed.model === 'string' ? parsed.model : null,
    }
  } catch {
    try {
      window.sessionStorage.removeItem(SESSION_KEY)
    } catch {
      return null
    }
    return null
  }
}

function formatCorrectAnswer(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return '正确（true）'
  if (normalized === 'false') return '错误（false）'
  return value
}

function formatAttemptTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function AnswerInput({
  item,
  value,
  disabled,
  onSelect,
}: {
  item: QuizItemView
  value: string
  disabled: boolean
  onSelect: (next: string) => void
}) {
  if (item.type === 'short_answer') {
    return (
      <textarea
        data-testid="quiz-answer-input"
        className="field-input mt-3 h-24 resize-y py-2"
        placeholder="写下你的答案…"
        value={value}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      />
    )
  }

  if (item.type === 'judge') {
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
              data-testid="quiz-option"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(option.value)}
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

  return (
    <div className="mt-3 space-y-2">
      {(item.options ?? []).map((option, index) => {
        const letter = String.fromCharCode(65 + index)
        const active = value === letter
        return (
          <button
            key={`${item.id}-${index}`}
            type="button"
            data-testid="quiz-option"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(letter)}
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
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{option}</span>
          </button>
        )
      })}
    </div>
  )
}

function QuizResult({ result }: { result: AnswerResponse }) {
  const chunk = result.source_chunk
  return (
    <div
      data-testid="quiz-result"
      className={`mt-4 rounded-xl border p-4 ${
        result.correct ? 'border-[#bfe8d1] bg-[#f2fbf6]' : 'border-[#f5c2c2] bg-[#fdf3f3]'
      }`}
    >
      <div
        className={`flex items-center gap-2 text-[14px] font-bold ${
          result.correct ? 'text-[#188c5e]' : 'text-[#d24848]'
        }`}
      >
        {result.correct ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
        {result.correct ? '正确' : '错误'}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold text-ink">正确答案</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-[13px] font-bold text-ink">
          {formatCorrectAnswer(result.correct_answer)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink-soft">
        {result.explanation}
      </p>
      {chunk && (
        <div className="mt-3 rounded-lg border border-line bg-white/80 p-3">
          <div className="text-[12px] font-semibold text-ink">
            来源切片
            {chunk.heading ? ` · ${chunk.heading}` : ''}
            {chunk.page !== null && chunk.page !== undefined ? ` · 第 ${chunk.page} 页` : ''}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-6 text-ink-soft">
            {chunk.content}
          </p>
        </div>
      )}
    </div>
  )
}

export default function QuizPage() {
  const [initialSession] = useState<StoredSession | null>(() => loadSession())
  const [items, setItems] = useState<QuizItemView[]>(initialSession?.items ?? [])
  const [drafts, setDrafts] = useState<Record<string, string>>(initialSession?.drafts ?? {})
  const [results, setResults] = useState<Record<string, AnswerResponse>>(
    initialSession?.results ?? {},
  )
  const [model, setModel] = useState<string | null>(initialSession?.model ?? null)

  const [points, setPoints] = useState<KnowledgePointOut[]>([])
  const [pointsLoading, setPointsLoading] = useState(true)
  const [pointsError, setPointsError] = useState('')
  const [pointsReloadKey, setPointsReloadKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [kpQuery, setKpQuery] = useState('')

  const [numInput, setNumInput] = useState(String(DEFAULT_NUM))
  const [type, setType] = useState<QuizQuestionType>('choice')
  const [difficulty, setDifficulty] = useState<QuizDifficulty | ''>('')
  const [prefsReady, setPrefsReady] = useState(false)
  const touchedRef = useRef({ num: false, type: false, difficulty: false })

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<ErrorInfo | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Record<string, AttemptsState>>({})

  const aliveRef = useRef(true)
  const startedAtRef = useRef<Record<string, number>>({})
  const { showToast } = useToast()

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
        if (!cancelled) setPointsError(readError(caught).message)
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
        if (!touchedRef.current.num) {
          const preferred = Number(learning.default_quiz_num)
          if (Number.isInteger(preferred) && preferred >= MIN_NUM && preferred <= MAX_NUM) {
            setNumInput(String(preferred))
          }
        }
        if (!touchedRef.current.type) {
          const preferred = learning.default_question_types?.[0]
          if (preferred === 'choice' || preferred === 'judge' || preferred === 'short_answer') {
            setType(preferred)
          }
        }
        if (!touchedRef.current.difficulty) {
          const preferred = learning.default_difficulty
          if (preferred === 'easy' || preferred === 'medium' || preferred === 'hard') {
            setDifficulty(preferred)
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
    const now = Date.now()
    for (const item of items) {
      if (startedAtRef.current[item.id] === undefined) startedAtRef.current[item.id] = now
    }
  }, [items])

  useEffect(() => {
    try {
      if (items.length === 0) {
        window.sessionStorage.removeItem(SESSION_KEY)
        return
      }
      const payload: StoredSession = {
        version: SESSION_VERSION,
        items,
        drafts,
        results,
        model,
      }
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload))
    } catch {
      return
    }
  }, [items, drafts, results, model])

  const filteredPoints = useMemo(() => {
    const keyword = kpQuery.trim().toLowerCase()
    if (!keyword) return points
    return points.filter((point) => point.title.toLowerCase().includes(keyword))
  }, [points, kpQuery])

  const answeredCount = Object.keys(results).length

  const togglePoint = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    )
  }

  const handleGenerate = async () => {
    if (generating) return
    if (selectedIds.length === 0) {
      setError({ message: '知识点列表不能为空' })
      return
    }
    const parsedNum = Number(numInput)
    if (!Number.isInteger(parsedNum) || parsedNum < MIN_NUM || parsedNum > MAX_NUM) {
      setError({ message: `生成数量需在 ${MIN_NUM}-${MAX_NUM} 之间` })
      return
    }

    setError(null)
    setGenerating(true)
    const payload: QuizGenerateRequest = {
      knowledge_point_ids: selectedIds,
      type,
      num: parsedNum,
      ...(difficulty ? { difficulty } : {}),
    }
    try {
      const data = await generateQuiz(payload, { timeoutMs: TIMEOUTS.quiz })
      if (!aliveRef.current) return
      const views = data.created.map(toView)
      setItems(views)
      setDrafts({})
      setResults({})
      setAttempts({})
      setModel(data.model)
      startedAtRef.current = Object.fromEntries(views.map((view) => [view.id, Date.now()]))
      if (views.length === 0) {
        setError({ message: '未能生成题目，请调整知识点后重试' })
      }
    } catch (caught) {
      if (aliveRef.current) setError(readError(caught))
    } finally {
      if (aliveRef.current) setGenerating(false)
    }
  }

  const handleSubmit = async (item: QuizItemView) => {
    if (submittingId !== null || results[item.id]) return
    const draft = (drafts[item.id] ?? '').trim()
    if (!draft) {
      showToast(item.type === 'short_answer' ? '请先填写答案' : '请先选择答案', 'error')
      return
    }

    const startedAt = startedAtRef.current[item.id]
    const responseTime = startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt)
    setSubmittingId(item.id)
    try {
      const response = await answerQuiz(item.id, {
        answer: draft,
        ...(responseTime === undefined ? {} : { response_time_ms: responseTime }),
      })
      if (!aliveRef.current) return
      setResults((prev) => ({ ...prev, [item.id]: response }))
      if (response.card_created) showToast('已加入复习', 'success')
    } catch (caught) {
      if (aliveRef.current) showToast(readError(caught).message, 'error')
    } finally {
      if (aliveRef.current) setSubmittingId(null)
    }
  }

  const loadAttempts = async (questionId: string) => {
    const current = attempts[questionId]
    if (current && (current.status === 'loading' || current.status === 'ready')) return
    setAttempts((prev) => ({
      ...prev,
      [questionId]: { status: 'loading', items: prev[questionId]?.items ?? [] },
    }))
    try {
      const list = await listQuizAttempts(questionId)
      if (!aliveRef.current) return
      setAttempts((prev) => ({ ...prev, [questionId]: { status: 'ready', items: list } }))
    } catch (caught) {
      if (!aliveRef.current) return
      setAttempts((prev) => ({
        ...prev,
        [questionId]: { status: 'error', items: [], message: readError(caught).message },
      }))
    }
  }

  const handleReset = () => {
    if (generating) return
    setItems([])
    setDrafts({})
    setResults({})
    setAttempts({})
    setModel(null)
    setError(null)
    startedAtRef.current = {}
    try {
      window.sessionStorage.removeItem(SESSION_KEY)
    } catch {
      return
    }
  }

  const showKpSearch = points.length > 8 || kpQuery.length > 0

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6" data-testid="page-quiz">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-ink">刷题</h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            选择知识点生成题目并即时判分；答错会回到来源切片，并自动加入间隔复习。
          </p>
        </div>
        {model && (
          <span className="rounded-full bg-page px-3 py-1 text-[11.5px] text-ink-mute">
            模型 {model}
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="card h-fit p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <span className="h-3.5 w-[3px] rounded-full bg-primary" />
              练习设置
            </h2>
            {selectedIds.length > 0 && (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">
                已选 {selectedIds.length}
              </span>
            )}
          </div>

          <div className="mt-4">
            <label className="text-[12.5px] font-semibold text-ink" htmlFor="quiz-kp-search">
              知识点
            </label>
            {showKpSearch && (
              <div className="relative mt-2">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
                <input
                  id="quiz-kp-search"
                  data-testid="quiz-kp-search"
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
                <ErrorView
                  message={pointsError}
                  onRetry={() => setPointsReloadKey((value) => value + 1)}
                  className="py-6"
                />
              )}
              {!pointsLoading && !pointsError && points.length === 0 && (
                <EmptyView
                  title="先去资料库生成知识点"
                  description="上传资料并生成笔记后，这里会出现可练习的知识点。"
                  action={
                    <Link to="/library" className="btn-primary h-8 px-3 text-[12.5px]">
                      前往资料库
                    </Link>
                  }
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
                            data-testid={`kp-option-${point.id}`}
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

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="quiz-num-input">
                题目数量（1-20）
              </label>
              <input
                id="quiz-num-input"
                data-testid="quiz-num-input"
                className="field-input mt-1.5"
                type="number"
                min={MIN_NUM}
                max={MAX_NUM}
                step={1}
                value={numInput}
                onChange={(event) => {
                  touchedRef.current.num = true
                  setNumInput(event.target.value)
                }}
              />
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="quiz-type-select">
                题型
              </label>
              <select
                id="quiz-type-select"
                data-testid="quiz-type-select"
                className="field-input mt-1.5"
                value={type}
                onChange={(event) => {
                  touchedRef.current.type = true
                  setType(event.target.value as QuizQuestionType)
                }}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-ink" htmlFor="quiz-difficulty-select">
                难度
              </label>
              <select
                id="quiz-difficulty-select"
                data-testid="quiz-difficulty-select"
                className="field-input mt-1.5"
                value={difficulty}
                onChange={(event) => {
                  touchedRef.current.difficulty = true
                  setDifficulty(event.target.value as QuizDifficulty | '')
                }}
              >
                <option value="">跟随学习偏好</option>
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            data-testid="quiz-generate"
            className="btn-primary mt-4 w-full"
            disabled={generating || points.length === 0 || !prefsReady}
            onClick={() => void handleGenerate()}
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? '生成中…' : '生成题目'}
          </button>

          {error && (
            <div
              data-testid="quiz-error"
              role="alert"
              className="mt-3 rounded-lg border border-[#f5c2c2] bg-[#fdecec] px-3 py-2 text-[12.5px] leading-5 text-[#c24545]"
            >
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p data-testid="quiz-error-message">{error.message}</p>
                  {error.raw && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] text-[#c24545]/80">
                        查看原始错误
                      </summary>
                      <pre
                        data-testid="quiz-error-raw"
                        className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 text-[11px]"
                      >
                        {error.raw}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>

        <section className="min-w-0">
          {items.length === 0 ? (
            <div className="card flex min-h-[360px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <Sparkles size={28} className="text-primary/60" />
              <div className="text-[15px] font-semibold text-ink">还没有题目</div>
              <p className="max-w-[420px] text-[13px] leading-6 text-ink-mute">
                在左侧选择知识点，设置好数量与题型后点击「生成题目」。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-bold text-ink">本次练习（{items.length} 题）</span>
                  <span className="text-[12px] text-ink-mute">
                    已完成 {answeredCount} / {items.length}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="quiz-reset"
                  className="btn-ghost h-8 px-3 text-[12.5px]"
                  disabled={generating}
                  onClick={handleReset}
                >
                  <RotateCcw size={14} />
                  重新开始
                </button>
              </div>

              {items.map((item, index) => {
                const draft = drafts[item.id] ?? ''
                const result = results[item.id]
                const pending = submittingId === item.id
                const attemptState = attempts[item.id]
                return (
                  <article key={item.id} data-testid="quiz-question" className="card p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">
                        {index + 1}
                      </span>
                      <span className="chip">{TYPE_LABELS[item.type] ?? item.type}</span>
                      <span className="chip">
                        {DIFFICULTY_LABELS[item.difficulty] ?? item.difficulty}
                      </span>
                      {result && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            result.correct
                              ? 'bg-[#e5f6ec] text-[#188c5e]'
                              : 'bg-[#fdecec] text-[#d24848]'
                          }`}
                        >
                          {result.correct ? '已答对' : '已答错'}
                        </span>
                      )}
                    </div>

                    <p className="mt-3 text-[14px] leading-7 text-ink">{item.question}</p>

                    <AnswerInput
                      item={item}
                      value={draft}
                      disabled={Boolean(result) || pending}
                      onSelect={(next) => setDrafts((prev) => ({ ...prev, [item.id]: next }))}
                    />

                    {!result && (
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          type="button"
                          data-testid="quiz-submit"
                          className="btn-primary h-9 px-4"
                          disabled={pending || draft.trim().length === 0}
                          onClick={() => void handleSubmit(item)}
                        >
                          {pending ? <Loader2 size={14} className="animate-spin" /> : null}
                          {pending ? '提交中…' : '提交答案'}
                        </button>
                        <span className="text-[11.5px] text-ink-mute">
                          提交后才会显示答案与解析
                        </span>
                      </div>
                    )}

                    {result && <QuizResult result={result} />}

                    <details
                      data-testid="quiz-attempts"
                      className="mt-3 rounded-lg border border-line bg-page/60 px-3 py-2"
                      onToggle={(event) => {
                        if (event.currentTarget.open) void loadAttempts(item.id)
                      }}
                    >
                      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[12.5px] text-ink-soft hover:text-primary">
                        <History size={14} />
                        历史尝试
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        {!attemptState && (
                          <p className="text-[12px] text-ink-mute">展开后加载该题的历史作答。</p>
                        )}
                        {attemptState?.status === 'loading' && (
                          <p className="text-[12px] text-ink-mute">正在加载历史尝试…</p>
                        )}
                        {attemptState?.status === 'error' && (
                          <p className="text-[12px] text-[#d24848]">
                            {attemptState.message ?? '历史尝试加载失败'}
                          </p>
                        )}
                        {attemptState?.status === 'ready' && attemptState.items.length === 0 && (
                          <p className="text-[12px] text-ink-mute">还没有作答记录。</p>
                        )}
                        {attemptState?.status === 'ready' &&
                          attemptState.items.map((attempt) => (
                            <div
                              key={attempt.id}
                              className="flex items-start justify-between gap-3 rounded-md bg-white px-3 py-2"
                            >
                              <div className="min-w-0">
                                <span
                                  className={`text-[12px] font-semibold ${
                                    attempt.correct ? 'text-[#188c5e]' : 'text-[#d24848]'
                                  }`}
                                >
                                  {attempt.correct ? '正确' : '错误'}
                                </span>
                                <p className="mt-0.5 break-words text-[12px] leading-5 text-ink-soft">
                                  作答：{attempt.answer || '（空）'}
                                </p>
                              </div>
                              <span className="shrink-0 text-[11px] text-ink-mute">
                                {formatAttemptTime(attempt.created_at)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </details>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
