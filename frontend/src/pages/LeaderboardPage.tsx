import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { api, ApiError, fetchLeaderboardPage } from '@/api/client'
import type { Competition, LeaderboardEntry } from '@/api/types'
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { Podium } from '@/components/leaderboard/Podium'
import { RankRow } from '@/components/leaderboard/RankRow'

const PAGE_SIZE = 10
const MAX_ITEMS = 100

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback
}

function mergeUnique(current: LeaderboardEntry[], incoming: LeaderboardEntry[]): LeaderboardEntry[] {
  const seen = new Set(current.map((entry) => entry.userId))
  const merged = [...current]
  for (const entry of incoming) {
    if (seen.has(entry.userId)) continue
    seen.add(entry.userId)
    merged.push(entry)
  }
  return merged.sort((a, b) => a.rank - b.rank)
}

function computeHasMore(loaded: number, pageLength: number, total: number | null): boolean {
  if (loaded >= MAX_ITEMS || pageLength === 0) return false
  if (total !== null) return loaded < total
  return pageLength === PAGE_SIZE
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [competitionId, setCompetitionId] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const abortRef = useRef<AbortController | null>(null)
  const requestSeq = useRef(0)
  const entriesRef = useRef<LeaderboardEntry[]>([])
  const competitionIdRef = useRef('')
  const loadingRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(false)

  const applyEntries = useCallback((next: LeaderboardEntry[]) => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  const applyHasMore = useCallback((next: boolean) => {
    hasMoreRef.current = next
    setHasMore(next)
  }, [])

  const loadFirstPage = useCallback(
    async (id: string) => {
      if (!id) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++requestSeq.current

      loadingRef.current = true
      loadingMoreRef.current = false
      hasMoreRef.current = false
      setLoading(true)
      setLoadingMore(false)
      setHasMore(false)
      setError(null)
      applyEntries([])

      try {
        const page = await fetchLeaderboardPage(id, { limit: PAGE_SIZE, offset: 0 }, controller.signal)
        if (seq !== requestSeq.current) return
        const items = mergeUnique([], page.items)
        applyEntries(items)
        applyHasMore(computeHasMore(items.length, page.items.length, page.total))
      } catch (err) {
        if (isAbortError(err) || seq !== requestSeq.current) return
        applyEntries([])
        setError(errorMessage(err, '排行榜加载失败，请稍后重试'))
      } finally {
        if (seq === requestSeq.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [applyEntries, applyHasMore],
  )

  const loadMore = useCallback(async () => {
    const id = competitionIdRef.current
    if (!id || loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return

    const seq = requestSeq.current
    const offset = entriesRef.current.length
    const controller = new AbortController()
    abortRef.current = controller

    loadingMoreRef.current = true
    setLoadingMore(true)

    try {
      const page = await fetchLeaderboardPage(id, { limit: PAGE_SIZE, offset }, controller.signal)
      if (seq !== requestSeq.current) return
      const merged = mergeUnique(entriesRef.current, page.items)
      applyEntries(merged)
      applyHasMore(computeHasMore(merged.length, page.items.length, page.total))
    } catch (err) {
      if (isAbortError(err) || seq !== requestSeq.current) return
      showToast(errorMessage(err, '加载更多失败，请稍后重试'))
    } finally {
      if (seq === requestSeq.current) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [applyEntries, applyHasMore, showToast])

  const loadCompetitions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listCompetitions()
      setCompetitions(list)
      if (list.length === 0) {
        loadingRef.current = false
        setLoading(false)
        return
      }
      setCompetitionId(list[0].id)
    } catch (err) {
      setError(errorMessage(err, '竞赛列表加载失败'))
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCompetitions()
  }, [loadCompetitions])

  useEffect(() => {
    competitionIdRef.current = competitionId
    if (competitionId) void loadFirstPage(competitionId)
  }, [competitionId, loadFirstPage])

  useEffect(() => {
    return () => {
      requestSeq.current += 1
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const sorted = [...entries].sort((a, b) => a.rank - b.rank)
  const champion = sorted.find((entry) => entry.rank === 1)
  const runnersUp = sorted.filter((entry) => entry.rank === 2 || entry.rank === 3)
  const rest = sorted.filter((entry) => entry.rank > 3)
  const showBoard = !loading && !error && entries.length > 0
  const showEmpty = !loading && !error && entries.length === 0

  return (
    <div className="relative w-full px-6 py-6">
      <img
        src="/misty-mountains.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-0 h-[190px] w-full select-none object-cover object-bottom"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 70%)',
        }}
        draggable={false}
      />

      <div className="relative z-10">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative z-40">
              <button
                type="button"
                aria-label="选择竞赛"
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                disabled={competitions.length === 0}
                onClick={() => setMenuOpen((open) => !open)}
                className="rank-glass-trigger flex h-11 w-56 items-center justify-between gap-3 px-4 text-left text-[13px] text-ink disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{competitions.find((c) => c.id === competitionId)?.title ?? '暂无竞赛'}</span>
                <ChevronDown size={15} className={`shrink-0 text-ink-mute transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </button>
              {menuOpen && (
                <div role="listbox" aria-label="竞赛列表" className="rank-glass-menu absolute right-0 top-full mt-2 max-h-64 w-56 overflow-y-auto p-2">
                  {competitions.map((c) => (
                    <button key={c.id} type="button" role="option" aria-selected={c.id === competitionId} onClick={() => { setCompetitionId(c.id); setMenuOpen(false) }} className={`block w-full rounded-xl px-3 py-2.5 text-left text-[13px] transition ${c.id === competitionId ? 'bg-primary/10 font-semibold text-primary' : 'text-ink-soft hover:bg-white/70 hover:text-primary'}`}>
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost flex h-11 w-11 items-center justify-center rounded-full p-0"
              onClick={() => void loadFirstPage(competitionId)}
              disabled={loading || !competitionId}
              aria-label="刷新排行榜"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="card mt-5" data-testid="leaderboard-loading">
            <LoadingView />
          </div>
        )}

        {!loading && error && (
          <div className="card mt-5" data-testid="leaderboard-error">
            <ErrorView
              message={error}
              onRetry={() => {
                if (competitionId) void loadFirstPage(competitionId)
                else void loadCompetitions()
              }}
            />
          </div>
        )}

        {showEmpty && (
          <div className="card mt-5" data-testid="leaderboard-empty">
            <EmptyView title="该竞赛暂无榜单数据" description="等成员开始学习后，这里会展示连续名次与积分。" />
          </div>
        )}

        {showBoard && (
          <>
            <Podium champion={champion} runnersUp={runnersUp} />

            {rest.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                {rest.map((entry) => (
                  <RankRow key={entry.userId} entry={entry} />
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-col items-center gap-2">
              {hasMore ? (
                <button
                  type="button"
                  className="btn-ghost h-9 px-5"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              ) : (
                <span className="text-[13px] text-ink-mute" data-testid="leaderboard-end">
                  已显示全部
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
