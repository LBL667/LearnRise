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
  capacity: number
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

/** AI 聊天回复 */
export interface ChatReply {
  reply: string
  planCard?: PlanCard
}

/** 聊天消息（含初始历史） */
export interface ChatItem {
  id: string
  role: 'ai' | 'user'
  text: string
  planCard?: PlanCard
  /** 'HH:mm' */
  time: string
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

/** 思维导图 */
export interface MindMapBranch {
  id: string
  label: string
  /** 主题色 hex */
  color: string
  leaves: string[]
}

export interface MindMapData {
  title: string
  center: string
  branches: MindMapBranch[]
}

/* ========== 赛题试炼 ========== */

export interface TrialQuestion {
  id: string
  /** 显示编号从 1 开始 */
  no: number
  type: 'choice' | 'blank' | 'multiple' | 'judge'
  score: number
  stem: string
  options?: WrongOption[]
  /** 填空题输入框占位 */
  placeholder?: string
  answer: string
  analysis: string
}

export interface TrialExam {
  title: string
  level: string
  cover: CoverVariant
  questionTotal: number
  fullScore: number
  /** 剩余秒数 */
  durationLeft: number
  questions: TrialQuestion[]
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
  name: string
  school: string
  badge: string
  motto: string
  joinTime: string
  grade: string
  strengths: string[]
  homepage: string
}

export interface ProfileStat {
  key: string
  label: string
  value: string
  /** 较上月变化，如 +120 / -8 */
  delta: string
  tone: 'blue' | 'green' | 'violet' | 'red'
}

export interface CompetitionRecord {
  id: string
  cover: CoverVariant
  title: string
  level: string
  timeRange: string
  award: string
  rankText: string
}

export interface StudyProgressItem {
  id: string
  cover: CoverVariant
  title: string
  level: string
  lastLesson: string
  percent: number
}

export interface SettingItem {
  icon: 'user' | 'shield' | 'bell' | 'sliders' | 'monitor' | 'lock'
  title: string
  desc: string
}

export interface SettingGroup {
  title: string
  items: SettingItem[]
}

/* ========== 排行榜 ========== */

export interface LeaderboardEntry {
  rank: number
  name: string
  /** 段位名：初识 / 启行 / 明理 / 融会 / 贯通 / 卓越 */
  tier: string
  /** 段位小级罗马数字 */
  division: string
  points: number
  /** 头像渐变色相 */
  avatarHue: number
}

/** 前端 API 契约 —— mock 实现与真实后端实现共用同一套签名 */
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
  previewRoadmap(payload: CreateCompetitionPayload): Promise<PlanStage[]>
  findByInviteCode(code: string): Promise<Competition | undefined>
  /** 用邀请码加入竞赛；失败时抛出带 code 的 ApiError */
  joinCompetition(code: string): Promise<Competition>

  /* 备赛区 */
  getChatHistory(): Promise<ChatItem[]>
  getChatSuggestions(batch: number): Promise<{ questions: string[] }>
  sendChatMessage(text: string): Promise<ChatReply>
  listWrongQuestions(): Promise<WrongQuestion[]>
  /** 删除一道错题，返回删除后的列表 */
  removeWrongQuestion(id: string): Promise<WrongQuestion[]>
  getDefaultMindMap(): Promise<MindMapData>
  generateMindMap(topic: string): Promise<MindMapData>

  /* 赛题试炼 / 晋级赛 / 个人中心 */
  getTrialExam(): Promise<TrialExam>
  submitExam(): Promise<UserProgress>
  getUserProgress(): Promise<UserProgress>
  getProfileInfo(): Promise<ProfileInfo>
  getProfileStats(): Promise<ProfileStat[]>
  getCompetitionRecords(): Promise<CompetitionRecord[]>
  getStudyProgress(): Promise<StudyProgressItem[]>
  getSettingGroups(): Promise<SettingGroup[]>
  getLeaderboard(competitionId: string): Promise<LeaderboardEntry[]>
}
