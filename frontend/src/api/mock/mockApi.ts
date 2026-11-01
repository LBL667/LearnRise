import { tierLogos } from '@/assets/tierLogos'
import type {
  ChatItem,
  ChatReply,
  Competition,
  CompetitionPlan,
  CreateCompetitionPayload,
  CreateResult,
  DueReviewCard,
  DueReviewList,
  LearnRiseApi,
  RemediationPayload,
  RemediationPlan,
  ReviewStats,
  ReviewSubmitResult,
  WeakPoint,
  WrongQuestionQuery,
  LeaderboardEntry,
  Member,
  MindMapData,
  PlanStage,
  ProfileInfo,
  ProfileStat,
  CompetitionRecord,
  SettingGroup,
  StudyProgressItem,
  TrialExam,
  UploadDocResult,
  UserProgress,
  WrongQuestion,
} from '../types'
import {
  buildDefaultMembers,
  buildDefaultPlan,
  buildMindMapTemplate,
  chatSeedPlanCard,
  chatSeedQuestion,
  chatSuggestionBatches,
  chatWelcome,
  competitionRecords,
  competitions as seedCompetitions,
  defaultMindMap,
  defaultStages,
  leaderboard,
  membersByCompetition,
  planByCompetition,
  profileInfo,
  profileStats,
  settingGroups,
  studyProgress,
  trialExam,
  userProgress as seedProgress,
  wrongQuestions,
} from './mockData'

/** 模拟网络延迟 */
const sleep = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms))

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genInviteCode(): string {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
}

