import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { clearToken, getToken, request, setToken } from '@/api/client'

export interface AuthUser {
  id: string
  email: string
  display_name: string
}

interface TokenPayload {
  access_token: string
  token_type: string
  user: AuthUser
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, displayName: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null)

  useEffect(() => {
    if (getToken() === null) {
      setLoading(false)
      return
    }
    let cancelled = false
    request<AuthUser>('/auth/me')
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) {
          clearToken()
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const adopt = useCallback((payload: TokenPayload) => {
    setToken(payload.access_token)
    setUser(payload.user)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await request<TokenPayload>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      adopt(payload)
    },
    [adopt],
  )

  const register = useCallback(
    async (email: string, displayName: string, password: string) => {
      const payload = await request<TokenPayload>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, display_name: displayName, password }),
      })
      adopt(payload)
    },
    [adopt],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
