import { Copy, Play, Plus, X } from 'lucide-react'
import { api } from '@/api/client'
import type { Competition, Member } from '@/api/types'
import { MemberAvatar } from './MemberAvatar'
import { useToast } from '../ui/Toast'

interface MembersPanelProps {
  competition: Competition
  members: Member[]
  onMembersChange: (members: Member[]) => void
}

export function MembersPanel({ competition, members, onMembersChange }: MembersPanelProps) {
  const { showToast } = useToast()

  const canManage = competition.canManageMembers === true

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(competition.inviteCode)
    } catch {
      /* 剪贴板不可用时忽略，仅提示 */
    }
    showToast('邀请码已复制', 'success')
  }

  const removeMember = async (member: Member) => {
    try {
      const next = await api.removeMember(competition.id, member.id)
      onMembersChange(next)
      showToast(`已将 ${member.name} 移出竞赛`)
    } catch {
      showToast('移除失败，请重试', 'error')
    }
  }

  const capacity = competition.capacity && competition.capacity > 0 ? competition.capacity : null
  const slots = capacity ? Math.max(0, capacity - members.length) : 0

  return (
    <div>
      {/* 头部操作区 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-bold text-ink">
            成员管理{' '}
            <span className="text-primary">
              {members.length}/{capacity ?? '不限'}
            </span>
          </h3>
          <p className="mt-1 text-[13px] text-ink-mute">邀请志同道合的伙伴一起竞赛，共同进步!</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 items-center gap-2 rounded-lg bg-page px-3">
            <span className="text-[13px] text-ink-mute">邀请码</span>
            <span data-testid="invite-code" className="text-[14px] font-bold tracking-widest text-ink">{competition.inviteCode}</span>
            <button
              onClick={() => void copyCode()}
              aria-label="复制邀请码"
              className="text-ink-mute transition hover:text-primary"
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="flex flex-col items-center">
            <button className="btn-gray" disabled>
              <Play size={14} />
              开启竞赛
            </button>
            <span className="mt-1 whitespace-nowrap text-[11px] text-ink-mute">
              {capacity ? `需满${capacity}人后方可开启竞赛` : '人数不限'}
            </span>
          </div>
        </div>
      </div>

      {/* 成员网格 */}
      <div className="mt-5 grid grid-cols-5 gap-4">
        {members.map((m) => (
          <div key={m.id} className="relative flex flex-col items-center rounded-[14px] border border-line bg-white px-3 py-5">
            {canManage && m.role !== 'leader' && (
              <button
                aria-label={`移除 ${m.name}`}
                onClick={() => void removeMember(m)}
                className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-[#fdecec] hover:text-[#e25050]"
              >
                <X size={13} />
              </button>
            )}
            <div className="relative">
              {m.role === 'leader' && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-gold" aria-label="队长">
                  <svg width="20" height="14" viewBox="0 0 20 14" fill="currentColor">
                    <path d="M2 12 L1 3 L6 7 L10 1 L14 7 L19 3 L18 12 Z" />
                  </svg>
                </span>
              )}
              <MemberAvatar name={m.name} hue={m.avatarHue} />
            </div>
            <div className="mt-2.5 text-[13px] font-semibold text-ink">{m.name}</div>
            <span
              className={`mt-1.5 rounded-full px-2.5 py-0.5 text-[11px] ${
                m.role === 'leader' ? 'bg-gold/15 text-[#c98a10]' : 'bg-[#f1f5fb] text-ink-soft'
              }`}
            >
              {m.role === 'leader' ? '队长' : '成员'}
            </span>
          </div>
        ))}

        {Array.from({ length: slots }, (_, i) => (
          <button
            key={`slot-${i}`}
            onClick={() => void copyCode()}
            className="flex flex-col items-center rounded-[14px] border-2 border-dashed border-[#dbe4f0] px-3 py-5 text-ink-mute transition hover:border-primary/50 hover:text-primary"
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-page">
              <Plus size={20} />
            </span>
            <span className="mt-2.5 text-[12px]">邀请成员</span>
          </button>
        ))}
      </div>
    </div>
  )
}
