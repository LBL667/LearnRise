import type { ReactNode } from 'react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export interface LoadingViewProps {
  className?: string
}

/** 统一的加载态：低调的旋转指示器 + 文案。 */
export function LoadingView({ className }: LoadingViewProps) {
  return (
    <div
      data-testid="state-loading"
      className={cx(
        'flex flex-col items-center justify-center gap-3 py-12 text-[13px] text-ink-mute',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-primary"
      />
      <span>加载中…</span>
    </div>
  )
}

export interface EmptyViewProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/** 空状态：标题 + 可选说明 + 可选操作按钮。 */
export function EmptyView({ title, description, action, className }: EmptyViewProps) {
  return (
    <div
      data-testid="state-empty"
      className={cx(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {description && <p className="max-w-[420px] text-[13px] leading-6 text-ink-mute">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export interface ErrorViewProps {
  message: string
  onRetry?: () => void
  className?: string
}

/** 错误态：错误文案 + 可选的重试按钮。 */
export function ErrorView({ message, onRetry, className }: ErrorViewProps) {
  return (
    <div
      data-testid="state-error"
      role="alert"
      className={cx(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-[15px] font-semibold text-ink">出错了</div>
      <p className="max-w-[420px] text-[13px] leading-6 text-ink-soft">{message}</p>
      {onRetry && (
        <button type="button" className="btn-primary h-9 px-4" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

export interface NotFoundViewProps {
  title?: string
  description?: string
  className?: string
}

/** 未找到态：默认标题「未找到」。 */
export function NotFoundView({ title = '未找到', description, className }: NotFoundViewProps) {
  return (
    <div
      data-testid="state-notfound"
      className={cx(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <p className="max-w-[420px] text-[13px] leading-6 text-ink-mute">
        {description ?? '你访问的内容不存在或已被删除。'}
      </p>
    </div>
  )
}
