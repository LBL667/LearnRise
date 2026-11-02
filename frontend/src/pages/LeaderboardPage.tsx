import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Crown } from 'lucide-react'
import { api } from '@/api/client'
import { tierLogos } from '@/api/mock/mockData'
import type { Competition, LeaderboardEntry } from '@/api/types'
import { useToast } from '@/components/ui/Toast'
import goldRankLogo from '../../rank_number/1.png'
import silverRankLogo from '../../rank_number/2.png'
import bronzeRankLogo from '../../rank_number/3.png'
import goldAvatarFrame from '../../rank_number/avatar_border_gold_transparent.png'
import silverAvatarFrame from '../../rank_number/avatar_border_silver_transparent.png'
import bronzeAvatarFrame from '../../rank_number/avatar_border_bronze_transparent.png'

/* ==================== 排名徽章 ==================== */

const RANK_LOGOS: Record<number, string> = {
  1: goldRankLogo,
  2: silverRankLogo,
  3: bronzeRankLogo,
}

function RankLogo({ rank, size = 96 }: { rank: number; size?: number }) {
  return (
    <img
      src={RANK_LOGOS[rank]}
      alt={`第 ${rank} 名`}
      width={size}
      height={size}
      className="shrink-0 select-none object-contain"
      draggable={false}
    />
  )
}

/* ==================== 榜单 ==================== */

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function TierBadge({ tier, division }: { tier: string; division: string }) {
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

function PlainAvatar({ name, hue, size = 44 }: { name: string; hue: number; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 82% 68%), hsl(${(hue + 40) % 360} 74% 52%))`,
      }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

const AVATAR_FRAMES: Record<number, string> = {
  1: goldAvatarFrame,
  2: silverAvatarFrame,
  3: bronzeAvatarFrame,
}

// 头像框图片的装饰形状不同，圆心并不都在图片的正中心。
const AVATAR_FRAME_LAYOUT: Record<number, { x: number; y: number; scale: number }> = {
  1: { x: 0.495, y: 0.542, scale: 0.63 },
  2: { x: 0.502, y: 0.506, scale: 0.65 },
  3: { x: 0.503, y: 0.488, scale: 0.67 },
}

function RankedAvatar({ name, hue, rank, size }: { name: string; hue: number; rank: number; size: number }) {
  const frame = AVATAR_FRAMES[rank]
  if (!frame) return <PlainAvatar name={name} hue={hue} size={size} />
  const layout = AVATAR_FRAME_LAYOUT[rank]

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${layout.x * 100}%`, top: `${layout.y * 100}%` }}>
        <PlainAvatar name={name} hue={hue} size={size * layout.scale} />
      </span>
      <img src={frame} alt="" aria-hidden="true" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />
    </span>
  )
}

