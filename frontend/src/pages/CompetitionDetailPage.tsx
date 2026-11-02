import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, parseApiDetail } from '@/api/client'
import { generatePlan } from '@/api/plans'
import type { Competition, CompetitionPlan, Member } from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { MembersPanel } from '@/components/members/MembersPanel'
import { PlanPanel } from '@/components/plan/PlanPanel'
import { useToast } from '@/components/ui/Toast'

const POLL_INTERVAL_MS = 1_500
const POLL_TIMEOUT_MS = 90_000

function describePlanGenerateError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '仅队长可生成规划'
    if (error.status === 409 && (error.code === 'NO_SOURCE' || error.code === 'NO_CONTEXT')) {
      return '请先在建赛时绑定资料'
    }
    return parseApiDetail(error.detail).message
  }
  return '学习规划生成失败，请稍后重试'
}

type TabKey = 'members' | 'plan'

export default function CompetitionDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [competition, setCompetition] = useState<Competition | undefined>()
  const [members, setMembers] = useState<Member[]>([])
  const [plan, setPlan] = useState<CompetitionPlan | undefined>()
  const [tab, setTab] = useState<TabKey>('members')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [planError, setPlanError] = useState('')
  const { showToast } = useToast()
  const aliveRef = useRef(true)
  const autoResumedRef = useRef(false)
  const pollTimer = useRef<number | null>(null)
  const pollDeadline = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    autoResumedRef.current = false
    return () => {
      aliveRef.current = false
      stopPolling()
    }
  }, [id, stopPolling])

  const pollPlan = useCallback(() => {
    stopPolling()
    const tick = async () => {
      if (!aliveRef.current) return
      if (Date.now() > pollDeadline.current) {
        setGenerating(false)
        setPlanError('规划生成超时，请稍后刷新查看')
        return
      }
      try {
        const latest = await api.getCompetition(id)
        if (!aliveRef.current) return
        if (!latest) {
          pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS)
          return
        }
        setCompetition(latest)
        if (latest.planStatus === 'ready') {
          try {
            const nextPlan = await api.getPlan(id)
            if (!aliveRef.current) return
            setPlan(nextPlan)
            setPlanError('')
            showToast('学习规划已生成', 'success')
          } catch (error) {
            if (!aliveRef.current) return
            setPlanError(
              error instanceof ApiError
                ? parseApiDetail(error.detail).message
                : '学习规划读取失败，请刷新重试',
            )
          }
          setGenerating(false)
          return
        }
        if (latest.planStatus === 'failed') {
          setGenerating(false)
          setPlanError('学习规划生成失败，请稍后重试')
          return
        }
        pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS)
      } catch (error) {
        if (!aliveRef.current) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
          setGenerating(false)
          setPlanError(parseApiDetail(error.detail).message)
          return
        }
        pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }
    }
    void tick()
  }, [id, showToast, stopPolling])

  const handleGeneratePlan = useCallback(async () => {
    if (generating) return
    setPlanError('')
    setGenerating(true)
    autoResumedRef.current = true
    try {
      await generatePlan(id)
      if (!aliveRef.current) return
      setCompetition((prev) => (prev ? { ...prev, planStatus: 'generating' } : prev))
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
      pollPlan()
    } catch (error) {
      if (!aliveRef.current) return
      setGenerating(false)
      setPlanError(describePlanGenerateError(error))
    }
  }, [generating, id, pollPlan])

  useEffect(() => {
    if (autoResumedRef.current) return
    if (competition?.planStatus !== 'generating') return
    autoResumedRef.current = true
    setGenerating(true)
    pollDeadline.current = Date.now() + POLL_TIMEOUT_MS
    pollPlan()
  }, [competition?.planStatus, pollPlan])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setNotFound(false)
    void (async () => {
      const [comp, mem, pln] = await Promise.allSettled([
        api.getCompetition(id),
        api.listMembers(id),
        api.getPlan(id),
      ])
      if (cancelled) return

      if (comp.status === 'rejected') {
        const reason = comp.reason
        if (reason instanceof ApiError && reason.status === 404) {
          setNotFound(true)
        } else {
          setError(reason instanceof ApiError ? reason.detail : '竞赛详情加载失败，请稍后重试')
        }
        setLoading(false)
        return
      }

      setCompetition(comp.value)
      setMembers(mem.status === 'fulfilled' ? mem.value : [])
      setPlan(pln.status === 'fulfilled' ? pln.value : undefined)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  if (loading) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center text-sm text-ink-mute">正在加载竞赛详情…</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-soft">竞赛不存在，或你没有权限查看。</p>
          <button className="btn-ghost mt-4" onClick={() => navigate('/')}>
            返回竞赛空间
          </button>
        </div>
      </div>
    )
  }

  if (error || !competition) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center">
          <p className="text-sm text-[#e25050]">{error || '竞赛详情加载失败'}</p>
          <button className="btn-ghost mt-4" onClick={() => setReloadKey((key) => key + 1)}>
            重新加载
          </button>
        </div>
      </div>
    )
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'members', label: '学习成员' },
    { key: 'plan', label: '学习规划' },
  ]

  return (
    <div className="w-full px-6 py-6">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-0.5 text-[13px] text-ink-soft transition hover:text-primary"
      >
        <ChevronLeft size={16} />
        返回
      </button>

      {/* 竞赛信息卡 */}
      <section className="card mt-3 flex items-center gap-5 p-4">
        <CoverArt variant={competition.cover} className="h-[110px] w-[190px] rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold text-ink">{competition.title}</h1>
          </div>
          <p className="mt-1 truncate text-[13px] text-ink-soft">{competition.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
            <span className="text-ink-soft">
              主办方 <span className="ml-1 font-medium text-ink">{competition.host}</span>
            </span>
            <span className="text-ink-soft">
              人数{' '}
              <span className="ml-1 font-medium text-ink">
                {competition.memberCount}/{competition.capacity ? competition.capacity : '不限'}
              </span>
            </span>
            <span className="text-ink-soft">
              开始时间 <span className="ml-1 font-medium text-ink">{competition.startTime}</span>
            </span>
            <span className="text-ink-soft">
              结束时间 <span className="ml-1 font-medium text-ink">{competition.endTime}</span>
            </span>
            <span className="text-ink-soft">
              报名名额{' '}
              <span className="ml-1 font-medium text-[#c98a10]">{competition.awardQuota} 名</span>
            </span>
          </div>
        </div>
      </section>

      {/* 标签页 */}
      <div className="mt-4 border-b border-line">
        <div className="flex gap-8">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative pb-2.5 text-[14px] font-medium transition-colors ${
                tab === t.key ? 'text-primary' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="mt-5">
        {tab === 'members' ? (
          <MembersPanel
            competition={competition}
            members={members}
            onMembersChange={setMembers}
          />
        ) : (
          <PlanPanel
            competitionId={competition.id}
            plan={plan}
            canGenerate={
              competition.currentUserRole === 'leader' ||
              String(competition.currentUserRole ?? '') === 'owner'
            }
            planStatus={competition.planStatus}
            generating={generating}
            planError={planError}
            onGenerate={() => void handleGeneratePlan()}
          />
        )}
      </div>
    </div>
  )
}
