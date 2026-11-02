import type { LeaderboardEntry } from '@/api/types'
import { LaurelAvatar, LaurelNumber } from './LaurelAvatar'
import { formatPoints, TierBadge } from './RankRow'

export function Podium({
  champion,
  runnersUp,
}: {
  champion?: LeaderboardEntry
  runnersUp: LeaderboardEntry[]
}) {
  return (
    <>
      {champion && (
        <section
          className="relative mt-5 overflow-hidden rounded-[16px] border border-[#f0e0b8] bg-gradient-to-r from-[#fbf1d3] via-[#fdf8e9] to-[#f4f9ff]"
          data-user-id={champion.userId}
        >
          <img
            src="/misty-mountains.jpg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-0 h-[82%] w-[58%] select-none object-cover object-bottom opacity-85"
            style={{
              maskImage: 'linear-gradient(to left, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to left, black 60%, transparent 100%)',
            }}
            draggable={false}
          />
          <div className="relative z-10 flex items-center gap-8 px-10 py-7">
            <LaurelNumber rank={champion.rank} size={104} />
            <LaurelAvatar
              name={champion.name}
              hue={champion.avatarHue}
              rank={champion.rank}
              size={112}
              avatarUrl={champion.avatarUrl}
            />
            <div className="min-w-0">
              <div className="truncate text-[19px] font-bold text-ink">{champion.name}</div>
              <div className="mt-2">
                <TierBadge tier={champion.tier} division={champion.division} />
              </div>
            </div>
            <div className="mx-3 h-14 w-px bg-[#e8d9ac]" />
            <div className="ml-auto shrink-0 pr-6">
              <span className="text-[15px] text-ink-soft">积分 </span>
              <span className="text-[34px] font-bold leading-none text-primary">
                {formatPoints(champion.points)}
              </span>
            </div>
          </div>
        </section>
      )}

      {runnersUp.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          {runnersUp.map((entry) => (
            <div
              key={entry.userId}
              className="card flex items-center gap-4 px-6 py-4"
              data-testid="leaderboard-runner"
              data-user-id={entry.userId}
            >
              <LaurelNumber rank={entry.rank} size={64} />
              <LaurelAvatar
                name={entry.name}
                hue={entry.avatarHue}
                rank={entry.rank}
                size={76}
                avatarUrl={entry.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-ink">{entry.name}</div>
                <div className="mt-1.5">
                  <TierBadge tier={entry.tier} division={entry.division} />
                </div>
              </div>
              <div className="shrink-0 pr-1 text-right">
                <span className="text-[13px] text-ink-soft">积分 </span>
                <span className="text-[22px] font-bold text-primary">{formatPoints(entry.points)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
