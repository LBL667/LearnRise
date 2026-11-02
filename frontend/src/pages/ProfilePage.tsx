import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Award, CalendarDays, Check, ChevronRight, FileText, Gem, Pencil, Star, Trophy, User } from 'lucide-react'
import { api } from '@/api/client'
import type {
  CompetitionRecord,
  ProfileInfo,
  ProfileStat,
} from '@/api/types'
import { CoverArt } from '@/components/competition/CoverArt'
import { MemberAvatar } from '@/components/members/MemberAvatar'
import { AvatarPicker, useProfileAvatar } from '@/components/members/AvatarPicker'
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

function GradePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<'高中' | '大学'>(value.startsWith('高中') ? '高中' : '大学')
  const [position, setPosition] = useState({ left: 0, top: 0, side: 'right' as 'left' | 'right' })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    const closeOnMove = () => setOpen(false)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', closeOnMove)
    window.addEventListener('scroll', closeOnMove, true)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); window.removeEventListener('resize', closeOnMove); window.removeEventListener('scroll', closeOnMove, true) }
  }, [open])
  const show = () => {
    if (open) { setOpen(false); return }
    const rect = trigger.current!.getBoundingClientRect()
    const width = Math.min(264, window.innerWidth - 24)
    const right = rect.right + 12
    const side = right + width <= window.innerWidth - 12 ? 'right' : 'left'
    const left = side === 'right' ? right : Math.max(12, rect.left - width - 12)
    setPosition({ left, top: Math.max(12, Math.min(rect.top, window.innerHeight - 320)), side })
    setLevel(value.startsWith('高中') ? '高中' : '大学')
    setOpen(true)
  }
  return <>
    <button ref={trigger} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={show} className="flex min-h-[58px] w-full flex-col justify-center gap-1 rounded-[18px] border border-[#e8effa] bg-[#f5f8ff] px-3.5 py-2 text-left transition hover:border-[#c6dbfa] focus-visible:outline-2 focus-visible:outline-primary">
      <span className="flex items-center gap-1.5 text-[12px] text-ink-mute"><User size={13} /> 所在年级</span><span className="flex items-center justify-between text-[13px] font-medium text-ink">{value || '请选择年级'} <ChevronRight size={14} className="text-ink-mute" /></span>
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label="选择所在年级" className={`grade-picker grade-picker--${position.side}`} style={{ left: position.left, top: position.top }}>
      <div className="grade-picker__content"><div className="grade-picker__title">选择所在年级</div><div className="grade-picker__section-label">学段</div><div className="grade-picker__levels">{(['高中', '大学'] as const).map((item) => <button type="button" key={item} aria-pressed={level === item} onClick={() => setLevel(item)}>{item}</button>)}</div>
        <div className="grade-picker__section-label grade-picker__section-label--grades">{level} · 具体年级</div><div className="grade-picker__grades">{(level === '高中' ? ['一年级', '二年级', '三年级'] : ['一年级', '二年级', '三年级', '四年级', '五年级']).map((grade) => <button type="button" key={grade} aria-pressed={value === level + grade} onClick={() => { onChange(level + grade); setOpen(false); trigger.current?.focus() }}><span>{grade}</span>{value === level + grade && <Check size={15} aria-hidden="true" />}</button>)}</div>
      </div>
    </div>, document.body)}
  </>
}

