import { getToken, parseApiDetail } from '@/api/client'

const BASE = '/api'

export interface SseTokenEvent {
  text: string
}

export interface SseCitationsEvent {
  citations: unknown[]
}

export interface SseDoneEvent {
  chars: number
  rewritten?: boolean
}

export interface SseErrorEvent {
  message: string
}

export interface SseHandlers {
  onToken?: (event: SseTokenEvent) => void
  onCitations?: (event: SseCitationsEvent) => void
  onDone?: (event: SseDoneEvent) => void
  onError?: (event: SseErrorEvent) => void
}

interface SseFrame {
  event: string
  data: string
}

function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
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

function readPayload(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export async function streamSse(
  url: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    signal,
  })

  if (!response.ok || response.body === null) {
    let message = `请求失败（${response.status}）`
    try {
      message = parseApiDetail(await response.json()).message
    } catch {
      message = `请求失败（${response.status}）`
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  if (signal) signal.addEventListener('abort', cancelReader, { once: true })

  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseFrames(buffer)
      buffer = parsed.rest
      for (const frame of parsed.frames) {
        const payload = readPayload(frame.data)
        if (payload === null) continue

        if (frame.event === 'token') {
          handlers.onToken?.({ text: String(payload.text ?? '') })
          continue
        }
        if (frame.event === 'citations') {
          const citations = Array.isArray(payload.citations) ? payload.citations : []
          handlers.onCitations?.({ citations })
          continue
        }
        if (frame.event === 'done') {
          const chars = typeof payload.chars === 'number' ? payload.chars : 0
          const rewritten =
            typeof payload.rewritten === 'boolean' ? payload.rewritten : undefined
          handlers.onDone?.(rewritten === undefined ? { chars } : { chars, rewritten })
          cancelReader()
          return
        }
        if (frame.event === 'error') {
          const message = String(payload.message ?? '生成失败')
          if (handlers.onError) handlers.onError({ message })
          else throw new Error(message)
          cancelReader()
          return
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) return
    throw error
  } finally {
    if (signal) signal.removeEventListener('abort', cancelReader)
    try {
      reader.releaseLock()
    } catch {}
  }
}
