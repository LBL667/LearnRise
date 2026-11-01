import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import type { Competition, CompetitionPlan, Member } from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { MembersPanel } from '@/components/members/MembersPanel'
import { PlanPanel } from '@/components/plan/PlanPanel'

type TabKey = 'members' | 'plan'

export default function CompetitionDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [competition, setCompetition] = useState<Competition | undefined>()
  const [members, setMembers] = useState<Member[]>([])
  const [plan, setPlan] = useState<CompetitionPlan | undefined>()
  const [tab, setTab] = useState<TabKey>('members')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [comp, mem, pln] = await Promise.all([
        api.getCompetition(id),
        api.listMembers(id),
        api.getPlan(id),
      ])
      if (cancelled) return
      setCompetition(comp)
      setMembers(mem)
      setPlan(pln)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!competition || !plan) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center text-sm text-ink-mute">正在加载竞赛详情…</div>
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
                {competition.memberCount}/{competition.capacity}
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
          <PlanPanel plan={plan} />
        )}
      </div>
    </div>
  )
}
