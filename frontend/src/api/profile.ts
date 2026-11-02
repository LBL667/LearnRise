import { ApiError, clearToken, getToken, request, TIMEOUTS } from './client'
import type { ProfileInfo } from './types'
import type {
  AvatarUploadResult,
  LearningPreferences,
  NotificationPreferences,
  PasswordUpdate,
  Preferences,
  PrivacyPreferences,
  ProfileInfoUpdate,
  UiPreferencesPayload,
} from './types/profile'

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function readError(response: Response): Promise<ApiError> {
  let detail = `请求失败（${response.status}）`
  let code: string | null = null
  const body: unknown = await response.json().catch(() => null)
  if (body && typeof body === 'object') {
    const record = body as { detail?: unknown; code?: unknown }
    if (typeof record.detail === 'string') detail = record.detail
    if (typeof record.code === 'string') code = record.code
  }
  return new ApiError(response.status, code, detail)
}

export function getProfileInfo(): Promise<ProfileInfo> {
  return request<ProfileInfo>('/profile/info')
}

export function updateProfileInfo(payload: ProfileInfoUpdate): Promise<ProfileInfo> {
  return request<ProfileInfo>('/profile/info', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function changePassword(payload: PasswordUpdate): Promise<void> {
  return request<void>(
    '/profile/password',
    { method: 'PUT', body: JSON.stringify(payload) },
    { timeoutMs: TIMEOUTS.password },
  )
}

export function getPreferences(): Promise<Preferences> {
  return request<Preferences>('/profile/preferences')
}

export function updateNotificationPreferences(
  payload: Partial<NotificationPreferences>,
): Promise<Preferences> {
  return request<Preferences>('/profile/preferences/notifications', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function updateLearningPreferences(
  payload: Partial<LearningPreferences>,
): Promise<Preferences> {
  return request<Preferences>('/profile/preferences/learning', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function updateUiPreferences(
  payload: Partial<UiPreferencesPayload>,
): Promise<Preferences> {
  return request<Preferences>('/profile/preferences/ui', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function updatePrivacyPreferences(
  payload: Partial<PrivacyPreferences>,
): Promise<Preferences> {
  return request<Preferences>('/profile/preferences/privacy', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function uploadAvatar(file: File): Promise<AvatarUploadResult> {
  const form = new FormData()
  form.append('file', file)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUTS.avatar)
  try {
    // multipart 必须由浏览器自动带 boundary，不能手动设置 Content-Type。
    const response = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: buildHeaders(),
      body: form,
      signal: controller.signal,
    })
    if (response.status === 401) {
      clearToken()
      throw new ApiError(401, 'AUTH_REQUIRED', '未认证')
    }
    if (!response.ok) throw await readError(response)
    return (await response.json()) as AvatarUploadResult
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', `头像上传超时（${TIMEOUTS.avatar}ms）`)
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络错误，请检查连接后重试')
  } finally {
    window.clearTimeout(timer)
  }
}
