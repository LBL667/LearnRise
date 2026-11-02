import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Crown, RefreshCw } from 'lucide-react'
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown size={26} className="fill-primary text-primary" />
            <h1 className="text-xl font-bold text-ink">排行榜</h1>
            <span className="ml-1 text-[13px] text-ink-mute">见证每一位探索者的成长与绽放</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                className="field-input h-9 w-56 appearance-none pr-8"
                value={competitionId}
                onChange={(e) => setCompetitionId(e.target.value)}
                disabled={competitions.length === 0}
              >
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-mute"
              />
            </div>
            <button
              type="button"
              className="btn-ghost h-9 px-3"
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
