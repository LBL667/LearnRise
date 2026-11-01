import { isMockDomain, type ApiDomain } from './domains'
import { mockApi } from './mock/mockApi'
import type {
  ChatItem,
  ChatReply,
  Competition,
  CompetitionPlan,
  CompetitionRecord,
  CreateCompetitionPayload,
  CreateResult,
  DueReviewList,
  LearnRiseApi,
  LeaderboardEntry,
  Member,
  MindMapData,
  PlanStage,
  ProfileInfo,
  ProfileStat,
  RemediationPayload,
  RemediationPlan,
  ReviewStats,
  ReviewSubmitResult,
  SettingGroup,
  StudyProgressItem,
  TrialExam,
  JobStatus,
  UploadDocResult,
  UserProgress,
  WeakPoint,
  WrongQuestion,
  WrongQuestionQuery,
} from './types'

/**
 * 数据访问统一入口。
 *
 * 每个方法按 `domains.ts` 声明的域选择真实后端或 mock，因此切片迁移期间不同域
 * 可以处于不同状态。真实后端契约由 `openapi.json` 生成到
 * `src/api/generated/schema.d.ts`，FastAPI 是唯一真源。
 */
const BASE = '/api'
const DEFAULT_TIMEOUT_MS = 15_000
export const TOKEN_STORAGE_KEY = 'learnrise.token'
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
  previewRoadmap: (payload) =>
    request<PlanStage[]>('/roadmap/preview', { method: 'POST', body: JSON.stringify(payload) }),
  findByInviteCode: (code) => request<Competition>(`/invite/${encodeURIComponent(code)}`),
  joinCompetition: (code) =>
    request<Competition>('/competitions/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: code }),
    }),

  getChatHistory: () => request<ChatItem[]>('/chat/history'),
  getChatSuggestions: (batch) =>
    request<{ questions: string[] }>(`/chat/suggestions${query({ batch })}`),
  sendChatMessage: (text) =>
    request<ChatReply>('/chat/messages', { method: 'POST', body: JSON.stringify({ text }) }),
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
  getDefaultMindMap: () => request<MindMapData>('/mindmap/default'),
  generateMindMap: (topic) =>
    request<MindMapData>('/mindmap/generate', { method: 'POST', body: JSON.stringify({ topic }) }),

  getTrialExam: () => request<TrialExam>('/trial/exam'),
  submitExam: () => request<UserProgress>('/trial/submit', { method: 'POST' }),
  getUserProgress: () => request<UserProgress>('/progress'),
  getProfileInfo: () => request<ProfileInfo>('/profile/info'),
  getProfileStats: () => request<ProfileStat[]>('/profile/stats'),
  getCompetitionRecords: () => request<CompetitionRecord[]>('/profile/competition-records'),
  getStudyProgress: () => request<StudyProgressItem[]>('/profile/study-progress'),
  getSettingGroups: () => request<SettingGroup[]>('/profile/settings'),
  getLeaderboard: (competitionId) =>
    request<LeaderboardEntry[]>(`/leaderboard/${encodeURIComponent(competitionId)}`),
}

const methodDomains: Record<keyof LearnRiseApi, ApiDomain> = {
  listCompetitions: 'competitions',
  getCompetition: 'competitions',
  listMembers: 'competitions',
  removeMember: 'competitions',
  getPlan: 'competitions',
  createCompetition: 'competitions',
  uploadDocument: 'competitions',
  getJob: 'competitions',
  uploadRewardImage: 'competitions',
  previewRoadmap: 'competitions',
  findByInviteCode: 'competitions',
  joinCompetition: 'competitions',

  getChatHistory: 'assistant',
  getChatSuggestions: 'assistant',
  sendChatMessage: 'assistant',
  listWrongQuestions: 'diagnostics',
  listWrongQuestionsPage: 'diagnostics',
  removeWrongQuestion: 'diagnostics',
  getWeakPoints: 'diagnostics',
  createRemediationPlan: 'diagnostics',
  getDueCards: 'diagnostics',
  submitReview: 'diagnostics',
  getReviewStats: 'diagnostics',
  getDefaultMindMap: 'mindmap',
  generateMindMap: 'mindmap',

  getTrialExam: 'trial',
  submitExam: 'trial',
  getUserProgress: 'trial',
  getProfileInfo: 'profile',
  getProfileStats: 'profile',
  getCompetitionRecords: 'profile',
  getStudyProgress: 'profile',
  getSettingGroups: 'profile',
  getLeaderboard: 'leaderboard',
}

function pick<K extends keyof LearnRiseApi>(name: K): LearnRiseApi[K] {
  const source = isMockDomain(methodDomains[name]) ? mockApi : realApi
  return source[name]
}

export const api: LearnRiseApi = {
  listCompetitions: pick('listCompetitions'),
  getCompetition: pick('getCompetition'),
  listMembers: pick('listMembers'),
  removeMember: pick('removeMember'),
  getPlan: pick('getPlan'),
  createCompetition: pick('createCompetition'),
  uploadDocument: pick('uploadDocument'),
  getJob: pick('getJob'),
  uploadRewardImage: pick('uploadRewardImage'),
  previewRoadmap: pick('previewRoadmap'),
  findByInviteCode: pick('findByInviteCode'),
  joinCompetition: pick('joinCompetition'),

  getChatHistory: pick('getChatHistory'),
  getChatSuggestions: pick('getChatSuggestions'),
  sendChatMessage: pick('sendChatMessage'),
  listWrongQuestions: pick('listWrongQuestions'),
  listWrongQuestionsPage: pick('listWrongQuestionsPage'),
  removeWrongQuestion: pick('removeWrongQuestion'),
  getWeakPoints: pick('getWeakPoints'),
  createRemediationPlan: pick('createRemediationPlan'),
  getDueCards: pick('getDueCards'),
  submitReview: pick('submitReview'),
  getReviewStats: pick('getReviewStats'),
  getDefaultMindMap: pick('getDefaultMindMap'),
  generateMindMap: pick('generateMindMap'),

  getTrialExam: pick('getTrialExam'),
  submitExam: pick('submitExam'),
  getUserProgress: pick('getUserProgress'),
  getProfileInfo: pick('getProfileInfo'),
  getProfileStats: pick('getProfileStats'),
  getCompetitionRecords: pick('getCompetitionRecords'),
  getStudyProgress: pick('getStudyProgress'),
  getSettingGroups: pick('getSettingGroups'),
  getLeaderboard: pick('getLeaderboard'),
}

export type { Competition, Member, CompetitionPlan, PlanStage, CreateCompetitionPayload }
