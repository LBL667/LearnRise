import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import type { Competition } from '@/api/types'
import { CompetitionCard } from '@/components/competition/CompetitionCard'
import { CreateCompetitionModal } from '@/components/create/CreateCompetitionModal'
import { useToast } from '@/components/ui/Toast'

export default function CommunityPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteInput, setInviteInput] = useState('')
  const { showToast } = useToast()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCompetitions(await api.listCompetitions())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleJoin = async () => {
    const code = inviteInput.trim()
    if (!code) {
      showToast('请先输入邀请码', 'error')
      return
    }
    const found = await api.findByInviteCode(code)
    if (found) {
      navigate(`/competition/${found.id}`)
    } else {
      showToast('邀请码无效或竞赛不存在', 'error')
    }
  }

  return (
    <div className="w-full px-6 py-6">
      {/* 页头控件（标题按需求移除） */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <span className="text-base leading-none">+</span> 创建学习竞赛
          </button>
          <input
            className="field-input w-56"
            placeholder="输入竞赛邀请码"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
          />
          <button className="btn-ghost" onClick={() => void handleJoin()}>
            加入竞赛
          </button>
        </div>
      </div>

      {/* 竞赛列表 */}
      <div className="mt-6 flex flex-col gap-4">
        {loading && <div className="card p-10 text-center text-sm text-ink-mute">正在加载竞赛…</div>}
        {!loading && competitions.map((c) => <CompetitionCard key={c.id} competition={c} />)}
      </div>

      {/* 创建竞赛分步弹窗 */}
      {createOpen && (
        <CreateCompetitionModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => void load()}
        />
      )}
    </div>
  )
}
