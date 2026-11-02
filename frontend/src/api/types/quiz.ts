export type QuizQuestionType = 'choice' | 'judge' | 'short_answer'
export type QuizDifficulty = 'easy' | 'medium' | 'hard'

export interface QuizGenerateRequest {
  type: QuizQuestionType
  num: number
  knowledge_point_ids?: string[]
  difficulty?: QuizDifficulty | null
}

export interface QuizItemOut {
  id: string
  type: string
  question: string
  options: string[] | null
  answer: string
  explanation: string
  difficulty: string
}

export interface QuizGenerateResponse {
  created: QuizItemOut[]
  model: string
}

export interface AnswerRequest {
  answer: string
  response_time_ms?: number | null
}

export interface SourceChunkOut {
  content: string
  page: number | null
  heading: string | null
}

export interface AnswerResponse {
  correct: boolean
  correct_answer: string
  explanation: string
  source_chunk: SourceChunkOut | null
  card_created: boolean
}

export interface AttemptOut {
  id: string
  answer: string
  correct: boolean
  response_time_ms: number | null
  created_at: string
}
