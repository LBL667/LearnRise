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

interface KnowledgePointRow {
  id: string
  title: string
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

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function openPoint(page: Page, token: string): Promise<KnowledgePointRow> {
  const points = await apiFetch<KnowledgePointRow[]>('/api/knowledge-points?limit=100', token)
  expect(points.length).toBeGreaterThan(0)
  const point = points[0]
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.goto(`/kp/${point.id}`)
  await expect(page.getByTestId('kp-title')).toBeVisible()
  return point
}

test('explain streams detailed text and clears the loading state', async ({ page }) => {
  const token = await login()
  await openPoint(page, token)

  await page.getByTestId('explain-style').selectOption('detailed')
  await page.getByTestId('explain-start').click()

  const output = page.getByTestId('explain-output')
  await expect(output).not.toBeEmpty({ timeout: 10_000 })
  await expect(page.getByTestId('explain-loading')).toBeHidden({ timeout: 10_000 })
  await expect(page.getByTestId('explain-stop')).toHaveCount(0)
  await capture(page, 'task-08-explain-detailed.png')
})

test('explain shows a thinking hint while socratic mode buffers', async ({ page }) => {
  const token = await login()
  await page.route('**/api/knowledge-points/*/explain', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })
  await openPoint(page, token)

  await page.getByTestId('explain-style').selectOption('socratic')
  await page.getByTestId('explain-start').click()

  await expect(page.getByTestId('explain-loading')).toContainText('思考中', { timeout: 2_000 })
  await expect(page.getByTestId('explain-output')).not.toBeEmpty({ timeout: 10_000 })
  await expect(page.getByTestId('explain-loading')).toBeHidden({ timeout: 10_000 })
  await capture(page, 'task-08-explain-socratic.png')
})

test('explain surfaces an SSE error and stops the spinner', async ({ page }) => {
  const token = await login()
  await page.route('**/api/knowledge-points/*/explain', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: error\ndata: {"message":"上游超时"}\n\n',
    }),
  )
  await openPoint(page, token)

  await page.getByTestId('explain-start').click()

  await expect(page.getByTestId('explain-error-message')).toHaveText('上游超时', {
    timeout: 2_000,
  })
  await expect(page.getByTestId('explain-loading')).toBeHidden({ timeout: 2_000 })
  await expect(page.getByTestId('explain-start')).toBeEnabled()
  await capture(page, 'task-08-explain-error.png')
})

test('delete asks for confirmation and mentions cascading children', async ({ page }) => {
  const token = await login()
  const point = await openPoint(page, token)

  await page.getByTestId('kp-delete').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('级联删除子知识点')
  await capture(page, 'task-08-delete-confirm.png')

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/kp/${point.id}$`))
})
