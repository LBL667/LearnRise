export type CompetitionPlanGenerateAccepted = Record<string, string>

export type ExamPlanMode = 'standard' | 'sprint'

export interface ExamPlanRequest {
  competition_id: string
  regenerate?: boolean
}

export interface ExamPlanItemOut {
  date: string
  focus_kp_ids?: string[]
  quiz_count?: number
  review_count?: number
  rationale?: string
}

export interface ExamPlanOut {
  mode: ExamPlanMode
  competition_id: string
  end_at: string
  generated_at: string
  guidance?: string | null
  items?: ExamPlanItemOut[]
  truncated?: boolean
}
