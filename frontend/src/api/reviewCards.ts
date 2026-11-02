import { request } from '@/api/client'
import type {
  ReviewCardCreate,
  ReviewCardListParams,
  ReviewCardOut,
} from '@/api/types/review'

function cardsQuery(params: ReviewCardListParams): string {
  const search = new URLSearchParams()
  if (params.state !== undefined && params.state !== null) {
    search.set('state', String(params.state))
  }
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  const rendered = search.toString()
  return rendered ? `?${rendered}` : ''
}

export function listCards(params: ReviewCardListParams = {}): Promise<ReviewCardOut[]> {
  return request<ReviewCardOut[]>(`/review/cards${cardsQuery(params)}`)
}

export function createCard(payload: ReviewCardCreate): Promise<ReviewCardOut> {
  return request<ReviewCardOut>('/review/cards', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
