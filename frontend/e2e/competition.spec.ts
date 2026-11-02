import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`), fullPage: true })
}

interface CompetitionFixtureOverrides {
  planStatus?: string
  currentUserRole?: string
  canManageMembers?: boolean
}

function competitionFixture(id: string, overrides: CompetitionFixtureOverrides = {}) {
  return {
    id,
    title: 'E2E 规划竞赛',
    level: '大学',
    description: '规划生成与备考计划端到端用例',
    host: '演示用户',
    memberCount: 1,
    capacity: null,
    startTime: '2026-12-01T09:00:00',
    endTime: '2026-12-31T18:00:00',
    awardQuota: 3,
    daysToStart: 29,
    daysToEnd: 59,
    cover: 'aurora',
    inviteCode: 'PLAN0001',
    questionTypes: ['choice'],
    difficulty: 'medium',
    rewards: [],
    planStatus: 'pending',
    currentUserRole: 'leader',
    canManageMembers: true,
    ...overrides,
  }
}

function planFixture() {
  return {
    stats: {
      daysToStart: 29,
      startAt: '2026-12-01T09:00:00',
      daysToEnd: 59,
      endAt: '2026-12-31T18:00:00',
      awardQuota: 3,
    },
    rewards: [],
    intro: 'E2E 规划已生成',
    stages: [
      { no: '01', title: '基础梳理', theme: '概念', points: ['知识点 A'], icon: 'book' },
    ],
  }
}

async function loginAndCreateCompetition(): Promise<{ token: string; id: string; code: string }> {
  const loginResponse = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  expect(loginResponse.ok).toBeTruthy()
  const { access_token: token } = (await loginResponse.json()) as { access_token: string }

  const created = await fetch(`${API}/api/competitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `E2E 竞赛 ${Date.now()}`,
      question_types: ['choice', 'judge'],
      start_time: '2026-12-01T09:00:00',
      end_time: '2026-12-31T18:00:00',
    }),
  })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { id: string; inviteCode: string }
  return { token, id: body.id, code: body.inviteCode }
}

test('community page lists competitions from the real api', async ({ page }) => {
  const { token, id } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  await page.goto('/')
  const cards = page.getByTestId('competition-card')
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThanOrEqual(1)

  await page.goto(`/competition/${id}`)
  await expect(page.getByTestId('invite-code')).toBeVisible()
})

test('a wrong invite code shows a backend-driven error and keeps the page usable', async ({
  page,
}) => {
  const { token } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  await page.goto('/')
  await page.fill('input[placeholder="输入竞赛邀请码"]', 'ZZZZZZZZ')
  await page.getByRole('button', { name: '加入竞赛' }).click()

  await expect(page.getByText('邀请码无效或已过期', { exact: true })).toBeVisible()
  await expect(page.getByTestId('competition-card').first()).toBeVisible()
})

test('leader generates a plan and the button polls until it is ready', async ({ page }) => {
  const { token, id } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  let generated = false
  let pollsAfterGenerate = 0
  let generateCalls = 0

  await page.route(`**/api/competitions/${id}/members`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/competitions/${id}/plan/generate`, (route) => {
    generateCalls += 1
    generated = true
    return route.fulfill({
      status: 202,
      json: { job_id: 'job-plan', competition_id: id, status: 'queued' },
    })
  })
  await page.route(`**/api/competitions/${id}/plan`, (route) => {
    if (pollsAfterGenerate < 2) {
      return route.fulfill({
        status: 409,
        json: { code: 'PLAN_NOT_READY', detail: '学习规划尚未生成' },
      })
    }
    return route.fulfill({ json: planFixture() })
  })
  await page.route(`**/api/competitions/${id}`, (route) => {
    if (!generated) {
      return route.fulfill({ json: competitionFixture(id, { planStatus: 'pending' }) })
    }
    pollsAfterGenerate += 1
    return route.fulfill({
      json: competitionFixture(id, {
        planStatus: pollsAfterGenerate < 2 ? 'generating' : 'ready',
      }),
    })
  })
  await page.route('**/api/knowledge-points**', (route) => route.fulfill({ json: [] }))

  await page.goto(`/competition/${id}`)
  await page.getByRole('button', { name: '学习规划' }).click()

  const button = page.getByTestId('generate-plan')
  await expect(button).toBeEnabled()
  await expect(button).toHaveText(/生成规划/)

  await button.click()
  await expect(button).toBeDisabled()
  await expect(button).toHaveText(/生成中/)
  await expect(page.getByText('规划图')).toBeVisible({ timeout: 15_000 })
  await expect(button).toHaveText(/重新生成规划/)

  expect(generateCalls).toBe(1)
  expect(pollsAfterGenerate).toBeGreaterThanOrEqual(2)
  await capture(page, 'task-12-plan-generated')
})

test('plan generation without a bound source shows the NO_SOURCE guidance', async ({ page }) => {
  const { token, id } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  await page.route(`**/api/competitions/${id}/members`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/competitions/${id}/plan/generate`, (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'NO_SOURCE', detail: '共享库里还没有可用的知识点' },
    }),
  )
  await page.route(`**/api/competitions/${id}/plan`, (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'PLAN_NOT_READY', detail: '学习规划尚未生成' },
    }),
  )
  await page.route(`**/api/competitions/${id}`, (route) =>
    route.fulfill({ json: competitionFixture(id, { planStatus: 'pending' }) }),
  )
  await page.route('**/api/knowledge-points**', (route) => route.fulfill({ json: [] }))

  await page.goto(`/competition/${id}`)
  await page.getByRole('button', { name: '学习规划' }).click()
  await page.getByTestId('generate-plan').click()

  await expect(page.getByText('请先在建赛时绑定资料', { exact: true })).toBeVisible()
  await expect(page.getByTestId('generate-plan')).toBeEnabled()
  await capture(page, 'task-12-plan-no-source')
})

