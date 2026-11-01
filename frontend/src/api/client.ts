import type {
  ChatItem,
  ChatReply,
  Competition,
  CompetitionPlan,
  CompetitionRecord,
  CreateCompetitionPayload,
  CreateResult,
  LearnRiseApi,
  LeaderboardEntry,
  Member,
  MindMapData,
  PlanStage,
  ProfileInfo,
  ProfileStat,
  SettingGroup,
  StudyProgressItem,
  TrialExam,
  UploadDocResult,
  UserProgress,
  WrongQuestion,
} from './types'
import { mockApi } from './mock/mockApi'

/**
 * 数据访问统一入口。
 *
 * - 默认走 mock 层（无后端也可完整运行）
 * - 设置 VITE_USE_MOCK=false 后切到真实 FastAPI 后端（vite 代理 /api -> :8000）
 *   接口契约见 LearnRiseApi，后端同构实现见 backend/app/main.py
 */
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`API ${path} 请求失败: ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** 真实后端实现（预留） */
const realApi: LearnRiseApi = {
  listCompetitions: () => request<Competition[]>('/competitions'),
  getCompetition: (id) => request<Competition>(`/competitions/${id}`),
  listMembers: (id) => request<Member[]>(`/competitions/${id}/members`),
  removeMember: (id, memberId) =>
    request<Member[]>(`/competitions/${id}/members/${memberId}`, { method: 'DELETE' }),
  getPlan: (id) => request<CompetitionPlan>(`/competitions/${id}/plan`),
  createCompetition: (payload) =>
    request<CreateResult>('/competitions', { method: 'POST', body: JSON.stringify(payload) }),
  uploadDocument: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/uploads/document`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('文档上传失败')
    return res.json() as Promise<UploadDocResult>
  },
  previewRoadmap: (payload) =>
    request<PlanStage[]>('/roadmap/preview', { method: 'POST', body: JSON.stringify(payload) }),
  findByInviteCode: (code) => request<Competition>(`/invite/${encodeURIComponent(code)}`),

  /* 备赛区 */
  getChatHistory: () => request<ChatItem[]>('/chat/history'),
  getChatSuggestions: (batch: number) =>
    request<{ questions: string[] }>(`/chat/suggestions?batch=${batch}`),
  sendChatMessage: (text: string) =>
    request<ChatReply>('/chat/messages', { method: 'POST', body: JSON.stringify({ text }) }),
  listWrongQuestions: () => request<WrongQuestion[]>('/wrong-questions'),
  removeWrongQuestion: (id: string) =>
    request<WrongQuestion[]>(`/wrong-questions/${id}`, { method: 'DELETE' }),
  getDefaultMindMap: () => request<MindMapData>('/mindmap/default'),
  generateMindMap: (topic: string) =>
    request<MindMapData>('/mindmap/generate', { method: 'POST', body: JSON.stringify({ topic }) }),

  /* 赛题试炼 / 晋级赛 / 个人中心 */
  getTrialExam: () => request<TrialExam>('/trial/exam'),
  submitExam: () => request<UserProgress>('/trial/submit', { method: 'POST' }),
  getUserProgress: () => request<UserProgress>('/progress'),
  getProfileInfo: () => request<ProfileInfo>('/profile/info'),
  getProfileStats: () => request<ProfileStat[]>('/profile/stats'),
  getCompetitionRecords: () => request<CompetitionRecord[]>('/profile/competition-records'),
  getStudyProgress: () => request<StudyProgressItem[]>('/profile/study-progress'),
  getSettingGroups: () => request<SettingGroup[]>('/profile/settings'),
  getLeaderboard: (competitionId: string) =>
    request<LeaderboardEntry[]>(`/leaderboard/${encodeURIComponent(competitionId)}`),
}

export const api: LearnRiseApi = USE_MOCK ? mockApi : realApi

export type { Competition, Member, CompetitionPlan, PlanStage, CreateCompetitionPayload }
