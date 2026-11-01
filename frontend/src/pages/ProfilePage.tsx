import { useEffect, useState } from 'react'
import {
  Award,
  Bell,
  CalendarDays,
  ChevronRight,
  FileText,
  Gem,
  Lock,
  Monitor,
  Pencil,
  Shield,
  SlidersHorizontal,
  Star,
  Trophy,
  User,
} from 'lucide-react'
import { api } from '@/api/client'
import type {
  CompetitionRecord,
  ProfileInfo,
  ProfileStat,
  SettingGroup,
  SettingItem,
  StudyProgressItem,
} from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { MemberAvatar } from '@/components/members/MemberAvatar'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'

const STAT_ICONS: Record<ProfileStat['tone'], typeof Star> = {
  blue: Star,
  green: Trophy,
  violet: Award,
  red: FileText,
}

const STAT_BG: Record<ProfileStat['tone'], string> = {
  blue: 'bg-gradient-to-br from-[#5b9bff] to-primary',
  green: 'bg-gradient-to-br from-[#43cf8e] to-[#1e9e6e]',
  violet: 'bg-gradient-to-br from-[#a58bff] to-[#7c5cf0]',
  red: 'bg-gradient-to-br from-[#ff8f6b] to-[#f2635c]',
}

const SETTING_ICONS: Record<SettingItem['icon'], typeof User> = {
  user: User,
  shield: Shield,
  bell: Bell,
  sliders: SlidersHorizontal,
  monitor: Monitor,
  lock: Lock,
}

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
              key={item.title}
              onClick={() => showToast(`「${item.title}」即将上线`)}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-page"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">{item.title}</span>
                <span className="block truncate text-[12px] text-ink-mute">{item.desc}</span>
              </span>
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
  const { showToast } = useToast()

  useEffect(() => {
    void (async () => {
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
    })()
  }, [])

  if (!info) {
    return <div className="w-full px-6 py-6"><div className="card p-10 text-center text-sm text-ink-mute">正在加载个人中心…</div></div>
  }

  return (
    <div className="w-full px-6 py-6">
      <h1 className="relative w-fit text-lg font-bold text-ink after:absolute after:-bottom-1.5 after:left-0 after:h-[3px] after:w-8 after:rounded-full after:bg-primary">
        个人中心
      </h1>

      <div className="mt-5 flex gap-5">
        {/* 左：个人卡 */}
        <aside className="w-[260px] shrink-0">
          <div className="card overflow-hidden">
            {/* 头图：复用雾岭山峦插画 */}
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
                <MemberAvatar name={info.name} hue={212} size={76} className="border-4 border-white shadow-md" />
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
                <div className="mt-0.5 text-[12.5px] text-ink-mute">{info.school}</div>
                <button
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#8f7bf5] to-[#6a5cf0] px-3 py-1 text-[12px] font-medium text-white shadow-sm transition hover:opacity-90"
                  onClick={() => showToast('等级规则说明即将上线')}
                >
                  <Gem size={12} />
                  {info.badge}
                  <ChevronRight size={11} />
                </button>
              </div>

              <div className="mt-3.5 rounded-xl bg-primary-soft/60 px-3.5 py-2.5">
                <p className="text-[12px] leading-5 text-ink-soft">{info.motto}</p>
                <button
                  aria-label="编辑签名"
                  onClick={() => showToast('签名编辑即将上线')}
                  className="mt-1 text-ink-mute transition hover:text-primary"
                >
                  <Pencil size={11} />
                </button>
              </div>

              <dl className="mt-4 space-y-2.5 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute"><CalendarDays size={13} /> 加入时间</dt>
                  <dd className="font-medium text-ink">{info.joinTime}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute"><User size={13} /> 所在年级</dt>
                  <dd className="font-medium text-ink">{info.grade}</dd>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <dt className="flex shrink-0 items-center gap-1.5 text-ink-mute"><Star size={13} /> 擅长方向</dt>
                  <dd className="text-right font-medium text-ink">{info.strengths.join('、')}</dd>
                </div>
              </dl>

              <button
                onClick={() => showToast('个人主页功能即将上线')}
                className="mt-4 flex w-full items-center justify-between border-t border-line pt-3.5 text-[12.5px] text-ink-soft transition hover:text-primary"
              >
                个人主页
                <span className="flex items-center gap-0.5">
                  {info.homepage}
                  <ChevronRight size={13} />
                </span>
              </button>
            </div>
          </div>
        </aside>

        {/* 右：主区 */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* 统计卡 */}
          <div className="grid grid-cols-4 gap-4">
            {stats.map((s) => {
              const Icon = STAT_ICONS[s.tone]
              return (
                <div key={s.key} className="card flex items-center gap-3 p-4">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${STAT_BG[s.tone]}`}>
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink-mute">{s.label}</div>
                    <div className="mt-0.5 text-[20px] font-bold leading-none text-ink">{s.value}</div>
                    <div className="mt-1 text-[11px] font-medium text-[#2bb673]">较上月 {s.delta}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 我的竞赛记录 */}
          <section className="card p-5">
            <SectionHeader title="我的竞赛记录" onViewMore={() => showToast('全部竞赛记录即将上线')} />
            <div className="mt-3 divide-y divide-line">
              {records.map((r) => (
                <div key={r.id} className="flex items-center gap-4 py-3.5">
                  <CoverArt variant={r.cover} className="h-[52px] w-[88px] shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-ink">{r.title}</span>
                      <Tag>{r.level}</Tag>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[12px] text-ink-mute">
                      <CalendarDays size={12} />
                      {r.timeRange}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5 text-[13px] font-bold text-[#c98a10]">
                      <Trophy size={14} className="text-gold" />
                      {r.award}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-ink-mute">{r.rankText}</div>
                  </div>
                  <button
                    className="btn-ghost h-8 shrink-0 px-3"
                    onClick={() => showToast('竞赛详情即将上线')}
                  >
                    查看详情
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* 最近学习进度 */}
          <section className="card p-5">
            <SectionHeader title="最近学习进度" onViewMore={() => showToast('全部学习进度即将上线')} />
            <div className="mt-3 grid grid-cols-3 gap-4">
              {study.map((s) => (
                <div key={s.id} className="group cursor-pointer" onClick={() => showToast('继续学习即将上线')}>
                  <div className="relative overflow-hidden rounded-xl">
                    <CoverArt variant={s.cover} className="h-[92px] w-full" />
                    <span className="absolute right-1.5 top-1.5">
                      <Tag>{s.level}</Tag>
                    </span>
                  </div>
                  <div className="mt-2 truncate text-[13.5px] font-semibold text-ink group-hover:text-primary">{s.title}</div>
                  <div className="mt-0.5 truncate text-[12px] text-ink-mute">上次学习：{s.lastLesson}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-page">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${s.percent}%` }} />
                    </div>
                    <span className="text-[12px] font-semibold text-primary">{s.percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 设置区 */}
          <div className="grid grid-cols-2 gap-5">
            {groups.map((g) => (
              <SettingsCard key={g.title} group={g} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
