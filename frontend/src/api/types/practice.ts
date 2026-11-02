import type { QuizDifficulty } from './quiz'

export interface PracticeQuestionOut {
  id: string
  no: number
  type: string
  difficulty: string
  stem: string
  options?: string[] | null
}

export interface ProgressOut {
  answered: number
  correct: number
  total: number
}

export interface SessionCreate {
  knowledge_point_ids: string[]
  competition_id?: string | null
  count?: number
  difficulty?: QuizDifficulty
}

export interface SessionStartOut {
  session_id: string
  difficulty: string
  status: string
  progress: ProgressOut
  current_question?: PracticeQuestionOut | null
}

export interface HistoryItemOut {
  question_id: string
  no: number
  type: string
  difficulty: string
  stem: string
  answered: boolean
  options?: string[] | null
  answer?: string | null
  correct?: boolean | null
  correct_answer?: string | null
  explanation?: string | null
}

export interface SessionDetailOut {
  session_id: string
  difficulty: string
  status: string
  progress: ProgressOut
  items: HistoryItemOut[]
  ended_at?: string | null
  current_question?: PracticeQuestionOut | null
}

export interface AnswerIn {
  question_id: string
  answer: string
}

export interface PracticeAnswerOut {
  correct: boolean
  correct_answer: string
  explanation: string
  difficulty: string
  progress: ProgressOut
  finished: boolean
  current_question?: PracticeQuestionOut | null
}

export interface SessionEndOut {
  answered: number
  correct: number
  accuracy: number
  ended_at: string
}
