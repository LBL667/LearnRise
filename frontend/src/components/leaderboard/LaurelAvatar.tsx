import goldNumber from '../../../rank_number/1.png'
import silverNumber from '../../../rank_number/2.png'
import bronzeNumber from '../../../rank_number/3.png'
import goldFrame from '../../../rank_number/avatar_border_gold_transparent.png'
import silverFrame from '../../../rank_number/avatar_border_silver_transparent.png'
import bronzeFrame from '../../../rank_number/avatar_border_bronze_transparent.png'

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

const frames: Record<number, { src: string; x: number; y: number; scale: number }> = {
  1: { src: goldFrame, x: .495, y: .542, scale: .63 },
  2: { src: silverFrame, x: .502, y: .506, scale: .65 },
  3: { src: bronzeFrame, x: .503, y: .488, scale: .67 },
}
const numbers: Record<number, string> = { 1: goldNumber, 2: silverNumber, 3: bronzeNumber }

export function LaurelAvatar({ name, hue, rank, size = 108, avatarUrl }: { name: string; hue: number; rank: number; size?: number; avatarUrl?: string | null }) {
  const frame = frames[rank]
  if (!frame) return <AvatarImage name={name} hue={hue} size={size} avatarUrl={avatarUrl} />
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full" style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%` }}>
        <AvatarImage name={name} hue={hue} size={size * frame.scale} avatarUrl={avatarUrl} />
      </span>
      <img src={frame.src} alt="" aria-hidden="true" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />
    </span>
  )
}

export function LaurelNumber({ rank, size = 96 }: { rank: number; size?: number }) {
  return <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
    <img src={numbers[rank]} alt="" aria-hidden="true" width={size} height={size} className="h-full w-full select-none object-contain" draggable={false} />
    <span className="sr-only" data-testid="rank-label" aria-label={`第 ${rank} 名`}>{rank}</span>
  </span>
}
