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

interface RawQuizItem {
  id: string
  type: string
  question: string
  options: string[] | null
  answer: string
  explanation: string
  difficulty: string
}

interface RawQuizResponse {
  created: RawQuizItem[]
  model: string
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

async function prepareQuizPage(page: Page, token: string): Promise<KnowledgePointRow> {
  const points = await apiFetch<KnowledgePointRow[]>('/api/knowledge-points?limit=100', token)
  expect(points.length).toBeGreaterThan(0)
  const point = points[0]
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.goto('/quiz')
  await expect(page.getByTestId(`kp-option-${point.id}`)).toBeVisible()
  await page.getByTestId(`kp-option-${point.id}`).click()
  return point
}

function expectNoAnswerLeak(
  bodyText: string,
  html: string,
  raw: RawQuizResponse,
): void {
  for (const item of raw.created) {
    expect(html).not.toContain(item.explanation)
    expect(bodyText).not.toContain(item.explanation)
    if (/^[A-Z]$/.test(item.answer)) {
      expect(bodyText).not.toMatch(new RegExp(`(^|[^A-Za-z])${item.answer}([^A-Za-z]|$)`))
    } else {
      expect(bodyText).not.toContain(item.answer)
    }
  }
}

test('quiz generates, hides answers until submit, and recovers the session', async ({ page }) => {
  const token = await login()
  await prepareQuizPage(page, token)

  await page.getByTestId('quiz-num-input').fill('2')
  await page.getByTestId('quiz-type-select').selectOption('choice')

  const generated = page.waitForResponse(
    (response) =>
      response.url().includes('/api/quiz/generate') &&
      response.request().method() === 'POST',
  )
  await page.getByTestId('quiz-generate').click()
  const response = await generated
  expect(response.status()).toBe(201)
  const raw = (await response.json()) as RawQuizResponse
  expect(raw.created).toHaveLength(2)

  await expect(page.getByTestId('quiz-question')).toHaveCount(2)

  const bodyText = await page.locator('body').innerText()
  const html = await page.content()
  expectNoAnswerLeak(bodyText, html, raw)
  await capture(page, 'task-07-quiz.png')

  const firstQuestion = page.getByTestId('quiz-question').first()
  await firstQuestion.getByTestId('quiz-option').first().click()
  const answered = page.waitForResponse(
    (result) =>
      result.url().includes('/answer') && result.request().method() === 'POST',
  )
  await firstQuestion.getByTestId('quiz-submit').click()
  await answered

  const result = firstQuestion.getByTestId('quiz-result')
  await expect(result).toBeVisible()
  await expect(result).toContainText(/正确|错误/)
  await expect(result).toContainText(raw.created[0].explanation)
  await capture(page, 'task-07-quiz-result.png')

  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('learnrise.quiz.session')))
    .not.toBeNull()

  await page.reload()
  await expect(page.getByTestId('quiz-question')).toHaveCount(2)
  await expect(
    page.getByTestId('quiz-question').first().getByTestId('quiz-result'),
  ).toBeVisible()

  await page.getByTestId('quiz-reset').click()
  await expect(page.getByTestId('quiz-question')).toHaveCount(0)
  const stored = await page.evaluate(() => window.sessionStorage.getItem('learnrise.quiz.session'))
  expect(stored).toBeNull()
})

test('quiz renders a readable message for an unparsable LLM payload', async ({ page }) => {
  const token = await login()
  await page.route('**/api/quiz/generate', async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          message: 'LLM 输出不可解析',
          raw: '{"broken": ',
        },
      }),
    })
  })
  await prepareQuizPage(page, token)

  await page.getByTestId('quiz-generate').click()

  const alert = page.getByTestId('quiz-error')
  await expect(alert).toBeVisible()
  await expect(page.getByTestId('quiz-error-message')).toHaveText('LLM 输出不可解析')
  const message = await page.getByTestId('quiz-error-message').innerText()
  expect(message).not.toContain('{"')
  await expect(page.getByTestId('quiz-error-raw')).toBeHidden()
  await expect(page.getByTestId('quiz-generate')).toBeEnabled()
  await capture(page, 'task-07-quiz-error.png')
})
