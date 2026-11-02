export type AgentProviderType = 'openai_compatible'

export interface AgentOut {
  id: string
  name: string
  provider_type: string
  base_url: string
  model: string
  system_prompt: string | null
  temperature: number
  is_default: boolean
  api_key_masked: string
  created_at: string
  updated_at: string
}

export interface AgentCreate {
  name: string
  base_url: string
  model: string
  provider_type?: AgentProviderType
  api_key?: string
  system_prompt?: string | null
  temperature?: number
  is_default?: boolean
}

export interface AgentUpdate {
  name?: string | null
  base_url?: string | null
  model?: string | null
  provider_type?: AgentProviderType | null
  api_key?: string | null
  system_prompt?: string | null
  temperature?: number | null
  is_default?: boolean | null
}

export interface AgentTestResult {
  ok: boolean
  message: string
}
