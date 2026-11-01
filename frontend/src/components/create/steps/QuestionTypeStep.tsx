import { CircleCheck, ListChecks, PenLine, SquareCheckBig } from 'lucide-react'
import type { Difficulty, QuestionType } from '@/api/types'
import type { StepProps } from '../wizardState'

const TYPES: { key: QuestionType; label: string; desc: string; icon: typeof ListChecks }[] = [
  { key: 'choice', label: '单选题', desc: '四选一', icon: ListChecks },
  { key: 'multiple', label: '多选题', desc: '多选作答', icon: SquareCheckBig },
  { key: 'judge', label: '判断题', desc: '正确或错误', icon: CircleCheck },
  { key: 'blank', label: '填空题', desc: '结果填空作答', icon: PenLine },
]

const LEVELS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: '简单' },
  { key: 'medium', label: '中等' },
  { key: 'hard', label: '困难' },
]

/** 步骤 2：题型与难度 */
export function QuestionTypeStep({ state, update }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <label className="mb-3 block text-[13px] font-semibold text-ink">
          题型 <span className="font-normal text-ink-mute">（可多选，至少选一种）</span>
        </label>
        <div className="grid grid-cols-4 gap-3">
          {TYPES.map((t) => {
            const active = state.questionTypes.includes(t.key)
            return (
              <button
                key={t.key}
                onClick={() => {
                  const next = active
                    ? state.questionTypes.filter((k) => k !== t.key)
                    : [...state.questionTypes, t.key]
                  update({ questionTypes: next })
                }}
                className={`relative flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-5 transition-colors ${
                  active
                    ? 'border-primary bg-primary-soft'
                    : 'border-line bg-white hover:border-primary/50'
                }`}
              >
                {active && (
                  <span className="absolute right-2 top-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary p-0.5">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5.2 L4 7.5 L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
                <t.icon size={24} className={active ? 'text-primary' : 'text-ink-mute'} />
                <span className={`text-[13.5px] font-semibold ${active ? 'text-primary' : 'text-ink'}`}>
                  {t.label}
                </span>
                <span className="text-[11px] text-ink-mute">{t.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[13px] font-semibold text-ink">难度</label>
        <div className="inline-flex rounded-lg border border-line bg-page p-1">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              onClick={() => update({ difficulty: l.key })}
              className={`h-8 rounded-md px-6 text-[13px] transition-colors ${
                state.difficulty === l.key
                  ? 'bg-white font-semibold text-primary shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
