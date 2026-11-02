import { getToken, request, TIMEOUTS } from './client'
import type {
  AssistantCitation,
  AssistantConversation,
  AssistantMessageDto,
} from './types'

const BASE = '/api'

/** 学习助手回答风格；与后端 `{content, mode}` 契约一致。 */
export type AssistantMode = 'concise' | 'detailed' | 'example' | 'socratic'

export interface RevealResult {
  answer: string
  explanation: string
}

export interface ConversationDetail {
  conversation: AssistantConversation
  messages: AssistantMessageDto[]
}

/** 非流式 `POST /conversations/{id}/messages` 的返回体（后端 `AnswerOut`）。 */
export interface AnswerResult {
  message_id: string
  role: string
  content: string
  citations: AssistantCitation[]
  created_at: string
  rewritten?: boolean
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

export async function revealAnswer(
  conversationId: string,
  payload: { question_id?: string; chunk_id?: string } = {},
): Promise<RevealResult> {
  return request<RevealResult>(`/assistant/conversations/${conversationId}/reveal`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * 非流式兜底：流式失败后改用普通回复。
 *
 * 超时使用 `TIMEOUTS.messages`（90s），与长耗时问答端点一致。
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  mode?: AssistantMode,
  signal?: AbortSignal,
): Promise<AnswerResult> {
  const payload = mode === undefined ? { content } : { content, mode }
  return request<AnswerResult>(
    `/assistant/conversations/${conversationId}/messages`,
    { method: 'POST', body: JSON.stringify(payload) },
    { timeoutMs: TIMEOUTS.messages, signal },
  )
}

export async function streamMessage(
  conversationId: string,
  content: string,
  mode: AssistantMode,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${BASE}/assistant/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, mode }),
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
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(frame.data) as Record<string, unknown>
      } catch {
        continue
      }
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
