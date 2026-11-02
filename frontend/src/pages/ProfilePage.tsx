import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  Award,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  ChevronRight,
  FileText,
  Gem,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Pencil,
  RefreshCw,
  Shield,
  Star,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, clearToken, parseApiDetail } from '@/api/client'
import {
  changePassword,
  getPreferences,
  getProfileInfo,
  updateLearningPreferences,
  updateNotificationPreferences,
  updatePrivacyPreferences,
  updateProfileInfo,
  updateUiPreferences,
  uploadAvatar,
} from '@/api/profile'
import type { CompetitionRecord, ProfileInfo, ProfileStat, StudyProgressItem } from '@/api/types'
import type {
  LearningPreferences,
  PrefDifficulty,
  PrefQuestionType,
  PrefTheme,
  Preferences,
  PrivacyPreferences,
  ProfileInfoUpdate,
  UiPreferencesPayload,
} from '@/api/types/profile'
import { MemberAvatar } from '@/components/members/MemberAvatar'
import { Tag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { useUiTheme } from '@/theme/ThemeProvider'

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

const DIFFICULTY_OPTIONS: Array<{ value: PrefDifficulty; label: string }> = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
]

const QUESTION_TYPE_OPTIONS: Array<{ value: PrefQuestionType; label: string }> = [
  { value: 'choice', label: '选择题' },
  { value: 'judge', label: '判断题' },
  { value: 'short_answer', label: '简答题' },
]

const THEME_OPTIONS: Array<{ value: PrefTheme; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const VISIBILITY_OPTIONS: Array<{ value: PrivacyPreferences['name_visibility']; label: string }> = [
  { value: 'public', label: '公开' },
  { value: 'members', label: '仅队友' },
  { value: 'private', label: '隐藏' },
]

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return parseApiDetail(error.detail).message
  return fallback
}

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  label: string
  testId?: string
  onChange: (next: boolean) => void
}

