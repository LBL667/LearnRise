import { expect, test } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'

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

  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: process.env.EVIDENCE_DIR, fullPage: true })
  }

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
