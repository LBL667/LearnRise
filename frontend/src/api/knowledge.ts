import { request } from '@/api/client'
import type {
  KnowledgePointListParams,
  KnowledgePointOut,
  KnowledgePointSearchParams,
  KnowledgePointUpdate,
} from '@/api/types/knowledge'

function listQuery(params: KnowledgePointListParams): string {
  const search = new URLSearchParams()
  if (params.source_id !== undefined && params.source_id !== null) {
    search.set('source_id', params.source_id)
  }
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.offset !== undefined) search.set('offset', String(params.offset))
  const rendered = search.toString()
  return rendered ? `?${rendered}` : ''
}

export function listKnowledgePoints(
  params: KnowledgePointListParams = {},
): Promise<KnowledgePointOut[]> {
  return request<KnowledgePointOut[]>(`/knowledge-points${listQuery(params)}`)
}

export function getKnowledgePoint(knowledgePointId: string): Promise<KnowledgePointOut> {
  return request<KnowledgePointOut>(
    `/knowledge-points/${encodeURIComponent(knowledgePointId)}`,
  )
}

export function searchKnowledgePoints(
  params: KnowledgePointSearchParams,
): Promise<KnowledgePointOut[]> {
  const search = new URLSearchParams({ q: params.q })
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  return request<KnowledgePointOut[]>(`/knowledge-points/search?${search.toString()}`)
}

export function updateKnowledgePoint(
  knowledgePointId: string,
  payload: KnowledgePointUpdate,
): Promise<KnowledgePointOut> {
  return request<KnowledgePointOut>(
    `/knowledge-points/${encodeURIComponent(knowledgePointId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  )
}

export function removeKnowledgePoint(knowledgePointId: string): Promise<void> {
  return request<void>(`/knowledge-points/${encodeURIComponent(knowledgePointId)}`, {
    method: 'DELETE',
  })
}
