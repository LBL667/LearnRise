import { useState } from 'react'
import { MindMapPanel } from '@/components/prep/MindMapPanel'
import { StudyAssistantPanel } from '@/components/prep/StudyAssistantPanel'
import { WrongQuestionsPanel } from '@/components/prep/WrongQuestionsPanel'

type PrepTab = 'assistant' | 'wrong' | 'mindmap'

const TABS: { key: PrepTab; label: string }[] = [
  { key: 'assistant', label: '学习助手' },
  { key: 'wrong', label: '错题收藏' },
  { key: 'mindmap', label: '思维导图' },
]

export default function PrepPage() {
  const [tab, setTab] = useState<PrepTab>('assistant')

  return (
    <div className="flex h-full flex-col px-6 py-6">
      {/* 标签页（页面大标题按需求移除） */}
      <div className="border-b border-line bg-white">
        <div className="flex gap-10 px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative py-3 text-[14px] font-medium transition-colors ${
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
      <div className="mt-5 min-h-0 flex-1">
        {tab === 'assistant' && <StudyAssistantPanel />}
        {tab === 'wrong' && <WrongQuestionsPanel />}
        {tab === 'mindmap' && <MindMapPanel />}
      </div>
    </div>
  )
}
