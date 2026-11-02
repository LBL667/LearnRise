import { streamSse, type SseHandlers } from '@/api/sse'
import type { ExplainRequest } from '@/api/types/knowledge'

export function streamExplain(
  knowledgePointId: string,
  handlers: SseHandlers,
  payload: ExplainRequest = {},
  signal?: AbortSignal,
): Promise<void> {
  return streamSse(
    `/knowledge-points/${encodeURIComponent(knowledgePointId)}/explain`,
    payload,
    handlers,
    signal,
  )
}
