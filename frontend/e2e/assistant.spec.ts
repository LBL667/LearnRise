import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR

type SourceSummary = { id: string; status: string }

async function ensureAssistantContext(): Promise<void> {
  const value = await token()
  const sourcesResponse = await fetch(`${API}/api/sources`, {
    headers: { Authorization: `Bearer ${value}` },
  })
  if (!sourcesResponse.ok) {
    console.log(`[e2e] sources listing failed with ${sourcesResponse.status}; skipping note seeding`)
    return
  }
  const sources = (await sourcesResponse.json()) as SourceSummary[]
  let generated = 0
  for (const source of sources) {
    if (source.status !== 'ready') continue
    const treeResponse = await fetch(`${API}/api/sources/${source.id}/tree`, {
      headers: { Authorization: `Bearer ${value}` },
    })
    if (!treeResponse.ok) continue
    const tree = (await treeResponse.json()) as unknown
    if (Array.isArray(tree) && tree.length > 0) continue
    const notesResponse = await fetch(`${API}/api/sources/${source.id}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${value}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (notesResponse.ok) generated += 1
  }
  console.log(`[e2e] assistant context ready: ${sources.length} sources, ${generated} notes generated`)
}

test.beforeAll(async () => {
  await ensureAssistantContext()
})

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`), fullPage: true })
}

async function token(): Promise<string> {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

async function ensureCitationQuestion(conversationId: string, bearer: string): Promise<void> {
  const headers = { Authorization: `Bearer ${bearer}` }
  const detailResponse = await fetch(`${API}/api/assistant/conversations/${conversationId}`, { headers })
  const detail = (await detailResponse.json()) as {
    messages: { role: string; citations: { knowledge_point_id?: string | null }[] }[]
  }
  const last = [...detail.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.citations.length > 0)
  const knowledgePointId = last?.citations.find((citation) => citation.knowledge_point_id)
    ?.knowledge_point_id
  if (!knowledgePointId) return
  await fetch(`${API}/api/quiz/generate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ knowledge_point_ids: [knowledgePointId], type: 'choice', num: 1 }),
  })
}

test('assistant streams an answer with a clickable citation', async ({ page }) => {
  const value = await token()
  await page.addInitScript((t) => window.localStorage.setItem('learnrise.token', t), value)

  await page.goto('/prep')
  await page.getByRole('button', { name: '学习助手' }).click()

  const input = page.getByPlaceholder(/请输入你的问题/)
  await input.fill('什么是特征值？')
  await input.press('Enter')

  const citation = page.locator('button[data-testid="citation-0"]').last()
  await expect(citation).toBeVisible({ timeout: 60_000 })
  await citation.click()
  await expect(page).toHaveURL(/\/kp\//)
  await expect(page.getByTestId('kp-title')).toBeVisible()
})

test('assistant sends socratic mode and reveals the reference answer', async ({ page }) => {
  const value = await token()
  await page.addInitScript((t) => window.localStorage.setItem('learnrise.token', t), value)

  await page.goto('/prep')
  await page.getByRole('button', { name: '学习助手' }).click()

  const socratic = page.getByRole('button', { name: '引导', exact: true })
  await socratic.click()
  await expect(socratic).toHaveAttribute('aria-pressed', 'true')

  await capture(page, 'assistant-socratic-mode')

  const streamRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      /\/api\/assistant\/conversations\/[^/]+\/stream$/.test(new URL(request.url()).pathname),
  )

  const input = page.getByPlaceholder(/请输入你的问题/)
  await input.fill('什么是特征值？')
  await input.press('Enter')

  const request = await streamRequest
  const body = request.postDataJSON() as { content: string; mode: string }
  expect(body.mode).toBe('socratic')
  expect(body.content).toBe('什么是特征值？')

  const reveal = page.getByRole('button', { name: '揭晓答案' })
  await expect(reveal).toBeEnabled({ timeout: 60_000 })

  const conversationId = new URL(request.url()).pathname.split('/').at(-2) ?? ''
  await ensureCitationQuestion(conversationId, value)

  await reveal.click()
  await expect(page.getByText(/参考答案：/).last()).toBeVisible({ timeout: 20_000 })
})

async function openAssistantWithFailedStream(page: Page): Promise<void> {
  const value = await token()
  await page.addInitScript((t) => window.localStorage.setItem('learnrise.token', t), value)

  await page.route('**/api/assistant/conversations/*/stream', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'stream unavailable' }),
    }),
  )

  await page.goto('/prep')
  await page.getByRole('button', { name: '学习助手' }).click()
}

test('assistant falls back to the non-stream reply when streaming fails', async ({ page }) => {
  await openAssistantWithFailedStream(page)
  await page.route('**/api/assistant/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message_id: 'fallback-answer-1',
        role: 'assistant',
        content: '普通回复：特征值刻画了矩阵在特征方向上的伸缩倍数。',
        citations: [],
        created_at: new Date().toISOString(),
        rewritten: false,
      }),
    })
  })

  const input = page.getByPlaceholder(/请输入你的问题/)
  await input.fill('什么是特征值？')
  await input.press('Enter')

  const fallback = page.getByTestId('assistant-fallback')
  await expect(fallback).toBeVisible({ timeout: 30_000 })
  await capture(page, 'assistant-fallback-button')

  await fallback.click()
  await expect(page.getByText('普通回复：特征值刻画了矩阵在特征方向上的伸缩倍数。')).toBeVisible({
    timeout: 20_000,
  })
  await capture(page, 'assistant-fallback-answer')
})

test('assistant fallback surfaces a readable message when context is missing', async ({ page }) => {
  await openAssistantWithFailedStream(page)
  await page.route('**/api/assistant/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'NO_CONTEXT',
        detail: '没有检索到可引用的资料，请先上传并解析文档',
      }),
    })
  })

  const input = page.getByPlaceholder(/请输入你的问题/)
  await input.fill('什么是特征值？')
  await input.press('Enter')

  const fallback = page.getByTestId('assistant-fallback')
  await expect(fallback).toBeVisible({ timeout: 30_000 })

  await fallback.click()
  await expect(page.getByText('请先上传或选择资料')).toBeVisible({ timeout: 20_000 })
  await expect(fallback).toBeEnabled()
  await capture(page, 'assistant-fallback-no-context')
})
