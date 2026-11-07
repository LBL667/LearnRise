// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { SCENES, FIXTURES, LR_ROOT, loadFixtures } from './record-scenes.mjs'

const FILM_ROOT =
  process.env.FILM_ROOT ??
  '/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min'
const RAW_DIR = path.join(FILM_ROOT, 'recordings', 'raw')
const TOKEN_KEY = 'learnrise.token'
const LOGIN_URL = 'http://localhost:8000/api/auth/login'

let token = ''

test.beforeAll(async () => {
  fs.mkdirSync(RAW_DIR, { recursive: true })

  const envText = fs.readFileSync(path.join(LR_ROOT, '.env.demo'), 'utf8')
  const password = /^DEMO_PASSWORD=(.*)$/m.exec(envText)?.[1]?.trim()
  if (!password) throw new Error('DEMO_PASSWORD not found in LearnRise/.env.demo')

  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'xiaohong@example.com', password }),
  })
  if (!response.ok) throw new Error(`login failed: ${response.status}`)
  const body = await response.json()
  token = body.access_token
  if (!token) throw new Error('login response has no access_token')

  const fixtures = await loadFixtures(token)
  console.log(`[record] main source=${fixtures.sourceId} kp=${fixtures.kpId}`)
})

for (const scene of SCENES) {
  test(`${scene.id} · ${scene.name}`, async ({ page }) => {
    test.setTimeout(300_000)

    await page.addInitScript(
      ({ key, value }) => {
        try {
          window.localStorage.setItem(key, value)
        } catch {}
      },
      { key: TOKEN_KEY, value: token },
    )

    const url = scene.route
      .replace('{sourceId}', FIXTURES.sourceId)
      .replace('{kpId}', FIXTURES.kpId)

    const output = path.join(RAW_DIR, `${scene.id}.webm`)
    let failure: unknown = null

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await scene.run(page)
    } catch (error) {
      failure = error
    }

    // 必须先关闭页面让 Playwright 结束录像，再 saveAs。
    const video = page.video()
    await page.close().catch(() => undefined)
    if (video) {
      await video.saveAs(output).catch((error) => {
        console.error(`[record] saveAs failed for ${scene.id}:`, error)
      })
    }

    expect(fs.existsSync(output), `${scene.id} webm should exist`).toBeTruthy()
    if (failure) throw failure
  })
}
