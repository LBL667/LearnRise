import { expect, test } from '@playwright/test'

const EMAIL = process.env.E2E_EMAIL ?? 'demo@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo1234'

test('unauthenticated visit is redirected to the login page with a redirect param', async ({
  page,
}) => {
  await page.goto('/competition/anything')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.locator('input[name=email]')).toBeVisible()
})

test('login sends the user back to the originally requested page', async ({ page }) => {
  await page.goto('/competition/anything')
  await expect(page).toHaveURL(/\/login\?redirect=/)

  await page.fill('input[name=email]', EMAIL)
  await page.fill('input[name=password]', PASSWORD)
  await page.click('button[type=submit]')

  await expect(page).toHaveURL(/\/competition\/anything/)
  await expect(page.locator('header')).toContainText('让每一次学习')
})

test('a broken token is cleared and the user is sent back to login', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => window.localStorage.setItem('learnrise.token', 'broken'))
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  const token = await page.evaluate(() => window.localStorage.getItem('learnrise.token'))
  expect(token).toBeNull()
})
