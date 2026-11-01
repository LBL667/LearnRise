import { expect, test } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080'

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
