import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'
const EVIDENCE_DIR = process.env.EVIDENCE_DIR
const FIXTURE = fileURLToPath(new URL('../../fixtures/lec01.pdf', import.meta.url))

test.setTimeout(300_000)

interface CompetitionRow {
  id: string
  title: string
  inviteCode: string
  planStatus: string
}

interface MemberRow {
  id: string
  name: string
  role: string
}

interface WrongQuestionRow {
  id: string
  type: string
  stem: string
}

interface ProfileStatRow {
  key: string
  label: string
  value: string
}

interface TrialQuestion {
  id: string
  type: string
  stem: string
}

interface TrialExamStart {
  exam_id: string
  total: number
  questions: TrialQuestion[]
}

interface TrialResultRow {
  question_id: string
  correct: boolean
}

interface TrialSubmission {
  exam_id: string
  score: number
  total: number
  results: TrialResultRow[]
}

interface Failure {
  checkpoint: string
  message: string
}

interface NetworkIssue {
  status: number
  method: string
  url: string
  page: string
}

const failures: Failure[] = []
const pageErrors: { page: string; message: string }[] = []
const consoleErrors: { page: string; message: string }[] = []
const networkIssues: NetworkIssue[] = []

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

function trackPage(page: Page, label: string): void {
  page.on('pageerror', (error) => pageErrors.push({ page: label, message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ page: label, message: message.text() })
    }
  })
  page.on('response', (response) => {
    const status = response.status()
    if (status < 400) return
    networkIssues.push({
      status,
      method: response.request().method(),
      url: response.url(),
      page: label,
    })
  })
}

async function checkpoint(
  id: string,
  title: string,
  page: Page,
  run: () => Promise<void>,
): Promise<void> {
  await test.step(`${id} ${title}`, async () => {
    try {
      await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ checkpoint: `${id} ${title}`, message })
      console.log(`[final-qa][FAIL] ${id} ${title}: ${message}`)
    } finally {
      await capture(page, `${id}.png`).catch(() => undefined)
    }
  })
}

