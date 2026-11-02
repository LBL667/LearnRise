import { tierLogos } from '@/assets/tierLogos'
import type { LeaderboardEntry } from '@/api/types'
import { AvatarImage } from './LaurelAvatar'

export function formatPoints(points: number): string {
  return points.toLocaleString('en-US')
}

export function TierBadge({ tier, division }: { tier: string; division: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-mute">
      <img
        src={tierLogos[tier] ?? tierLogos['初识']}
        alt=""
        aria-hidden="true"
        className="h-[18px] w-[18px] select-none rounded-full object-cover"
        draggable={false}
      />
      {tier}
      <span className="font-medium text-ink-soft">{division}</span>
    </span>
  )
}

export function RankRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      className="card flex items-center gap-4 px-6 py-3.5"
      data-user-id={entry.userId}
    >
      <span
        data-testid="rank-label"
        aria-label={`第 ${entry.rank} 名`}
        className="w-8 shrink-0 text-center text-[22px] font-bold text-ink-soft"
      >
        {entry.rank}
      </span>
      <AvatarImage name={entry.name} hue={entry.avatarHue} size={44} avatarUrl={entry.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{entry.name}</div>
        <div className="mt-0.5">
          <TierBadge tier={entry.tier} division={entry.division} />
        </div>
      </div>
      <div className="shrink-0 pr-1 text-right">
        <span className="text-[12.5px] text-ink-soft">积分 </span>
        <span className="text-[18px] font-bold text-primary">{formatPoints(entry.points)}</span>
      </div>
    </div>
  )
}
