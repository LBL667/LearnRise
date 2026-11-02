import type {
  Competition,
  CompetitionPlan,
  CompetitionRecord,
  CreateCompetitionPayload,
  CreateResult,
  DueReviewList,
  LearnRiseApi,
  LeaderboardEntry,
  Member,
  ProfileInfo,
  ProfileStat,
  RemediationPayload,
  RemediationPlan,
  ReviewStats,
  ReviewSubmitResult,
  SettingGroup,
  StudyProgressItem,
  StartTrialExamPayload,
  TrialExam,
  TrialExamState,
  TrialSubmission,
  JobStatus,
  WeakPoint,
  WrongQuestion,
  WrongQuestionQuery,
} from './types'

/**
 * 数据访问统一入口：所有方法都走 FastAPI。
 *
 * 真实后端契约由 `openapi.json` 生成到 `src/api/generated/schema.d.ts`，
 * FastAPI 是唯一真源。
 */
const BASE = '/api'
const DEFAULT_TIMEOUT_MS = 15_000
export const TOKEN_STORAGE_KEY = 'learnrise.token'

/** 长耗时端点的超时配置（毫秒）。 */
export const TIMEOUTS = {
  default: 15_000,
  quiz: 120_000,
  notes: 180_000,
  agentTest: 30_000,
  messages: 90_000,
} as const
const LOGIN_PATH = '/login'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly detail: string

  constructor(status: number, code: string | null, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
}

function redirectToLogin(): void {
  if (window.location.pathname === LOGIN_PATH) return
  const target = `${window.location.pathname}${window.location.search}`
  window.location.assign(`${LOGIN_PATH}?redirect=${encodeURIComponent(target)}`)
}

async function toApiError(response: Response): Promise<ApiError> {
  let detail = `请求失败（${response.status}）`
  let code: string | null = null
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object') {
      const record = body as { detail?: unknown; code?: unknown }
      if (typeof record.detail === 'string') {
        detail = record.detail
      } else if (record.detail !== undefined) {
        detail = JSON.stringify(record.detail)
      }
      if (typeof record.code === 'string') {
        code = record.code
      }
    }
  } catch {
    detail = `请求失败（${response.status}）`
  }
  return new ApiError(response.status, code, detail)
}

/**
 * 把 FastAPI 的错误 `detail` 归一化为可展示文案，永不抛错。
 *
 * 覆盖字符串、`{message, raw}`、422 校验数组以及未知结构。
 */
export function parseApiDetail(detail: unknown): { message: string; raw?: string } {
  try {
    if (typeof detail === 'string') {
      return { message: detail }
    }

    if (Array.isArray(detail)) {
      const messages: string[] = []
      for (const item of detail) {
        if (typeof item === 'string') {
          messages.push(item)
          continue
        }
        if (item && typeof item === 'object') {
          const record = item as { msg?: unknown; loc?: unknown }
          const msg = typeof record.msg === 'string' ? record.msg : null
          if (msg !== null) {
            const loc = Array.isArray(record.loc) ? record.loc.map(String).join('.') : ''
            messages.push(loc ? `${loc}: ${msg}` : msg)
            continue
          }
        }
        const serialized = safeStringify(item)
        if (serialized !== null) messages.push(serialized)
      }
      const raw = safeStringify(detail) ?? undefined
      return {
        message: messages.length > 0 ? messages.join('; ') : '请求校验失败',
        ...(raw === undefined ? {} : { raw }),
      }
    }

    if (detail && typeof detail === 'object') {
      const record = detail as { message?: unknown; raw?: unknown; detail?: unknown }
      if (typeof record.message === 'string') {
        return typeof record.raw === 'string'
          ? { message: record.message, raw: record.raw }
          : { message: record.message }
      }
      if (typeof record.raw === 'string') {
        return { message: record.raw, raw: record.raw }
      }
      if (record.detail !== undefined && record.detail !== detail) {
        return parseApiDetail(record.detail)
      }
      return { message: safeStringify(detail) ?? '请求失败' }
    }

    if (detail === null || detail === undefined) {
      return { message: '请求失败' }
    }
    return { message: String(detail) }
  } catch {
    return { message: '请求失败' }
  }
}

