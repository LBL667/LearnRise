import { ArrowRight, CalendarDays, CalendarClock, Trophy, User, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Competition } from '@/api/types'
import { CoverArt } from './CoverArt'

function Meta({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[11px] text-ink-mute">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-ink">{value}</div>
    </div>
  )
}

export function CompetitionCard({ competition }: { competition: Competition }) {
  const navigate = useNavigate()

  return (
    <article
      data-testid="competition-card"
      className="card flex items-center gap-5 p-4 transition-shadow hover:shadow-[0_6px_24px_rgba(46,124,246,0.08)]">
      <CoverArt variant={competition.cover} className="h-[96px] w-[168px] rounded-xl" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[15px] font-bold text-ink">{competition.title}</h3>
        </div>
        <p className="mt-1 truncate text-[13px] text-ink-soft">{competition.description}</p>

        <div className="mt-3 grid grid-cols-5 gap-3">
          <Meta icon={User} label="主办方" value={competition.host} />
          <Meta icon={Users} label="人数" value={`${competition.memberCount}/${competition.capacity ? competition.capacity : '不限'}`} />
          <Meta icon={CalendarDays} label="开始时间" value={competition.startTime} />
          <Meta icon={CalendarClock} label="结束时间" value={competition.endTime} />
          <Meta icon={Trophy} label="获奖名额" value={`${competition.awardQuota} 名`} />
        </div>
      </div>

      <div className="flex shrink-0 items-center pr-1">
        <button className="btn-primary" onClick={() => navigate(`/competition/${competition.id}`)}>
          进入竞赛
          <ArrowRight size={15} />
        </button>
      </div>
    </article>
  )
}
