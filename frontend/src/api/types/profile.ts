/** 个人中心偏好设置与资料编辑的请求/响应类型 —— 与后端 ProfileInfoUpdate 等契约同构 */

export type PrefDifficulty = 'easy' | 'medium' | 'hard'
export type PrefQuestionType = 'choice' | 'judge' | 'short_answer'
export type PrefTheme = 'light' | 'dark' | 'system'
export type NameVisibility = 'public' | 'members' | 'private'

export interface NotificationPreferences {
  email_reminders_enabled: boolean
}

export interface LearningPreferences {
  default_difficulty: PrefDifficulty
  default_question_types: PrefQuestionType[]
  default_quiz_num: number
}

export interface UiPreferencesPayload {
  theme: PrefTheme
  sidebar_collapsed: boolean
  compact_tables: boolean
}

export interface PrivacyPreferences {
  leaderboard_anonymous: boolean
  name_visibility: NameVisibility
}

/** GET /api/profile/preferences */
export interface Preferences {
  notifications: NotificationPreferences
  learning: LearningPreferences
  ui: UiPreferencesPayload
  privacy: PrivacyPreferences
}

/** PUT /api/profile/info —— 只发送需要修改的字段（服务端 exclude_unset） */
export interface ProfileInfoUpdate {
  display_name?: string
  school?: string | null
  grade?: string | null
}

/** PUT /api/profile/password */
export interface PasswordUpdate {
  current_password: string
  new_password: string
}

/** POST /api/profile/avatar */
export interface AvatarUploadResult {
  avatarUrl: string
}
