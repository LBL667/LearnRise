import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Clock, Gift, RefreshCw, Sparkles, Trophy, Users } from 'lucide-react'
import { ApiError, parseApiDetail } from '@/api/client'
import { listKnowledgePoints } from '@/api/knowledge'
import { examPlan as requestExamPlan } from '@/api/plans'
import type { CompetitionPlan } from '@/api/types'
import type { ExamPlanOut } from '@/api/types/plans'
import { useToast } from '../ui/Toast'
import { Roadmap } from './Roadmap'

const MEDAL = ['bg-gold', 'bg-silver', 'bg-bronze']

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

function describeExamPlanError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) {
      return '竞赛缺少结束时间，无法生成备考计划'
    }
    if (error.status === 409 && (error.code === 'NO_SOURCE' || error.code === 'NO_CONTEXT')) {
      return '请先在建赛时绑定资料'
    }
    return parseApiDetail(error.detail).message
  }
  return '备考计划生成失败，请稍后重试'
}

function StatBlock({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  iconClass = 'text-primary',
}: {
  icon: typeof Clock
  label: string
  value: string
  unit?: string
  sub?: string
  iconClass?: string
}) {
  return (
    <div className="min-w-0 shrink-0 px-5 first:pl-1">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-soft">
        <Icon size={15} className={iconClass} />
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[26px] font-bold leading-none text-primary">{value}</span>
        {unit && <span className="whitespace-nowrap text-[13px] text-ink-soft">{unit}</span>}
      </div>
      {sub && <div className="mt-1 whitespace-nowrap text-[12px] text-ink-mute">{sub}</div>}
    </div>
  )
}

interface PlanPanelProps {
  competitionId: string
  plan?: CompetitionPlan
  canGenerate: boolean
  planStatus?: 'pending' | 'generating' | 'ready' | 'failed'
  generating: boolean
  planError: string
  onGenerate: () => void
}

