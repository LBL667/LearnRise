import type { ReactNode } from 'react'
import type { CurveItem, HeatmapItem, HistogramItem, RadarItem } from '@/api/types/dashboard'
import { EmptyView } from '@/components/ui/StateViews'

/** Fixed difficulty buckets, mirroring `app.services.dashboard.BUCKETS`. */
const FIXED_BUCKETS = ['1-2', '2-3', '3-4', '4-5', '5'] as const

function asFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, asFinite(value, min)))
}

function toPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${asFinite(point.x).toFixed(2)},${asFinite(point.y).toFixed(2)}`).join(' ')
}

export interface ChartCardProps {
  title: string
  subtitle?: string
  testId?: string
  className?: string
  children: ReactNode
}

/** Shared card frame so every chart keeps the same spacing and heading rhythm. */
export function ChartCard({ title, subtitle, testId, className, children }: ChartCardProps) {
  return (
    <section className={`card flex h-full flex-col p-5 ${className ?? ''}`} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-bold text-ink">{title}</h2>
        {subtitle ? <span className="shrink-0 text-[11.5px] text-ink-mute">{subtitle}</span> : null}
      </div>
      <div className="mt-4 flex flex-1 items-center">{children}</div>
    </section>
  )
}

interface ChartEmptyProps {
  testId: string
  title: string
  description?: string
}

function ChartEmpty({ testId, title, description }: ChartEmptyProps) {
  return (
    <div
      data-testid={testId}
      className="flex h-[190px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-4 text-center"
    >
      <span aria-hidden="true" className="text-[22px] leading-none text-ink-mute/60">
        ∅
      </span>
      <div className="text-[13px] font-semibold text-ink-soft">{title}</div>
      {description ? <p className="max-w-[280px] text-[11.5px] leading-5 text-ink-mute">{description}</p> : null}
    </div>
  )
}

interface HeatmapChartProps {
  items: HeatmapItem[]
}

/** 90 day review heatmap: one `<rect>` per API item, intensity scaled by count. */
export function HeatmapChart({ items }: HeatmapChartProps) {
  if (items.length === 0) {
    return (
      <ChartEmpty
        testId="heatmap-empty"
        title="暂无复习记录"
        description="完成第一次复习后，这里会点亮最近 90 天的学习热力图。"
      />
    )
  }

  const counts = items.map((item) => Math.max(0, asFinite(item.count)))
  const max = Math.max(1, ...counts)
  const total = counts.reduce((sum, count) => sum + count, 0)

  const cell = 14
  const gap = 3
  const rows = 7
  const cols = Math.max(1, Math.ceil(items.length / rows))
  const width = cols * cell + (cols - 1) * gap
  const height = rows * cell + (rows - 1) * gap
  const xFor = (index: number) => Math.floor(index / rows) * (cell + gap)
  const yFor = (index: number) => (index % rows) * (cell + gap)

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          className="block h-auto w-full"
          role="img"
          aria-label="近 90 天复习热力图"
          data-testid="heatmap-svg"
        >
          {items.map((item, index) => {
            const count = Math.max(0, asFinite(item.count))
            const ratio = count > 0 ? count / max : 0
            return (
              <rect
                key={`${item.date}-${index}`}
                data-testid="heatmap-cell"
                x={xFor(index)}
                y={yFor(index)}
                width={cell}
                height={cell}
                rx={4}
                fill={count > 0 ? 'var(--color-primary)' : 'var(--color-line)'}
                fillOpacity={count > 0 ? 0.18 + 0.82 * clamp(ratio, 0, 1) : 1}
              >
                <title>{`${item.date}：${count} 次复习`}</title>
              </rect>
            )
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-mute">
        {total === 0 ? (
          <span data-testid="heatmap-empty-note">近 90 天还没有复习记录</span>
        ) : (
          <span>近 90 天共 {total} 次复习</span>
        )}
        <span className="flex items-center gap-1.5" aria-label="热力图图例">
          <span>少</span>
          {[0, 0.25, 0.5, 0.75, 1].map((level) => (
            <span
              key={level}
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{
                backgroundColor: level === 0 ? 'var(--color-line)' : 'var(--color-primary)',
                opacity: level === 0 ? 1 : 0.18 + 0.82 * level,
              }}
            />
          ))}
          <span>多</span>
        </span>
      </div>
    </div>
  )
}

interface ForgettingCurveChartProps {
  items: CurveItem[]
}

/** 30 point forgetting curve: inline polyline + one circle per API point. */
export function ForgettingCurveChart({ items }: ForgettingCurveChartProps) {
  const points = items
    .filter((item) => Number.isFinite(item.days) && Number.isFinite(item.retrievability))
    .slice()
    .sort((a, b) => a.days - b.days)

  if (points.length === 0) {
    return (
      <ChartEmpty
        testId="curve-empty"
        title="暂无遗忘曲线"
        description="当有到期复习卡片时，这里会显示未来 30 天的可检索概率。"
      />
    )
  }

  const width = 540
  const height = 220
  const padLeft = 44
  const padRight = 14
  const padTop = 16
  const padBottom = 32
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const xFor = (index: number) =>
    padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const yFor = (value: number) => padTop + (1 - clamp(value, 0, 1)) * plotHeight

  const linePoints = points.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.retrievability),
  }))
  const last = linePoints[linePoints.length - 1]
  const areaPoints = [
    { x: padLeft, y: padTop + plotHeight },
    ...linePoints,
    { x: last?.x ?? padLeft, y: padTop + plotHeight },
  ]
  const allZero = points.every((point) => asFinite(point.retrievability) <= 0)

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
  const xTickIndexes = Array.from(
    new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  )

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        role="img"
        aria-label="遗忘曲线"
        data-testid="curve-svg"
      >
        {yTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <text x={padLeft - 10} y={y + 4} textAnchor="end" fontSize={14} fill="var(--color-ink-mute)">
                {Math.round(tick * 100)}%
              </text>
            </g>
          )
        })}

        <polygon points={toPoints(areaPoints)} fill="var(--color-primary)" fillOpacity={0.08} />
        <polyline
          points={toPoints(linePoints)}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {linePoints.map((point, index) => (
          <circle
            key={points[index]?.days ?? index}
            data-testid="curve-point"
            cx={point.x}
            cy={point.y}
            r={3.3}
            fill="var(--color-surface)"
            stroke="var(--color-primary)"
            strokeWidth={1.8}
          />
        ))}

        {xTickIndexes.map((index) => {
          const point = points[index]
          if (!point) return null
          return (
            <text
              key={`x-${index}`}
              x={xFor(index)}
              y={height - 12}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fontSize={14}
              fill="var(--color-ink-mute)"
            >
              第 {point.days} 天
            </text>
          )
        })}

        {allZero ? (
          <text
            data-testid="curve-empty-note"
            x={padLeft + plotWidth / 2}
            y={padTop + plotHeight / 2 - 8}
            textAnchor="middle"
            fontSize={12}
            fill="var(--color-ink-mute)"
          >
            暂无到期卡片，曲线将在有复习任务后更新
          </text>
        ) : null}
      </svg>
    </div>
  )
}

interface MasteryRadarChartProps {
  items: RadarItem[]
}

/** Mean mastery per source, drawn as a polygon over the API labels/scores. */
export function MasteryRadarChart({ items }: MasteryRadarChartProps) {
  if (items.length < 3) {
    return (
      <div data-testid="radar-empty" className="w-full">
        <EmptyView
          className="h-[190px] py-0"
          title="暂无掌握度数据"
          description="生成知识点并完成复习后，这里会按资料显示掌握度雷达。"
        />
      </div>
    )
  }

  const width = 340
  const height = 300
  const centerX = width / 2
  const centerY = height / 2 + 6

  const labelPad = 26
  const radius = Math.min(width, height) / 2 - labelPad - 10
  const count = items.length
  const angleFor = (index: number) => (Math.PI * 2 * index) / count - Math.PI / 2

  const outerPoints = items.map((_, index) => {
    const angle = angleFor(index)
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    }
  })

  const valuePoints = items.map((item, index) => {
    const angle = angleFor(index)
    const ratio = clamp(asFinite(item.value), 0, 100) / 100
    return {
      x: centerX + radius * ratio * Math.cos(angle),
      y: centerY + radius * ratio * Math.sin(angle),
    }
  })

  const allZero = items.every((item) => asFinite(item.value) <= 0)
  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="mx-auto block h-auto w-full max-w-[320px]"
      role="img"
      aria-label="掌握度雷达"
      data-testid="radar-svg"
    >
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={toPoints(
            outerPoints.map((point) => ({
              x: centerX + (point.x - centerX) * ring,
              y: centerY + (point.y - centerY) * ring,
            })),
          )}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={1}
        />
      ))}

      {outerPoints.map((point, index) => (
        <line
          key={`axis-${index}`}
          x1={centerX}
          y1={centerY}
          x2={point.x}
          y2={point.y}
          stroke="var(--color-line)"
          strokeWidth={1}
        />
      ))}

      <polygon
        data-testid="radar-polygon"
        points={toPoints(valuePoints)}
        fill="var(--color-primary)"
        fillOpacity={0.18}
        stroke="var(--color-primary)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {valuePoints.map((point, index) => (
        <circle
          key={`value-${index}`}
          cx={point.x}
          cy={point.y}
          r={3}
          fill="var(--color-surface)"
          stroke="var(--color-primary)"
          strokeWidth={1.8}
        />
      ))}

      {items.map((item, index) => {
        const angle = angleFor(index)
        const x = centerX + (radius + 18) * Math.cos(angle)
        const y = centerY + (radius + 18) * Math.sin(angle)
        const anchor = Math.abs(x - centerX) < 12 ? 'middle' : x > centerX ? 'start' : 'end'
        const label = item.name.length > 10 ? `${item.name.slice(0, 10)}…` : item.name
        return (
          <text
            key={`label-${index}`}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10.5}
            fill="var(--color-ink-soft)"
          >
            {label}
          </text>
        )
      })}

      {allZero ? (
        <text
          data-testid="radar-empty-note"
          x={centerX}
          y={centerY + 26}
          textAnchor="middle"
          fontSize={11}
          fill="var(--color-ink-mute)"
        >
          掌握度数据不足
        </text>
      ) : null}
    </svg>
  )
}

interface DifficultyHistogramChartProps {
  items: HistogramItem[]
}

/** Fixed 1..5 difficulty histogram, always five inline SVG bars. */
export function DifficultyHistogramChart({ items }: DifficultyHistogramChartProps) {
  const buckets = FIXED_BUCKETS.map((label) => {
    const match = items.find((item) => item.bucket === label)
    return {
      bucket: label,
      count: match ? Math.max(0, asFinite(match.count)) : 0,
    }
  })

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const width = 380
  const height = 220
  const padLeft = 34
  const padRight = 14
  const padTop = 24
  const padBottom = 36
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const slotWidth = plotWidth / buckets.length
  const barWidth = Math.min(46, slotWidth * 0.56)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-auto w-full"
      role="img"
      aria-label="复习难度分布"
      data-testid="histogram-svg"
    >
      {[0, 0.5, 1].map((tick) => {
        const y = padTop + (1 - tick) * plotHeight
        return (
          <g key={`tick-${tick}`}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            <text x={padLeft - 8} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="var(--color-ink-mute)">
              {Math.round(tick * max)}
            </text>
          </g>
        )
      })}

      {buckets.map((bucket, index) => {
        const barHeight = (bucket.count / max) * plotHeight
        const x = padLeft + index * slotWidth + (slotWidth - barWidth) / 2
        const y = padTop + plotHeight - barHeight
        return (
          <g key={bucket.bucket}>
            <rect
              data-testid="histogram-bar"
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(0, barHeight)}
              rx={5}
              fill="var(--color-primary)"
              fillOpacity={0.85}
            >
              <title>{`难度 ${bucket.bucket}：${bucket.count} 张卡片`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={Math.max(padTop + 10, y - 7)}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={600}
              fill="var(--color-ink-soft)"
            >
              {bucket.count}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - 13}
              textAnchor="middle"
              fontSize={10.5}
              fill="var(--color-ink-mute)"
            >
              {bucket.bucket}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
