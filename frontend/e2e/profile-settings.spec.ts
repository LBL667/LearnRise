import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

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

interface PreferencesBody {
  notifications: { email_reminders_enabled: boolean }
  ui: { theme: 'light' | 'dark' | 'system'; sidebar_collapsed: boolean; compact_tables: boolean }
  privacy: { leaderboard_anonymous: boolean; name_visibility: 'public' | 'members' | 'private' }
}

interface CompetitionRow {
  id: string
  title: string
}

interface MemberRow {
  userId: string
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

async function setToggle(page: Page, testId: string, desired: boolean): Promise<void> {
  const toggle = page.getByTestId(testId)
  await expect(toggle).toBeVisible()
  const current = (await toggle.getAttribute('aria-checked')) === 'true'
  if (current === desired) return
  const response = waitForPut(page, '/api/profile/preferences/')
  await toggle.click()
  expect((await response).ok()).toBeTruthy()
  await expect(toggle).toHaveAttribute('aria-checked', desired ? 'true' : 'false')
}

async function setSegmented(
  page: Page,
  testId: string,
  label: string,
  pathFragment = '/api/profile/preferences/ui',
): Promise<void> {
  const response = waitForPut(page, pathFragment)
  await page.getByTestId(testId).getByRole('button', { name: label, exact: true }).click()
  expect((await response).ok()).toBeTruthy()
}

async function restoreDemoProfile(token: string, name: string): Promise<void> {
  await apiFetch('/api/profile/info', token, {
    method: 'PUT',
    body: JSON.stringify({ display_name: name }),
  })
  await apiFetch('/api/profile/preferences/ui', token, {
    method: 'PUT',
    body: JSON.stringify({ theme: 'light', sidebar_collapsed: false, compact_tables: false }),
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

async function fetchOwnMemberName(
  request: APIRequestContext,
  token: string,
  competitionId: string,
  userId: string,
): Promise<string | undefined> {
  const response = await request.get(`${API}/api/competitions/${competitionId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBeTruthy()
  const members = (await response.json()) as MemberRow[]
  return members.find((member) => member.userId === userId)?.name
}

test('profile settings: server preferences drive controls and edits persist', async ({
  page,
  request,
}) => {
  const token = await login()
  const original = await apiFetch<ProfileInfoBody>('/api/profile/info', token)
  const prefs = await apiFetch<PreferencesBody>('/api/profile/preferences', token)
  const competitions = await apiFetch<CompetitionRow[]>('/api/competitions', token)
  expect(competitions.length).toBeGreaterThan(0)
  const competition = competitions[0]

  try {
    await page.addInitScript(
      (value) => window.localStorage.setItem('learnrise.token', value),
      token,
    )
    await page.goto('/profile')
    await expect(page.getByTestId('profile-settings')).toBeVisible()

    // 1) Server-side preferences are reflected in the controls.
    const expectedTheme = prefs.ui.theme === 'system' ? /^(light|dark)$/ : prefs.ui.theme
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme)
    await expect(page.getByTestId('settings-ui-sidebar')).toHaveAttribute(
      'aria-checked',
      prefs.ui.sidebar_collapsed ? 'true' : 'false',
    )
    await expect(page.getByTestId('settings-ui-compact')).toHaveAttribute(
      'aria-checked',
      prefs.ui.compact_tables ? 'true' : 'false',
    )
    await expect(page.getByTestId('settings-notifications-toggle')).toHaveAttribute(
      'aria-checked',
      prefs.notifications.email_reminders_enabled ? 'true' : 'false',
    )
    await expect(page.getByTestId('settings-privacy-anonymous')).toHaveAttribute(
      'aria-checked',
      prefs.privacy.leaderboard_anonymous ? 'true' : 'false',
    )
    const visibilityLabel = { public: '公开', members: '仅队友', private: '隐藏' }[
      prefs.privacy.name_visibility
    ]
    await expect(
      page.getByTestId('settings-privacy-visibility').getByRole('button', {
        name: visibilityLabel,
        exact: true,
      }),
    ).toHaveClass(/text-primary/)
    await capture(page, 'round2-profile-settings-server-state.png')

    // 2) Nickname edit persists across a reload.
    await page.getByTestId('settings-edit-info').click()
    await page.getByTestId('profile-display-name-input').fill('QA-设置昵称')
    const infoResponse = waitForPut(page, '/api/profile/info')
    await page.getByTestId('profile-info-save').click()
    expect((await infoResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('profile-info')).toContainText('QA-设置昵称')
    await page.reload()
    await expect(page.getByTestId('profile-info')).toContainText('QA-设置昵称')

    // 3) Notification toggle off survives a reload, then is restored.
    await setToggle(page, 'settings-notifications-toggle', false)
    await page.reload()
    await expect(page.getByTestId('settings-notifications-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(
      (await apiFetch<PreferencesBody>('/api/profile/preferences', token)).notifications
        .email_reminders_enabled,
    ).toBe(false)
    await setToggle(page, 'settings-notifications-toggle', true)

    // 4) Dark theme applies immediately and survives a reload, then is restored.
    await setSegmented(page, 'settings-ui-theme', '深色')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await capture(page, 'round2-profile-settings-dark.png')
    await setSegmented(page, 'settings-ui-theme', '浅色')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    // 5) Sidebar collapse preference drives the layout and survives a reload.
    const aside = page.locator('aside').first()
    await expect(aside).toHaveClass(/w-\[224px\]/)
    await setToggle(page, 'settings-ui-sidebar', true)
    await expect
      .poll(async () => aside.evaluate((element) => element.className))
      .toContain('w-[68px]')
    await page.reload()
    await expect(page.locator('aside').first()).toHaveClass(/w-\[68px\]/)
    await capture(page, 'round2-profile-settings-sidebar-collapsed.png')
    await setToggle(page, 'settings-ui-sidebar', false)
    await expect(page.locator('aside').first()).toHaveClass(/w-\[224px\]/)

    // 6) name_visibility=private hides the demo user's name in the member list.
    await setSegmented(
      page,
      'settings-privacy-visibility',
      '隐藏',
      '/api/profile/preferences/privacy',
    )
    await expect
      .poll(() =>
        fetchOwnMemberName(request, token, competition.id, original.id),
      )
      .toBe('已隐藏')
    await capture(page, 'round2-profile-settings-privacy.png')
  } finally {
    await restoreDemoProfile(token, original.name)
  }
})
