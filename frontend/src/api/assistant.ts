import { getToken, request } from './client'
import type {
  AssistantCitation,
  AssistantConversation,
  AssistantMessageDto,
} from './types'

const BASE = '/api'

export interface ConversationDetail {
  conversation: AssistantConversation
  messages: AssistantMessageDto[]
}

export interface StreamHandlers {
  onCitations: (citations: AssistantCitation[]) => void
  onToken: (text: string) => void
  onDone: (messageId: string) => void
}

export async function listConversations(limit = 20): Promise<AssistantConversation[]> {
  return request<AssistantConversation[]>(`/assistant/conversations?limit=${limit}`)
}

export async function createConversation(payload: {
  title?: string
  competition_id?: string | null
  mode?: string
} = {}): Promise<AssistantConversation> {
  return request<AssistantConversation>('/assistant/conversations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/assistant/conversations/${id}`)
}

function parseFrames(buffer: string): { frames: { event: string; data: string }[]; rest: string } {
  const frames: { event: string; data: string }[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

export async function streamMessage(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${BASE}/assistant/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
    signal,
  })
  if (!response.ok || response.body === null) {
    let detail = `请求失败（${response.status}）`
    try {
      const body = (await response.json()) as { detail?: string }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      detail = `请求失败（${response.status}）`
    }
    throw new Error(detail)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseFrames(buffer)
    buffer = parsed.rest
    for (const frame of parsed.frames) {
      const payload = JSON.parse(frame.data) as Record<string, unknown>
      if (frame.event === 'citations') {
        handlers.onCitations((payload.citations ?? []) as AssistantCitation[])
      } else if (frame.event === 'token') {
        handlers.onToken(String(payload.text ?? ''))
      } else if (frame.event === 'done') {
        handlers.onDone(String(payload.message_id ?? ''))
      } else if (frame.event === 'error') {
        throw new Error(String(payload.message ?? '生成失败'))
      }
    }
  }
}
