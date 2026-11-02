export interface SourceOut {
  id: string
  title: string
  filename: string
  content_type: string
  size_bytes: number
  status: string
  page_count: number | null
  created_at: string
}

export interface SourceDetail {
  id: string
  title: string
  filename: string
  content_type: string
  size_bytes: number
  status: string
  page_count: number | null
  created_at: string
  error_message: string | null
  updated_at: string
}

export interface SourceJobAccepted {
  source_id: string
  job_id: string
  status?: string
}

export interface TreeNode {
  id: string
  title: string
  content: string
  level: number
  mastery_score: number
  children?: TreeNode[]
}

export interface NotesRequest {
  agent_id?: string | null
}

export interface NotesResponse {
  source_id: string
  knowledge_points_created: number
  root_ids: string[]
  model: string
}
