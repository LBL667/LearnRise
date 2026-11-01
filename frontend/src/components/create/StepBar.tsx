import { Check } from 'lucide-react'

export const WIZARD_STEPS = ['上传文档', '题型难度', '奖励名额', '时间', '发布'] as const

interface StepBarProps {
  current: number
}

export function StepBar({ current }: StepBarProps) {
  return (
    <div className="flex items-center px-7">
      {WIZARD_STEPS.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors ${
                  done
                    ? 'border-primary bg-primary text-white'
                    : active
                      ? 'border-primary bg-white text-primary ring-2 ring-primary/20'
                      : 'border-line bg-white text-ink-mute'
                }`}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span
                className={`whitespace-nowrap text-[12px] ${
                  active ? 'font-semibold text-primary' : done ? 'text-ink-soft' : 'text-ink-mute'
                }`}
              >
                {label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <span
                className={`mx-2 mb-5 h-px min-w-4 flex-1 ${done ? 'bg-primary' : 'bg-line'}`}
                aria-hidden="true"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
