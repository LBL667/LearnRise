export interface ReviewCardOut {
  id: string
  knowledge_point_id: string | null
  quiz_question_id: string | null
  question: string
  answer: string
  card_type: string
  difficulty: number
  stability: number
  retrievability: number
  state: number
  reps: number
  lapses: number
  due_date: string | null
  last_review: string | null
  scheduler: string
  created_at: string
  updated_at: string
}

export interface ReviewCardCreate {
  question: string
  answer: string
  knowledge_point_id?: string | null
}

export interface ReviewCardListParams {
  state?: number | null
  limit?: number
}
