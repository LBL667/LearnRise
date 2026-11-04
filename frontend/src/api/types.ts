/** 全局数据类型定义 —— 与后端 FastAPI 接口保持同构 */

export type QuestionType = 'choice' | 'blank' | 'multiple' | 'judge' | 'both'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type CoverVariant = 'aurora' | 'blackboard' | 'geometry' | 'wave' | 'forest'

/** 竞赛 */
export interface Competition {
  id: string
  title: string
  /** 学段标签：高中 / 大学 */
  level: string
  description: string
  host: string
  memberCount: number
  capacity?: number | null
  /** '2025-09-01 14:00' */
  startTime: string
  endTime: string
  /** 获奖名额 */
  awardQuota: number
  /** 展示用：距离开始 / 结束天数（设计稿口径） */
  daysToStart: number
  daysToEnd: number
  cover: CoverVariant
  inviteCode: string
  /** 后端下发的题型（choice / judge / short_answer） */
  questionTypes?: string[]
  difficulty?: Difficulty
  rewards?: RewardItem[]
  planStatus?: 'pending' | 'generating' | 'ready' | 'failed'
  /** 当前登录用户在该竞赛中的角色；未加入时为空 */
  currentUserRole?: 'leader' | 'member' | 'viewer' | null
  canManageMembers?: boolean
}

/** 竞赛成员 */
export interface Member {
  id: string
  name: string
  role: 'leader' | 'member'
  /** 用于生成渐变头像的色相 0-360 */
  avatarHue: number
}

/** 规划图阶段 */
export interface PlanStage {
  no: string
  title: string
  theme: string
  points: string[]
  icon: 'book' | 'grid' | 'triangle' | 'chart' | 'pie' | 'crown'
  /** 段位 Logo 图片路径（如 /badges/01.png） */
  logo?: string
}

/** 奖励条目 */
export interface RewardItem {
  rank: number
  name: string
  imageUrl?: string
}

/** 学习规划（详情页“学习规划”Tab） */
export interface CompetitionPlan {
  stats: {
    daysToStart: number
    startAt: string
    daysToEnd: number
    endAt: string
    awardQuota: number
  }
  /** 前三奖励 */
  rewards: RewardItem[]
  intro: string
  stages: PlanStage[]
}

/** 创建竞赛提交载荷 */
export interface CreateCompetitionPayload {
  /** 学习竞赛名称 */
  name: string
  /** 已上传到后端、待绑定到竞赛的资料 id */
  sourceIds?: string[]
  /** 知识点范围 / 掌握程度 / 章节，最底层 prompt */
  knowledgePrompt: string
  /** 已选题型（可多选） */
  questionTypes: QuestionType[]
  difficulty: Difficulty
  winnerCount: number
  rewards: RewardItem[]
  /** 'YYYY-MM-DD HH:mm' */
  startTime: string
  endTime: string
}

export interface CreateResult {
  id: string
  inviteCode: string
}

export interface UploadDocResult {
  sourceId: string
  jobId: string
  fileName: string
}

/** 后端 job 轮询结果 */
export interface JobStatus {
  id: string
  status: 'queued' | 'parsing' | 'embedding' | 'ready' | 'ready_empty' | 'failed'
  progress: number
}

/* ========== 备赛区：学习助手 / 错题收藏 / 思维导图 ========== */

/** AI 回复中的学习计划卡片 */
export interface PlanMonth {
  no: number
  name: string
  period: string
  items: string[]
}

export interface PlanCard {
  title: string
  months: PlanMonth[]
  tail: string
}

/** 学习助手引用 */
export interface AssistantCitation {
  chunk_id: string
  source_id: string
  knowledge_point_id?: string | null
  page?: number | null
  heading?: string | null
  snippet: string
  score: number
}

export interface AssistantConversation {
  id: string
  title: string
  mode: string
  competition_id?: string | null
  created_at: string
  updated_at: string
}

export interface AssistantMessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AssistantCitation[]
  mode?: string | null
  created_at: string
}

/** 聊天消息（含初始历史） */
export interface ChatItem {
  id: string
  role: 'ai' | 'user'
  text: string
  planCard?: PlanCard
  /** 'HH:mm' */
  time: string
  /** 学习助手引用（真实后端返回） */
  citations?: AssistantCitation[]
}

