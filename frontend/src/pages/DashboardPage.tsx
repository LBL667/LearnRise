import { useCallback } from 'react'
import { BookOpenCheck, CalendarClock, Flame, RefreshCw, Target } from 'lucide-react'
import { getDashboardSummary } from '@/api/dashboard'
import type { DashboardSummaryOut } from '@/api/types/dashboard'
import {
  ChartCard,
  DifficultyHistogramChart,
  ForgettingCurveChart,
  HeatmapChart,
  MasteryRadarChart,
} from '@/components/dashboard/charts'
import { ErrorView, LoadingView } from '@/components/ui/StateViews'
import { useAsync } from '@/hooks/useAsync'

interface KpiCardProps {
  testId: string
  label: string
  value: string
  unit?: string
  icon: typeof CalendarClock
  tone: string
}

function KpiCard({ testId, label, value, unit, icon: Icon, tone }: KpiCardProps) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-mute">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span data-testid={testId} className="text-[22px] font-bold leading-none text-ink">
            {value}
          </span>
          {unit ? <span className="text-[11px] font-medium text-ink-mute">{unit}</span> : null}
        </div>
      </div>
    </div>
  )
}

function masteryAverage(summary: DashboardSummaryOut): string {
  const scores = summary.mastery_radar
    .map((item) => item.value)
    .filter((value) => Number.isFinite(value))
  if (scores.length === 0) return '—'
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length
  return String(Math.round(average))
}

export default function DashboardPage() {
  const load = useCallback(() => getDashboardSummary(), [])
  const { data, loading, error, reload } = useAsync(load, [])

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 pb-6 pt-4" data-testid="page-dashboard">
      <div className="sticky top-3 z-30 flex h-0 justify-end pr-2">
        <button type="button" onClick={reload} aria-label="刷新学习看板" title="刷新学习看板" data-testid="dashboard-refresh" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/85 text-primary shadow-lg backdrop-blur-md transition hover:bg-white hover:shadow-xl focus-visible:outline-2 focus-visible:outline-primary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div>
        {loading && !data ? (
          <LoadingView />
        ) : error && !data ? (
          <ErrorView message={error} onRetry={reload} />
        ) : data ? (
          <DashboardContent summary={data} />
        ) : (
          <LoadingView />
        )}
      </div>
    </div>
  )
}

function DashboardContent({ summary }: { summary: DashboardSummaryOut }) {
  const mastery = masteryAverage(summary)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="dashboard-kpis">
        <KpiCard
          testId="dashboard-kpi-due"
          label="今日到期"
          value={String(Number.isFinite(summary.due_count) ? summary.due_count : 0)}
          unit="张"
          icon={CalendarClock}
          tone="bg-primary-soft text-primary"
        />
        <KpiCard
          testId="dashboard-kpi-reviewed"
          label="今日已复习"
          value={String(Number.isFinite(summary.reviewed_today) ? summary.reviewed_today : 0)}
          unit="张"
          icon={BookOpenCheck}
          tone="bg-primary-soft text-primary-deep"
        />
        <KpiCard
          testId="dashboard-kpi-streak"
          label="连续复习"
          value={String(Number.isFinite(summary.streak_days) ? summary.streak_days : 0)}
          unit="天"
          icon={Flame}
          tone="bg-gold/15 text-gold"
        />
        <div className="relative">
          <KpiCard
            testId="dashboard-kpi-mastery"
            label="平均掌握度"
            value={mastery}
            unit={mastery === '—' ? undefined : '%'}
            icon={Target}
            tone="bg-primary-soft text-primary"
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="学习热力图" subtitle="近 90 天" testId="dashboard-heatmap">
          <HeatmapChart items={summary.heatmap} />
        </ChartCard>

        <ChartCard title="遗忘曲线" subtitle="未来 30 天" testId="dashboard-curve">
          <ForgettingCurveChart items={summary.forgetting_curve} />
        </ChartCard>

        <ChartCard title="掌握度雷达" subtitle="按资料" testId="dashboard-radar">
          <MasteryRadarChart items={summary.mastery_radar} />
        </ChartCard>

        <ChartCard title="难度分布" subtitle="复习卡片" testId="dashboard-histogram">
          <DifficultyHistogramChart items={summary.difficulty_histogram} />
        </ChartCard>
      </div>
    </div>
  )
}
