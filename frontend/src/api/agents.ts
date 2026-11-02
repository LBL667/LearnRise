import { TIMEOUTS, request } from '@/api/client'
import type {
  AgentCreate,
  AgentOut,
  AgentTestResult,
  AgentUpdate,
} from '@/api/types/agents'

export function listAgents(): Promise<AgentOut[]> {
  return request<AgentOut[]>('/agents')
}

export function createAgent(payload: AgentCreate): Promise<AgentOut> {
  return request<AgentOut>('/agents', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getAgent(agentId: string): Promise<AgentOut> {
  return request<AgentOut>(`/agents/${encodeURIComponent(agentId)}`)
}

export function updateAgent(agentId: string, payload: AgentUpdate): Promise<AgentOut> {
  return request<AgentOut>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function removeAgent(agentId: string): Promise<void> {
  return request<void>(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' })
}

export function setDefaultAgent(agentId: string): Promise<AgentOut> {
  return request<AgentOut>(`/agents/${encodeURIComponent(agentId)}/default`, {
    method: 'PATCH',
  })
}

export function testAgent(
  agentId: string,
  options: { timeoutMs?: number } = {},
): Promise<AgentTestResult> {
  return request<AgentTestResult>(
    `/agents/${encodeURIComponent(agentId)}/test`,
    { method: 'POST' },
    { timeoutMs: options.timeoutMs ?? TIMEOUTS.agentTest },
  )
}
