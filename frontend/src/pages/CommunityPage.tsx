import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '@/api/client'
import type { Competition } from '@/api/types'
import { CompetitionCard } from '@/components/competition/CompetitionCard'
import { CreateCompetitionModal } from '@/components/create/CreateCompetitionModal'
import { useToast } from '@/components/ui/Toast'

export default function CommunityPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteInput, setInviteInput] = useState('')
  const [error, setError] = useState('')
  const { showToast } = useToast()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCompetitions(await api.listCompetitions())
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : '竞赛列表加载失败，请稍后重试')
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
    try {
      const joined = await api.joinCompetition(code)
      showToast(`已加入「${joined.title}」`, 'success')
      await load()
      navigate(`/competition/${joined.id}`)
    } catch (caught) {
      if (caught instanceof ApiError) {
        const messageByCode: Record<string, string> = {
          JOIN_INVITE_INVALID: '邀请码无效或已过期',
          ALREADY_MEMBER: '你已经加入该竞赛',
          COMPETITION_FULL: '竞赛人数已满',
        }
        showToast(messageByCode[caught.code ?? ''] ?? caught.detail, 'error')
      } else {
        showToast('加入失败，请稍后重试', 'error')
      }
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
        {!loading && error && (
          <div className="card p-10 text-center">
            <p className="text-sm text-[#e25050]">{error}</p>
            <button className="btn-ghost mt-4" onClick={() => void load()}>
              重新加载
            </button>
          </div>
        )}
        {!loading && !error && competitions.length === 0 && (
          <div className="card p-10 text-center text-sm text-ink-mute">
            还没有加入任何竞赛，创建一个或用邀请码加入。
          </div>
        )}
        {!loading &&
          !error &&
          competitions.map((c) => <CompetitionCard key={c.id} competition={c} />)}
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
