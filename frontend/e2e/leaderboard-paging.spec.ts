import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR

interface MockEntry {
  rank: number
  userId: string
  name: string
  tier: string
  division: string
  points: number
  avatarHue: number
  avatarUrl?: string
}

const AVATAR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3b82f6"/></svg>')

function buildUsers(count: number): MockEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1
    return {
      rank,
      userId: `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`,
      name: `榜单用户${rank}`,
      tier: '初识',
      division: 'III',
      points: (count - index) * 10,
      avatarHue: (rank * 37) % 360,
      ...(rank % 3 === 0 ? { avatarUrl: AVATAR_SVG } : {}),
    }
  })
}

async function login(): Promise<string> {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(response.ok).toBeTruthy()
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function authenticate(page: Page): Promise<string> {
  const token = await login()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)
  return token
}

async function mockLeaderboard(page: Page, users: MockEntry[]): Promise<void> {
  await page.route('**/api/leaderboard/**', async (route) => {
    const url = new URL(route.request().url())
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const items = users.slice(offset, offset + limit)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'X-Total-Count': String(users.length),
        'Access-Control-Expose-Headers': 'X-Total-Count',
      },
      body: JSON.stringify(items),
    })
  })
}

async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('leaderboard-loading')).toHaveCount(0)
  await expect(page.getByTestId('leaderboard-error')).toHaveCount(0)
}

test('leaderboard paging: 25 mocked users load 10 → 20 → 25 with no duplicates', async ({ page }) => {
  const users = buildUsers(25)
  await authenticate(page)
  await mockLeaderboard(page, users)

  await page.goto('/rank')
  await waitForBoard(page)

  await expect(page.getByTestId('rank-label')).toHaveCount(10)
  await capture(page, 'task-21-leaderboard-page-10.png')

  const loadMore = page.getByRole('button', { name: '加载更多' })
  await loadMore.click()
  await expect(page.getByTestId('rank-label')).toHaveCount(20)
  await capture(page, 'task-21-leaderboard-page-20.png')

  await page.getByRole('button', { name: '加载更多' }).click()
  await expect(page.getByTestId('rank-label')).toHaveCount(25)
  await expect(page.getByTestId('leaderboard-end')).toHaveText('已显示全部')
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0)
  await capture(page, 'task-21-leaderboard-page-25.png')

  const ids = await page.locator('[data-user-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-user-id') ?? ''),
  )
  expect(ids).toHaveLength(25)
  expect(new Set(ids).size).toBe(25)
})

test('leaderboard avatars: mocked avatarUrl rows render real images', async ({ page }) => {
  const users = buildUsers(10)
  await authenticate(page)
  await mockLeaderboard(page, users)

  await page.goto('/rank')
  await waitForBoard(page)
  await expect(page.getByTestId('rank-label')).toHaveCount(10)

  const avatars = page.getByTestId('avatar-image')
  await expect(avatars).toHaveCount(3)
  await expect(avatars.first()).toHaveAttribute('src', /^data:image\/svg\+xml/)
  await capture(page, 'task-21-leaderboard-avatars.png')
})

test('leaderboard real data: first page matches X-Total-Count', async ({ page }) => {
  const token = await authenticate(page)

  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto('/rank')
  await expect(page.locator('select')).toBeVisible()
  await waitForBoard(page)

  const selected = await page.locator('select').inputValue()
  expect(selected, 'leaderboard must select a competition').not.toBe('')

  const boardResponse = await page.request.get(
    `${API}/api/leaderboard/${encodeURIComponent(selected)}?limit=10&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(boardResponse.ok()).toBeTruthy()
  const rows = (await boardResponse.json()) as MockEntry[]
  const headerTotal = Number(boardResponse.headers()['x-total-count'] ?? Number.NaN)
  const total = Number.isFinite(headerTotal) ? headerTotal : rows.length

  await expect(page.getByTestId('rank-label')).toHaveCount(Math.min(10, total))
  await capture(page, 'task-21-leaderboard-real.png')
  expect(consoleErrors).toEqual([])
})
