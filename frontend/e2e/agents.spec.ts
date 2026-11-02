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

interface AgentRow {
  id: string
  name: string
  provider_type: string
  base_url: string
  model: string
  system_prompt: string | null
  temperature: number
  is_default: boolean
  api_key_masked: string
  created_at: string
  updated_at: string
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
  expect(response.ok).toBeTruthy()
  return (await response.json()) as T
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function seedToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
}

test('agents: lists seeded agents and never renders a plaintext key', async ({ page }) => {
  const token = await login()
  const agents = await apiFetch<AgentRow[]>('/api/agents', token)
  expect(agents.length).toBeGreaterThanOrEqual(1)
  await seedToken(page, token)

  await page.goto('/settings/agents')
  await expect(page.getByTestId('agent-row').first()).toBeVisible()
  await expect(page.getByTestId('agent-row')).toHaveCount(agents.length)
  await expect(page.getByTestId('state-loading')).toHaveCount(0)

  const bodyText = await page.locator('body').innerText()
  // Masked keys look like "sk-****-key"; a plaintext key looks like sk- + 8+ key chars.
  expect(bodyText).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
  for (const agent of agents) {
    expect(bodyText).toContain(agent.api_key_masked)
  }

  await expect(page.getByTestId('agents-hint')).toContainText(
    '测试连接失败不影响保存；把占位 Key 的 Agent 设为默认会导致 AI 功能失败',
  )
  await expect(page.getByText('Agent 设置')).toBeVisible()
  await capture(page, 'round2-agents-list.png')
})

test('agents: creates an agent through the inline form', async ({ page }) => {
  const token = await login()
  const createdName = `E2E Mock Agent ${Date.now()}`
  let created: AgentRow | null = null

  await page.route('**/api/agents', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      created = {
        id: '00000000-0000-4000-8000-000000000001',
        name: createdName,
        provider_type: 'openai_compatible',
        base_url: 'https://api.example.com/v1',
        model: 'e2e-mock-model',
        system_prompt: null,
        temperature: 0.7,
        is_default: false,
        api_key_masked: 'ab****yz',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
      return
    }
    if (method === 'GET' && created !== null) {
      const pending = created
      const response = await route.fetch()
      const rows = (await response.json()) as AgentRow[]
      await route.fulfill({ response, json: [...rows, pending] })
      return
    }
    await route.continue()
  })

  await seedToken(page, token)
  await page.goto('/settings/agents')
  await expect(page.getByTestId('agent-row').first()).toBeVisible()
  const before = await page.getByTestId('agent-row').count()

  await page.getByTestId('agent-create').click()
  await expect(page.getByTestId('agent-form')).toBeVisible()
  await page.getByTestId('agent-field-name').fill(createdName)
  await page.getByTestId('agent-field-base-url').fill('https://api.example.com/v1')
  await page.getByTestId('agent-field-model').fill('e2e-mock-model')
  await page.getByTestId('agent-field-api-key').fill('sk-e2e-placeholder-0000000000')
  await page.getByTestId('agent-form-submit').click()

  await expect(page.getByText('Agent 已创建', { exact: true })).toBeVisible()
  await expect(page.getByTestId('agent-form')).toHaveCount(0)
  await expect(page.getByTestId('agent-row').filter({ hasText: createdName })).toBeVisible()
  await expect(page.getByTestId('agent-row')).toHaveCount(before + 1)

  const bodyText = await page.locator('body').innerText()
  expect(bodyText).not.toContain('sk-e2e-placeholder')
  await capture(page, 'round2-agents-created.png')
})

test('agents: test connection failure is inline and does not block editing', async ({ page }) => {
  const token = await login()
  const agents = await apiFetch<AgentRow[]>('/api/agents', token)
  const target = agents[0]
  expect(target).toBeTruthy()

  await page.route('**/api/agents/*/test', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, message: '连接失败' }),
    }),
  )

  await seedToken(page, token)
  await page.goto('/settings/agents')
  const row = page.getByTestId('agent-row').filter({ hasText: target.name }).first()
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: '测试连接' }).click()
  await expect(row.getByTestId('agent-test-result')).toContainText('连接失败')
  await expect(row.getByTestId('agent-test-result')).toContainText('失败')
  await capture(page, 'round2-agents-test-failure.png')

  await row.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByTestId('agent-form')).toBeVisible()
  await expect(page.getByTestId('agent-field-name')).toBeEnabled()
  await expect(page.getByTestId('agent-form-submit')).toBeEnabled()
  await page.getByTestId('agent-form-cancel').click()
  await expect(page.getByTestId('agent-form')).toHaveCount(0)
})
