import { Crown } from 'lucide-react'

type LaurelColor = { main: string; light: string; crown?: string }

const LAUREL_COLOR: Record<number, LaurelColor> = {
  1: { main: '#d9a53f', light: '#f0c96b', crown: '#f2b93c' },
  2: { main: '#9fb0c6', light: '#c2cfe0' },
  3: { main: '#c98d52', light: '#e3ad75' },
}

function colorFor(rank: number): LaurelColor {
  return LAUREL_COLOR[rank] ?? LAUREL_COLOR[2]
}

function LaurelLeaves({
  side,
  color,
  r = 52,
}: {
  side: 'left' | 'right'
  color: LaurelColor
  r?: number
}) {
  const leaves = []
  for (let i = 0; i < 10; i++) {
    const t = i / 9
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

function InitialAvatar({ name, hue, size }: { name: string; hue: number; size: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 82% 68%), hsl(${(hue + 40) % 360} 74% 52%))`,
      }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function AvatarImage({
  name,
  hue,
  size,
  avatarUrl,
}: {
  name: string
  hue: number
  size: number
  avatarUrl?: string | null
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        data-testid="avatar-image"
        className="inline-block rounded-full object-cover"
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return <InitialAvatar name={name} hue={hue} size={size} />
}

export function LaurelAvatar({
  name,
  hue,
  rank,
  size = 108,
  avatarUrl,
}: {
  name: string
  hue: number
  rank: number
  size?: number
  avatarUrl?: string | null
}) {
  const color = colorFor(rank)
  const avatarSize = size * 0.58
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="absolute inset-0" aria-hidden="true">
        <LaurelLeaves side="left" color={color} />
        <LaurelLeaves side="right" color={color} />
      </svg>
      <span
        className="absolute overflow-hidden rounded-full"
        style={{
          width: avatarSize,
          height: avatarSize,
          left: (size - avatarSize) / 2,
          top: (size - avatarSize) / 2 + size * 0.02,
          boxShadow: `0 0 0 3px #fff, 0 0 0 4px ${color.main}66`,
        }}
      >
        <AvatarImage name={name} hue={hue} size={avatarSize} avatarUrl={avatarUrl} />
      </span>
      {rank === 1 && (
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

export function LaurelNumber({ rank, size = 96 }: { rank: number; size?: number }) {
  const color = colorFor(rank)
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="absolute inset-0">
        <LaurelLeaves side="left" color={color} r={46} />
        <LaurelLeaves side="right" color={color} r={46} />
      </svg>
      <span
        data-testid="rank-label"
        className="absolute inset-0 flex items-center justify-center font-black leading-none"
        aria-label={`第 ${rank} 名`}
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