function genId(): string {
  return `comp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}

function filterWrongQuestions(params: WrongQuestionQuery = {}): WrongQuestion[] {
  const keyword = params.q?.trim().toLowerCase() ?? ''
  const filtered = wrongQuestions.filter((q) => {
    if (params.type && params.type !== 'all' && q.type !== params.type) return false
    if (params.severity && params.severity !== 'all' && q.severity !== params.severity) return false
    if (keyword) {
      const haystack = [q.stem, ...q.tags].join(' ').toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
  const offset = params.offset ?? 0
  if (params.limit === undefined) return filtered.slice(offset)
  return filtered.slice(offset, offset + params.limit)
}

/**
 * mock 实现：数据存内存，接口签名与真实后端完全一致。
 * 页面组件只依赖 client.ts 暴露的方法，不感知 mock 细节。
 */
class MockApi implements LearnRiseApi {
  private store: Competition[] = [...seedCompetitions]

  async listCompetitions(): Promise<Competition[]> {
    await sleep()
    return [...this.store]
  }

  async getCompetition(id: string): Promise<Competition | undefined> {
    await sleep(120)
    return this.store.find((c) => c.id === id)
  }

  async listMembers(competitionId: string): Promise<Member[]> {
    await sleep()
    const competition = this.store.find((c) => c.id === competitionId)
    if (!competition) return []
    return membersByCompetition[competitionId] ?? buildDefaultMembers(competition)
  }

  async getPlan(competitionId: string): Promise<CompetitionPlan> {
    await sleep()
    const competition = this.store.find((c) => c.id === competitionId)
    if (!competition) throw new Error(`竞赛不存在: ${competitionId}`)
    return planByCompetition[competitionId] ?? buildDefaultPlan(competition)
  }

  async createCompetition(payload: CreateCompetitionPayload): Promise<CreateResult> {
    await sleep(420)
    const id = genId()
    const now = Date.now()
    const start = new Date(payload.startTime.replace(' ', 'T')).getTime()
    const end = new Date(payload.endTime.replace(' ', 'T')).getTime()
    const days = (ts: number) => Math.max(0, Math.round((ts - now) / 86400000))
    const coverPool = ['aurora', 'geometry', 'wave', 'forest', 'blackboard'] as const
    const competition: Competition = {
      id,
      title: payload.name.trim() || `学习竞赛 ${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日`,
      level: '高中',
      description: payload.knowledgePrompt.slice(0, 30) || '从上传文档自动生成的学习竞赛。',
      host: '林同学',
      memberCount: 1,
      capacity: 10,
      startTime: payload.startTime,
      endTime: payload.endTime,
      awardQuota: payload.winnerCount,
      daysToStart: Number.isNaN(start) ? 0 : days(start),
      daysToEnd: Number.isNaN(end) ? 0 : days(end),
      cover: coverPool[Math.floor(Math.random() * coverPool.length)],
      inviteCode: genInviteCode(),
    }
    this.store = [competition, ...this.store]
    membersByCompetition[id] = [
      { id: `${id}-m-1`, name: '林同学', role: 'leader', avatarHue: 212 },
    ]
    const plan = buildDefaultPlan(competition)
    // 规划图与创建时填写的知识点要求关联
    plan.stages = this.deriveStages(payload)
    planByCompetition[id] = plan
    return { id, inviteCode: competition.inviteCode }
  }

  /** 队长移除成员，队长本人不可移除 */
  async removeMember(competitionId: string, memberId: string): Promise<Member[]> {
    await sleep(240)
    const list = membersByCompetition[competitionId]
    if (!list) throw new Error(`竞赛不存在: ${competitionId}`)
    const target = list.find((m) => m.id === memberId)
    if (!target) throw new Error('成员不存在')
    if (target.role === 'leader') throw new Error('队长不可被移除')
    membersByCompetition[competitionId] = list.filter((m) => m.id !== memberId)
    const competition = this.store.find((c) => c.id === competitionId)
    if (competition) competition.memberCount = Math.max(0, competition.memberCount - 1)
    return [...membersByCompetition[competitionId]]
  }

  async uploadDocument(file: File): Promise<UploadDocResult> {
    await sleep(500)
    return {
      sourceId: `src-${Date.now().toString(36)}`,
      jobId: `job-${Date.now().toString(36)}`,
      fileName: file.name,
    }
  }

  /**
   * 依据知识点要求生成规划图。
   * 真实场景由后端 AI 生成；mock 按 prompt 分句映射到六阶主题。
   */
  async previewRoadmap(payload: CreateCompetitionPayload): Promise<PlanStage[]> {
    await sleep(360)
    return this.deriveStages(payload)
  }

  private deriveStages(payload: CreateCompetitionPayload): PlanStage[] {
    const chunks = payload.knowledgePrompt
      .split(/[\n;；。、,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (chunks.length === 0) return defaultStages
    return defaultStages.map((stage, i) => {
      const chunk = chunks[i % chunks.length]
      return {
        ...stage,
        theme: chunk.length > 12 ? chunk.slice(0, 12) : chunk,
        points: i === 0 && chunks.length > 6 ? chunks.slice(6, 10).map((c) => (c.length > 10 ? c.slice(0, 10) : c)) : stage.points,
      }
    })
  }

  async getJob(jobId: string): Promise<{ id: string; status: 'ready'; progress: number }> {
    return { id: jobId, status: 'ready', progress: 100 }
  }

  async uploadRewardImage(file: File): Promise<{ url: string; key: string }> {
    return { url: URL.createObjectURL(file), key: `mock/${file.name}` }
  }

  async joinCompetition(code: string): Promise<Competition> {
    const found = await this.findByInviteCode(code)
    if (!found) {
      throw new Error('邀请码无效')
    }
    return found
  }

  async findByInviteCode(code: string): Promise<Competition | undefined> {
    await sleep(180)
    const upper = code.trim().toUpperCase()
    return this.store.find((c) => c.inviteCode.toUpperCase() === upper)
  }

  /* ==================== 备赛区 ==================== */

  async getChatHistory(): Promise<ChatItem[]> {
    return [
      { id: 'msg-welcome', role: 'ai', text: chatWelcome, time: '14:18' },
      { id: 'msg-seed-q', role: 'user', text: chatSeedQuestion, time: '14:20' },
      {
        id: 'msg-seed-a',
        role: 'ai',
        text: '好的！我已根据你的目标（综合知识竞赛）和时间安排，为你制定了为期 3 个月的备考计划。计划兼顾基础巩固、专项提升和模拟冲刺，帮助你稳步提升竞赛能力。',
        planCard: chatSeedPlanCard,
        time: '14:21',
      },
    ]
  }

  async getChatSuggestions(batch: number): Promise<{ questions: string[] }> {
    await sleep(150)
    return { questions: chatSuggestionBatches[batch % chatSuggestionBatches.length] }
  }

  async sendChatMessage(text: string): Promise<ChatReply> {
    await sleep(720)
    const t = text.trim()
    if (/计划|规划|备考|复习安排/.test(t)) {
      return {
        reply: '好的！我已根据你的描述整理了一个通用备考框架。你可以告诉我具体科目和当前水平，我来帮你进一步细化。',
        planCard: chatSeedPlanCard,
      }
    }
    if (/错题|错题本|归纳/.test(t)) {
      return {
        reply:
          '关于错题整理，建议按三步走：第一，按知识点归类错题，找出集中失分的模块；第二，每道错题写下错误原因与正确思路，标注易错点；第三，每周重做一次错题本中的题目，连续两次做对再移出。你也可以把错题添加到错题收藏，我会帮你自动归纳知识点与高频错因。',
      }
    }
    const variants = [
      `收到！关于「${t.slice(0, 24)}」，建议先明确目标和现有基础，把大目标拆解成周计划，优先补齐最薄弱的模块。遇到具体题目或知识点随时发给我，我会帮你分析归纳；也可以让我为你生成对应章节的思维导图。`,
      `明白你的问题。针对「${t.slice(0, 24)}」，可以先做一次自测定位薄弱点，再按「概念梳理 → 专项练习 → 综合检验」的节奏推进。需要的话，我可以为相关章节生成思维导图，或把要点整理成复习清单。`,
    ]
    return { reply: variants[Math.floor(Math.random() * variants.length)] }
  }

  async listWrongQuestions(params: WrongQuestionQuery = {}): Promise<WrongQuestion[]> {
    await sleep(260)
    return filterWrongQuestions(params)
  }

  async listWrongQuestionsPage(
    params: WrongQuestionQuery = {},
  ): Promise<{ items: WrongQuestion[]; total: number }> {
    await sleep(260)
    const items = filterWrongQuestions(params)
    return { items, total: filterWrongQuestions({ ...params, limit: undefined, offset: undefined }).length }
  }

  /** 删除一道错题（内存移除，返回删除后的列表） */
  async removeWrongQuestion(id: string): Promise<WrongQuestion[]> {
    await sleep(240)
    const idx = wrongQuestions.findIndex((q) => q.id === id)
    if (idx === -1) throw new Error(`错题不存在: ${id}`)
    wrongQuestions.splice(idx, 1)
    return [...wrongQuestions]
  }

  async getWeakPoints(_competitionId?: string): Promise<WeakPoint[]> {
    await sleep(200)
    const grouped = new Map<string, WrongQuestion[]>()
    wrongQuestions.forEach((q) => {
      q.tags.forEach((tag) => {
        const bucket = grouped.get(tag) ?? []
        bucket.push(q)
        grouped.set(tag, bucket)
      })
    })
    return [...grouped.entries()]
      .map(([title, list], index) => {
        const wrongAttempts = list.reduce((sum, q) => sum + q.wrongCount, 0)
        const totalAttempts = wrongAttempts + 2
        return {
          knowledge_point_id: `mock-kp-${index + 1}`,
          title,
          total_attempts: totalAttempts,
          wrong_attempts: wrongAttempts,
          error_rate: wrongAttempts / totalAttempts,
          mastery_score: 1 - wrongAttempts / totalAttempts,
          score: (wrongAttempts / totalAttempts) * 0.7,
        }
      })
      .sort((a, b) => b.score - a.score)
  }

  async createRemediationPlan(payload?: RemediationPayload): Promise<RemediationPlan> {
    const weakPoints = await this.getWeakPoints(payload?.competitionId)
    const limit = payload?.limit ?? 5
    const items = weakPoints.slice(0, limit).map((point) => {
      const owner = wrongQuestions.find((q) => q.tags.includes(point.title))
      return {
        knowledge_point_id: point.knowledge_point_id,
        title: point.title,
        error_rate: point.error_rate,
        recommended_questions: owner
          ? [
              {
                id: owner.id,
                stem: owner.stem,
                type: owner.type,
                wrong_count: owner.wrongCount,
              },
            ]
          : [],
      }
    })
    return items.length > 0
      ? { items }
      : { items: [], guidance: '先做一轮诊断练习，再生成补强清单' }
  }

  private dueCards: DueReviewCard[] = wrongQuestions.slice(0, 3).map((q) => ({
    id: `mock-card-${q.id}`,
    question: q.stem,
    answer: q.analysis.answer ?? q.analysis.choiceAnswer ?? q.analysis.conclusion,
    knowledge_point_id: `mock-kp-${q.tags[0] ?? 'unknown'}`,
    due_date: new Date().toISOString().slice(0, 10),
    state: 0,
    reps: 0,
    lapses: q.wrongCount,
    difficulty: 5,
    stability: 1,
    retrievability: 1,
  }))

  private reviewedToday = 0

  async getDueCards(): Promise<DueReviewList> {
    await sleep(240)
    return { cards: [...this.dueCards], count: this.dueCards.length }
  }

  async submitReview(cardId: string, rating: number): Promise<ReviewSubmitResult> {
    await sleep(220)
    const card = this.dueCards.find((item) => item.id === cardId)
    if (!card) throw new Error(`复习卡片不存在: ${cardId}`)
    this.dueCards = this.dueCards.filter((item) => item.id !== cardId)
    this.reviewedToday += 1
    const intervalDays = [1, 2, 4, 7, 15][Math.max(0, Math.min(4, rating - 1))]
    const next = new Date()
    next.setDate(next.getDate() + intervalDays)
    return {
      card_id: cardId,
      next_due_date: next.toISOString().slice(0, 10),
      interval_days: intervalDays,
      stability: card.stability + rating,
      difficulty: card.difficulty,
      state: card.state + 1,
      reps: card.reps + 1,
      lapses: card.lapses,
      idempotent: false,
    }
  }

  async getReviewStats(): Promise<ReviewStats> {
    await sleep(160)
    return {
      due_count: this.dueCards.length,
      reviewed_today: this.reviewedToday,
      streak_days: this.reviewedToday > 0 ? 1 : 0,
      total_cards: this.dueCards.length + this.reviewedToday,
    }
  }

  async getDefaultMindMap(): Promise<MindMapData> {
    await sleep(200)
    return defaultMindMap
  }

  async generateMindMap(topic: string): Promise<MindMapData> {
    await sleep(900)
    return buildMindMapTemplate(topic.trim())
  }

  /* ==================== 赛题试炼 / 晋级赛 / 个人中心 ==================== */

  private progress: UserProgress = { ...seedProgress }

  async getTrialExam(): Promise<TrialExam> {
    await sleep(300)
    return trialExam
  }

  /** 交卷：赛题试炼完成数 +1，返回最新进度（晋级赛条件联动） */
  async submitExam(): Promise<UserProgress> {
    await sleep(500)
    this.progress.trialDone = Math.min(this.progress.trialTotal, this.progress.trialDone + 1)
    this.progress.points = Math.min(this.progress.pointsTarget, this.progress.points + 10)
    return { ...this.progress }
  }

  async getUserProgress(): Promise<UserProgress> {
    await sleep(200)
    return { ...this.progress }
  }

  async getProfileInfo(): Promise<ProfileInfo> {
    await sleep(200)
    return profileInfo
  }

  async getProfileStats(): Promise<ProfileStat[]> {
    await sleep(200)
    return profileStats
  }

  async getCompetitionRecords(): Promise<CompetitionRecord[]> {
    await sleep(240)
    return competitionRecords
  }

  async getStudyProgress(): Promise<StudyProgressItem[]> {
    await sleep(240)
    return studyProgress
  }

  async getSettingGroups(): Promise<SettingGroup[]> {
    await sleep(180)
    return settingGroups
  }

  async getLeaderboard(_competitionId: string): Promise<LeaderboardEntry[]> {
    await sleep(260)
    return leaderboard
  }
}

export const mockApi = new MockApi()
