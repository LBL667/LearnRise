/**
 * record-scenes.mjs — 11 个真实 UI 交互场景定义。
 *
 * 每个场景只描述「在浏览器里做什么」，不负责视频落盘；落盘由
 * record-ui.spec.ts 在测试结束后调用 page.video().saveAs() 完成。
 *
 * 约束：
 * - 只使用真实用户可触发的交互（hover / click / type / select / scroll）；
 * - 任何失败的可选交互都被 safe() 吞掉，核心导航失败仍会让测试失败；
 * - 场景总交互时长 = targetSeconds + 4s（由 fillTime 兜底），保证
 *   WebM 时长 >= targetSeconds。
 */

export const LR_ROOT = '/home/sky/竞赛/华为ICT/LearnRise'
export const API_ROOT = 'http://localhost:8000'

/** 运行时解析出的实体 id（beforeAll 调用 loadFixtures 填充）。 */
export const FIXTURES = {
  sourceId: '',
  kpId: '',
  practiceKpTitle: '',
  fixturePdf: `${LR_ROOT}/fixtures/lec01.pdf`,
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 吞掉可选交互的错误，避免一个 hover 失败就中断整段录制。 */
export async function safe(fn) {
  try {
    return await fn()
  } catch {
    return undefined
  }
}

/**
 * 保持画面持续变化：鼠标在内容区移动 + 缓慢滚动。
 * 每 700ms 一次状态变化，满足「≤2s 必有可见变化」。
 */
export async function idleLoop(page, ms) {
  const end = Date.now() + Math.max(0, ms)
  let i = 0
  while (Date.now() < end) {
    const x = 360 + (i % 6) * 190
    const y = 220 + (i % 4) * 130
    await safe(() => page.mouse.move(x, y, { steps: 6 }))
    await sleep(420)
    await safe(() => page.mouse.wheel(0, i % 2 === 0 ? 140 : -90))
    await sleep(300)
    i += 1
  }
}

/** 从场景开始到现在，补足到 targetSeconds + 4s。 */
async function fillTime(page, startedAt, targetSeconds) {
  const need = targetSeconds * 1000 + 4000 - (Date.now() - startedAt)
  if (need > 0) await idleLoop(page, need)
}

async function waitForAny(page, selectors, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const selector of selectors) {
      const loc = page.locator(selector)
      if ((await loc.count()) > 0) return selector
    }
    await sleep(200)
  }
  throw new Error(`none of selectors appeared: ${selectors.join(', ')}`)
}


/** 仅当元素存在时在短超时内 hover，避免 auto-wait 卡死到测试超时。 */
export async function hoverIfPresent(page, selector, timeout = 2500) {
  const loc = page.locator(selector)
  if ((await loc.count()) === 0) return false
  try {
    await loc.first().hover({ timeout })
    return true
  } catch {
    return false
  }
}

async function clickTab(page, label) {
  const tab = page.getByRole('button', { name: label, exact: true })
  await tab.first().click()
  await sleep(900)
}

async function hoverSequence(page, selector, count, holdMs = 900) {
  const items = page.locator(selector)
  const total = Math.min(await items.count(), count)
  for (let i = 0; i < total; i += 1) {
    await safe(() => items.nth(i).hover())
    await sleep(holdMs)
  }
}

async function scrollMain(page, delta, steps = 6) {
  for (let i = 0; i < steps; i += 1) {
    await safe(() => page.mouse.wheel(0, delta))
    await sleep(260)
  }
}

/** 用真实上传弹窗选择 fixtures 里的 PDF。 */
async function uploadFixture(page) {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 })
  await page.locator('[data-testid="library-upload"]').click()
  const chooser = await chooserPromise
  await chooser.setFiles(FIXTURES.fixturePdf)
}

/** 轮询状态徽标，返回本场景观察到的状态序列。 */
async function watchStatuses(page, ms) {
  const seen = []
  const end = Date.now() + ms
  while (Date.now() < end) {
    const rows = page.locator('[data-testid="status-badge"]')
    const count = await rows.count()
    for (let i = 0; i < count; i += 1) {
      const status = await rows.nth(i).getAttribute('data-status')
      if (status && seen[seen.length - 1] !== status) seen.push(status)
    }
    await sleep(150)
  }
  return seen
}

/** 从 API 解析主资料与知识点 id（不含密码，密码由 spec 读取 .env.demo）。 */

