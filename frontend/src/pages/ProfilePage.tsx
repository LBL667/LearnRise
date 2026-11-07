import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Award,
  CalendarDays,
  ChevronRight,
  FileText,
  Loader2,
  Mail,
  Pencil,
  RefreshCw,
  Star,
  Trophy,
  Users,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, clearToken, parseApiDetail } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import {
  changePassword,
  getProfileInfo,
  updateProfileInfo,
  uploadAvatar,
} from '@/api/profile'
import type { CompetitionRecord, ProfileInfo, ProfileStat } from '@/api/types'
import type { ProfileInfoUpdate } from '@/api/types/profile'
import { MemberAvatar } from '@/components/members/MemberAvatar'
import { AvatarPicker } from '@/components/members/AvatarPicker'
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return parseApiDetail(error.detail).message
  return fallback
}

export default function ProfilePage() {
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [stats, setStats] = useState<ProfileStat[]>([])
  const [records, setRecords] = useState<CompetitionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [savingInfo, setSavingInfo] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [infoOpen, setInfoOpen] = useState(false)
  const [infoForm, setInfoForm] = useState({ display_name: '', school: '', grade: '' })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const { showToast } = useToast()
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const closeAvatarPicker = useCallback(() => setAvatarPickerOpen(false), [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextInfo, nextStats, nextRecords] = await Promise.all([
        getProfileInfo(),
        api.getProfileStats(),
        api.getCompetitionRecords(),
      ])
      setInfo(nextInfo)
      setStats(nextStats)
      setRecords(nextRecords)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '个人中心加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleAvatarSave = async (file: File): Promise<boolean> => {
    setUploadingAvatar(true)
    try {
      const result = await uploadAvatar(file)
      const separator = result.avatarUrl.includes('?') ? '&' : '?'
      const avatarUrl = `${result.avatarUrl}${separator}v=${Date.now()}`
      setInfo((prev) => (prev ? { ...prev, avatarUrl } : prev))
      updateUser({ avatar_url: avatarUrl })
      showToast('头像已更新', 'success')
      return true
    } catch (err) {
      showToast(errorMessage(err, '头像上传失败，请稍后重试'), 'error')
      return false
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
      updateUser({ display_name: updated.name })
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
      {avatarPickerOpen && <AvatarPicker onClose={closeAvatarPicker} onSave={handleAvatarSave} saving={uploadingAvatar} />}
      <div className="flex items-center justify-end">
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
          <div className="card flex flex-col overflow-hidden" data-testid="profile-info">
            <div className="relative h-20 shrink-0 overflow-hidden">
              <img
                src="/misty-mountains.jpg"
                alt=""
                aria-hidden="true"
                className="absolute bottom-0 left-0 w-[145%] max-w-none select-none"
                draggable={false}
              />
            </div>
            <div className="relative flex flex-1 flex-col px-5 pb-5">
              <div className="relative -mt-10 flex justify-center">
                <button
                  type="button"
                  aria-label="编辑头像"
                  data-testid="profile-avatar-button"
                  onClick={() => setAvatarPickerOpen(true)}
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
                  onClick={() => setAvatarPickerOpen(true)}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-0.5 right-1/2 translate-x-[30px] rounded-full bg-white p-1 shadow ring-1 ring-line transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Pencil size={11} className="text-ink-soft" />
                </button>

              </div>
              <div className="mt-2.5 text-center">
                <div className="text-[17px] font-bold text-ink">{info.name}</div>
                <div className="mt-2.5 flex items-center justify-center gap-1 text-[12.5px] text-ink-mute">
                  <Mail size={12} />
                  {info.email}
                </div>
              </div>

              <dl className="mt-5 flex flex-col gap-3 text-[12.5px]">
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
                <div className="rounded-[16px] bg-primary-soft/50 px-3 py-3"><dt className="text-ink-mute">学校</dt><dd className="mt-1 break-words font-medium text-ink">{info.school || '未填写'}</dd></div>
                <div className="rounded-[16px] bg-primary-soft/50 px-3 py-3"><dt className="text-ink-mute">年级</dt><dd className="mt-1 break-words font-medium text-ink">{info.grade || '未填写'}</dd></div>
              </dl>

              <button type="button" className="btn-ghost mt-4 h-9 w-full" data-testid="settings-edit-info" onClick={openInfoDialog} disabled={savingInfo}>
                {savingInfo ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                编辑资料
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3" data-testid="profile-settings">
            <button type="button" className="profile-action" data-testid="settings-change-password" onClick={openPasswordDialog} disabled={savingPassword}>修改密码</button>
            <Link to="/settings/agents" className="profile-action" data-testid="profile-agent-settings">Agent 设置</Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
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

          <section className="card flex min-h-[360px] flex-1 flex-col p-5" data-testid="profile-records">
            <h3 className="text-[15px] font-bold text-ink">我的竞赛记录</h3>
            <div className="mt-3 max-h-[calc(100vh-250px)] overflow-y-auto divide-y divide-line">
              {records.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-mute">还没有参加任何竞赛</p>
              ) : (
                records.slice(0, 10).map((r, index) => (
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
            {records.length < 10 && <p className="mt-auto pt-5 text-center text-[13px] text-ink-mute">只显示前10个历史记录哦</p>}
          </section>




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
