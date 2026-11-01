import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Check,
  FileText,
  Lock,
  PencilLine,
  ScrollText,
} from 'lucide-react'
import { api } from '@/api/client'
import type { UserProgress } from '@/api/types'
import { useToast } from '@/components/ui/Toast'

const CONDITIONS_META = [
  {
    icon: BookOpen,
    title: '完成备赛区学习',
    desc: '系统化学习基础知识，打好竞赛基础。',
    key: 'prep' as const,
  },
  {
    icon: PencilLine,
    title: '完成赛题试炼',
    desc: '完成规定数量的赛题，提升解题能力。',
    key: 'trial' as const,
  },
  {
    icon: BarChart3,
    title: '积分达到要求',
    desc: '累计获得不少于 100 积分。',
    key: 'points' as const,
  },
]

/** 锁插画（CSS + 图标组合，贴近设计稿的蓝色调插画） */
function LockIllustration({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="relative mx-auto flex h-[190px] w-[320px] items-center justify-center" aria-hidden="true">
      {/* 背景山影 */}
      <img
        src="/misty-mountains.jpg"
        alt=""
        className="pointer-events-none absolute bottom-2 left-0 w-full select-none opacity-70"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)',
        }}
      />
      {/* 漂浮装饰小卡 */}
      <div className="absolute left-14 top-6 h-10 w-10 -rotate-12 rounded-lg bg-white/80 shadow-sm backdrop-blur">
        <FileText size={18} className="m-auto mt-2.5 text-primary/60" />
      </div>
      <div className="absolute right-14 top-10 h-10 w-10 rotate-12 rounded-lg bg-white/80 shadow-sm backdrop-blur">
        <ScrollText size={18} className="m-auto mt-2.5 text-primary/50" />
      </div>
      {/* 锁体 */}
      <div className="relative z-10 flex flex-col items-center">
        <div
          className={`flex h-[104px] w-[128px] items-center justify-center rounded-2xl shadow-[0_10px_30px_rgba(46,124,246,0.25)] transition-colors ${
            unlocked
              ? 'bg-gradient-to-b from-[#34c08b] to-[#1e9e6e]'
              : 'bg-gradient-to-b from-[#6ea8ff] to-[#3f7ef0]'
          }`}
        >
          {unlocked ? (
            <Check size={54} className="text-white" strokeWidth={3} />
          ) : (
            <Lock size={50} className="text-white" strokeWidth={2.2} />
          )}
        </div>
        <div className="mt-1.5 h-4 w-[150px] rounded-lg bg-gradient-to-b from-[#c9def8] to-[#eef5fd]" />
      </div>
    </div>
  )
}

export default function PromotionPage() {
  const [progress, setProgress] = useState<UserProgress | null>(null)
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    void (async () => {
      setProgress(await api.getUserProgress())
    })()
  }, [])

  if (!progress) {
    return <div className="w-full px-6 py-6"><div className="card p-10 text-center text-sm text-ink-mute">正在加载晋级赛信息…</div></div>
  }

  const ratio = (done: number, total: number) => (total > 0 ? (done / total) * 100 : 0)
  const values = {
    prep: { done: progress.prepDone, text: '已完成', progress: undefined as undefined },
    trial: {
      done: progress.trialTotal > 0 && progress.trialDone >= progress.trialTotal,
      text: `${progress.trialDone} / ${progress.trialTotal}`,
      progress: ratio(progress.trialDone, progress.trialTotal),
    },
    points: {
      done: progress.points >= progress.pointsTarget,
      text: `${progress.points} / ${progress.pointsTarget}`,
      progress: ratio(progress.points, progress.pointsTarget),
    },
  }
  const allDone = Object.values(values).every((v) => v.done)

  return (
    <div className="flex w-full justify-center px-6 py-10">
      <div className="w-full max-w-[640px]">
        <LockIllustration unlocked={allDone} />

        <div className="mt-6 text-center">
          <h1 className="text-[22px] font-bold text-ink">
            {allDone ? '恭喜，晋级赛已解锁!' : '未达到晋级赛要求'}
          </h1>
          <p className="mx-auto mt-2 max-w-[440px] text-[13.5px] leading-6 text-ink-soft">
            晋级赛面向已完成基础准备并达到相应水平的同学开放。
            {allDone ? '三项条件均已完成，快去挑战吧。' : '请先完成以下要求，解锁晋级赛资格。'}
          </p>
        </div>

        {/* 条件清单 */}
        <section className="card mt-7 divide-y divide-line px-2">
          {CONDITIONS_META.map((c) => {
            const v = values[c.key]
            return (
              <div key={c.key} className="flex items-center gap-3.5 px-3 py-4">
                {v.done ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2bb673]">
                    <Check size={13} className="text-white" strokeWidth={3} />
                  </span>
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[#c6d2e4]" />
                )}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <c.icon size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">{c.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-mute">{c.desc}</div>
                </div>
                {v.done ? (
                  <span className="shrink-0 rounded-full bg-[#e5f6ec] px-3 py-1 text-[12px] font-medium text-[#188c5e]">
                    已完成
                  </span>
                ) : (
                  <div className="w-28 shrink-0">
                    <div className="text-right text-[13px] font-semibold text-ink">{v.text}</div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-page">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, v.progress ?? 0)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* 底部按钮 */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <button className="btn-primary h-10 px-6" onClick={() => navigate('/prep')}>
            <BookOpen size={15} />
            去备赛区
            <span className="text-base leading-none">→</span>
          </button>
          <button
            className="btn-base h-10 rounded-lg border border-line bg-white px-5 text-sm font-medium text-ink transition hover:border-primary/50 hover:text-primary"
            onClick={() => showToast('晋级赛规则页即将上线')}
          >
            <FileText size={15} />
            查看晋级规则
          </button>
        </div>
      </div>
    </div>
  )
}