function safeStringify(value: unknown): string | null {
  try {
    const rendered = JSON.stringify(value)
    return typeof rendered === 'string' ? rendered : null
  } catch {
    return null
  }
}

interface RequestOptions {
  timeoutMs?: number
}

async function perform(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  const headers = new Headers(init.headers)
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  try {
    const response = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal })

    if (response.status === 401) {
      clearToken()
      redirectToLogin()
      throw new ApiError(401, 'AUTH_REQUIRED', '未认证')
    }
    if (!response.ok) {
      throw await toApiError(response)
    }
    return response
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', `请求超时（${timeoutMs}ms）`)
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络错误，请检查连接后重试')
  } finally {
    window.clearTimeout(timer)
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const response = await perform(path, init, options)
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

const QUESTION_TYPE_MAP: Record<string, string[]> = {
  choice: ['choice'],
  multiple: ['choice'],
  judge: ['judge'],
  blank: ['short_answer'],
  both: ['choice', 'judge'],
}

export function mapQuestionTypes(types: string[]): string[] {
  const mapped = types.flatMap((type) => QUESTION_TYPE_MAP[type] ?? [])
  return Array.from(new Set(mapped))
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const rendered = search.toString()
  return rendered ? `?${rendered}` : ''
}

function wrongQuestionsQuery(params: WrongQuestionQuery = {}): string {
  return query({
    competition_id: params.competitionId,
    type: params.type === 'all' ? undefined : params.type,
    severity: params.severity === 'all' ? undefined : params.severity,
    q: params.q,
    limit: params.limit,
    offset: params.offset,
  })
}

function fetchWrongQuestions(params?: WrongQuestionQuery): Promise<WrongQuestion[]> {
  return request<WrongQuestion[]>(`/wrong-questions${wrongQuestionsQuery(params)}`)
}

async function fetchWrongQuestionsPage(
  params?: WrongQuestionQuery,
): Promise<{ items: WrongQuestion[]; total: number }> {
  const response = await perform(`/wrong-questions${wrongQuestionsQuery(params)}`)
  const items = (await response.json()) as WrongQuestion[]
  const header = response.headers.get('X-Total-Count')
  const parsed = header === null ? Number.NaN : Number(header)
  return { items, total: Number.isFinite(parsed) ? parsed : items.length }
}

interface TrialExamStartResponse {
  exam_id: string
  expires_at: string
  total: number
  questions: TrialExam['questions']
}

interface TrialSubmissionResponse {
  exam_id: string
  score: number
  total: number
  submitted_at: string
  results: TrialSubmission['results']
}

interface TrialExamStateResponse {
  exam_id: string
  status: string
  score?: number | null
  total: number
  expires_at: string
  remaining_seconds: number
  questions: TrialExam['questions']
  results?: TrialSubmission['results'] | null
}

const realApi: LearnRiseApi = {
  listCompetitions: () => request<Competition[]>('/competitions'),
  getCompetition: (id) => request<Competition>(`/competitions/${id}`),
  listMembers: (id) => request<Member[]>(`/competitions/${id}/members`),
  removeMember: (id, memberId) =>
    request<void>(`/competitions/${id}/members/${memberId}`, { method: 'DELETE' }).then(() =>
      request<Member[]>(`/competitions/${id}/members`),
    ),
  getPlan: (id) => request<CompetitionPlan>(`/competitions/${id}/plan`),
  createCompetition: (payload) =>
    request<CreateResult>('/competitions', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        knowledge_prompt: payload.knowledgePrompt,
        question_types: mapQuestionTypes(payload.questionTypes),
        difficulty: payload.difficulty,
        winner_count: payload.winnerCount,
        rewards: payload.rewards,
        start_time: payload.startTime,
        end_time: payload.endTime,
        source_ids: payload.sourceIds ?? [],
      }),
    }),
  uploadDocument: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ source_id: string; job_id: string }>(
      '/sources/upload',
      { method: 'POST', body: form },
      { timeoutMs: 120_000 },
    ).then((body) => ({ sourceId: body.source_id, jobId: body.job_id, fileName: file.name }))
  },
  getJob: (jobId) => request<JobStatus>(`/jobs/${jobId}`),
  uploadRewardImage: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string; key: string }>(
      '/uploads/reward-image',
      { method: 'POST', body: form },
      { timeoutMs: 60_000 },
    )
  },
  findByInviteCode: (code) => request<Competition>(`/invite/${encodeURIComponent(code)}`),
  joinCompetition: (code) =>
    request<Competition>('/competitions/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: code }),
    }),

  listWrongQuestions: (params) => fetchWrongQuestions(params),
  listWrongQuestionsPage: (params) => fetchWrongQuestionsPage(params),
  removeWrongQuestion: async (id) => {
    await request<void>(`/wrong-questions/${id}`, { method: 'DELETE' })
    return fetchWrongQuestions()
  },
  getWeakPoints: (competitionId) =>
    request<WeakPoint[]>(`/assistant/weak-points${query({ competition_id: competitionId })}`),
  createRemediationPlan: (payload: RemediationPayload = {}) =>
    request<RemediationPlan>('/assistant/remediation-plan', {
      method: 'POST',
      body: JSON.stringify({ competition_id: payload.competitionId, limit: payload.limit }),
    }),
  getDueCards: () => request<DueReviewList>('/review/due'),
  submitReview: (cardId, rating) =>
    request<ReviewSubmitResult>(`/review/${cardId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }),
  getReviewStats: () => request<ReviewStats>('/review/stats'),
  startTrialExam: (payload: StartTrialExamPayload = {}) =>
    request<TrialExamStartResponse>('/trial/exams', {
      method: 'POST',
      body: JSON.stringify({ competition_id: payload.competitionId, count: payload.count }),
    }).then((body) => ({
      examId: body.exam_id,
      expiresAt: body.expires_at,
      total: body.total,
      questions: body.questions,
    })),
  submitTrialExam: (examId, answers) =>
    request<TrialSubmissionResponse>(`/trial/exams/${examId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }).then((body) => ({
      exam_id: body.exam_id,
      score: body.score,
      total: body.total,
      submitted_at: body.submitted_at,
      results: body.results,
    })),
  getTrialExam: (examId) =>
    request<TrialExamStateResponse>(`/trial/exams/${examId}`).then((body) => ({
      exam_id: body.exam_id,
      status: body.status,
      score: body.score,
      total: body.total,
      expires_at: body.expires_at,
      remaining_seconds: body.remaining_seconds,
      questions: body.questions,
      results: body.results,
    })),
  getUserProgress: async () => {
    const [study, stats] = await Promise.all([
      request<StudyProgressItem[]>('/profile/study-progress'),
      request<ProfileStat[]>('/profile/stats'),
    ])
    const pointProgress = study.find((item) => item.label === '知识点掌握')
    const trialProgress = study.find((item) => item.label === '试炼完成')
    const reviewItem = stats.find((item) => item.key === 'reviews')
    const reviews = Number(reviewItem?.value ?? 0) || 0
    return {
      prepDone: (pointProgress?.percent ?? 0) >= 80,
      trialDone: trialProgress?.value ?? 0,
      trialTotal: trialProgress?.total ?? 0,
      points: reviews * 4,
      pointsTarget: 100,
    }
  },
  getProfileInfo: () => request<ProfileInfo>('/profile/info'),
  getProfileStats: () => request<ProfileStat[]>('/profile/stats'),
  getCompetitionRecords: () => request<CompetitionRecord[]>('/profile/competition-records'),
  getStudyProgress: () => request<StudyProgressItem[]>('/profile/study-progress'),
  getSettingGroups: () => request<SettingGroup[]>('/profile/settings'),
  getLeaderboard: (competitionId) =>
    request<LeaderboardEntry[]>(`/leaderboard/${encodeURIComponent(competitionId)}`),
}

export const api: LearnRiseApi = realApi

export type { Competition, Member, CompetitionPlan, CreateCompetitionPayload }
