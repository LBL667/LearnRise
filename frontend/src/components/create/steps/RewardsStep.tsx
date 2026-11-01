import { ImagePlus, X } from 'lucide-react'
import { api } from '@/api/client'
import type { StepProps } from '../wizardState'

const MEDAL_BG = ['bg-gold', 'bg-silver', 'bg-bronze']

function medalClass(rank: number): string {
  return MEDAL_BG[rank - 1] ?? 'bg-ink-mute'
}

/** 步骤 3：获胜名额 + 各名次奖励（可传奖品图） */
export function RewardsStep({ state, update }: StepProps) {
  const setCount = (raw: number) => {
    const count = Math.min(10, Math.max(1, Number.isNaN(raw) ? 1 : raw))
    const rewards = Array.from({ length: count }, (_, i) => ({
      rank: i + 1,
      name: state.rewards[i]?.name ?? '',
      imageUrl: state.rewards[i]?.imageUrl,
    }))
    update({ winnerCount: count, rewards })
  }

  const setReward = (rank: number, patch: Partial<{ name: string; imageUrl?: string }>) => {
    update({
      rewards: state.rewards.map((r) => (r.rank === rank ? { ...r, ...patch } : r)),
    })
  }

  const uploadImage = async (rank: number, file: File | undefined) => {
    if (!file) return
    try {
      const uploaded = await api.uploadRewardImage(file)
      setReward(rank, { imageUrl: uploaded.url })
    } catch {
      setReward(rank, { imageUrl: undefined })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <label className="text-[13px] font-semibold text-ink">获胜名额</label>
        <input
          type="number"
          min={1}
          max={10}
          value={state.winnerCount}
          onChange={(e) => setCount(e.target.valueAsNumber)}
          className="field-input w-28"
        />
        <span className="text-[12px] text-ink-mute">填 1-10，下方自动生成对应名次</span>
      </div>

      <div className="flex flex-col gap-3">
        {state.rewards.map((r) => (
          <div key={r.rank} className="card flex items-center gap-3 p-3">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${medalClass(r.rank)}`}
            >
              {r.rank}
            </span>
            <span className="w-14 shrink-0 text-[13px] font-semibold text-ink">第{r.rank}名</span>
            <input
              className="field-input flex-1"
              placeholder="填写奖励内容，例如 手表"
              value={r.name}
              onChange={(e) => setReward(r.rank, { name: e.target.value })}
            />
            {r.imageUrl ? (
              <span className="relative">
                <img src={r.imageUrl} alt={`第${r.rank}名奖品`} className="h-10 w-10 rounded-lg object-cover" />
                <button
                  aria-label="移除奖品图片"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#5b6b82] text-white"
                  onClick={() => setReward(r.rank, { imageUrl: undefined })}
                >
                  <X size={10} />
                </button>
              </span>
            ) : (
              <label className="btn-ghost h-9 cursor-pointer px-3">
                <ImagePlus size={14} />
                奖品图
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => uploadImage(r.rank, e.target.files?.[0])}
                />
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
