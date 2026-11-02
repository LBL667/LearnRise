import { TIMEOUTS, request } from '@/api/client'
import type {
  AnswerRequest,
  AnswerResponse,
  AttemptOut,
  QuizGenerateRequest,
  QuizGenerateResponse,
} from '@/api/types/quiz'

export function generateQuiz(
  payload: QuizGenerateRequest,
  options: { timeoutMs?: number } = {},
): Promise<QuizGenerateResponse> {
  return request<QuizGenerateResponse>(
    '/quiz/generate',
    { method: 'POST', body: JSON.stringify(payload) },
    { timeoutMs: options.timeoutMs ?? TIMEOUTS.quiz },
  )
}

export function answerQuiz(
  questionId: string,
  payload: AnswerRequest,
): Promise<AnswerResponse> {
  return request<AnswerResponse>(`/quiz/${encodeURIComponent(questionId)}/answer`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listQuizAttempts(questionId: string): Promise<AttemptOut[]> {
  return request<AttemptOut[]>(`/quiz/${encodeURIComponent(questionId)}/attempts`)
}
