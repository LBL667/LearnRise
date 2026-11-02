export interface StatusBadgeProps {
  status: string
  className?: string
}

interface StatusMeta {
  label: string
  tone: string
}

const STATUS_META: Record<string, StatusMeta> = {
  pending: { label: '待处理', tone: 'bg-[#fdf3e3] text-[#c07b1d]' },
  parsing: { label: '解析中', tone: 'bg-primary-soft text-primary' },
  embedding: { label: '向量化中', tone: 'bg-[#f0ecfe] text-[#7c5cf0]' },
  ready: { label: '就绪', tone: 'bg-[#e5f6ec] text-[#188c5e]' },
  ready_empty: { label: '无内容', tone: 'bg-[#eef1f6] text-ink-soft' },
  failed: { label: '失败', tone: 'bg-[#fdecec] text-[#d24848]' },
  queued: { label: '排队中', tone: 'bg-[#eef1f6] text-ink-soft' },
  running: { label: '进行中', tone: 'bg-primary-soft text-primary' },
  succeeded: { label: '已成功', tone: 'bg-[#e5f6ec] text-[#188c5e]' },
  success: { label: '成功', tone: 'bg-[#e5f6ec] text-[#188c5e]' },
  error: { label: '错误', tone: 'bg-[#fdecec] text-[#d24848]' },
  active: { label: '启用中', tone: 'bg-[#e5f6ec] text-[#188c5e]' },
  inactive: { label: '已停用', tone: 'bg-[#eef1f6] text-ink-mute' },
}

const FALLBACK_TONE = 'bg-[#eef1f6] text-ink-soft'

/** 状态徽章：已知状态映射为中文标签与配色，未知状态原样显示。 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_META[status]
  const label = meta ? meta.label : status
  const tone = meta ? meta.tone : FALLBACK_TONE

  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className={`inline-flex h-5 shrink-0 items-center rounded px-2 text-[11px] font-medium leading-none ${tone}${
        className ? ` ${className}` : ''
      }`}
    >
      {label}
    </span>
  )
}
