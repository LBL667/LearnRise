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

interface SessionCreatedBody {
  session_id: string
  progress: { answered: number; correct: number; total: number }
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

async function attachToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function openPractice(page: Page, token: string): Promise<KnowledgePointRow[]> {
  const points = await apiFetch<KnowledgePointRow[]>('/api/knowledge-points?limit=100', token)
  expect(points.length).toBeGreaterThanOrEqual(2)
  await attachToken(page, token)
  await page.goto('/practice')
  await expect(page.getByTestId('page-practice')).toBeVisible()
  await expect(page.getByTestId(`practice-kp-${points[0].id}`)).toBeVisible()
  return points
}

async function selectPoints(page: Page, points: KnowledgePointRow[], count: number): Promise<void> {
  for (const point of points.slice(0, count)) {
    const row = page.getByTestId(`practice-kp-${point.id}`)
    await expect(row).toBeVisible()
    await row.click()
  }
  await expect(page.getByTestId('practice-start')).toBeEnabled()
}

async function startSession(page: Page): Promise<SessionCreatedBody> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/assistant/practice/sessions') &&
      response.request().method() === 'POST',
  )
  await page.getByTestId('practice-start').click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  return (await response.json()) as SessionCreatedBody
}

async function answerCurrentQuestion(page: Page): Promise<void> {
  const question = page.getByTestId('practice-question')
  await expect(question).toBeVisible()

  const input = question.getByTestId('practice-answer-input')
  if ((await input.count()) > 0) {
    await input.fill('测试答案')
  } else {
    await question.getByTestId('practice-option').first().click()
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/assistant/practice/sessions/') &&
      response.url().endsWith('/answer') &&
      response.request().method() === 'POST',
  )
  await question.getByTestId('practice-submit').click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
}

test('practice: starts a session, grades the answer, and ends with a summary', async ({ page }) => {
  const token = await login()
  const points = await openPractice(page, token)
  await selectPoints(page, points, 2)
  await page.getByTestId('practice-difficulty-easy').click()
  await expect
    .poll(() =>
      page
        .getByTestId('practice-difficulty-easy')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe('rgb(234, 242, 255)')
  await capture(page, 'task-09-practice-setup.png')

  const created = await startSession(page)
  await expect
    .poll(() => new URL(page.url()).searchParams.get('session'))
    .toBe(created.session_id)

  const progress = page.getByTestId('practice-progress')
  await expect(progress).toContainText('0/')
  await expect(page.getByTestId('practice-result')).toHaveCount(0)
  await capture(page, 'task-09-practice-session.png')

  const before = await progress.innerText()
  await answerCurrentQuestion(page)

  await expect(page.getByTestId('practice-result').first()).toBeVisible()
  await expect
    .poll(async () =>
      (await page.getByTestId('practice-explanation').last().innerText()).trim().length,
    )
    .toBeGreaterThan(0)
  await expect.poll(() => progress.innerText()).not.toBe(before)
  await capture(page, 'task-09-practice-graded.png')

  const endPromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/assistant/practice/sessions/') &&
      response.url().endsWith('/end') &&
      response.request().method() === 'POST',
  )
  await page.getByTestId('practice-end').click()
  expect((await endPromise).status()).toBe(200)

  const summary = page.getByTestId('practice-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(/\d+%/)
  await capture(page, 'task-09-practice-summary.png')
})

test('practice: reloading ?session= restores progress and the current question', async ({ page }) => {
  const token = await login()
  const points = await openPractice(page, token)
  await selectPoints(page, points, 2)
  await startSession(page)

  const progress = page.getByTestId('practice-progress')
  await expect(progress).toContainText('0/')
  await answerCurrentQuestion(page)
  await expect(page.getByTestId('practice-result').first()).toBeVisible()
  await expect.poll(() => progress.innerText()).toContain('1/')

  const sessionId = new URL(page.url()).searchParams.get('session')
  expect(sessionId).toBeTruthy()
  const progressBeforeReload = await progress.innerText()

  await page.reload()
  await expect(page.getByTestId('practice-question')).toBeVisible()
  await expect
    .poll(() => page.getByTestId('practice-progress').innerText())
    .toBe(progressBeforeReload)
  await expect(page.getByTestId('practice-result').first()).toBeVisible()
  await capture(page, 'task-09-practice-resume.png')
})

test('practice: 409 NO_QUESTIONS renders dedicated copy', async ({ page }) => {
  const token = await login()
  const points = await openPractice(page, token)

  await page.route('**/api/assistant/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'NO_QUESTIONS', detail: '当前没有可用的题目' }),
    })
  })

  await selectPoints(page, points, 1)
  await page.getByTestId('practice-start').click()

  await expect(page.getByTestId('practice-error')).toContainText(
    '没有可用题目，请先为知识点生成题目',
  )
  await capture(page, 'task-09-practice-no-questions.png')
})
