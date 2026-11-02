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

interface CompetitionRow {
  id: string
  title: string
  planStatus: string
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
  expect(response.ok).toBeTruthy()
  return (await response.json()) as T
}

const SEEDED_COMPETITION_TITLES = ['全科知识联赛模拟赛', '2025 秋季学习挑战赛']

async function planStageCount(id: string, token: string): Promise<number> {
  const response = await fetch(`${API}/api/competitions/${encodeURIComponent(id)}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return 0
  const body = (await response.json()) as { stages?: unknown[] }
  return Array.isArray(body.stages) ? body.stages.length : 0
}

async function pickSeededCompetition(token: string): Promise<CompetitionRow> {
  const competitions = await apiFetch<CompetitionRow[]>('/api/competitions?limit=100', token)
  const titled = competitions.find(
    (row) => row.planStatus === 'ready' && SEEDED_COMPETITION_TITLES.includes(row.title),
  )
  if (titled) return titled
  for (const row of competitions) {
    if (row.planStatus !== 'ready') continue
    if ((await planStageCount(row.id, token)) > 0) return row
  }
  throw new Error('seed_demo.py must create a ready competition with a six-stage plan')
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function expectNoSkeleton(page: Page, skeleton?: string): Promise<void> {
  await expect(page.getByText('加载中…', { exact: false })).toHaveCount(0)
  await expect(page.getByText('正在加载', { exact: false })).toHaveCount(0)
  if (skeleton) await expect(page.getByText(skeleton, { exact: false })).toHaveCount(0)
}

async function expectPageReady(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId)).toBeVisible()
  await expectNoSkeleton(page)
}

test('smoke: every main page renders from the API without skeletons', async ({ page }) => {
  const token = await login()
  const competition = await pickSeededCompetition(token)
  const homeCompetitions = await apiFetch<CompetitionRow[]>('/api/competitions', token)
  expect(homeCompetitions.length, 'home page must list at least one competition').toBeGreaterThan(0)
  const homeTop = homeCompetitions[0]

  const points = await apiFetch<KnowledgePointRow[]>('/api/knowledge-points?limit=100', token)
  expect(points.length, 'seed_demo.py must create demo knowledge points').toBeGreaterThan(0)
  const point = points[0]

  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/')
  await expect(page.getByRole('button', { name: /创建学习竞赛/ })).toBeVisible()
  await expect(page.getByText(homeTop.title)).toBeVisible()
  await expectNoSkeleton(page, '正在加载竞赛…')
  await capture(page, 'task-26-nomock.png')

  await page.goto(`/competition/${competition.id}`)
  await expect(page.getByRole('heading', { name: competition.title })).toBeVisible()
  await expectNoSkeleton(page, '正在加载竞赛详情…')
  await page.getByRole('button', { name: '学习规划' }).click()
  await expect(page.getByText(/六阶段|基础概念|初识/).first()).toBeVisible()
  await capture(page, 'task-26-nomock-competition.png')

  await page.goto('/prep')
  await expect(page.getByRole('button', { name: '学习助手' })).toBeVisible()
  await page.getByRole('button', { name: '错题收藏' }).click()
  await expect(page.getByTestId('wrong-diagnostics')).toBeVisible()
  await expect(page.getByTestId('wrong-question-item').first()).toBeVisible()
  await page.getByRole('button', { name: '思维导图' }).click()
  await expect(page.getByTestId('mindmap-region')).toBeVisible()
  await expectNoSkeleton(page, '正在加载思维导图…')
  await expectNoSkeleton(page, '正在加载错题…')
  await capture(page, 'task-26-nomock-prep.png')

  await page.goto('/trial')
  await expect(page.getByRole('button', { name: '交卷', exact: true })).toBeVisible()
  await expect(page.getByText(/共 \d+ 题/)).toBeVisible()
  await expectNoSkeleton(page, '正在加载试卷…')
  const firstOption = page.getByRole('button', { name: /^A\./ }).first()
  if ((await firstOption.count()) > 0) await firstOption.click()
  await page.getByRole('button', { name: '交卷', exact: true }).click()
  await page.getByRole('button', { name: '确认交卷', exact: true }).click()
  await expect(page.getByRole('button', { name: '已交卷', exact: true })).toBeVisible()
  await expect(page.getByText(/回答正确|回答错误/).first()).toBeVisible()
  await capture(page, 'task-26-nomock-trial.png')

  await page.goto('/rank')
  await expect(
    page.getByTestId('rank-label').first().or(page.getByTestId('leaderboard-empty')),
  ).toBeVisible()
  await expectNoSkeleton(page, '正在加载排行榜…')
  await capture(page, 'task-26-nomock-rank.png')

  await page.goto('/profile')
  await expect(page.getByTestId('profile-info')).toBeVisible()
  await expect(page.getByTestId('profile-stats')).toBeVisible()
  await expectNoSkeleton(page, '正在加载个人中心…')
  await capture(page, 'task-26-nomock-profile.png')

  await page.goto('/review')
  await expect(
    page.getByTestId('review-progress').or(page.getByText('今天没有到期卡片')),
  ).toBeVisible()
  await expectNoSkeleton(page, '正在加载复习队列…')
  await capture(page, 'task-26-nomock-review.png')

  await page.goto('/library')
  await expectPageReady(page, 'page-library')
  await expect(page.getByTestId('source-row').first()).toBeVisible()
  await capture(page, 'task-14-smoke-library.png')

  await page.goto('/quiz')
  await expectPageReady(page, 'page-quiz')
  await expect(page.getByTestId(`kp-option-${point.id}`)).toBeVisible()
  await capture(page, 'task-14-smoke-quiz.png')

  await page.goto('/practice')
  await expectPageReady(page, 'page-practice')
  await expect(page.getByTestId(`practice-kp-${point.id}`)).toBeVisible()
  await capture(page, 'task-14-smoke-practice.png')

  await page.goto('/dashboard')
  await expectPageReady(page, 'page-dashboard')
  await expect(page.getByTestId('dashboard-kpis')).toBeVisible()
  await capture(page, 'task-14-smoke-dashboard.png')

  await page.goto('/settings/agents')
  await expectPageReady(page, 'page-agents')
  await expect(page.getByTestId('agent-create')).toBeVisible()
  await capture(page, 'task-14-smoke-agents.png')

  await page.goto(`/kp/${point.id}`)
  await expectPageReady(page, 'page-knowledge-point')
  await expect(page.getByTestId('kp-title')).toBeVisible()
  await capture(page, 'task-14-smoke-knowledge-point.png')

  expect(pageErrors, pageErrors.join('\n')).toEqual([])
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
})
