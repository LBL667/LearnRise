import { useLocation, useNavigate } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import PracticePage from './PracticePage'
import ReviewPage from './ReviewPage'
import { MindMapPanel } from '@/components/prep/MindMapPanel'
import { StudyAssistantPanel } from '@/components/prep/StudyAssistantPanel'
import { WrongQuestionsPanel } from '@/components/prep/WrongQuestionsPanel'

type PrepTab = 'assistant' | 'wrong' | 'mindmap' | 'dashboard' | 'practice' | 'review'

const TABS: { key: PrepTab; label: string }[] = [
  { key: 'assistant', label: '学习助手' },
  { key: 'wrong', label: '错题收藏' },
  { key: 'mindmap', label: '思维导图' },
  { key: 'dashboard', label: '学习看板' },
  { key: 'practice', label: '陪练' },
  { key: 'review', label: '间隔复习' },
]

export default function PrepPage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const routeTabs: Record<string, PrepTab> = { '/dashboard': 'dashboard', '/practice': 'practice', '/review': 'review' }
  const requestedTab = new URLSearchParams(search).get('tab')
  const prepTab: PrepTab = requestedTab === 'wrong' || requestedTab === 'mindmap' ? requestedTab : 'assistant'
  const tab = routeTabs[pathname] ?? prepTab

  const selectTab = (next: PrepTab) => {
    if (next === 'dashboard' || next === 'practice' || next === 'review') {
      navigate(`/${next}`)
    } else {
      navigate(next === 'assistant' ? '/prep' : `/prep?tab=${next}`)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-6 pb-6 pt-3">
      {/* 标签页（页面大标题按需求移除） */}
      <div className="z-10 shrink-0 overflow-hidden rounded-[20px] border border-white/70 bg-white/35 shadow-sm backdrop-blur-md">
        <div className="grid w-full grid-cols-3 gap-x-1 px-2 min-[800px]:grid-cols-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={`relative min-w-0 px-1 py-3 text-center text-[13px] font-medium transition-colors sm:text-[14px] ${
                tab === t.key ? 'text-primary' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 面板 */}
      <div className={`min-h-0 min-w-0 flex-1 ${tab === 'dashboard' || tab === 'practice' || tab === 'review' ? '-mt-10 overflow-y-auto overflow-x-hidden pt-10' : '-mt-10 overflow-hidden pt-[60px]'}`}>
        {tab === 'assistant' && <StudyAssistantPanel />}
        {tab === 'wrong' && <WrongQuestionsPanel />}
        {tab === 'mindmap' && <MindMapPanel />}
        {tab === 'dashboard' && <DashboardPage />}
        {tab === 'practice' && <PracticePage />}
        {tab === 'review' && <ReviewPage />}
      </div>
    </div>
  )
}
