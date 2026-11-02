import { TIMEOUTS, request } from '@/api/client'
import type {
  NotesRequest,
  NotesResponse,
  SourceDetail,
  SourceJobAccepted,
  SourceOut,
  TreeNode,
} from '@/api/types/sources'

export function listSources(): Promise<SourceOut[]> {
  return request<SourceOut[]>('/sources')
}

export function getSource(sourceId: string): Promise<SourceDetail> {
  return request<SourceDetail>(`/sources/${encodeURIComponent(sourceId)}`)
}

export function reprocessSource(sourceId: string): Promise<SourceJobAccepted> {
  return request<SourceJobAccepted>(
    `/sources/${encodeURIComponent(sourceId)}/reprocess`,
    { method: 'POST' },
  )
}

export function getSourceTree(sourceId: string): Promise<TreeNode[]> {
  return request<TreeNode[]>(`/sources/${encodeURIComponent(sourceId)}/tree`)
}

export function createSourceNotes(
  sourceId: string,
  payload: NotesRequest = {},
  options: { timeoutMs?: number } = {},
): Promise<NotesResponse> {
  return request<NotesResponse>(
    `/sources/${encodeURIComponent(sourceId)}/notes`,
    { method: 'POST', body: JSON.stringify(payload) },
    { timeoutMs: options.timeoutMs ?? TIMEOUTS.notes },
  )
}
