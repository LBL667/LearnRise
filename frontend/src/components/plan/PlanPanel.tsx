import { CalendarClock, Clock, Gift, Trophy, Users } from 'lucide-react'
import type { CompetitionPlan } from '@/api/types'
import { Roadmap } from './Roadmap'

const MEDAL = ['bg-gold', 'bg-silver', 'bg-bronze']

function StatBlock({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  iconClass = 'text-primary',
}: {
  icon: typeof Clock
  label: string
  value: string
  unit?: string
  sub?: string
  iconClass?: string
}) {
  return (
    <div className="min-w-0 shrink-0 px-5 first:pl-1">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-soft">
        <Icon size={15} className={iconClass} />
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[26px] font-bold leading-none text-primary">{value}</span>
        {unit && <span className="whitespace-nowrap text-[13px] text-ink-soft">{unit}</span>}
      </div>
      {sub && <div className="mt-1 whitespace-nowrap text-[12px] text-ink-mute">{sub}</div>}
    </div>
  )
}

interface PlanPanelProps {
  plan: CompetitionPlan
}

export function PlanPanel({ plan }: PlanPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* 统计行 */}
      <section className="card flex items-stretch py-5">
        <StatBlock
          icon={Clock}
          label="距离竞赛开始"
          value={String(plan.stats.daysToStart)}
          unit="天"
          sub={plan.stats.startAt}
        />
        <div className="w-px bg-line" />
        <StatBlock
          icon={CalendarClock}
          label="距离竞赛结束"
          value={String(plan.stats.daysToEnd)}
          unit="天"
          sub={plan.stats.endAt}
        />
        <div className="w-px bg-line" />
        <StatBlock
          icon={Users}
          label="预计获奖名额"
          value={String(plan.stats.awardQuota)}
          unit="名"
        />
        <div className="w-px bg-line" />
        <div className="min-w-0 flex-1 px-5 pr-1">
          <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
            <Trophy size={15} className="text-gold" />
            前三奖励
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.rewards.slice(0, 3).map((r) => (
              <div key={r.rank} className="flex items-center gap-1.5 rounded-lg bg-[#f6f8fc] p-1.5 pr-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                    MEDAL[r.rank - 1] ?? 'bg-ink-mute'
                  }`}
                >
                  {r.rank}
                </span>
                {r.imageUrl ? (
                  <img src={r.imageUrl} alt={r.name} className="h-7 w-7 rounded-md object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-ink-mute">
                    <Gift size={13} />
                  </span>
                )}
                <span className="leading-tight">
                  <span className="block text-[11px] font-semibold text-ink">第{r.rank}名</span>
                  <span className="block max-w-[60px] truncate text-[10px] text-ink-mute">{r.name}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 规划图 */}
      <section className="card p-6">
        <h3 className="text-[15px] font-bold text-ink">规划图</h3>
        <p className="mt-1 text-[13px] text-ink-mute">{plan.intro}</p>
        <div className="mt-4">
          <Roadmap stages={plan.stages} />
        </div>
      </section>
    </div>
  )
}
