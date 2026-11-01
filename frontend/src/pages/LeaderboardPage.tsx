import { useEffect, useState } from 'react'
import { ChevronDown, Crown } from 'lucide-react'
import { api } from '@/api/client'
import { tierLogos } from '@/assets/tierLogos'
import type { Competition, LeaderboardEntry } from '@/api/types'
import { useToast } from '@/components/ui/Toast'

/* ==================== 月桂冠装饰 ==================== */

const LAUREL_COLOR: Record<number, { main: string; light: string; crown?: string }> = {
  1: { main: '#d9a53f', light: '#f0c96b', crown: '#f2b93c' },
  2: { main: '#9fb0c6', light: '#c2cfe0' },
  3: { main: '#c98d52', light: '#e3ad75' },
}

/**
 * 月桂叶弧：在 viewBox 120x120 内，沿半径 R 的圆弧摆放一串叶片。
 * side=left 从底部向左上绕，right 镜像。叶片沿切线方向旋转。
 */
function LaurelLeaves({ side, color, r = 52 }: { side: 'left' | 'right'; color: { main: string; light: string }; r?: number }) {
  const n = 10
  const leaves = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    // 左枝：从 210° 扫到 105°；右枝：从 -30° 扫到 75°
    const deg = side === 'left' ? 210 - t * 105 : -30 + t * 105
    const rad = (deg * Math.PI) / 180
    const cx = 60 + r * Math.cos(rad)
    const cy = 62 - r * Math.sin(rad) * 0.96
    const rot = side === 'left' ? deg - 90 : deg + 90
    const big = 1 - Math.abs(t - 0.5) * 0.4
    leaves.push(
      <ellipse
        key={i}
        cx={cx}
        cy={cy}
        rx={9 * big}
        ry={3.6 * big}
        fill={i % 2 === 0 ? color.main : color.light}
        opacity={0.94}
        transform={`rotate(${rot} ${cx} ${cy})`}
      />,
    )
  }
  return <>{leaves}</>
}

/** 月桂冠头像框（1/2/3 名）：头像 + 金/银/铜月桂环绕；榜首带皇冠 */
function LaurelAvatar({ name, hue, rank, size = 108 }: { name: string; hue: number; rank: number; size?: number }) {
  const color = LAUREL_COLOR[rank] ?? LAUREL_COLOR[2]
  const showCrown = rank === 1
  const avatarSize = size * 0.58
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="absolute inset-0" aria-hidden="true">
        <LaurelLeaves side="left" color={color} />
        <LaurelLeaves side="right" color={color} />
      </svg>
      <span
        className="absolute inline-flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: avatarSize,
          height: avatarSize,
          left: (size - avatarSize) / 2,
          top: (size - avatarSize) / 2 + size * 0.02,
          fontSize: avatarSize * 0.38,
          background: `linear-gradient(135deg, hsl(${hue} 82% 68%), hsl(${(hue + 40) % 360} 74% 52%))`,
          boxShadow: `0 0 0 3px #fff, 0 0 0 4px ${color.main}66`,
        }}
      >
        {name.slice(0, 1)}
      </span>
      {showCrown && (
        <span
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: -size * 0.1, color: color.crown }}
          aria-hidden="true"
        >
          <Crown size={size * 0.3} fill="currentColor" strokeWidth={1.2} />
        </span>
      )}
    </span>
  )
}

/** 月桂数字徽章（1/2/3 名）：月桂环绕中的大号渐变数字 */
function LaurelNumber({ rank, size = 96 }: { rank: number; size?: number }) {
  const color = LAUREL_COLOR[rank] ?? LAUREL_COLOR[2]
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 120 120" width={size} height={size} className="absolute inset-0">
        <LaurelLeaves side="left" color={color} r={46} />
        <LaurelLeaves side="right" color={color} r={46} />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-black leading-none"
        style={{
          fontSize: size * 0.5,
          background: `linear-gradient(to bottom, ${color.light}, ${color.main})`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {rank}
      </span>
    </span>
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

  const champion = entries[0]
  const runnersUp = entries.slice(1, 3)
  const rest = entries.slice(3)

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
          <div className="relative">
            <select
              className="field-input h-9 w-56 appearance-none pr-8"
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          </div>
        </div>

        {/* 榜首大卡 */}
        {champion && (
          <section className="relative mt-5 overflow-hidden rounded-[16px] border border-[#f0e0b8] bg-gradient-to-r from-[#fbf1d3] via-[#fdf8e9] to-[#f4f9ff]">
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
              <LaurelNumber rank={1} size={104} />
              <LaurelAvatar name={champion.name} hue={champion.avatarHue} rank={1} size={112} />
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
              <LaurelNumber rank={e.rank} size={64} />
              <LaurelAvatar name={e.name} hue={e.avatarHue} rank={e.rank} size={76} />
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
