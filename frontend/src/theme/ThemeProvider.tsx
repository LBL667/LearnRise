import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** 匿名用户与首屏回退使用的本地存储键；服务端偏好由 T20 通过 applyFromPreferences 覆盖 */
const STORAGE_KEY = 'learnrise.ui'

export interface UiPreferences {
  theme?: string
  sidebar_collapsed?: boolean
  compact_tables?: boolean
}

interface StoredUi {
  theme: ThemeMode
  sidebarCollapsed: boolean
  compactTables: boolean
}

export interface UiThemeValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  resolvedTheme: ResolvedTheme
  sidebarCollapsed: boolean
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  compactTables: boolean
  setCompactTables: Dispatch<SetStateAction<boolean>>
  applyFromPreferences: (prefs: UiPreferences) => void
}

const DEFAULT_UI: StoredUi = {
  theme: 'light',
  sidebarCollapsed: false,
  compactTables: false,
}

const UiThemeContext = createContext<UiThemeValue | null>(null)

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredUi(): StoredUi {
  try {
    if (typeof window === 'undefined') return DEFAULT_UI
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_UI
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_UI
    const record = parsed as Record<string, unknown>
    return {
      theme: isThemeMode(record.theme) ? record.theme : DEFAULT_UI.theme,
      sidebarCollapsed:
        typeof record.sidebar_collapsed === 'boolean'
          ? record.sidebar_collapsed
          : DEFAULT_UI.sidebarCollapsed,
      compactTables:
        typeof record.compact_tables === 'boolean'
          ? record.compact_tables
          : DEFAULT_UI.compactTables,
    }
  } catch {
    return DEFAULT_UI
  }
}

function persist(ui: StoredUi): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: ui.theme,
        sidebar_collapsed: ui.sidebarCollapsed,
        compact_tables: ui.compactTables,
      }),
    )
  } catch {
    // 隐私模式或存储被禁用时静默降级为内存态
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<StoredUi>(readStoredUi)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  const setTheme = useCallback((theme: ThemeMode) => {
    setUi((previous) => ({ ...previous, theme }))
  }, [])

  const setSidebarCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((next) => {
    setUi((previous) => ({
      ...previous,
      sidebarCollapsed: typeof next === 'function' ? next(previous.sidebarCollapsed) : next,
    }))
  }, [])

  const setCompactTables = useCallback<Dispatch<SetStateAction<boolean>>>((next) => {
    setUi((previous) => ({
      ...previous,
      compactTables: typeof next === 'function' ? next(previous.compactTables) : next,
    }))
  }, [])

  const applyFromPreferences = useCallback((prefs: UiPreferences) => {
    setUi((previous) => ({
      theme: isThemeMode(prefs.theme) ? prefs.theme : previous.theme,
      sidebarCollapsed:
        typeof prefs.sidebar_collapsed === 'boolean'
          ? prefs.sidebar_collapsed
          : previous.sidebarCollapsed,
      compactTables:
        typeof prefs.compact_tables === 'boolean' ? prefs.compact_tables : previous.compactTables,
    }))
  }, [])

  /** theme=system 时跟随系统配色，切走后自动解绑，StrictMode 下也不会重复监听 */
  useEffect(() => {
    if (ui.theme !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [ui.theme])

  const resolvedTheme: ResolvedTheme = ui.theme === 'system' ? systemTheme : ui.theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.dataset.density = ui.compactTables ? 'compact' : 'normal'
  }, [ui.compactTables])

  useEffect(() => {
    persist(ui)
  }, [ui])

  const value = useMemo<UiThemeValue>(
    () => ({
      theme: ui.theme,
      setTheme,
      resolvedTheme,
      sidebarCollapsed: ui.sidebarCollapsed,
      setSidebarCollapsed,
      compactTables: ui.compactTables,
      setCompactTables,
      applyFromPreferences,
    }),
    [
      ui.theme,
      ui.sidebarCollapsed,
      ui.compactTables,
      resolvedTheme,
      setTheme,
      setSidebarCollapsed,
      setCompactTables,
      applyFromPreferences,
    ],
  )

  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>
}

export function useUiTheme(): UiThemeValue {
  const context = useContext(UiThemeContext)
  if (!context) {
    throw new Error('useUiTheme must be used within a <ThemeProvider>')
  }
  return context
}