test('non-leader sees a disabled plan generation button with a hint', async ({ page }) => {
  const { token, id } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  await page.route(`**/api/competitions/${id}/members`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/competitions/${id}/plan`, (route) =>
    route.fulfill({
      status: 409,
      json: { code: 'PLAN_NOT_READY', detail: '学习规划尚未生成' },
    }),
  )
  await page.route(`**/api/competitions/${id}`, (route) =>
    route.fulfill({
      json: competitionFixture(id, {
        planStatus: 'pending',
        currentUserRole: 'member',
        canManageMembers: false,
      }),
    }),
  )
  await page.route('**/api/knowledge-points**', (route) => route.fulfill({ json: [] }))

  await page.goto(`/competition/${id}`)
  await page.getByRole('button', { name: '学习规划' }).click()

  await expect(page.getByTestId('generate-plan')).toBeDisabled()
  await expect(page.getByText('仅队长可生成规划', { exact: true })).toBeVisible()
  await capture(page, 'task-12-plan-non-leader')
})

test('exam plan renders items, resolved knowledge points and the truncated hint', async ({
  page,
}) => {
  const { token, id } = await loginAndCreateCompetition()
  await page.addInitScript((value) => {
    window.localStorage.setItem('learnrise.token', value)
  }, token)

  const kpOne = '11111111-1111-4111-8111-111111111111'
  const kpTwo = '22222222-2222-4222-8222-222222222222'
  let examPlanBody: Record<string, unknown> | null = null

  await page.route(`**/api/competitions/${id}/members`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/competitions/${id}/plan`, (route) =>
    route.fulfill({ json: planFixture() }),
  )
  await page.route(`**/api/competitions/${id}`, (route) =>
    route.fulfill({ json: competitionFixture(id, { planStatus: 'ready' }) }),
  )
  await page.route('**/api/knowledge-points**', (route) =>
    route.fulfill({
      json: [
        {
          id: kpOne,
          source_id: null,
          parent_id: null,
          title: '数据结构',
          content: '',
          level: 1,
          sort_order: 1,
          mastery_score: 0.5,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
        {
          id: kpTwo,
          source_id: null,
          parent_id: null,
          title: '算法复杂度',
          content: '',
          level: 1,
          sort_order: 2,
          mastery_score: 0.4,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ],
    }),
  )
  await page.route('**/api/assistant/exam-plan', (route) => {
    examPlanBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({
      json: {
        mode: 'standard',
        competition_id: id,
        end_at: '2026-12-31T18:00:00Z',
        generated_at: '2026-11-02T10:00:00Z',
        guidance: '每天保持 2 小时学习时间',
        truncated: true,
        items: [
          {
            date: '2026-12-01',
            focus_kp_ids: [kpOne, kpTwo],
            quiz_count: 5,
            review_count: 2,
            rationale: '主攻数据结构',
          },
          {
            date: '2026-12-02',
            focus_kp_ids: [kpTwo],
            quiz_count: 6,
            review_count: 1,
            rationale: '巩固算法复杂度',
          },
        ],
      },
    })
  })

  await page.goto(`/competition/${id}`)
  await page.getByRole('button', { name: '学习规划' }).click()
  await page.getByRole('button', { name: '生成备考计划' }).click()

  const items = page.getByTestId('exam-plan-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('2026-12-01')
  await expect(items.nth(0)).toContainText('练习题 5 道')
  await expect(items.nth(0)).toContainText('复习 2 个')
  await expect(items.nth(0)).toContainText('数据结构')
  await expect(items.nth(0)).toContainText('算法复杂度')
  await expect(items.nth(1)).toContainText('2026-12-02')
  await expect(page.getByTestId('exam-plan-truncated')).toBeVisible()
  await expect(page.getByTestId('exam-plan-guidance')).toContainText('每天保持 2 小时学习时间')
  await expect(page.getByTestId('exam-plan-mode')).toContainText('标准计划')
  expect(examPlanBody).toEqual({ competition_id: id, regenerate: false })

  await capture(page, 'task-12-exam-plan')
})