function Toggle({ checked, disabled = false, label, testId, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-[#d5dbe5]'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  testId?: string
  onChange: (next: T) => void
}

function Segmented<T extends string>({
  value,
  options,
  disabled = false,
  testId,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      className="inline-flex rounded-lg border border-line bg-page p-0.5"
      data-testid={testId}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition ${
            value === option.value
              ? 'bg-white text-primary shadow-sm'
              : 'text-ink-mute hover:text-ink'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface SettingCardProps {
  title: string
  description?: string
  icon: typeof User
  children: ReactNode
}

function SettingCard({ title, description, icon: Icon, children }: SettingCardProps) {
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-ink-mute">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

interface SettingRowProps {
  label: string
  hint?: string
  children: ReactNode
}

function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[11.5px] text-ink-mute">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default function ProfilePage() {
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [stats, setStats] = useState<ProfileStat[]>([])
  const [records, setRecords] = useState<CompetitionRecord[]>([])
  const [study, setStudy] = useState<StudyProgressItem[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingNotification, setSavingNotification] = useState(false)
  const [savingLearning, setSavingLearning] = useState(false)
  const [savingUi, setSavingUi] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState(false)

  const [infoOpen, setInfoOpen] = useState(false)
  const [infoForm, setInfoForm] = useState({ display_name: '', school: '', grade: '' })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [learningForm, setLearningForm] = useState<LearningPreferences | null>(null)

  const { applyFromPreferences } = useUiTheme()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextInfo, nextStats, nextRecords, nextStudy, nextPrefs] = await Promise.all([
        getProfileInfo(),
        api.getProfileStats(),
        api.getCompetitionRecords(),
        api.getStudyProgress(),
        getPreferences(),
      ])
      setInfo(nextInfo)
      setStats(nextStats)
      setRecords(nextRecords)
      setStudy(nextStudy)
      setPrefs(nextPrefs)
      setLearningForm(nextPrefs.learning)
      applyFromPreferences(nextPrefs.ui)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '个人中心加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [applyFromPreferences])

  useEffect(() => {
    void load()
  }, [load])

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingAvatar(true)
    try {
      const result = await uploadAvatar(file)
      setInfo((prev) => (prev ? { ...prev, avatarUrl: result.avatarUrl } : prev))
      showToast('头像已更新', 'success')
    } catch (err) {
      showToast(errorMessage(err, '头像上传失败，请稍后重试'), 'error')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const openInfoDialog = () => {
    if (!info) return
    setInfoForm({
      display_name: info.name,
      school: info.school ?? '',
      grade: info.grade ?? '',
    })
    setInfoOpen(true)
  }

  const submitInfo = async (event: FormEvent) => {
    event.preventDefault()
    if (!info) return
    const payload: ProfileInfoUpdate = {}
    const displayName = infoForm.display_name.trim()
    if (displayName && displayName !== info.name) payload.display_name = displayName
    const school = infoForm.school.trim()
    if (school !== (info.school ?? '')) payload.school = school || null
    const grade = infoForm.grade.trim()
    if (grade !== (info.grade ?? '')) payload.grade = grade || null

    if (Object.keys(payload).length === 0) {
      setInfoOpen(false)
      return
    }

    setSavingInfo(true)
    try {
      const updated = await updateProfileInfo(payload)
      setInfo(updated)
      setInfoOpen(false)
      showToast('资料已更新', 'success')
    } catch (err) {
      showToast(errorMessage(err, '资料保存失败，请稍后重试'), 'error')
    } finally {
      setSavingInfo(false)
    }
  }

  const openPasswordDialog = () => {
    setPasswordForm({ current: '', next: '', confirm: '' })
    setPasswordError(null)
    setPasswordOpen(true)
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (passwordForm.next.length < 8) {
      setPasswordError('新密码至少 8 位')
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    setPasswordError(null)
    setSavingPassword(true)
    try {
      await changePassword({
        current_password: passwordForm.current,
        new_password: passwordForm.next,
      })
      setPasswordOpen(false)
      showToast('密码已修改，请使用新密码重新登录', 'success')
      clearToken()
      navigate('/login', { replace: true })
    } catch (err) {
      setPasswordError(errorMessage(err, '密码修改失败，请稍后重试'))
    } finally {
      setSavingPassword(false)
    }
  }

  const toggleNotifications = async (nextEnabled: boolean) => {
    if (!prefs) return
    const previous = prefs
    setSavingNotification(true)
    setPrefs({
      ...prefs,
      notifications: { email_reminders_enabled: nextEnabled },
    })
    try {
      const updated = await updateNotificationPreferences({
        email_reminders_enabled: nextEnabled,
      })
      setPrefs(updated)
      showToast(nextEnabled ? '已开启邮件提醒' : '已关闭邮件提醒', 'success')
    } catch (err) {
      setPrefs(previous)
      showToast(errorMessage(err, '通知设置保存失败'), 'error')
    } finally {
      setSavingNotification(false)
    }
  }

  const updateLearningField = <K extends keyof LearningPreferences>(
    key: K,
    value: LearningPreferences[K],
  ) => {
    setLearningForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const toggleQuestionType = (type: PrefQuestionType) => {
    if (!learningForm) return
    const has = learningForm.default_question_types.includes(type)
    if (has && learningForm.default_question_types.length === 1) {
      showToast('至少保留一种题型', 'error')
      return
    }
    setLearningForm({
      ...learningForm,
      default_question_types: has
        ? learningForm.default_question_types.filter((item) => item !== type)
        : [...learningForm.default_question_types, type],
    })
  }

  const saveLearning = async () => {
    if (!learningForm) return
    if (learningForm.default_question_types.length === 0) {
      showToast('至少选择一种题型', 'error')
      return
    }
    if (learningForm.default_quiz_num < 1 || learningForm.default_quiz_num > 20) {
      showToast('每次题目数量需在 1–20 之间', 'error')
      return
    }
    setSavingLearning(true)
    try {
      const updated = await updateLearningPreferences(learningForm)
      setPrefs(updated)
      setLearningForm(updated.learning)
      showToast('学习偏好已保存', 'success')
    } catch (err) {
      showToast(errorMessage(err, '学习偏好保存失败'), 'error')
    } finally {
      setSavingLearning(false)
    }
  }

  const applyUiChange = async (next: UiPreferencesPayload) => {
    if (!prefs) return
    const previous = prefs
    setSavingUi(true)
    applyFromPreferences(next)
    setPrefs({ ...prefs, ui: next })
    try {
      const updated = await updateUiPreferences(next)
      setPrefs(updated)
      applyFromPreferences(updated.ui)
      showToast('界面设置已保存', 'success')
    } catch (err) {
      setPrefs(previous)
      applyFromPreferences(previous.ui)
      showToast(errorMessage(err, '界面设置保存失败'), 'error')
    } finally {
      setSavingUi(false)
    }
  }

  const applyPrivacyChange = async (next: PrivacyPreferences) => {
    if (!prefs) return
    const previous = prefs
    setSavingPrivacy(true)
    setPrefs({ ...prefs, privacy: next })
    try {
      const updated = await updatePrivacyPreferences(next)
      setPrefs(updated)
      showToast('隐私设置已保存', 'success')
    } catch (err) {
      setPrefs(previous)
      showToast(errorMessage(err, '隐私设置保存失败'), 'error')
    } finally {
      setSavingPrivacy(false)
    }
  }

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

  const savedInfoRows = [
    { label: '昵称', value: info.name },
    { label: '邮箱', value: info.email },
    { label: '学校', value: info.school || '未填写' },
    { label: '年级', value: info.grade || '未填写' },
  ]

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
                <button
                  type="button"
                  aria-label="编辑头像"
                  data-testid="profile-avatar-button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="relative h-[76px] w-[76px] rounded-full transition disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {info.avatarUrl ? (
                    <img
                      src={info.avatarUrl}
                      alt={info.name}
                      data-testid="profile-avatar"
                      className="h-[76px] w-[76px] rounded-full border-4 border-white object-cover shadow-md"
                    />
                  ) : (
                    <MemberAvatar
                      name={info.name}
                      hue={info.avatarHue}
                      size={76}
                      className="border-4 border-white shadow-md"
                    />
                  )}
                  {uploadingAvatar ? (
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[rgba(31,39,51,0.45)]">
                      <Loader2 size={18} className="animate-spin text-white" />
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label="编辑头像"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-0.5 right-1/2 translate-x-[30px] rounded-full bg-white p-1 shadow ring-1 ring-line transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Pencil size={11} className="text-ink-soft" />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="profile-avatar-input"
                  onChange={(event) => void handleAvatarChange(event)}
                />
              </div>
              <div className="mt-2.5 text-center">
                <div className="text-[17px] font-bold text-ink">{info.name}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[12.5px] text-ink-mute">
                  <Mail size={12} />
                  {info.email}
                </div>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#8f7bf5] to-[#6a5cf0] px-3 py-1 text-[12px] font-medium text-white shadow-sm">
                  <Gem size={12} />
                  {info.level}
                </div>
              </div>

              <dl className="mt-4 space-y-2.5 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute">
                    <CalendarDays size={13} /> 加入时间
                  </dt>
                  <dd className="font-medium text-ink">{info.joinedAt}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute">
                    <Trophy size={13} /> 参赛数
                  </dt>
                  <dd className="font-medium text-ink">{info.competitionCount} 场</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-ink-mute">
                    <User size={13} /> 账号等级
                  </dt>
                  <dd className="font-medium text-ink">{info.level}</dd>
                </div>
              </dl>

              <div className="mt-4 flex w-full items-center justify-between border-t border-line pt-3.5 text-[12.5px] text-ink-soft">
                等级说明
                <span className="text-ink-mute">按复习次数成长</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          <div className="grid grid-cols-4 gap-4" data-testid="profile-stats">
            {stats.map((s) => {
              const Icon = STAT_ICONS[s.tone]
              return (
                <div key={s.key} className="card flex items-center gap-3 p-4">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${STAT_BG[s.tone]}`}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink-mute">{s.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      <span className="text-[20px] font-bold leading-none text-ink">{s.value}</span>
                      {s.unit ? (
                        <span className="text-[11px] font-medium text-ink-mute">{s.unit}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <section className="card p-5" data-testid="profile-records">
            <h3 className="text-[15px] font-bold text-ink">我的竞赛记录</h3>
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
                        <span className="truncate text-[14px] font-semibold text-ink">
                          {r.title}
                        </span>
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
                      data-testid="profile-record-detail"
                      onClick={() => navigate(`/competition/${r.id}`)}
                    >
                      查看详情
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card p-5" data-testid="profile-study">
            <h3 className="text-[15px] font-bold text-ink">最近学习进度</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4">
              {study.map((s) => (
                <div key={s.label}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-ink">{s.label}</span>
                    <span className="text-ink-mute">
                      {s.value} / {s.total}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-page">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${s.percent}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-[12px] font-semibold text-primary">
                      {s.percent}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-5" data-testid="profile-settings">
            <SettingCard
              title="基本信息"
              description="昵称、学校与年级会展示在你的资料卡上。"
              icon={User}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                {savedInfoRows.map((row) => (
                  <div key={row.label} className="min-w-0">
                    <dt className="text-ink-mute">{row.label}</dt>
                    <dd className="truncate font-medium text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                className="btn-ghost mt-4 h-8 px-3"
                data-testid="settings-edit-info"
                onClick={openInfoDialog}
                disabled={savingInfo}
              >
                {savingInfo ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                编辑资料
              </button>
            </SettingCard>

            <SettingCard
              title="安全设置"
              description="修改密码后需要使用新密码重新登录。"
              icon={Shield}
            >
              <button
                type="button"
                className="btn-ghost h-8 px-3"
                data-testid="settings-change-password"
                onClick={openPasswordDialog}
                disabled={savingPassword}
              >
                <Lock size={13} />
                修改密码
              </button>
            </SettingCard>

            <SettingCard title="通知设置" description="到期复习与竞赛提醒。" icon={Bell}>
              <SettingRow label="邮件提醒" hint="每天发送到期复习邮件">
                <Toggle
                  checked={prefs?.notifications.email_reminders_enabled ?? false}
                  disabled={savingNotification || !prefs}
                  label="邮件提醒"
                  testId="settings-notifications-toggle"
                  onChange={(next) => void toggleNotifications(next)}
                />
              </SettingRow>
            </SettingCard>

            <SettingCard title="学习偏好" description="生成练习时的默认参数。" icon={BookOpen}>
              {learningForm ? (
                <div className="space-y-3">
                  <SettingRow label="默认难度">
                    <select
                      className="field-input w-[110px]"
                      data-testid="settings-learning-difficulty"
                      value={learningForm.default_difficulty}
                      disabled={savingLearning}
                      onChange={(event) =>
                        updateLearningField(
                          'default_difficulty',
                          event.target.value as PrefDifficulty,
                        )
                      }
                    >
                      {DIFFICULTY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                  <div>
                    <div className="text-[13px] font-semibold text-ink">题型</div>
                    <div className="mt-1.5 flex flex-wrap gap-3">
                      {QUESTION_TYPE_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"
                        >
                          <input
                            type="checkbox"
                            data-testid={`settings-learning-type-${option.value}`}
                            checked={learningForm.default_question_types.includes(option.value)}
                            disabled={savingLearning}
                            onChange={() => toggleQuestionType(option.value)}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <SettingRow label="每次题量" hint="1–20 道">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className="field-input w-[90px]"
                      data-testid="settings-learning-num"
                      value={learningForm.default_quiz_num}
                      disabled={savingLearning}
                      onChange={(event) =>
                        updateLearningField('default_quiz_num', Number(event.target.value))
                      }
                    />
                  </SettingRow>
                  <button
                    type="button"
                    className="btn-primary h-8 px-3"
                    data-testid="settings-learning-save"
                    onClick={() => void saveLearning()}
                    disabled={savingLearning}
                  >
                    {savingLearning ? <Loader2 size={13} className="animate-spin" /> : null}
                    保存偏好
                  </button>
                </div>
              ) : null}
            </SettingCard>

            <SettingCard title="界面设置" description="修改后立即生效并同步到账号。" icon={Monitor}>
              {prefs ? (
                <div className="space-y-3">
                  <SettingRow label="主题">
                    <Segmented
                      value={prefs.ui.theme}
                      options={THEME_OPTIONS}
                      disabled={savingUi}
                      testId="settings-ui-theme"
                      onChange={(theme) => void applyUiChange({ ...prefs.ui, theme })}
                    />
                  </SettingRow>
                  <SettingRow label="收起侧边栏">
                    <Toggle
                      checked={prefs.ui.sidebar_collapsed}
                      disabled={savingUi}
                      label="收起侧边栏"
                      testId="settings-ui-sidebar"
                      onChange={(sidebar_collapsed) =>
                        void applyUiChange({ ...prefs.ui, sidebar_collapsed })
                      }
                    />
                  </SettingRow>
                  <SettingRow label="紧凑表格">
                    <Toggle
                      checked={prefs.ui.compact_tables}
                      disabled={savingUi}
                      label="紧凑表格"
                      testId="settings-ui-compact"
                      onChange={(compact_tables) =>
                        void applyUiChange({ ...prefs.ui, compact_tables })
                      }
                    />
                  </SettingRow>
                </div>
              ) : null}
            </SettingCard>

            <SettingCard title="隐私设置" description="控制你在排行榜中的展示方式。" icon={Shield}>
              {prefs ? (
                <div className="space-y-3">
                  <SettingRow label="匿名参与排行" hint="排行榜显示为「匿名用户」">
                    <Toggle
                      checked={prefs.privacy.leaderboard_anonymous}
                      disabled={savingPrivacy}
                      label="匿名参与排行"
                      testId="settings-privacy-anonymous"
                      onChange={(leaderboard_anonymous) =>
                        void applyPrivacyChange({ ...prefs.privacy, leaderboard_anonymous })
                      }
                    />
                  </SettingRow>
                  <SettingRow label="姓名可见度">
                    <Segmented
                      value={prefs.privacy.name_visibility}
                      options={VISIBILITY_OPTIONS}
                      disabled={savingPrivacy}
                      testId="settings-privacy-visibility"
                      onChange={(name_visibility) =>
                        void applyPrivacyChange({ ...prefs.privacy, name_visibility })
                      }
                    />
                  </SettingRow>
                </div>
              ) : null}
            </SettingCard>
          </div>

          <Link
            to="/settings/agents"
            className="card flex items-center gap-3 p-5 transition hover:border-primary/40"
            data-testid="profile-agent-settings"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Bot size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">Agent 设置</span>
              <span className="block truncate text-[12px] text-ink-mute">
                配置自定义 Agent 的模型、密钥与系统提示词
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-mute" />
          </Link>
        </div>
      </div>

      {infoOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(31,39,51,0.42)] p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="编辑基本信息"
            data-testid="profile-info-dialog"
            className="modal-panel w-full max-w-[440px] rounded-[14px] border border-line bg-white p-5 shadow-xl"
            onSubmit={(event) => void submitInfo(event)}
            noValidate
          >
            <h2 className="text-[15px] font-bold text-ink">编辑基本信息</h2>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">昵称</span>
                <input
                  className="field-input mt-1"
                  data-testid="profile-display-name-input"
                  value={infoForm.display_name}
                  maxLength={128}
                  disabled={savingInfo}
                  onChange={(event) =>
                    setInfoForm((prev) => ({ ...prev, display_name: event.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">学校</span>
                <input
                  className="field-input mt-1"
                  data-testid="profile-school-input"
                  value={infoForm.school}
                  maxLength={64}
                  disabled={savingInfo}
                  onChange={(event) =>
                    setInfoForm((prev) => ({ ...prev, school: event.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">年级</span>
                <input
                  className="field-input mt-1"
                  data-testid="profile-grade-input"
                  value={infoForm.grade}
                  maxLength={32}
                  disabled={savingInfo}
                  onChange={(event) =>
                    setInfoForm((prev) => ({ ...prev, grade: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-gray"
                onClick={() => setInfoOpen(false)}
                disabled={savingInfo}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-primary"
                data-testid="profile-info-save"
                disabled={savingInfo}
              >
                {savingInfo ? <Loader2 size={13} className="animate-spin" /> : null}
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {passwordOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(31,39,51,0.42)] p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="修改密码"
            data-testid="profile-password-dialog"
            className="modal-panel w-full max-w-[440px] rounded-[14px] border border-line bg-white p-5 shadow-xl"
            onSubmit={(event) => void submitPassword(event)}
            noValidate
          >
            <h2 className="text-[15px] font-bold text-ink">修改密码</h2>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">当前密码</span>
                <input
                  type="password"
                  className="field-input mt-1"
                  data-testid="profile-current-password"
                  value={passwordForm.current}
                  disabled={savingPassword}
                  onChange={(event) =>
                    setPasswordForm((prev) => ({ ...prev, current: event.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">新密码（至少 8 位）</span>
                <input
                  type="password"
                  className="field-input mt-1"
                  data-testid="profile-new-password"
                  value={passwordForm.next}
                  disabled={savingPassword}
                  onChange={(event) =>
                    setPasswordForm((prev) => ({ ...prev, next: event.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-semibold text-ink-soft">确认新密码</span>
                <input
                  type="password"
                  className="field-input mt-1"
                  data-testid="profile-confirm-password"
                  value={passwordForm.confirm}
                  disabled={savingPassword}
                  onChange={(event) =>
                    setPasswordForm((prev) => ({ ...prev, confirm: event.target.value }))
                  }
                />
              </label>
              {passwordError ? (
                <p className="text-[12.5px] text-[#e25050]" data-testid="profile-password-error">
                  {passwordError}
                </p>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-gray"
                onClick={() => setPasswordOpen(false)}
                disabled={savingPassword}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-primary"
                data-testid="profile-password-save"
                disabled={savingPassword}
              >
                {savingPassword ? <Loader2 size={13} className="animate-spin" /> : null}
                确认修改
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