function CompetitionPicker({ competitions, value, onChange }: { competitions: Competition[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const selected = competitions.find((competition) => competition.id === value)
  return (
    <div ref={rootRef} className="competition-picker" onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
      if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
        const current = options.indexOf(document.activeElement as HTMLButtonElement)
        const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        options[next]?.focus()
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button ref={triggerRef} type="button" className="competition-picker__trigger" aria-label="选择赛事" aria-haspopup="listbox" aria-expanded={open} aria-controls="competition-options" onClick={() => setOpen(!open)}>
        <span className="competition-picker__label">{selected?.title ?? '选择赛事'}</span>
        <ChevronDown size={16} className={`competition-picker__chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      <div id="competition-options" role="listbox" aria-label="赛事列表" aria-hidden={!open} inert={!open} className={`competition-picker__menu ${open ? 'is-open' : ''}`}>
        {competitions.map((competition) => (
          <button key={competition.id} type="button" role="option" aria-selected={competition.id === value} className="competition-picker__option" onClick={() => {
            onChange(competition.id)
            setOpen(false)
            triggerRef.current?.focus()
          }}>
            <span>{competition.title}</span>
            {competition.id === value && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [competitionId, setCompetitionId] = useState('comp-001')
  const { showToast } = useToast()

  useEffect(() => {
    void (async () => {
      const list = await api.listCompetitions()
      setCompetitions(list)
      if (list.length > 0) setCompetitionId(list[0].id)
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      setEntries(await api.getLeaderboard(competitionId))
    })()
  }, [competitionId])

  const sortedEntries = [...entries].sort((a, b) => a.rank - b.rank)
  const champion = sortedEntries.find((entry) => entry.rank === 1)
  const runnersUp = sortedEntries.filter((entry) => entry.rank === 2 || entry.rank === 3)
  const rest = sortedEntries.filter((entry) => entry.rank > 3)

  return (
    <div className="relative w-full px-6 py-6">
      {/* 页面底部山峦大背景 */}
      <img
        src="/misty-mountains.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-0 h-[190px] w-full select-none object-cover object-bottom"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 70%)',
        }}
        draggable={false}
      />

      <div className="relative z-10">
        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown size={26} className="fill-primary text-primary" />
            <h1 className="text-xl font-bold text-ink">排行榜</h1>
            <span className="ml-1 text-[13px] text-ink-mute">见证每一位探索者的成长与绽放</span>
          </div>
          <CompetitionPicker competitions={competitions} value={competitionId} onChange={setCompetitionId} />
        </div>

        {/* 榜首大卡 */}
        {champion && (
          <section className="champion-card relative mt-5 overflow-hidden rounded-[16px] border border-[#f0e0b8] bg-gradient-to-r from-[#fbf1d3] via-[#fdf8e9] to-[#f4f9ff]">
            <img
              src="/misty-mountains.jpg"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 h-full w-[58%] select-none object-cover object-bottom opacity-80"
              style={{
                maskImage: 'linear-gradient(to left, black 45%, transparent 100%), linear-gradient(to bottom, transparent, black 35%)',
                maskComposite: 'intersect',
                WebkitMaskImage: 'linear-gradient(to left, black 45%, transparent 100%), linear-gradient(to bottom, transparent, black 35%)',
                WebkitMaskComposite: 'source-in',
              }}
              draggable={false}
            />
            <div className="relative z-10 flex items-center gap-8 px-10 py-4">
              <RankLogo rank={1} size={104} />
              <RankedAvatar name={champion.name} hue={champion.avatarHue} rank={champion.rank} size={112} />
              <div className="min-w-0">
                <div className="truncate text-[19px] font-bold text-ink">{champion.name}</div>
                <div className="mt-2">
                  <TierBadge tier={champion.tier} division={champion.division} />
                </div>
              </div>
              <div className="mx-3 h-14 w-px bg-[#e8d9ac]" />
              <div className="ml-auto shrink-0 pr-6">
                <span className="text-[15px] text-ink-soft">积分 </span>
                <span className="text-[34px] font-bold leading-none text-primary">{fmt(champion.points)}</span>
              </div>
            </div>
          </section>
        )}

        {/* 2 / 3 名 */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          {runnersUp.map((e) => (
            <div key={e.rank} className="card flex items-center gap-4 px-6 py-4">
              <RankLogo rank={e.rank} size={76} />
              <RankedAvatar name={e.name} hue={e.avatarHue} rank={e.rank} size={76} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-ink">{e.name}</div>
                <div className="mt-1.5">
                  <TierBadge tier={e.tier} division={e.division} />
                </div>
              </div>
              <div className="shrink-0 pr-1 text-right">
                <span className="text-[13px] text-ink-soft">积分 </span>
                <span className="text-[22px] font-bold text-primary">{fmt(e.points)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 4-9 名 */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          {rest.slice(0, 6).map((e) => (
            <div key={e.rank} className="card flex items-center gap-4 px-6 py-3.5">
              <span className="w-8 shrink-0 text-center text-[22px] font-bold text-ink-soft">{e.rank}</span>
              <PlainAvatar name={e.name} hue={e.avatarHue} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-ink">{e.name}</div>
                <div className="mt-0.5">
                  <TierBadge tier={e.tier} division={e.division} />
                </div>
              </div>
              <div className="shrink-0 pr-1 text-right">
                <span className="text-[12.5px] text-ink-soft">积分 </span>
                <span className="text-[18px] font-bold text-primary">{fmt(e.points)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 第 10 名：通栏 */}
        {rest[6] && (
          <div className="card mt-4 flex items-center gap-4 px-6 py-3.5">
            <span className="w-8 shrink-0 text-center text-[22px] font-bold text-ink-soft">{rest[6].rank}</span>
            <PlainAvatar name={rest[6].name} hue={rest[6].avatarHue} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-ink">{rest[6].name}</div>
              <div className="mt-0.5">
                <TierBadge tier={rest[6].tier} division={rest[6].division} />
              </div>
            </div>
            <button className="btn-ghost h-8 shrink-0 px-3" onClick={() => showToast('完整榜单即将上线')}>
              查看完整榜单
            </button>
            <div className="shrink-0 pr-1 text-right">
              <span className="text-[12.5px] text-ink-soft">积分 </span>
              <span className="text-[18px] font-bold text-primary">{fmt(rest[6].points)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
