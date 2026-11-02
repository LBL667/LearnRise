import { useEffect } from 'react'
import type { ReactNode } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** 通用确认框：固定遮罩 + 居中对话框，支持危险操作与处理中状态。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(31,39,51,0.42)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-dialog"
        className="modal-panel w-full max-w-[400px] rounded-[14px] border border-line bg-white p-5 shadow-xl"
      >
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        {description && (
          <div className="mt-2 text-[13px] leading-6 text-ink-soft">{description}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-gray"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cx(
              'btn-base px-4 h-9 text-white',
              danger ? 'bg-[#e25050] hover:bg-[#cc3f3f]' : 'bg-primary hover:bg-primary-deep',
            )}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
