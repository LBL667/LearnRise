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

interface ProfileInfoBody {
  id: string
  name: string
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

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...init, headers })
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function capture(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true })
}

async function waitForPut(page: Page, pathFragment: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(pathFragment) && response.request().method() === 'PUT',
  )
}

async function restoreDemoProfile(token: string, name: string): Promise<void> {
  await apiFetch('/api/profile/info', token, {
    method: 'PUT',
    body: JSON.stringify({ display_name: name }),
  })
  await apiFetch('/api/profile/preferences/notifications', token, {
    method: 'PUT',
    body: JSON.stringify({ email_reminders_enabled: true }),
  })
  await apiFetch('/api/profile/preferences/privacy', token, {
    method: 'PUT',
    body: JSON.stringify({ leaderboard_anonymous: false, name_visibility: 'public' }),
  })
}

test('profile settings: removed cards stay hidden and profile edits persist', async ({ page }) => {
  const token = await login()
  const original = await apiFetch<ProfileInfoBody>('/api/profile/info', token)

  try {
    await page.addInitScript(
      (value) => window.localStorage.setItem('learnrise.token', value),
      token,
    )
    await page.goto('/profile')
    await expect(page.getByTestId('profile-settings')).toBeVisible()

    for (const title of ['通知设置', '学习偏好', '界面设置', '隐私设置']) {
      await expect(page.getByTestId('profile-settings').getByText(title, { exact: true })).toHaveCount(0)
    }

    // 2) Nickname edit persists across a reload.
    await page.getByTestId('settings-edit-info').click()
    await page.getByTestId('profile-display-name-input').fill('QA-设置昵称')
    const infoResponse = waitForPut(page, '/api/profile/info')
    await page.getByTestId('profile-info-save').click()
    expect((await infoResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('profile-info')).toContainText('QA-设置昵称')
    await page.reload()
    await expect(page.getByTestId('profile-info')).toContainText('QA-设置昵称')

    const aside = page.locator('aside').first()
    await page.getByRole('button', { name: '收起侧边栏' }).click()
    await expect(aside).toHaveClass(/w-\[68px\]/)
    await page.reload()
    await expect(page.locator('aside').first()).toHaveClass(/w-\[68px\]/)
    await page.getByRole('button', { name: '展开侧边栏' }).click()
  } finally {
    await restoreDemoProfile(token, original.name)
  }
})
