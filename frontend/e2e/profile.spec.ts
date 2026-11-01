import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR

interface LoginBody {
  access_token: string
}

interface CompetitionBody {
  id: string
  title: string
  inviteCode: string
}

interface LeaderboardRow {
  rank: number
  userId: string
  points: number
}

async function login(email = EMAIL, password = PASSWORD): Promise<string> {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
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

async function createMember(
  token: string,
  index: number,
  competition: CompetitionBody,
): Promise<void> {
  const stamp = `${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`
  const email = `profile-e2e-${stamp}@example.com`
  const password = 'profile-e2e-pass'
  await apiFetch('/api/auth/register', token, {
    method: 'POST',
    body: JSON.stringify({ email, display_name: `榜单队员${index}`, password }),
  })
  const memberToken = await login(email, password)
  await apiFetch('/api/competitions/join', memberToken, {
    method: 'POST',
    body: JSON.stringify({ invite_code: competition.inviteCode }),
  })
}

async function seedCompetition(token: string): Promise<CompetitionBody> {
  const created = await apiFetch<CompetitionBody>('/api/competitions', token, {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E 排行榜 ${Date.now()}`,
      knowledge_prompt: '图论',
      question_types: ['choice'],
      difficulty: 'medium',
      winner_count: 3,
      rewards: [],
      start_time: '2026-12-01T09:00:00',
      end_time: '2026-12-31T18:00:00',
      source_ids: [],
    }),
  })
  for (let index = 0; index < 3; index += 1) {
    await createMember(token, index, created)
  }
  return created
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

test('profile page renders all five blocks with real data', async ({ page }) => {
  const token = await login()
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/profile')

  for (const id of [
    'profile-info',
    'profile-stats',
    'profile-records',
    'profile-study',
    'profile-settings',
  ]) {
    const block = page.getByTestId(id)
    await expect(block).toBeVisible()
    await expect(block).not.toHaveText('')
  }

  await expect(page.getByText('正在加载个人中心…')).toHaveCount(0)
  await expect(page.getByTestId('profile-stats')).toContainText('参赛数')
  await expect(page.getByTestId('profile-stats')).toContainText('连续学习天数')
  await expect(page.getByTestId('profile-settings')).toContainText('账号设置')
  await expect(page.getByTestId('profile-settings')).toContainText('隐私设置')

  await capture(page, 'task-21-profile.png')
})

test('leaderboard shows a contiguous server rank for the top three', async ({ page }) => {
  const token = await login()
  const competition = await seedCompetition(token)

  const rows = await apiFetch<LeaderboardRow[]>(
    `/api/leaderboard/${competition.id}`,
    token,
  )
  expect(rows.length).toBeGreaterThanOrEqual(4)
  expect(rows.map((row) => row.rank)).toEqual(rows.map((_, index) => index + 1))
  const points = rows.map((row) => row.points)
  expect(points).toEqual([...points].sort((a, b) => b - a))

  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.goto('/rank')

  await page.locator('select').selectOption({ label: competition.title })

  const ranks = page.getByTestId('rank-label')
  await expect(ranks.nth(0)).toHaveText('1')
  await expect(ranks.nth(1)).toHaveText('2')
  await expect(ranks.nth(2)).toHaveText('3')
  await expect(page.getByTestId('leaderboard-error')).toHaveCount(0)
  await expect(page.getByTestId('leaderboard-empty')).toHaveCount(0)

  await capture(page, 'task-21-rank.png')
})
