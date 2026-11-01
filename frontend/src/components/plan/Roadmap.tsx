import { BookOpen, Crown, Flag, LayoutGrid, PieChart, SquareKanban, TrendingUp } from 'lucide-react'
import type { PlanStage } from '@/api/types'

const STAGE_ICONS = {
  book: BookOpen,
  grid: LayoutGrid,
  triangle: SquareKanban,
  chart: TrendingUp,
  pie: PieChart,
  crown: Crown,
} as const

const STEP_GAP = 26
const CARD_W = 152

/** 阶梯间的虚线箭头 */
function Connector({ offset }: { offset: number }) {
  return (
    <svg
      width="34"
      height="96"
      viewBox="0 0 34 96"
      fill="none"
      className="shrink-0"
      style={{ marginBottom: offset + 34 }}
      aria-hidden="true"
    >
      <path
        d="M3 88 C 14 82, 20 40, 28 12"
        stroke="#8db9f5"
        strokeWidth="1.6"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path d="M23 16 L29 8 L31 18" stroke="#8db9f5" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function StageCard({ stage, index }: { stage: PlanStage; index: number }) {
  const Icon = STAGE_ICONS[stage.icon] ?? BookOpen
  const isLast = index === 5
  return (
    <div className="flex flex-col items-center" style={{ marginBottom: index * STEP_GAP }}>
      {/* 段位 Logo（悬于阶梯卡片上方） */}
      {stage.logo && (
        <img
          src={stage.logo}
          alt={`${stage.no} ${stage.title} 段位`}
          draggable={false}
          className="mb-1.5 h-[74px] w-auto select-none drop-shadow-[0_4px_10px_rgba(46,124,246,0.15)]"
        />
      )}
      <div className="relative w-[152px] shrink-0 rounded-xl border border-line bg-white/95 p-3 shadow-[0_4px_14px_rgba(46,124,246,0.06)]">
        {isLast && (
          <Flag size={18} className="absolute -top-9 right-2 fill-primary/20 text-primary" aria-hidden="true" />
        )}
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-gradient-to-br from-[#4a90ff] to-primary px-1.5 py-0.5 text-[11px] font-bold text-white">
            {stage.no}
          </span>
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[12px] font-semibold text-white">
            {stage.title}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Icon size={15} className="shrink-0 text-primary" />
          <span className="truncate text-[13px] font-bold text-ink">{stage.theme}</span>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {stage.points.map((p) => (
            <li key={p}>
              <span className="chip block w-fit max-w-full truncate">{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

interface RoadmapProps {
  stages: PlanStage[]
}

/** 六阶阶梯规划图 */
export function Roadmap({ stages }: RoadmapProps) {
  return (
    <div className="relative overflow-x-auto pb-2">
      {/* 背景山峦插画：等比缩放贴底，上边缘渐隐融入白色背景 */}
      <img
        src="/misty-mountains.jpg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute bottom-0 left-0 w-full select-none"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 42%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 42%)',
        }}
      />

      <div className="relative z-10 flex min-w-max items-end px-2 pt-10">
        {stages.map((stage, i) => (
          <div key={stage.no} className="flex items-end">
            {i > 0 && <Connector offset={i * STEP_GAP} />}
            <StageCard stage={stage} index={i} />
          </div>
        ))}
      </div>
    </div>
  )
}