/** 找到一个「确实有题目」的知识点标题，供 S07 陪练场景在 UI 上精确选择。 */
export async function resolvePracticeKp(token) {
  const headers = { Authorization: `Bearer ${token}` }
  const res = await fetch(`${API_ROOT}/api/knowledge-points?limit=100`, { headers })
  if (!res.ok) return ''
  const points = await res.json()
  for (const point of points) {
    const probe = await fetch(`${API_ROOT}/api/assistant/practice/sessions`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ knowledge_point_ids: [point.id], difficulty: 'medium', count: 1 }),
    })
    if (probe.ok) {
      const session = await probe.json()
      await fetch(`${API_ROOT}/api/assistant/practice/sessions/${session.session_id}/end`, {
        method: 'POST',
        headers,
      }).catch(() => undefined)
      return point.title
    }
  }
  return ''
}

export async function loadFixtures(token) {
  const headers = { Authorization: `Bearer ${token}` }
  const sourcesRes = await fetch(`${API_ROOT}/api/sources`, { headers })
  if (!sourcesRes.ok) throw new Error(`GET /api/sources -> ${sourcesRes.status}`)
  const sources = await sourcesRes.json()

  let mainSourceId = ''
  let kpId = ''
  const ordered = [...sources.filter((item) => item.status === 'ready')].sort((a, b) => {
    const score = (item) => (String(item.title ?? '').includes('第3章') ? 0 : 1)
    return score(a) - score(b)
  })
  for (const source of ordered) {
    const treeRes = await fetch(`${API_ROOT}/api/sources/${source.id}/tree`, { headers })
    if (!treeRes.ok) continue
    const tree = await treeRes.json()
    if (Array.isArray(tree) && tree.length > 0 && tree[0]?.id) {
      mainSourceId = source.id
      kpId = tree[0].id
      break
    }
  }

  if (!kpId) {
    const kpRes = await fetch(`${API_ROOT}/api/knowledge-points?limit=1`, { headers })
    if (kpRes.ok) {
      const points = await kpRes.json()
      if (Array.isArray(points) && points.length > 0) {
        kpId = points[0].id
        mainSourceId = mainSourceId || points[0].source_id || ''
      }
    }
  }
  if (!mainSourceId) mainSourceId = sources.find((item) => item.status === 'ready')?.id ?? ''
  if (!mainSourceId || !kpId) throw new Error('cannot resolve source/knowledge-point fixtures')

  FIXTURES.sourceId = mainSourceId
  FIXTURES.kpId = kpId
  FIXTURES.practiceKpTitle = await resolvePracticeKp(token)
  return { ...FIXTURES }
}

// ---------------------------------------------------------------------------
// 11 个场景
// ---------------------------------------------------------------------------