export type WrongSeverity = 'repeat' | 'general'
export type WrongType = 'choice' | 'blank' | 'multiple' | 'judge'

export interface WrongOption {
  key: string
  text: string
}

/** 选择题逐选项解析 */
export interface WrongOptionNote {
  key: string
  verdict: 'correct' | 'wrong'
  text: string
}

/** 错题（均为选择题 / 填空题） */
export interface WrongQuestion {
  id: string
  severity: WrongSeverity
  type: WrongType
  stem: string
  options?: WrongOption[]
  tags: string[]
  myMistake: string
  wrongCount: number
  analysis: {
    /** 填空题答案 */
    answer?: string
    /** 填空题步骤 */
    steps?: string[]
    /** 正确答案（选择题） */
    choiceAnswer?: string
    /** 选择题逐选项解析 */
    optionNotes?: WrongOptionNote[]
    conclusion: string
  }
}

/** 错题列表查询参数（后端为 snake_case，这里保持前端风格） */
export interface WrongQuestionQuery {
  competitionId?: string
  /** 'all' 与不传等价，方便直接透传面板筛选值 */
  type?: WrongType | 'all'
  severity?: WrongSeverity | 'all'
  q?: string
  limit?: number
  offset?: number
}

/** 薄弱知识点（GET /api/assistant/weak-points） */
export interface WeakPoint {
  knowledge_point_id: string
  title: string
  total_attempts: number
  wrong_attempts: number
  error_rate: number
  mastery_score: number
  score: number
}

export interface RemediationQuestion {
  id: string
  stem: string
  type: WrongType
  wrong_count: number
}

export interface RemediationItem {
  knowledge_point_id: string
  title: string
  error_rate: number
  recommended_questions: RemediationQuestion[]
}

/** 补强计划（POST /api/assistant/remediation-plan） */
export interface RemediationPlan {
  items: RemediationItem[]
  guidance?: string | null
}

export interface RemediationPayload {
  competitionId?: string
  limit?: number
}

/** DSR 到期卡片（GET /api/review/due） */
export interface DueReviewCard {
  id: string
  question: string
  answer: string
  knowledge_point_id: string | null
  due_date: string | null
  state: number
  reps: number
  lapses: number
  difficulty: number
  stability: number
  retrievability: number
  /** 后端可选下发；缺失时前端不渲染预测区间 */
  predicted_intervals?: number[] | Record<string, number> | null
}

export interface DueReviewList {
  cards: DueReviewCard[]
  count: number
}

/** POST /api/review/{card_id}/submit */
export interface ReviewSubmitResult {
  card_id: string
  next_due_date: string
  interval_days: number
  stability: number
  difficulty: number
  state: number
  reps: number
  lapses: number
  idempotent: boolean
}

/** GET /api/review/stats */
export interface ReviewStats {
  due_count: number
  reviewed_today: number
  streak_days: number
  total_cards: number
}

/* ========== 赛题试炼 ========== */

export interface TrialExamQuestion {
  id: string
  /** 显示编号从 1 开始 */
  no: number
  /** 后端把 short_answer 映射为 blank */
  type: 'choice' | 'blank' | 'multiple' | 'judge'
  score: number
  stem: string
  options?: WrongOption[]
  answered: boolean
}

export interface TrialExam {
  examId: string
  /** 服务端 ISO-8601 过期时间 */
  expiresAt: string
  total: number
  questions: TrialExamQuestion[]
}

export interface TrialSourceChunk {
  content: string
  page?: number | null
  heading?: string | null
}

export interface TrialAnswerResult {
  question_id: string
  correct: boolean
  my_answer: string
  correct_answer: string
  explanation: string
  source_chunk?: TrialSourceChunk | null
}

export interface TrialSubmission {
  exam_id: string
  /** 服务端判分：答对题数 */
  score: number
  total: number
  submitted_at: string
  results: TrialAnswerResult[]
}

export interface TrialExamState {
  exam_id: string
  status: 'in_progress' | 'submitted' | 'expired' | string
  score?: number | null
  total: number
  expires_at: string
  submitted_at?: string | null
  remaining_seconds: number
  questions: TrialExamQuestion[]
  results?: TrialAnswerResult[] | null
}

export interface StartTrialExamPayload {
  competitionId?: string
  count?: number
}

/* ========== 晋级赛 / 个人中心 ========== */