async function api<T>(
  request: APIRequestContext,
  path: string,
  token: string | null,
  init: { method?: string; data?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await request.fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers,
    data: init.data,
  })
  if (!response.ok()) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${response.status()} ${await response.text()}`,
    )
  }
  if (response.status() === 204) return undefined as T
  return (await response.json()) as T
}

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const body = await api<{ access_token: string }>(request, '/api/auth/login', null, {
    method: 'POST',
    data: { email, password },
  })
  return body.access_token
}

const SEEDED_COMPETITION_TITLES = ['全科知识联赛模拟赛', '2025 秋季学习挑战赛']

async function pickSeededCompetition(
  request: APIRequestContext,
  token: string,
): Promise<CompetitionRow> {
  const competitions = await api<CompetitionRow[]>(request, '/api/competitions?limit=100', token)
  const titled = competitions.find(
    (row) => row.planStatus === 'ready' && SEEDED_COMPETITION_TITLES.includes(row.title),
  )
  if (titled) return titled
  for (const row of competitions) {
    if (row.planStatus !== 'ready') continue
    try {
      const plan = await api<{ stages: unknown[] }>(
        request,
        `/api/competitions/${encodeURIComponent(row.id)}/plan`,
        token,
      )
      if (Array.isArray(plan.stages) && plan.stages.length > 0) return row
    } catch {
      continue
    }
  }
  throw new Error('seed_demo.py must create a ready competition with a six-stage plan')
}

async function reviewCount(request: APIRequestContext, token: string): Promise<number> {
  const stats = await api<ProfileStatRow[]>(request, '/api/profile/stats', token)
  return Number(stats.find((row) => row.key === 'reviews')?.value ?? 0)
}

test('final QA: real browser walk across every product slice', async ({ page, browser }) => {
  trackPage(page, 'demo')

  const demoToken = await apiLogin(page.request, EMAIL, PASSWORD)
  const seeded = await pickSeededCompetition(page.request, demoToken)
  const homeCompetitions = await api<CompetitionRow[]>(page.request, '/api/competitions', demoToken)
  expect(homeCompetitions.length, 'home page must list at least one competition').toBeGreaterThan(0)
  const homeTop = homeCompetitions[0]

  let created: CompetitionRow | null = null
  let createdSourceId = ''
  let secondEmail = ''
  let secondName = ''
  let reviewsBefore = 0

  await checkpoint('a-community', 'login lands on community with cards', page, async () => {
    await page.goto('/login')
    await page.fill('input[name=email]', EMAIL)
    await page.fill('input[name=password]', PASSWORD)
    await page.getByRole('button', { name: '登录', exact: true }).click()

    await expect(page).toHaveURL(/\/$/)
    const cards = page.getByTestId('competition-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(1)
    await expect(page.getByText('正在加载竞赛…')).toHaveCount(0)
    await expect(page.getByText(homeTop.title, { exact: true })).toBeVisible()
  })

  await checkpoint('b-competition-detail', 'detail invite code, leader and six-stage plan', page, async () => {
    await page.goto(`/competition/${seeded.id}`)

    await expect(page).toHaveURL(new RegExp(`/competition/${seeded.id}`))
    await expect(page.getByTestId('invite-code')).toContainText(seeded.inviteCode)
    await expect(page.getByText('正在加载竞赛详情…')).toHaveCount(0)

    await expect(page.getByText('队长', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '学习成员' })).toBeVisible()

    await page.getByRole('button', { name: '学习规划' }).click()
    for (const stage of ['初识', '启行', '明理', '融会', '贯通', '卓越']) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible()
    }
    const stageTitles = ['初识', '启行', '明理', '融会', '贯通', '卓越']
    for (const stage of stageTitles) {
      expect(await page.getByText(stage, { exact: true }).count()).toBeGreaterThanOrEqual(1)
    }
  })

  await checkpoint('c-create-wizard', 'upload PDF and publish a competition', page, async () => {
    await page.goto('/')
    await page.getByRole('button', { name: /创建学习竞赛/ }).click()

    const title = `QA 端到端竞赛 ${Date.now()}`
    await page.fill('input[placeholder*="高等数学期中冲刺赛"]', title)

    const uploadWait = page.waitForResponse(
      (response) => response.url().includes('/api/sources/upload') && response.request().method() === 'POST',
    )
    await page.setInputFiles('input[type=file]', FIXTURE)
    const uploadResponse = await uploadWait
    expect(uploadResponse.status()).toBe(202)
    createdSourceId = ((await uploadResponse.json()) as { source_id: string }).source_id

    await expect(page.getByText('解析完成')).toBeVisible({ timeout: 90_000 })

    await page
      .getByPlaceholder(/请填写要掌握的知识点范围/)
      .fill('掌握 TCP 三次握手、四次挥手与拥塞控制，能解释状态迁移与异常场景。')
    await page.getByRole('button', { name: '下一步' }).click()

    await page.getByRole('button', { name: /判断题/ }).click()
    await page.getByRole('button', { name: '下一步' }).click()

    await page.getByRole('button', { name: '下一步' }).click()

    const startInput = page.locator('input[type="datetime-local"]').nth(0)
    const endInput = page.locator('input[type="datetime-local"]').nth(1)
    await startInput.fill('2026-12-01T09:00')
    await endInput.fill('2026-12-31T18:00')
    await page.getByRole('button', { name: '下一步' }).click()

    const createWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/competitions' && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '发布', exact: true }).click()
    const createResponse = await createWait
    expect(createResponse.status()).toBe(201)
    created = (await createResponse.json()) as CompetitionRow

    await expect(page.getByText('发布成功!')).toBeVisible()
    await expect(page.getByText(created.inviteCode, { exact: true })).toBeVisible()
    await capture(page, 'c-wizard-success.png')

    await page.getByRole('button', { name: '完成', exact: true }).click()
    const createdCard = page.getByTestId('competition-card').filter({ hasText: title })
    await expect(createdCard).toBeVisible()
    await createdCard.getByRole('button', { name: /进入竞赛/ }).click()

    await expect(page).toHaveURL(new RegExp(`/competition/${created.id}`))
    await expect(page.getByTestId('invite-code')).toContainText(created.inviteCode)
    await capture(page, 'c-detail.png')

    await page.goto('/')
    await expect(page.getByTestId('competition-card').filter({ hasText: title })).toBeVisible()
  })

  await checkpoint('d-register-and-join', 'second account registers through UI and joins', page, async () => {
    if (!created) throw new Error('blocked: competition from (c) was not created')
    const stamp = Date.now()
    secondEmail = `qa-e2e-${stamp}@example.com`
    secondName = `QA队员${String(stamp).slice(-4)}`

    const secondContext = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    })
    const secondPage = await secondContext.newPage()
    trackPage(secondPage, 'second-user')
    try {
      await secondPage.goto('/login')
      await secondPage.getByRole('button', { name: '没有账号？立即注册' }).click()
      await secondPage.fill('input[name=email]', secondEmail)
      await secondPage.fill('input[name=displayName]', secondName)
      await secondPage.fill('input[name=password]', 'qa-e2e-pass')
      await secondPage.getByRole('button', { name: '注册并登录' }).click()

      await expect(secondPage).toHaveURL(/\/$/)
      await expect(secondPage.getByRole('button', { name: /创建学习竞赛/ })).toBeVisible()

      await secondPage.fill('input[placeholder="输入竞赛邀请码"]', created.inviteCode)
      await secondPage.getByRole('button', { name: '加入竞赛' }).click()
      await expect(secondPage).toHaveURL(new RegExp(`/competition/${created.id}`))
      await expect(secondPage.getByTestId('invite-code')).toContainText(created.inviteCode)
      await capture(secondPage, 'd-joined.png')

      const members = await api<MemberRow[]>(
        page.request,
        `/api/competitions/${created.id}/members`,
        demoToken,
      )
      expect(members.map((member) => member.name)).toContain(secondName)

      await page.goto(`/competition/${created.id}`)
      await expect(page.getByTestId('invite-code')).toContainText(created.inviteCode)
      await expect(page.getByText(secondName, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '学习成员' }).click()
      await capture(page, 'd-members-demo-view.png')
    } finally {
      await secondContext.close()
    }
  })

  await checkpoint('e-assistant-citation', 'assistant streams an answer and citation opens /kp', page, async () => {
    if (!createdSourceId) throw new Error('blocked: no uploaded source from (c)')
    const notes = await api<{ knowledge_points_created: number; root_ids: string[] }>(
      page.request,
      `/api/sources/${createdSourceId}/notes`,
      demoToken,
      { method: 'POST', data: {} },
    )
    expect(notes.knowledge_points_created).toBeGreaterThan(0)

    await page.goto('/prep')
    await expect(page.getByRole('button', { name: '学习助手' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    const input = page.getByPlaceholder(/请输入你的问题/)
    await input.fill('什么是三次握手？')
    await input.press('Enter')

    const citation = page.locator('button[data-testid^="citation-"]').first()
    await expect(citation).toBeVisible({ timeout: 60_000 })
    const answerBubble = page.locator('div.rounded-2xl.rounded-tl-sm').last()
    await expect(answerBubble).not.toHaveText('')
    await capture(page, 'e-assistant-answer.png')

    await citation.click()
    await expect(page).toHaveURL(/\/kp\//)
    await expect(page.getByTestId('kp-title')).toBeVisible()
    await expect(page.getByText('正在加载知识点…')).toHaveCount(0)
  })

  await checkpoint('f-wrong-questions', 'wrong list, server-side type filter and AI diagnosis', page, async () => {
    await page.goto('/prep')
    await page.getByRole('button', { name: '错题收藏' }).click()

    await expect(page.getByTestId('wrong-question-item').first()).toBeVisible()
    await expect(page.getByTestId('wrong-diagnostics')).toBeVisible()
    await expect(page.getByTestId('wrong-diagnostics')).toContainText('AI 诊断')
    await expect(page.getByTestId('weak-point-list')).toBeVisible()
    expect(await page.getByTestId('weak-point-list').locator('li').count()).toBeGreaterThan(0)
    await expect(page.getByText('正在加载错题…')).toHaveCount(0)

    await page.getByRole('button', { name: '筛选' }).click()
    const filterWait = page.waitForRequest(
      (request) => request.url().includes('/api/wrong-questions') && request.url().includes('type=choice'),
    )
    await page.getByRole('button', { name: '单选题', exact: true }).click()
    const request = await filterWait
    expect(request.url()).toContain('type=choice')
    await expect(page.getByTestId('wrong-question-item').first()).toContainText('单选题')
  })

  await checkpoint('g-review', 'flip card, rate 3, advance and bump profile review count', page, async () => {
    reviewsBefore = await reviewCount(page.request, demoToken)

    await page.goto('/review')
    const progress = page.getByTestId('review-progress')
    await expect(progress).toHaveText(/第 1 \/ \d+ 张/)
    await expect(page.getByText('正在加载复习队列…')).toHaveCount(0)

    const cards = page.getByTestId('review-card')
    await expect(cards).toHaveAttribute('data-flipped', 'false')
    await expect(page.getByTestId('rating-3')).toBeDisabled()
    await cards.click()
    await expect(cards).toHaveAttribute('data-flipped', 'true')
    await expect(page.getByTestId('rating-3')).toBeEnabled()
    await capture(page, 'g-review-flipped.png')

    const submitWait = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().includes('/submit'),
    )
    await page.keyboard.press('3')
    expect((await submitWait).postDataJSON()).toEqual({ rating: 3 })
    await expect(progress).toHaveText(/第 2 \//)
    await capture(page, 'g-review-advanced.png')

    const reviewsAfter = await reviewCount(page.request, demoToken)
    expect(reviewsAfter).toBe(reviewsBefore + 1)
    await page.goto('/profile')
    const stats = page.getByTestId('profile-stats')
    await expect(stats).toBeVisible()
    await expect(page.getByText('正在加载个人中心…')).toHaveCount(0)
    const text = await stats.innerText()
    const match = text.match(/复习次数\s*(\d+)/)
    expect(match, `profile stats text: ${text}`).not.toBeNull()
    expect(Number(match?.[1])).toBe(reviewsAfter)
    await capture(page, 'g-profile-reviews.png')
  })

  let trialWrongStems: string[] = []
  await checkpoint('h-trial', 'server-graded trial with per-question correctness', page, async () => {
    const startWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/trial/exams' && response.request().method() === 'POST',
    )
    await page.goto('/trial')
    const startResponse = await startWait
    expect(startResponse.status()).toBe(201)
    const exam = (await startResponse.json()) as TrialExamStart
    expect(exam.total).toBeGreaterThan(0)

    await expect(page.getByText('正在加载试卷…')).toHaveCount(0)
    await expect(page.locator('article.card')).toHaveCount(exam.questions.length)

    for (const question of exam.questions) {
      const card = page.locator('article.card').filter({ hasText: question.stem }).first()
      await expect(card).toBeVisible()
      if (question.type === 'blank') {
        await card.locator('input').fill('final-qa-deliberately-wrong')
      } else {
        await card.locator('.grid > button').first().click()
      }
    }
    await capture(page, 'h-trial-answered.png')

    await page.getByRole('button', { name: '交卷', exact: true }).click()
    const submitWait = page.waitForResponse(
      (response) =>
        /\/api\/trial\/exams\/[^/]+\/submit$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '确认交卷', exact: true }).click()
    const submitResponse = await submitWait
    expect(submitResponse.status()).toBe(200)
    const submission = (await submitResponse.json()) as TrialSubmission
    expect(submission.total).toBe(exam.total)
    expect(submission.results).toHaveLength(exam.total)
    expect(submission.results.some((row) => row.correct)).toBe(true)
    expect(submission.results.some((row) => !row.correct)).toBe(true)

    await expect(page.getByRole('button', { name: '已交卷', exact: true })).toBeVisible()
    expect(await page.getByText(/回答正确|回答错误/).count()).toBe(exam.total)

    const byId = new Map(exam.questions.map((question) => [question.id, question]))
    trialWrongStems = submission.results
      .filter((row) => !row.correct)
      .map((row) => byId.get(row.question_id)?.stem ?? '')
      .filter((stem) => stem !== '')
    expect(trialWrongStems.length).toBeGreaterThan(0)
  })

  await checkpoint('h-integration-wrong-list', 'trial wrong answers appear in the wrong-question list', page, async () => {
    if (trialWrongStems.length === 0) throw new Error('blocked: trial produced no wrong answers')
    const rows = await api<WrongQuestionRow[]>(
      page.request,
      '/api/wrong-questions?limit=100',
      demoToken,
    )
    const stems = new Set(rows.map((row) => row.stem))
    const missing = trialWrongStems.filter((stem) => !stems.has(stem))

    await page.goto('/prep')
    await page.getByRole('button', { name: '错题收藏' }).click()
    await expect(page.getByTestId('wrong-question-item').first()).toBeVisible()

    if (missing.length > 0) {
      throw new Error(
        `${missing.length}/${trialWrongStems.length} trial-wrong questions missing from /api/wrong-questions; missing stems: ${missing
          .map((stem) => stem.slice(0, 60))
          .join(' | ')}`,
      )
    }
  })

  await checkpoint('i-rank', 'leaderboard top three ranks are 1/2/3', page, async () => {
    if (!created) throw new Error('blocked: competition from (c) was not created')
    for (const suffix of ['甲', '乙']) {
      const stamp = Date.now()
      const email = `qa-rank-${stamp}-${suffix}@example.com`
      const name = `榜单队员${suffix}`
      const memberToken = await api<{ access_token: string }>(
        page.request,
        '/api/auth/register',
        null,
        {
          method: 'POST',
          data: { email, display_name: name, password: 'qa-rank-pass' },
        },
      ).then((body) => body.access_token)
      await api<unknown>(page.request, '/api/competitions/join', memberToken, {
        method: 'POST',
        data: { invite_code: created.inviteCode },
      })
    }

    await page.goto('/rank')
    await expect(page.locator('select')).toBeVisible()
    await page.locator('select').selectOption({ label: created.title })
    await expect(page.getByText('正在加载排行榜…')).toHaveCount(0)
    await expect(page.getByTestId('leaderboard-error')).toHaveCount(0)

    const ranks = page.getByTestId('rank-label')
    await expect(ranks.nth(0)).toHaveText('1')
    await expect(ranks.nth(1)).toHaveText('2')
    await expect(ranks.nth(2)).toHaveText('3')
  })

  await checkpoint('j-profile', 'profile five blocks all have content', page, async () => {
    await page.goto('/profile')
    for (const id of [
      'profile-info',
      'profile-stats',
      'profile-records',
      'profile-study',
      'profile-settings',
    ]) {
      const block = page.getByTestId(id)
      await expect(block).toBeVisible()
      expect((await block.innerText()).trim().length).toBeGreaterThan(0)
    }
    await expect(page.getByText('正在加载个人中心…')).toHaveCount(0)
    await expect(page.getByTestId('profile-stats')).toContainText('参赛数')
    await expect(page.getByTestId('profile-stats')).toContainText('复习次数')
    await expect(page.getByTestId('profile-stats')).toContainText('连续学习天数')
    await expect(page.getByTestId('profile-settings')).toContainText('基本信息')
    await expect(page.getByTestId('profile-settings')).toContainText('通知设置')
    await expect(page.getByTestId('profile-settings')).toContainText('隐私设置')
    await expect(page.getByTestId('settings-edit-info')).toBeVisible()
    await expect(page.getByTestId('settings-change-password')).toBeVisible()
    await expect(page.getByTestId('settings-notifications-toggle')).toBeVisible()
    await expect(page.getByTestId('settings-ui-theme')).toBeVisible()
    await expect(page.getByTestId('settings-privacy-anonymous')).toBeVisible()
    await expect(page.getByText('即将上线')).toHaveCount(0)
  })

  console.log('[final-qa] network issues:', JSON.stringify(networkIssues, null, 2))
  console.log('[final-qa] console errors:', JSON.stringify(consoleErrors, null, 2))
  console.log('[final-qa] page errors:', JSON.stringify(pageErrors, null, 2))
  console.log('[final-qa] failures:', JSON.stringify(failures, null, 2))

  expect(pageErrors, 'uncaught page errors').toEqual([])
  expect(failures, 'checkpoint failures').toEqual([])
})
