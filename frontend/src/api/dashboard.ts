import { request } from '@/api/client'
import type { DashboardSummaryOut } from '@/api/types/dashboard'

export function getDashboardSummary(): Promise<DashboardSummaryOut> {
  return request<DashboardSummaryOut>('/dashboard/summary')
}