export default function ProfilePage() {
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [stats, setStats] = useState<ProfileStat[]>([])
  const [records, setRecords] = useState<CompetitionRecord[]>([])
  const [details, setDetails] = useState({ grade: '', strengths: '' })
  const [avatarOpen, setAvatarOpen] = useState(false)
  const closeAvatar = useCallback(() => setAvatarOpen(false), [])
  const avatar = useProfileAvatar()
  const { showToast } = useToast()

  useEffect(() => {
    void (async () => {
      const [i, s, r] = await Promise.all([
        api.getProfileInfo(),
        api.getProfileStats(),
        api.getCompetitionRecords(),
      ])
      setInfo(i)
      setDetails({ grade: i.grade, strengths: i.strengths.join('、') })
      setStats(s)
      setRecords(r)
    })()
  }, [])

  if (!info) {
    return <div className="w-full px-6 py-6"><div className="card p-10 text-center text-sm text-ink-mute">正在加载个人中心…</div></div>
  }

  return (
    <div className="flex h-full min-h-[520px] w-full flex-col px-5 py-3">
      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左：个人卡 */}
        <aside className="w-[260px] shrink-0">
          <div className="card flex h-full flex-col overflow-hidden">
            {/* 头图：复用雾岭山峦插画 */}
            <div className="relative h-20 shrink-0 overflow-hidden">
              <img
                src="/misty-mountains.jpg"
                alt=""
                aria-hidden="true"
                className="absolute bottom-0 left-0 w-[145%] max-w-none select-none"
                draggable={false}
              />
            </div>
            <div className="relative flex flex-1 flex-col px-5 pb-4">
              <div className="relative -mt-10 flex justify-center">
                {avatar ? <img src={avatar} alt={`${info.name}的头像`} className="h-[76px] w-[76px] rounded-full border-4 border-white bg-[#eaf2ff] object-cover shadow-md" /> : <MemberAvatar name={info.name} hue={212} size={76} className="border-4 border-white shadow-md" />}
                <button
                  aria-label="编辑头像"
                  onClick={() => setAvatarOpen(true)}
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

              <div className="mt-4 min-h-[110px] rounded-[20px] bg-primary-soft/60 px-3.5 py-3.5">
                <p className="text-[12px] leading-5 text-ink-soft">{info.motto}</p>
                <button
                  aria-label="编辑签名"
                  onClick={() => showToast('签名编辑即将上线')}
                  className="mt-1 text-ink-mute transition hover:text-primary"
                >
                  <Pencil size={11} />
                </button>
              </div>

              <div className="mt-4 grid flex-1 grid-rows-3 gap-2.5">
                {([
                  { key: 'strengths', label: '擅长方向', icon: Star },
                ] as const).map(({ key, label, icon: Icon }) => (
                  <label key={key} className="order-3 flex min-h-[58px] cursor-text flex-col justify-center gap-1 rounded-[18px] border border-[#e8effa] bg-[#f5f8ff] px-3.5 py-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <span className="flex items-center gap-1.5 text-[12px] text-ink-mute"><Icon size={13} /> {label}</span>
                    <input aria-label={label} className="w-full min-w-0 bg-transparent text-[13px] font-medium text-ink outline-none" value={details[key]} onChange={(event) => setDetails((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                ))}
                <div className="order-1 flex min-h-[58px] flex-col justify-center gap-1 rounded-[18px] border border-[#e8effa] bg-[#f5f8ff] px-3.5 py-2"><span className="flex items-center gap-1.5 text-[12px] text-ink-mute"><CalendarDays size={13} /> 注册时间</span><span className="text-[13px] font-medium text-ink">{info.joinTime || '暂无记录'}</span></div>
                <div className="order-2 flex"><GradePicker value={details.grade} onChange={(grade) => setDetails((current) => ({ ...current, grade }))} /></div>
              </div>
            </div>
          </div>
        </aside>

        {/* 右：主区 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* 统计卡 */}
          <div className="grid grid-cols-4 gap-3">
            {stats.map((s) => {
              const Icon = STAT_ICONS[s.tone]
              return (
                <div key={s.key} className="card flex items-center gap-3 p-3">
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
          <section className="card flex min-h-0 flex-1 flex-col p-4">
            <h3 className="text-[15px] font-bold text-ink">我的竞赛记录</h3>
            <div className="mt-1 min-h-0 flex-1 divide-y divide-line overflow-y-auto" tabIndex={0} aria-label="竞赛记录列表">
              {records.map((r) => (
                <div key={r.id} className="flex items-center gap-4 py-2">
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


        </div>
      </div>
      {avatarOpen && <AvatarPicker current={avatar} onClose={closeAvatar} />}
    </div>
  )
}
