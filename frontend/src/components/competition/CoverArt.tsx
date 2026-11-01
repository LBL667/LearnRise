import type { CoverVariant } from '@/api/types'

const COVERS: Record<CoverVariant, { background: string; glyph: string; glyphClass: string }> = {
  aurora: {
    background: 'linear-gradient(135deg,#cfe6ff 0%,#8fc0ff 55%,#6aa6ff 100%)',
    glyph: 'A+',
    glyphClass: 'text-white/45',
  },
  blackboard: {
    background: 'linear-gradient(135deg,#3f6a60 0%,#274a42 100%)',
    glyph: 'abc',
    glyphClass: 'text-white/60',
  },
  geometry: {
    background: 'linear-gradient(135deg,#eef5ff 0%,#c7ddf9 100%)',
    glyph: 'Q&A',
    glyphClass: 'text-primary/35',
  },
  wave: {
    background: 'linear-gradient(135deg,#123c7a 0%,#2e7cf6 100%)',
    glyph: '∞',
    glyphClass: 'text-white/40',
  },
  forest: {
    background: 'linear-gradient(135deg,#e2f2e5 0%,#a9d3b4 100%)',
    glyph: '★',
    glyphClass: 'text-white/60',
  },
}

interface CoverArtProps {
  variant: CoverVariant
  className?: string
}

/** 竞赛封面：设计稿配图不可提取，用渐变 + 数学符号占位 */
export function CoverArt({ variant, className = '' }: CoverArtProps) {
  const cover = COVERS[variant] ?? COVERS.aurora
  return (
    <div
      className={`relative shrink-0 overflow-hidden ${className}`}
      style={{ background: cover.background }}
      aria-hidden="true"
    >
      <span className={`absolute -right-1 top-1/2 -translate-y-1/2 font-serif italic ${cover.glyphClass}`}
        style={{ fontSize: '2.6em', lineHeight: 1 }}
      >
        {cover.glyph}
      </span>
      <span className="absolute left-2 top-2 h-6 w-6 rounded-full bg-white/25" />
      <span className="absolute bottom-1.5 left-8 h-3 w-3 rounded-full bg-white/20" />
    </div>
  )
}
