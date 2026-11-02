import { request } from '@/api/client'
import type {
  CompetitionPlanGenerateAccepted,
  ExamPlanOut,
  ExamPlanRequest,
} from '@/api/types/plans'

export function generatePlan(competitionId: string): Promise<CompetitionPlanGenerateAccepted> {
  return request<CompetitionPlanGenerateAccepted>(
    `/competitions/${encodeURIComponent(competitionId)}/plan/generate`,
    { method: 'POST' },
  )
}

export function examPlan(payload: ExamPlanRequest): Promise<ExamPlanOut> {
  return request<ExamPlanOut>('/assistant/exam-plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
