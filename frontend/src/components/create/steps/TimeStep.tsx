import { Lock } from 'lucide-react'
import type { StepProps } from '../wizardState'

function display(value: string): string {
  return value ? value.replace('T', ' ') : '未选择'
}

/** 步骤 4：竞赛时间，精确到小时，选定后固定不可更改 */
export function TimeStep({ state, update }: StepProps) {
  const locked = state.timeLocked

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block text-[13px] font-semibold text-ink">竞赛开始时间</label>
          <input
            type="datetime-local"
            step={3600}
            className="field-input"
            value={state.startTime}
            disabled={locked}
            onChange={(e) => update({ startTime: e.target.value })}
          />
          <p className="mt-1.5 text-[12px] text-ink-mute">{display(state.startTime)}</p>
        </div>
        <div>
          <label className="mb-2 block text-[13px] font-semibold text-ink">竞赛结束时间</label>
          <input
            type="datetime-local"
            step={3600}
            className="field-input"
            value={state.endTime}
            disabled={locked}
            onChange={(e) => update({ endTime: e.target.value })}
          />
          <p className="mt-1.5 text-[12px] text-ink-mute">{display(state.endTime)}</p>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12px] ${
          locked ? 'bg-primary-soft text-primary' : 'bg-page text-ink-mute'
        }`}
      >
        <Lock size={13} />
        {locked
          ? '时间已选定，固定不可更改'
          : '时间精确到小时，点击下一步后即选定并锁定，不可更改'}
      </div>
    </div>
  )
}
