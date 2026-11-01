/**
 * 按域声明数据来源：`real` 走 FastAPI，`mock` 走本地假数据。
 *
 * 切片迁移期间必须按域切换，不能再用一个全局布尔：一个域切到真接口时，
 * 其余域仍要能完整演示。每完成一个后端切片，就把对应域改成 `real`。
 */
export type DomainMode = 'real' | 'mock'

export type ApiDomain =
  | 'competitions'
  | 'assistant'
  | 'diagnostics'
  | 'mindmap'
  | 'trial'
  | 'profile'
  | 'leaderboard'

export const domainModes: Record<ApiDomain, DomainMode> = {
  competitions: 'real',
  assistant: 'mock',
  diagnostics: 'mock',
  mindmap: 'mock',
  trial: 'mock',
  profile: 'mock',
  leaderboard: 'mock',
}

export function isMockDomain(domain: ApiDomain): boolean {
  return domainModes[domain] === 'mock'
}