export function PlanPanel({
  competitionId,
  plan,
  canGenerate,
  planStatus,
  generating,
  planError,
  onGenerate,
}: PlanPanelProps) {
  const { showToast } = useToast()
  const [kpTitles, setKpTitles] = useState<Record<string, string>>({})
  const [examPlan, setExamPlan] = useState<ExamPlanOut>()
  const [examLoading, setExamLoading] = useState(false)
  const [examError, setExamError] = useState('')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    void listKnowledgePoints({ limit: 500 })
      .then((points) => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const point of points) next[point.id] = point.title
        setKpTitles(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      aliveRef.current = false
    }
  }, [competitionId])

  const handleExamPlan = useCallback(async () => {
    if (examLoading) return
    const regenerate = examPlan !== undefined
    setExamLoading(true)
    setExamError('')
    try {
      const next = await requestExamPlan({ competition_id: competitionId, regenerate })
      if (!aliveRef.current) return
      setExamPlan(next)
      showToast(regenerate ? '备考计划已重新生成' : '备考计划已生成', 'success')
    } catch (error) {
      if (!aliveRef.current) return
      setExamError(describeExamPlanError(error))
    } finally {
      if (aliveRef.current) setExamLoading(false)
    }
  }, [competitionId, examLoading, examPlan, showToast])

  const noPlanHint =
    planStatus === 'failed'
      ? '上次生成失败，可重新生成学习规划。'
      : '学习规划尚未生成，队长可在详情页触发生成。'

  return (
    <div className="flex flex-col gap-5">
      {/* 生成入口 */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink">规划与备考</h3>
          <p className="mt-1 text-[13px] text-ink-mute">
            {plan ? '学习规划已就绪，可随时重新生成。' : noPlanHint}
          </p>
          {planError && (
            <p data-testid="plan-generate-error" className="mt-2 text-[13px] text-[#e25050]">
              {planError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!canGenerate && <span className="text-[12px] text-ink-mute">仅队长可生成规划</span>}
          <button
            type="button"
            data-testid="generate-plan"
            className="btn-primary"
            disabled={!canGenerate || generating}
            onClick={onGenerate}
          >
            {generating ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {generating ? '生成中…' : plan ? '重新生成规划' : '生成规划'}
          </button>
        </div>
      </section>

      {!plan ? (
        <div className="card p-10 text-center text-sm text-ink-mute">{noPlanHint}</div>
      ) : (
        <>
          {/* 统计行 */}
          <section className="card flex items-stretch py-5">
            <StatBlock
              icon={Clock}
              label="距离竞赛开始"
              value={String(plan.stats.daysToStart)}
              unit="天"
              sub={plan.stats.startAt}
            />
            <div className="w-px bg-line" />
            <StatBlock
              icon={CalendarClock}
              label="距离竞赛结束"
              value={String(plan.stats.daysToEnd)}
              unit="天"
              sub={plan.stats.endAt}
            />
            <div className="w-px bg-line" />
            <StatBlock
              icon={Users}
              label="预计获奖名额"
              value={String(plan.stats.awardQuota)}
              unit="名"
            />
            <div className="w-px bg-line" />
            <div className="min-w-0 flex-1 px-5 pr-1">
              <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                <Trophy size={15} className="text-gold" />
                前三奖励
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {plan.rewards.slice(0, 3).map((r) => (
                  <div
                    key={r.rank}
                    className="flex items-center gap-1.5 rounded-lg bg-[#f6f8fc] p-1.5 pr-2.5"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                        MEDAL[r.rank - 1] ?? 'bg-ink-mute'
                      }`}
                    >
                      {r.rank}
                    </span>
                    {r.imageUrl ? (
                      <img
                        src={r.imageUrl}
                        alt={r.name}
                        className="h-7 w-7 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-ink-mute">
                        <Gift size={13} />
                      </span>
                    )}
                    <span className="leading-tight">
                      <span className="block text-[11px] font-semibold text-ink">
                        第{r.rank}名
                      </span>
                      <span className="block max-w-[60px] truncate text-[10px] text-ink-mute">
                        {r.name}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 规划图 */}
          <section className="card p-6">
            <h3 className="text-[15px] font-bold text-ink">规划图</h3>
            <p className="mt-1 text-[13px] text-ink-mute">{plan.intro}</p>
            <div className="mt-4">
              <Roadmap stages={plan.stages} />
            </div>
          </section>
        </>
      )}

      {/* 备考计划 */}
      <section className="card p-6" data-testid="exam-plan-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-ink">备考计划</h3>
            <p className="mt-1 text-[13px] text-ink-mute">
              按竞赛截止日期与薄弱知识点生成每日任务。
            </p>
          </div>
          <button
            type="button"
            data-testid="generate-exam-plan"
            className="btn-primary"
            disabled={examLoading}
            onClick={() => void handleExamPlan()}
          >
            {examLoading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {examLoading ? '生成中…' : examPlan ? '重新生成备考计划' : '生成备考计划'}
          </button>
        </div>

        {examError && (
          <p data-testid="exam-plan-error" className="mt-3 text-[13px] text-[#e25050]">
            {examError}
          </p>
        )}

        {examPlan && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <span
                data-testid="exam-plan-mode"
                className="rounded-full bg-[#f1f5fb] px-2.5 py-0.5 font-medium text-ink-soft"
              >
                {examPlan.mode === 'sprint' ? '冲刺计划' : '标准计划'}
              </span>
              <span className="text-ink-mute">截止 {examPlan.end_at.slice(0, 10)}</span>
            </div>

            {examPlan.guidance && (
              <p data-testid="exam-plan-guidance" className="text-[13px] text-ink-soft">
                {examPlan.guidance}
              </p>
            )}

            {examPlan.truncated && (
              <p data-testid="exam-plan-truncated" className="text-[12px] text-[#c98a10]">
                计划过长，已截断为最近 180 天
              </p>
            )}

            <div className="flex flex-col gap-2">
              {(examPlan.items ?? []).map((item, index) => (
                <div
                  key={`${item.date}-${index}`}
                  data-testid="exam-plan-item"
                  className="rounded-xl border border-line bg-white p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink">{item.date}</span>
                    <span className="text-[12px] text-ink-soft">
                      练习题 {item.quiz_count ?? 0} 道 · 复习 {item.review_count ?? 0} 个
                    </span>
                  </div>
                  {item.rationale && (
                    <p className="mt-1 text-[12px] text-ink-mute">{item.rationale}</p>
                  )}
                  {(item.focus_kp_ids ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(item.focus_kp_ids ?? []).map((kpId) => (
                        <span
                          key={kpId}
                          data-testid="exam-plan-kp"
                          className="rounded-md bg-[#eef3fb] px-2 py-0.5 text-[11px] text-primary"
                        >
                          {kpTitles[kpId] ?? shortId(kpId)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {(examPlan.items ?? []).length === 0 && (
                <p className="text-[13px] text-ink-mute">
                  {examPlan.guidance || '暂无每日任务，先做一轮诊断练习吧。'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