export const SCENES = [
  {
    id: 'S01',
    name: '竞赛空间首页',
    route: '/',
    targetSeconds: 12,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('[data-testid="competition-card"]')
      const cards = page.locator('[data-testid="competition-card"]')
      const count = Math.min(await cards.count(), 2)
      for (let i = 0; i < count; i += 1) {
        await safe(() => cards.nth(i).hover())
        await sleep(1400)
      }
      // 侧边栏展开 / 收起各一次
      await safe(() => page.locator('aside button[aria-label="收起侧边栏"]').click())
      await sleep(900)
      await safe(() => page.locator('aside button[aria-label="展开侧边栏"]').click())
      await sleep(800)
      // 进入第二张竞赛卡（一班/二班之间切换）
      if (count > 1) {
        await safe(() => cards.nth(1).locator('button').click())
        await sleep(2200)
        await safe(() => page.locator('aside button', { hasText: '竞赛空间' }).click())
        await sleep(1200)
      }
      await fillTime(page, startedAt, 12)
    },
  },

  {
    id: 'S02',
    name: '学习助手流式回答',
    route: '/prep',
    targetSeconds: 20,
    run: async (page) => {
      const startedAt = Date.now()
      const input = page.locator('textarea[placeholder*="请输入你的问题"]')
      await input.waitFor({ state: 'visible', timeout: 20000 })
      await input.fill('请用三句话解释应收账款减值迹象，并举一个例子。')
      await sleep(600)
      await input.press('Enter')
      await sleep(1200)
      // 等待流式消息出现（mock LLM 也可能很快）
      await safe(() =>
        page.waitForFunction(
          () => {
            const text = document.body.innerText
            return /减值|应收|例子|坏账/.test(text)
          },
          { timeout: 15000 },
        ),
      )
      // 切换回答模式，保持可见变化
      for (const label of ['详细', '举例', '简洁']) {
        await safe(() => page.getByRole('button', { name: label, exact: true }).first().click())
        await sleep(900)
      }
      // 再发一条更短的问题
      await safe(async () => {
        await input.fill('再给一个更贴近考试的例子。')
        await sleep(500)
        await input.press('Enter')
      })
      await sleep(5000)
      // 滚回消息区顶部再到底部
      await scrollMain(page, -420, 4)
      await scrollMain(page, 520, 5)
      await fillTime(page, startedAt, 20)
    },
  },

  {
    id: 'S03',
    name: '资料库上传与状态流转',
    route: '/library',
    targetSeconds: 24,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('[data-testid="page-library"]')
      await page.waitForSelector('[data-testid="source-count"], [data-testid="library-upload"]')
      const before = await page.locator('[data-testid="source-row"]').count()
      await safe(() => page.locator('[data-testid="library-upload"]').hover())
      await sleep(700)
      await uploadFixture(page)
      // 观察 queued → parsing → embedding → ready 的实际状态序列
      const seen = await watchStatuses(page, 6000)
      console.log(`[S03] status badges observed: ${seen.join(' -> ') || '(none)'}`)
      // 等新行出现并变成 ready（最多 12s）
      await safe(() =>
        page.waitForFunction(
          (n) => document.querySelectorAll('[data-testid="source-row"]').length > n,
          before,
          { timeout: 12000 },
        ),
      )
      await safe(() =>
        page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll('[data-testid="status-badge"]')).some(
              (el) => el.getAttribute('data-status') === 'ready',
            ),
          { timeout: 12000 },
        ),
      )
      await hoverSequence(page, '[data-testid="source-row"]', 4, 1200)
      await scrollMain(page, 180, 3)
      await fillTime(page, startedAt, 24)
    },
  },

  {
    id: 'S04',
    name: '资料详情生成笔记与知识树',
    route: '/library/{sourceId}',
    targetSeconds: 24,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('[data-testid="page-source-detail"]')
      await page.waitForSelector('[data-testid="tree-node"]', { timeout: 20000 })
      await safe(() => page.locator('[data-testid="source-generate-notes"]').hover())
      await sleep(900)
      // 真实点击「生成笔记」；不阻塞等待整个生成过程
      await safe(() => page.locator('[data-testid="source-generate-notes"]').click())
      await sleep(1500)
      // 知识树节点逐个悬停（点击会跳转详情，悬停保持在本页）
      const nodes = page.locator('[data-testid="tree-node"]')
      for (let round = 0; round < 3; round += 1) {
        const n = Math.min(await nodes.count(), 7)
        for (let i = 0; i < n; i += 1) {
          await safe(() => nodes.nth(i).hover())
          await sleep(650)
        }
      }
      await scrollMain(page, 220, 4)
      await scrollMain(page, -180, 3)
      await fillTime(page, startedAt, 24)
    },
  },

  {
    id: 'S05',
    name: '思维导图平移缩放',
    route: '/prep?tab=mindmap',
    targetSeconds: 26,
    run: async (page) => {
      const startedAt = Date.now()
      const select = page.locator('[data-testid="mindmap-source-select"]')
      await select.waitFor({ state: 'visible', timeout: 20000 })
      await safe(() => select.selectOption(FIXTURES.sourceId))
      await sleep(1200)
      await page.waitForSelector('[data-testid="mindmap-node"]', { timeout: 20000 })
      // 放大 / 缩小，观察节点整体缩放
      for (let i = 0; i < 3; i += 1) {
        await safe(() => page.getByRole('button', { name: '放大' }).click())
        await sleep(800)
      }
      await hoverSequence(page, '[data-testid="mindmap-node"]', 6, 800)
      for (let i = 0; i < 3; i += 1) {
        await safe(() => page.getByRole('button', { name: '缩小' }).click())
        await sleep(800)
      }
      await hoverSequence(page, '[data-testid="mindmap-node"]', 5, 850)
      // 平移：在画布上拖动鼠标
      await safe(async () => {
        await page.mouse.move(950, 520)
        await page.mouse.down()
        await page.mouse.move(1180, 420, { steps: 18 })
        await page.mouse.up()
      })
      await sleep(900)
      await fillTime(page, startedAt, 26)
    },
  },

  {
    id: 'S06',
    name: '知识点 SSE 讲解与风格切换',
    route: '/kp/{kpId}',
    targetSeconds: 24,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('[data-testid="kp-title"]', { timeout: 20000 })
      const style = page.locator('[data-testid="explain-style"]')
      const agent = page.locator('[data-testid="explain-agent"]')
      await style.waitFor({ state: 'visible' })
      // 选一次 Agent 再切回服务端默认，避免录制依赖外部密钥服务
      await safe(async () => {
        const options = await agent.locator('option').all()
        if (options.length > 1) {
          await agent.selectOption({ index: 1 })
          await sleep(1100)
          await agent.selectOption('')
          await sleep(700)
        }
      })
      await safe(() => style.selectOption('concise'))
      await sleep(600)
      await page.locator('[data-testid="explain-start"]').click()
      // 等 SSE token 真正写进 explain-output
      await safe(() =>
        page.waitForFunction(
          () => (document.querySelector('[data-testid="explain-output"]')?.textContent ?? '').length > 12,
          { timeout: 20000 },
        ),
      )
      await sleep(6000)
      // 切到「举例」风格，重新跑一次短段（会清空旧输出）
      await safe(() => style.selectOption('example'))
      await sleep(1000)
      await page.locator('[data-testid="explain-start"]').click()
      await sleep(7000)
      await safe(() => page.locator('[data-testid="explain-output"]').scrollIntoViewIfNeeded())
      await sleep(1200)
      await fillTime(page, startedAt, 24)
    },
  },

  {
    id: 'S07',
    name: '陪练答题与结果页',
    route: '/prep?tab=practice',
    targetSeconds: 22,
    run: async (page) => {
      const startedAt = Date.now()
      // PrepPage 的 practice/review/dashboard 实际走路径路由，这里真实点击标签切过去
      await page.waitForSelector('text=陪练', { timeout: 20000 })
      await clickTab(page, '陪练')
      await page.waitForSelector('[data-testid="page-practice"]', { timeout: 20000 })
      await page.waitForSelector('label[data-testid^="practice-kp-"]', { timeout: 20000 })
      // 选一个确实有题目的知识点（否则后端 409 NO_QUESTIONS）
      await safe(async () => {
        const search = page.locator('[data-testid="practice-kp-search"]')
        if ((await search.count()) > 0 && FIXTURES.practiceKpTitle) {
          await search.fill(FIXTURES.practiceKpTitle.slice(0, 6))
          await sleep(600)
        }
        const rows = page.locator('label[data-testid^="practice-kp-"]')
        const total = await rows.count()
        let picked = false
        if (FIXTURES.practiceKpTitle) {
          for (let i = 0; i < total; i += 1) {
            const text = (await rows.nth(i).innerText().catch(() => '')) ?? ''
            if (text.includes(FIXTURES.practiceKpTitle)) {
              const box = rows.nth(i).locator('input[type="checkbox"]')
              if ((await box.count()) > 0) await box.check({ timeout: 5000 })
              else await rows.nth(i).click({ timeout: 5000 })
              picked = true
              break
            }
          }
        }
        if (!picked) {
          const box = rows.first().locator('input[type="checkbox"]')
          if ((await box.count()) > 0) await box.check({ timeout: 5000 })
          else await rows.first().click({ timeout: 5000 })
        }
      })
      await safe(() => page.locator('[data-testid="practice-start"]').waitFor({ state: 'visible' }))
      await sleep(700)
      await safe(() => page.locator('[data-testid="practice-difficulty-hard"]').click())
      await sleep(700)
      await safe(async () => {
        const count = page.locator('[data-testid="practice-count-input"]')
        await count.fill('3')
      })
      await sleep(700)
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="practice-start"]')
          return btn instanceof HTMLButtonElement && !btn.disabled
        },
        { timeout: 20000 },
      )
      await page.locator('[data-testid="practice-start"]').click({ timeout: 15000 })
      await page.waitForSelector('[data-testid="practice-question"]', { timeout: 30000 })
      await sleep(900)

      // 逐题作答 3 题
      for (let q = 0; q < 3; q += 1) {
        const option = page.locator('[data-testid="practice-option"]').first()
        if ((await option.count()) > 0) {
          await safe(() => option.click())
        } else {
          const answer = page.locator('[data-testid="practice-answer-input"]').first()
          if ((await answer.count()) > 0) await safe(() => answer.fill('减值迹象包括市价下跌、债务人财务困难等。'))
        }
        await sleep(900)
        await safe(() => page.locator('[data-testid="practice-submit"]').click())
        // 等这一题的解析卡出现
        await safe(() =>
          page.waitForFunction(
            (n) => document.querySelectorAll('[data-testid="practice-result"]').length > n,
            q,
            { timeout: 15000 },
          ),
        )
        await sleep(1500)
      }
      // 结束练习 → 成绩页
      await safe(() => page.locator('[data-testid="practice-end"]').click())
      await safe(() => page.waitForSelector('[data-testid="practice-summary"]', { timeout: 15000 }))
      await scrollMain(page, 220, 4)
      await fillTime(page, startedAt, 22)
    },
  },

  {
    id: 'S08',
    name: '间隔复习翻卡评分',
    route: '/prep?tab=review',
    targetSeconds: 20,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('text=间隔复习', { timeout: 20000 })
      await clickTab(page, '间隔复习')
      await page.waitForSelector('[data-testid="review-card"]', { timeout: 20000 })
      // 连续复习 3 张卡：翻面 → 评分
      for (let i = 0; i < 3; i += 1) {
        await safe(() => page.locator('[data-testid="review-card"]').click())
        await sleep(1300)
        await safe(() => page.locator('[data-testid="review-answer"]').waitFor({ state: 'visible' }))
        await sleep(1000)
        const rating = page.locator('[data-testid="rating-4"]')
        if ((await rating.count()) > 0) {
          await safe(() => rating.click())
        } else {
          await safe(() => page.locator('[data-testid^="rating-"]').first().click())
        }
        await sleep(2200)
      }
      await scrollMain(page, 260, 4)
      await fillTime(page, startedAt, 20)
    },
  },

  {
    id: 'S09',
    name: '排行榜 Podium 与名次',
    route: '/rank',
    targetSeconds: 20,
    run: async (page) => {
      const startedAt = Date.now()
      // 先等竞赛下拉可用，再切到主竞赛（4 名学生）——podium 只有 ≥3 人才渲染。
      await page.waitForFunction(
        () => document.body.innerText.includes('积分') || document.body.innerText.includes('暂无竞赛'),
        { timeout: 25000 },
      )
      await sleep(1200)
      await safe(async () => {
        const trigger = page.locator('button').filter({ hasText: '财务会计' }).first()
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 5000 })
          await sleep(700)
          const option = page.getByRole('option').filter({ hasText: '财务会计班级联赛' }).first()
          if ((await option.count()) > 0) await option.click({ timeout: 5000 })
          await sleep(1600)
        }
      })
      await page.waitForSelector('[data-testid="leaderboard-runner"]', { timeout: 25000 })
      const rows = page.locator('[data-user-id]')
      await safe(() => rows.first().hover())
      await sleep(1200)
      // 悬停领奖台与 4 行名次
      const n = Math.min(await rows.count(), 7)
      for (let i = 0; i < n; i += 1) {
        await safe(() => rows.nth(i).hover())
        await sleep(900)
      }
      await scrollMain(page, 260, 5)
      await sleep(1500)
      await scrollMain(page, -240, 4)
      await fillTime(page, startedAt, 20)
    },
  },

  {
    id: 'S10',
    name: '个人中心与 Agent 掩码',
    route: '/profile',
    targetSeconds: 16,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('[data-testid="profile-records"]', { timeout: 25000 })
      await page.waitForSelector('[data-testid="profile-stats"]')
      await safe(() => page.locator('[data-testid="profile-records"]').scrollIntoViewIfNeeded())
      await sleep(900)
      // 打开修改密码对话框（不提交），再关闭
      await safe(() => page.locator('[data-testid="settings-change-password"]').click())
      await safe(() => page.locator('[data-testid="profile-password-dialog"]').waitFor({ state: 'visible' }))
      await sleep(1800)
      await safe(() => page.getByRole('button', { name: '取消', exact: true }).click())
      await sleep(900)
      // 进入 Agent 设置，展示密钥掩码
      await safe(() => page.locator('[data-testid="profile-agent-settings"]').click())
      await safe(() => page.waitForSelector('[data-testid="agent-key-masked"]', { timeout: 15000 }))
      await safe(() => page.locator('[data-testid="agent-key-masked"]').hover())
      await sleep(1600)
      await scrollMain(page, 140, 3)
      await fillTime(page, startedAt, 16)
    },
  },

  {
    id: 'S11',
    name: '学习看板图表滚动',
    route: '/prep?tab=dashboard',
    targetSeconds: 16,
    run: async (page) => {
      const startedAt = Date.now()
      await page.waitForSelector('text=学习看板', { timeout: 20000 })
      await clickTab(page, '学习看板')
      await page.waitForSelector('[data-testid="dashboard-kpis"]', { timeout: 25000 })
      await safe(() => page.waitForSelector('[data-testid="radar-svg"], [data-testid="radar-empty"]'))
      await safe(() => page.locator('[data-testid="heatmap-cell"]').first().hover())
      await sleep(900)
      await hoverIfPresent(page, '[data-testid="radar-polygon"]')
      await sleep(900)
      await scrollMain(page, 260, 5)
      await hoverIfPresent(page, '[data-testid="curve-point"]')
      await sleep(1200)
      await scrollMain(page, -260, 4)
      await fillTime(page, startedAt, 16)
    },
  },
]
