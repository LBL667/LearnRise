import { useState } from 'react'
import { BarChart3, ChevronDown, ChevronRight, ChevronsLeft, Crown, FileText, Library, MessagesSquare, PencilLine, RotateCw, Trophy, User } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useToast } from '../ui/Toast'
import { useUiTheme } from '../../theme/ThemeProvider'
import snowhill from '../../../snowhill.png'

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
      <div className={`flex items-center gap-2.5 pb-4 pt-5 ${collapsed ? 'justify-center px-0' : 'pl-4 pr-9'}`}>
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
        className={`absolute top-6 z-30 flex h-6 w-6 items-center justify-center text-ink-mute transition-colors hover:text-primary ${collapsed ? '-right-3 rounded-full border border-line bg-white shadow-sm hover:bg-primary-soft' : 'right-2 rounded-md hover:bg-page'}`}
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

      {/* 原山景作为背景，雪山与飘动旗面叠放在前景。 */}
      {!collapsed && (
        <div className="pointer-events-none relative z-10 mt-auto overflow-hidden" aria-hidden="true">
          <img
            src="/mountain-traveler.jpg"
            alt=""
            className="block select-none"
            style={{ width: '145%', maxWidth: 'none', maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)' }}
            draggable={false}
          />
          {pathname === '/rank' && (
            <img
              src="/misty-mountains.jpg"
              alt=""
              className="sidebar-rank-landscape fixed bottom-0 left-0 z-10 h-[190px] w-screen select-none object-cover object-bottom"
              draggable={false}
            />
          )}
          <svg className="sidebar-snowhill absolute bottom-0 left-0 z-20 block w-full select-none" viewBox="0 0 1902 827" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <mask id="sidebar-snowhill-mask" maskUnits="userSpaceOnUse">
                <rect width="1902" height="827" fill="white" />
                <rect x="1187" y="34" width="270" height="135" fill="black" />
              </mask>
              <clipPath id="sidebar-flag-clip" clipPathUnits="userSpaceOnUse">
                <rect x="1187" y="34" width="270" height="135" />
              </clipPath>
            </defs>
            <image href={snowhill} width="1902" height="827" mask="url(#sidebar-snowhill-mask)" />
            <g clipPath="url(#sidebar-flag-clip)">
              <image className="sidebar-snowhill-flag" href={snowhill} width="1902" height="827" />
            </g>
          </svg>
        </div>
      )}
    </aside>
  )
}