export interface UserProgress {
  prepDone: boolean
  trialDone: number
  trialTotal: number
  points: number
  pointsTarget: number
}

export interface ProfileInfo {
  id: string
  name: string
  email: string
  /** 由用户 id 派生的头像色相 0-360 */
  avatarHue: number
  /** 等级：初识 / 启行 / 明理 / 融会 / 贯通 / 卓越 */
  level: string
  /** 'YYYY-MM-DD' */
  joinedAt: string
  competitionCount: number
  school?: string | null
  grade?: string | null
  avatarUrl?: string | null
}

export interface ProfileStat {
  key: string
  label: string
  value: string
  unit?: string | null
  tone: 'primary' | 'success' | 'warning' | 'violet'
}

export interface CompetitionRecord {
  id: string
  title: string
  role: 'leader' | 'member' | 'viewer'
  memberCount: number
  /** 'YYYY-MM-DD' */
  joinedAt: string
  status: string
}

/* ========== 排行榜 ========== */

export interface LeaderboardEntry {
  /** 服务端下发的连续名次，从 1 开始 */
  rank: number
  userId: string
  name: string
  /** 段位名：初识 / 启行 / 明理 / 融会 / 贯通 / 卓越 */
  tier: string
  /** 段位小级罗马数字 */
  division: string
  points: number
  /** 头像渐变色相 */
  avatarHue: number
  /** 已上传头像的签名地址；为空时回退到渐变首字头像 */
  avatarUrl?: string | null
}

/** 前端 API 契约 —— 全部由 FastAPI 实现 */
export interface LearnRiseApi {
  listCompetitions(): Promise<Competition[]>
  getCompetition(id: string): Promise<Competition | undefined>
  listMembers(competitionId: string): Promise<Member[]>
  /** 队长移除成员，返回删除后的成员列表 */
  removeMember(competitionId: string, memberId: string): Promise<Member[]>
  getPlan(competitionId: string): Promise<CompetitionPlan>
  createCompetition(payload: CreateCompetitionPayload): Promise<CreateResult>
  uploadDocument(file: File): Promise<UploadDocResult>
  /** 轮询入库 job 状态 */
  getJob(jobId: string): Promise<JobStatus>
  /** 上传奖励图片，返回可公开访问的 url */
  uploadRewardImage(file: File): Promise<{ url: string; key: string }>
  findByInviteCode(code: string): Promise<Competition | undefined>
  /** 用邀请码加入竞赛；失败时抛出带 code 的 ApiError */
  joinCompetition(code: string): Promise<Competition>

  /* 备赛区 */
  /** 不传参数时保持旧的「取回全部」语义 */
  listWrongQuestions(params?: WrongQuestionQuery): Promise<WrongQuestion[]>
  /** 同上，并暴露 X-Total-Count 里的总数（服务端分页用） */
  listWrongQuestionsPage(
    params?: WrongQuestionQuery,
  ): Promise<{ items: WrongQuestion[]; total: number }>
  /** 删除一道错题，返回删除后的列表 */
  removeWrongQuestion(id: string): Promise<WrongQuestion[]>
  /** 按错误率排序的薄弱知识点 */
  getWeakPoints(competitionId?: string): Promise<WeakPoint[]>
  /** 生成补强计划（薄弱知识点 + 推荐练习） */
  createRemediationPlan(payload?: RemediationPayload): Promise<RemediationPlan>
  /** DSR 到期队列 */
  getDueCards(): Promise<DueReviewList>
  /** 提交一次复习评分（1-5），返回下次复习日期 */
  submitReview(cardId: string, rating: number): Promise<ReviewSubmitResult>
  getReviewStats(): Promise<ReviewStats>
  /* 赛题试炼 / 晋级赛 / 个人中心 */
  startTrialExam(payload?: StartTrialExamPayload): Promise<TrialExam>
  submitTrialExam(examId: string, answers: Record<string, string>): Promise<TrialSubmission>
  getTrialExam(examId: string): Promise<TrialExamState>
  getUserProgress(): Promise<UserProgress>
  getProfileInfo(): Promise<ProfileInfo>
  getProfileStats(): Promise<ProfileStat[]>
  getCompetitionRecords(): Promise<CompetitionRecord[]>
  getLeaderboard(competitionId: string): Promise<LeaderboardEntry[]>
}
