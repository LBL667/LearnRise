import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

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

test('upload wizard stores a real source and reaches the ready state', async ({ page }) => {
  const value = await token()
  await page.addInitScript((t) => window.localStorage.setItem('learnrise.token', t), value)

  await page.goto('/')
  await page.getByRole('button', { name: /创建学习竞赛/ }).click()
  await page.fill('input[placeholder*="高等数学期中冲刺赛"]', 'E2E 上传向导竞赛')
  await page.setInputFiles('input[type=file]', fileURLToPath(new URL('../../fixtures/lec01.pdf', import.meta.url)))

  await expect(page.getByText('解析完成')).toBeVisible({ timeout: 90_000 })
  const evidenceDir = process.env.EVIDENCE_DIR
  if (evidenceDir) {
    await page.screenshot({ path: `${evidenceDir}/task-15-wizard.png` })
  }
})
