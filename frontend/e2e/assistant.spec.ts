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
