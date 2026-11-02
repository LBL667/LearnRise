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

interface SourceRow {
  id: string
  title: string
  status: string
}

interface TreeRow {
  id: string
  title: string
  children?: TreeRow[]
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

function countTree(nodes: TreeRow[]): number {
  return nodes.reduce((total, node) => total + 1 + countTree(node.children ?? []), 0)
}

async function pickSource(token: string): Promise<SourceRow> {
  const sources = await apiFetch<SourceRow[]>('/api/sources', token)
  const source = sources.find((row) => row.status === 'ready') ?? sources[0]
  expect(source, 'seed_demo.py must create a demo source').toBeTruthy()
  return source
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

test('library: lists sources, opens detail and reprocesses a ready source', async ({ page }) => {
  const token = await login()
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/library')
  const rows = page.getByTestId('source-row')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('source-count')).toContainText('共')
  await capture(page, 'task-05-library-list.png')

  await rows.first().click()
  await expect(page).toHaveURL(/\/library\/[0-9a-fA-F-]{36}$/)
  await expect(page.getByTestId('page-source-detail')).toBeVisible()
  await expect(page.getByTestId('source-status')).toHaveText('就绪', { timeout: 30_000 })
  await capture(page, 'task-05-source-detail.png')

  const reprocessResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && /\/api\/sources\/[^/]+\/reprocess$/.test(response.url()),
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: '重新解析' }).click()
  const response = await reprocessResponse
  expect(response.status()).toBe(202)

  const reprocessButton = page.getByTestId('source-reprocess')
  await expect(reprocessButton).toBeDisabled()
  await expect(reprocessButton).toContainText('处理中…')

  await expect(page.getByTestId('source-status')).toHaveText('就绪', { timeout: 120_000 })
  await expect(reprocessButton).toBeEnabled()
  await capture(page, 'task-05-source-reprocess.png')
})

test('library: empty state points to the competition wizard', async ({ page }) => {
  const token = await login()
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.route('**/api/sources', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    }),
  )

  await page.goto('/library')
  await expect(page.getByTestId('state-empty')).toBeVisible()
  await expect(page.getByText('上传资料请从建赛向导进入')).toBeVisible()
  await expect(page.getByTestId('source-row')).toHaveCount(0)
  await capture(page, 'task-05-empty.png')
})

test('library: source detail renders the knowledge tree read-only', async ({ page }) => {
  const token = await login()
  const source = await pickSource(token)
  let tree = await apiFetch<TreeRow[]>(`/api/sources/${source.id}/tree`, token)
  if (tree.length === 0) {
    const notes = await fetch(`${API}/api/sources/${source.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    })
    expect(notes.ok).toBeTruthy()
    tree = await apiFetch<TreeRow[]>(`/api/sources/${source.id}/tree`, token)
  }
  const expected = countTree(tree)
  expect(expected).toBeGreaterThanOrEqual(1)

  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.goto(`/library/${source.id}`)
  await expect(page.getByTestId('page-source-detail')).toBeVisible()
  await expect(page.getByTestId('tree-node')).toHaveCount(expected)
  await expect(page.getByText('添加分支')).toHaveCount(0)
  await expect(page.getByText('保存', { exact: true })).toHaveCount(0)
  await capture(page, 'task-10-source-tree.png')
})

test('library: generating notes reports the count and refreshes the tree', async ({ page }) => {
  const token = await login()
  const source = await pickSource(token)
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)
  await page.route('**/api/sources/*/notes', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.continue()
  })

  await page.goto(`/library/${source.id}`)
  const button = page.getByTestId('source-generate-notes')
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toBeDisabled()
  await expect(button).toContainText('生成中')
  await expect(page.getByText(/个知识点/).first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('tree-node').first()).toBeVisible({ timeout: 60_000 })
  await capture(page, 'task-10-notes-generated.png')
})

test('prep: mindmap renders the selected source tree', async ({ page }) => {
  const token = await login()
  const sources = await apiFetch<SourceRow[]>('/api/sources', token)
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/prep')
  await page.getByRole('button', { name: '思维导图' }).click()
  await expect(page.getByTestId('mindmap-region')).toBeVisible()
  if (sources.length > 0) {
    await expect(page.getByTestId('mindmap-node').first()).toBeVisible()
  }
  await capture(page, 'task-10-mindmap.png')
})
