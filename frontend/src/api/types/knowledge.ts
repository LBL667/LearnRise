export interface KnowledgePointOut {
  id: string
  source_id: string | null
  parent_id: string | null
  title: string
  content: string
  level: number
  sort_order: number
  mastery_score: number
  created_at: string
  updated_at: string
}

export interface KnowledgePointUpdate {
  title?: string | null
  content?: string | null
  sort_order?: number | null
}

export interface KnowledgePointListParams {
  source_id?: string | null
  limit?: number
  offset?: number
}

export interface KnowledgePointSearchParams {
  q: string
  limit?: number
}

export type ExplainStyle = 'concise' | 'detailed' | 'example' | 'socratic'

export interface ExplainRequest {
  agent_id?: string | null
  style?: ExplainStyle
}
