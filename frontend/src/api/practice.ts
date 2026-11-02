import { request } from '@/api/client'
import type {
  AnswerIn,
  PracticeAnswerOut,
  SessionCreate,
  SessionDetailOut,
  SessionEndOut,
  SessionStartOut,
} from '@/api/types/practice'

export function createSession(payload: SessionCreate): Promise<SessionStartOut> {
  return request<SessionStartOut>('/assistant/practice/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getSession(sessionId: string): Promise<SessionDetailOut> {
  return request<SessionDetailOut>(
    `/assistant/practice/sessions/${encodeURIComponent(sessionId)}`,
  )
}

export function answerSession(
  sessionId: string,
  payload: AnswerIn,
): Promise<PracticeAnswerOut> {
  return request<PracticeAnswerOut>(
    `/assistant/practice/sessions/${encodeURIComponent(sessionId)}/answer`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export function endSession(sessionId: string): Promise<SessionEndOut> {
  return request<SessionEndOut>(
    `/assistant/practice/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST' },
  )
}
