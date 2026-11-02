import { useState } from 'react'
import { BarChart3, ChevronDown, ChevronRight, ChevronsLeft, Crown, FileText, Library, MessagesSquare, PencilLine, RotateCw, Trophy, User } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useToast } from '../ui/Toast'
import { useUiTheme } from '../../theme/ThemeProvider'

interface NavItem {
  key: string
  label: string
  icon: typeof Trophy
  /** 已实现的路由；无 path 的项点击提示建设中 */
  path?: string
}

/** 设计稿：竞赛空间为一级菜单，其余为子项 */
const PRIMARY_ITEM: NavItem = { key: 'arena', label: '竞赛空间', icon: Trophy, path: '/' }
const SUB_ITEMS: NavItem[] = [
  { key: 'prep', label: '备赛区', icon: FileText, path: '/prep' },
  { key: 'trial', label: '赛题试炼', icon: PencilLine, path: '/trial' },
  { key: 'review', label: '间隔复习', icon: RotateCw, path: '/review' },
  { key: 'promo', label: '晋级赛', icon: BarChart3, path: '/promo' },
  { key: 'rank', label: '排行榜', icon: Crown, path: '/rank' },
  { key: 'library', label: '资料库', icon: Library, path: '/library' },
  { key: 'quiz', label: '刷题', icon: PencilLine, path: '/quiz' },
  { key: 'practice', label: '陪练', icon: MessagesSquare, path: '/practice' },
  { key: 'dashboard', label: '学习看板', icon: BarChart3, path: '/dashboard' },
]

export function Sidebar() {
  const { sidebarCollapsed: collapsed, setSidebarCollapsed } = useUiTheme()
  const [subOpen, setSubOpen] = useState(true)
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const stub = () => showToast('该模块即将上线')

  const isActive = (item: NavItem) => item.path !== undefined && pathname === item.path

  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col border-r border-line bg-white transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-[224px]'
      }`}
    >
      {/* 品牌区 */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <img
          src="/logo.png"
          alt="LearnRise"
          className="h-10 w-10 shrink-0 select-none rounded-full object-cover object-[50%_38%] ring-1 ring-line"
          draggable={false}
        />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-ink">LearnRise</div>
            <div className="truncate text-[10px] text-ink-mute">以竞赛点亮学习之路</div>
          </div>
        )}
      </div>
      <button
        onClick={() => setSidebarCollapsed((v) => !v)}
        aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        className="absolute right-2 top-6 flex h-6 w-6 items-center justify-center rounded-md text-ink-mute hover:bg-page hover:text-ink-soft"
      >
        <ChevronsLeft size={15} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* 导航 */}
      <nav className="mt-3 flex flex-col gap-1 px-3">
        <button
          onClick={() => navigate(PRIMARY_ITEM.path ?? '/')}
          className={`flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold ${
            collapsed ? 'justify-center px-0' : ''
          } ${isActive(PRIMARY_ITEM) ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-page hover:text-ink'}`}
          title={PRIMARY_ITEM.label}
        >
          <PRIMARY_ITEM.icon size={17} />
          {!collapsed && <span className="flex-1 text-left">{PRIMARY_ITEM.label}</span>}
          {!collapsed && (
            <span
              role="button"
              aria-label={subOpen ? '折叠子菜单' : '展开子菜单'}
              tabIndex={0}
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/70"
              onClick={(e) => {
                e.stopPropagation()
                setSubOpen((v) => !v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  setSubOpen((v) => !v)
                }
              }}
            >
              <ChevronDown
                size={14}
                className={`text-current opacity-60 transition-transform ${subOpen ? '' : '-rotate-90'}`}
              />
            </span>
          )}
        </button>
        {!collapsed && subOpen
          ? SUB_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => (item.path ? navigate(item.path) : stub())}
                className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] ${
                  isActive(item)
                    ? 'bg-primary-soft font-semibold text-primary'
                    : 'text-ink-soft hover:bg-page hover:text-ink'
                } pl-9`}
                title={item.label}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            ))
          : null}
      </nav>

      {/* 个人中心 */}
      <div className="mt-6 border-t border-line px-3 pt-3">
        <button
          onClick={() => navigate('/profile')}
          className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] ${
            collapsed ? 'justify-center px-0' : ''
          } ${
            pathname === '/profile'
              ? 'bg-primary-soft font-semibold text-primary'
              : 'text-ink-soft hover:bg-page hover:text-ink'
          }`}
        >
          <User size={16} />
          {!collapsed && <span className="flex-1 text-left">个人中心</span>}
          {!collapsed && <ChevronRight size={14} className="text-current opacity-60" />}
        </button>
      </div>

      {/* 底部装饰：雪山旅人插画，与侧边栏白色背景融合 */}
      <div className="relative mt-auto overflow-hidden">
        {!collapsed && (
          <div className="absolute left-5 top-2 z-10 -rotate-6 text-[12px] font-medium leading-4 tracking-wide text-[#7d97bd]">
            在竞赛中遇见
            <br />
            更好的自己
          </div>
        )}
        <img
          src="/mountain-traveler.jpg"
          alt=""
          aria-hidden="true"
          className={`block select-none ${collapsed ? 'hidden' : ''}`}
          style={{
            width: '145%',
            maxWidth: 'none',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
          }}
          draggable={false}
        />
      </div>
    </aside>
  )
}
