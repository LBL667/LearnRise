import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'

type Mode = 'login' | 'register'

function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export default function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get('redirect'))

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isRegister = mode === 'register'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (isRegister) {
        await register(email.trim(), displayName.trim(), password)
      } else {
        await login(email.trim(), password)
      }
      navigate(redirect, { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.code === 'EMAIL_TAKEN' ? '该邮箱已注册，请直接登录' : caught.detail)
      } else {
        setError('登录失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-lg font-semibold text-ink">LearnRise</p>
          <p className="mt-1 text-sm text-ink-soft">
            {isRegister ? '创建账号，开始你的学习竞赛' : '登录后继续你的学习竞赛'}
          </p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-soft">邮箱</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-primary"
            />
          </label>

          {isRegister && (
            <label className="block">
              <span className="mb-1 block text-sm text-ink-soft">昵称</span>
              <input
                name="displayName"
                type="text"
                required
                maxLength={128}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-primary"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-sm text-ink-soft">密码</span>
            <input
              name="password"
              type="password"
              required
              minLength={isRegister ? 8 : 1}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-primary"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[#e25050]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-10 w-full rounded-lg bg-primary text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? '处理中…' : isRegister ? '注册并登录' : '登录'}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-ink-soft hover:text-primary"
          onClick={() => {
            setMode(isRegister ? 'login' : 'register')
            setError('')
          }}
        >
          {isRegister ? '已有账号？去登录' : '没有账号？立即注册'}
        </button>
      </div>
    </div>
  )
}
