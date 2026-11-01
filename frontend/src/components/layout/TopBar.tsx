import { Bell, ChevronDown, Menu } from 'lucide-react'

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-5">
      <div className="flex items-center gap-3">
        <button
          aria-label="菜单"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-page"
        >
          <Menu size={18} />
        </button>
        <p className="text-sm text-ink-soft">让每一次学习，都更接近更好的自己。</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-label="通知"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-page"
        >
          <Bell size={18} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#f26d6d]" />
        </button>
        <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-page">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, hsl(212 85% 68%), hsl(232 78% 55%))' }}
          >
            林
          </span>
          <span className="text-sm font-medium text-ink">林同学</span>
          <ChevronDown size={14} className="text-ink-mute" />
        </button>
      </div>
    </header>
  )
}
