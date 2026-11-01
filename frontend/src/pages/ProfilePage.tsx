import { useCallback, useEffect, useState } from 'react'
import {
  Award,
  Bell,
  CalendarDays,
  ChevronRight,
  FileText,
  Gem,
  Lock,
  Mail,
  Monitor,
  Pencil,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Star,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type {
  CompetitionRecord,
  ProfileInfo,
  ProfileStat,
  SettingGroup,
  SettingItem,
  StudyProgressItem,
} from '@/api/types'
import { MemberAvatar } from '@/components/members/MemberAvatar'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'

const STAT_ICONS: Record<ProfileStat['tone'], typeof Star> = {
  primary: Star,
  success: Trophy,
  warning: Award,
  violet: FileText,
}

const STAT_BG: Record<ProfileStat['tone'], string> = {
  primary: 'bg-gradient-to-br from-[#5b9bff] to-primary',
  success: 'bg-gradient-to-br from-[#43cf8e] to-[#1e9e6e]',
  warning: 'bg-gradient-to-br from-[#ffb457] to-[#e88a1f]',
  violet: 'bg-gradient-to-br from-[#a58bff] to-[#7c5cf0]',
}

const SETTING_ICONS: Record<SettingItem['icon'], typeof User> = {
  user: User,
  shield: Shield,
  bell: Bell,
  sliders: SlidersHorizontal,
  monitor: Monitor,
  lock: Lock,
}

const ROLE_LABELS: Record<CompetitionRecord['role'], string> = {
  leader: '队长',
  member: '队员',
  viewer: '观察员',
}

const COVER_TILES = [
  'from-[#5b9bff] to-[#7c5cf0]',
  'from-[#43cf8e] to-[#1e9e6e]',
  'from-[#ffb457] to-[#e88a1f]',
  'from-[#ff8f6b] to-[#f2635c]',
]

function SectionHeader({ title, onViewMore }: { title: string; onViewMore: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[15px] font-bold text-ink">{title}</h3>
      <button
        className="flex items-center gap-0.5 text-[12.5px] text-ink-mute transition hover:text-primary"
        onClick={onViewMore}
      >
        查看更多
        <ChevronRight size={13} />
      </button>
    </div>
  )
}

function SettingsCard({ group }: { group: SettingGroup }) {
  const { showToast } = useToast()
  return (
    <section className="card p-5">
      <h3 className="text-[15px] font-bold text-ink">{group.title}</h3>
      <div className="mt-3">
        {group.items.map((item) => {
          const Icon = SETTING_ICONS[item.icon] ?? User
          return (
            <button
              key={item.label}
              onClick={() => showToast(`「${item.label}」即将上线`)}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-page"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">{item.label}</span>
                <span className="block truncate text-[12px] text-ink-mute">{item.description}</span>
              </span>
              {item.value ? (
                <span className="max-w-[120px] truncate text-[12px] text-ink-mute">{item.value}</span>
              ) : null}
              <ChevronRight size={15} className="shrink-0 text-ink-mute transition group-hover:text-primary" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default function ProfilePage() {
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [stats, setStats] = useState<ProfileStat[]>([])
  const [records, setRecords] = useState<CompetitionRecord[]>([])
  const [study, setStudy] = useState<StudyProgressItem[]>([])
  const [groups, setGroups] = useState<SettingGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [i, s, r, st, g] = await Promise.all([
        api.getProfileInfo(),
        api.getProfileStats(),
        api.getCompetitionRecords(),
        api.getStudyProgress(),
        api.getSettingGroups(),
      ])
      setInfo(i)
      setStats(s)
      setRecords(r)
      setStudy(st)
      setGroups(g)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '个人中心加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !info) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card p-10 text-center text-sm text-ink-mute">正在加载个人中心…</div>
      </div>
    )
  }

  if (error && !info) {
    return (
      <div className="w-full px-6 py-6">
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-ink-soft">{error}</p>
          <button className="btn-ghost h-9 px-4" onClick={() => void load()}>
            <RefreshCw size={14} />
            重新加载
          </button>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div className="w-full px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="relative w-fit text-lg font-bold text-ink after:absolute after:-bottom-1.5 after:left-0 after:h-[3px] after:w-8 after:rounded-full after:bg-primary">
          个人中心
        </h1>
        <button
          className="flex items-center gap-1 text-[12.5px] text-ink-mute transition hover:text-primary"
          onClick={() => void load()}
          aria-label="刷新个人中心"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="mt-5 flex gap-5">
        <aside className="w-[260px] shrink-0">
          <div className="card overflow-hidden" data-testid="profile-info">
            <div className="relative h-20 overflow-hidden">
              <img
                src="/misty-mountains.jpg"
                alt=""
                aria-hidden="true"
                className="absolute bottom-0 left-0 w-[145%] max-w-none select-none"
                draggable={false}
              />
            </div>
            <div className="relative px-5 pb-5">
              <div className="relative -mt-10 flex justify-center">
                <MemberAvatar
                  name={info.name}
                  hue={info.avatarHue}
                  size={76}
                  className="border-4 border-white shadow-md"
                />
                <button
                  aria-label="编辑头像"
                  onClick={() => showToast('头像编辑即将上线')}
                  className="absolute -bottom-0.5 right-1/2 translate-x-[30px] rounded-full bg-white p-1 shadow ring-1 ring-line transition hover:text-primary"
                >
                  <Pencil size={11} className="text-ink-soft" />
                </button>
              </div>
              <div className="mt-2.5 text-center">
                <div className="text-[17px] font-bold text-ink">{info.name}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[12.5px] text-ink-mute">
                  <Mail size={12} />
                  {info.email}
                </div>
                <button
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#8f7bf5] to-[#6a5cf0] px-3 py-1 text-[12px] font-medium text-white shadow-sm transition hover:opacity-90"
                  onClick={() => showToast('等级规则说明即将上线')}
                >
                  <Gem size={12} />
                  {info.level}
                  <ChevronRight size={11} />
                </button>
              </div>

              <dl className="mt-4 space-y-2.5 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute"><CalendarDays size={13} /> 加入时间</dt>
                  <dd className="font-medium text-ink">{info.joinedAt}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute"><Trophy size={13} /> 参赛数</dt>
                  <dd className="font-medium text-ink">{info.competitionCount} 场</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute"><User size={13} /> 账号等级</dt>
                  <dd className="font-medium text-ink">{info.level}</dd>
                </div>
              </dl>

              <button
                onClick={() => showToast('等级规则说明即将上线')}
                className="mt-4 flex w-full items-center justify-between border-t border-line pt-3.5 text-[12.5px] text-ink-soft transition hover:text-primary"
              >
                等级说明
                <span className="flex items-center gap-0.5">
                  按复习次数成长
                  <ChevronRight size={13} />
                </span>
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          <div className="grid grid-cols-4 gap-4" data-testid="profile-stats">
            {stats.map((s) => {
              const Icon = STAT_ICONS[s.tone]
              return (
                <div key={s.key} className="card flex items-center gap-3 p-4">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${STAT_BG[s.tone]}`}>
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink-mute">{s.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      <span className="text-[20px] font-bold leading-none text-ink">{s.value}</span>
                      {s.unit ? <span className="text-[11px] font-medium text-ink-mute">{s.unit}</span> : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <section className="card p-5" data-testid="profile-records">
            <SectionHeader title="我的竞赛记录" onViewMore={() => showToast('全部竞赛记录即将上线')} />
            <div className="mt-3 divide-y divide-line">
              {records.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-mute">还没有参加任何竞赛</p>
              ) : (
                records.map((r, index) => (
                  <div key={r.id} className="flex items-center gap-4 py-3.5">
                    <div
                      className={`flex h-[52px] w-[88px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[18px] font-bold text-white ${COVER_TILES[index % COVER_TILES.length]}`}
                      aria-hidden="true"
                    >
                      {r.title.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-ink">{r.title}</span>
                        <Tag tone={r.status === '已结束' ? 'violet' : 'blue'}>{r.status}</Tag>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[12px] text-ink-mute">
                        <span className="flex items-center gap-1">
                          <CalendarDays size={12} />
                          {r.joinedAt}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {r.memberCount} 人
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1.5 text-[13px] font-bold text-[#c98a10]">
                        <Trophy size={14} className="text-gold" />
                        {ROLE_LABELS[r.role] ?? r.role}
                      </div>
                    </div>
                    <button
                      className="btn-ghost h-8 shrink-0 px-3"
                      onClick={() => showToast('竞赛详情即将上线')}
                    >
                      查看详情
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card p-5" data-testid="profile-study">
            <SectionHeader title="最近学习进度" onViewMore={() => showToast('全部学习进度即将上线')} />
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
              {study.map((s) => (
                <div key={s.label} className="group cursor-pointer" onClick={() => showToast('继续学习即将上线')}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-ink group-hover:text-primary">{s.label}</span>
                    <span className="text-ink-mute">
                      {s.value} / {s.total}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-page">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${s.percent}%` }} />
                    </div>
                    <span className="w-9 text-right text-[12px] font-semibold text-primary">{s.percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-5" data-testid="profile-settings">
            {groups.map((g) => (
              <SettingsCard key={g.title} group={g} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
