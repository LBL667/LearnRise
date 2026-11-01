import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-page text-sm text-ink-soft">
        正在加载…
      </div>
    )
  }

  if (user === null) {
    const target = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />
  }

  return <>{children}</>
}
