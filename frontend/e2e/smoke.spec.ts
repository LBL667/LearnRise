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

async function expectNoSkeleton(page: Page, skeleton: string): Promise<void> {
  await expect(page.getByText(skeleton, { exact: false })).toHaveCount(0)
}

test('smoke: every main page renders from the API without skeletons', async ({ page }) => {
  const token = await login()
  const competitions = await apiFetch<CompetitionRow[]>('/api/competitions', token)
  const competition = competitions.find((row) => row.planStatus === 'ready') ?? competitions[0]
  expect(competition, 'seed_demo.py must create a demo competition').toBeTruthy()

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript((value) => window.localStorage.setItem('learnrise.token', value), token)

  await page.goto('/')
  await expect(page.getByRole('button', { name: /创建学习竞赛/ })).toBeVisible()
  await expect(page.getByText(competition.title)).toBeVisible()
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

  expect(pageErrors, pageErrors.join('\n')).toEqual([])
})
