import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR

interface WrongQuestionRow {
  id: string
  type: string
}

interface KnowledgePointRow {
  id: string
}

interface GeneratedQuiz {
  created: { id: string; answer: string }[]
}

interface DueList {
  cards: { id: string }[]
  count: number
}

interface LoginBody {
  access_token: string
}

async function login(): Promise<string> {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(response.ok).toBeTruthy()
  const body = (await response.json()) as LoginBody
  return body.access_token
}

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...init, headers })
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function answerOneWrongJudgement(token: string): Promise<void> {
  const points = await apiFetch<KnowledgePointRow[]>('/api/knowledge-points?limit=1', token)
  if (points.length === 0) throw new Error('cannot seed wrong questions: no knowledge points')
  const generated = await apiFetch<GeneratedQuiz>('/api/quiz/generate', token, {
    method: 'POST',
    body: JSON.stringify({ knowledge_point_ids: [points[0].id], type: 'judge', num: 1 }),
  })
  const question = generated.created[0]
  if (!question) throw new Error('cannot seed wrong questions: quiz generation returned no rows')
  const wrongAnswer = question.answer.trim().toUpperCase() === 'T' ? 'F' : 'T'
  await apiFetch(`/api/quiz/${question.id}/answer`, token, {
    method: 'POST',
    body: JSON.stringify({ answer: wrongAnswer }),
  })
}

async function ensureWrongQuestions(token: string): Promise<void> {
  const existing = await apiFetch<WrongQuestionRow[]>('/api/wrong-questions?limit=1', token)
  if (existing.length === 0) await answerOneWrongJudgement(token)

  const judges = await apiFetch<WrongQuestionRow[]>('/api/wrong-questions?type=judge&limit=1', token)
  if (judges.length === 0) await answerOneWrongJudgement(token)
}

async function ensureDueCards(token: string, wanted: number): Promise<void> {
  let due = await apiFetch<DueList>('/api/review/due?limit=50', token)
  let guard = 0
  while (due.cards.length < wanted && guard < 5) {
    await apiFetch('/api/review/cards', token, {
      method: 'POST',
      body: JSON.stringify({
        question: `E2E 复习卡片 ${Date.now()}-${guard}：TCP 三次握手的作用是什么？`,
        answer: '同步双方初始序号并确认收发能力正常。',
      }),
    })
    due = await apiFetch<DueList>('/api/review/due?limit=50', token)
    guard += 1
  }
  expect(due.cards.length).toBeGreaterThanOrEqual(wanted)
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

test('wrong-question list renders from the API and filters server-side by type', async ({ page }) => {
  const token = await login()
  await ensureWrongQuestions(token)
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/prep')
  await page.getByRole('button', { name: '错题收藏' }).click()

  await expect(page.getByTestId('wrong-question-item').first()).toBeVisible()
  await expect(page.getByTestId('wrong-diagnostics')).toBeVisible()
  await expect(page.getByTestId('wrong-diagnostics')).toContainText('AI 诊断')

  await page.getByRole('button', { name: '筛选' }).click()
  const filtered = page.waitForRequest(
    (request) => request.url().includes('/api/wrong-questions') && request.url().includes('type=judge'),
  )
  await page.getByRole('button', { name: '判断题', exact: true }).click()

  const request = await filtered
  expect(request.url()).toContain('type=judge')
  await expect(page.getByTestId('wrong-question-item').first()).toContainText('判断题')
  await capture(page, 'task-19-filter.png')
})

test('review card flips before rating and keyboard 3 submits and advances', async ({ page }) => {
  const token = await login()
  await ensureDueCards(token, 2)
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/review')
  await expect(page.getByTestId('review-progress')).toHaveText(/第 1 \/ \d+ 张/)

  const card = page.getByTestId('review-card')
  await expect(card).toHaveAttribute('data-flipped', 'false')
  await expect(page.getByTestId('rating-3')).toBeDisabled()

  await card.click()
  await expect(card).toHaveAttribute('data-flipped', 'true')
  await expect(page.getByTestId('rating-3')).toBeEnabled()
  await capture(page, 'task-19-review.png')

  const submitted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/submit'),
  )
  await page.keyboard.press('3')
  const request = await submitted
  expect(request.postDataJSON()).toEqual({ rating: 3 })

  await expect(page.getByText(/下次复习：/)).toBeVisible()
  await expect(page.getByTestId('review-progress')).toHaveText(/第 2 \//)
})
