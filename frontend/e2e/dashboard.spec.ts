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

interface DashboardSummary {
  due_count: number
  reviewed_today: number
  streak_days: number
  mastery_radar: Array<{ name: string; value: number }>
  difficulty_histogram: Array<{ bucket: string; count: number }>
  heatmap: Array<{ date: string; count: number }>
  forgetting_curve: Array<{ days: number; retrievability: number }>
}

async function login(): Promise<string> {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(response.ok).toBeTruthy()
  return ((await response.json()) as LoginBody).access_token
}

async function fetchSummary(token: string): Promise<DashboardSummary> {
  const response = await fetch(`${API}/api/dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok).toBeTruthy()
  return (await response.json()) as DashboardSummary
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

function expectedMastery(radar: Array<{ value: number }>): string {
  if (radar.length === 0) return '—'
  const average = radar.reduce((sum, item) => sum + item.value, 0) / radar.length
  return String(Math.round(average))
}

test('dashboard: KPIs and SVG charts match the API summary', async ({ page }) => {
  const token = await login()
  const summary = await fetchSummary(token)

  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.goto('/dashboard')

  await expect(page.getByTestId('page-dashboard')).toBeVisible()
  await expect(page.getByTestId('dashboard-kpi-due')).toHaveText(String(summary.due_count))
  await expect(page.getByTestId('dashboard-kpi-reviewed')).toHaveText(String(summary.reviewed_today))
  await expect(page.getByTestId('dashboard-kpi-streak')).toHaveText(String(summary.streak_days))
  await expect(page.getByTestId('dashboard-kpi-mastery')).toHaveText(expectedMastery(summary.mastery_radar))

  await expect(page.getByTestId('heatmap-cell')).toHaveCount(90)
  await expect(page.getByTestId('curve-point')).toHaveCount(30)
  await expect(page.getByTestId('histogram-bar')).toHaveCount(5)

  if (summary.mastery_radar.length >= 3) {
    await expect(page.getByTestId('radar-svg')).toBeVisible()
    await expect(page.getByTestId('radar-polygon')).toHaveCount(1)
  } else {
    await expect(page.getByTestId('radar-empty')).toBeVisible()
  }

  await expect(page.locator('body')).not.toContainText('NaN')
  await expect(page.locator('body')).not.toContainText('Infinity')
  await capture(page, 'task-06-dashboard.png')
})

test('dashboard: empty summary shows placeholders and never renders NaN', async ({ page }) => {
  const token = await login()
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.route('**/api/dashboard/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        due_count: 0,
        reviewed_today: 0,
        streak_days: 0,
        mastery_radar: [],
        difficulty_histogram: [],
        heatmap: [],
        forgetting_curve: [],
      }),
    }),
  )

  await page.goto('/dashboard')

  await expect(page.getByTestId('dashboard-kpi-mastery')).toHaveText('—')
  await expect(page.getByTestId('dashboard-kpi-due')).toHaveText('0')
  await expect(page.getByTestId('radar-empty')).toBeVisible()
  await expect(page.getByTestId('heatmap-empty')).toBeVisible()
  await expect(page.getByTestId('curve-empty')).toBeVisible()
  await expect(page.getByTestId('histogram-bar')).toHaveCount(5)
  await expect(page.locator('body')).not.toContainText('NaN')
  await expect(page.locator('body')).not.toContainText('Infinity')
  await capture(page, 'task-06-dashboard-empty.png')
})
