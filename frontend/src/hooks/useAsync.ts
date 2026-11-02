import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseAsyncResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (next: T | null) => void
}

function isAbortError(caught: unknown): boolean {
  if (typeof DOMException !== 'undefined' && caught instanceof DOMException) {
    return caught.name === 'AbortError'
  }
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'name' in caught &&
    (caught as { name?: unknown }).name === 'AbortError'
  )
}

function errorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message
  if (typeof caught === 'string' && caught) return caught
  return '加载失败'
}

/**
 * 通用异步数据加载：依赖变化或卸载时中止在途请求，忽略 AbortError，
 * 卸载后不再写入状态。
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): UseAsyncResult<T> {
  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const fnRef = useRef(fn)
  fnRef.current = fn

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError(null)

    fnRef.current(controller.signal).then(
      (result) => {
        if (!active) return
        setDataState(result)
        setLoading(false)
      },
      (caught: unknown) => {
        if (!active || isAbortError(caught)) return
        setError(errorMessage(caught))
        setLoading(false)
      },
    )

    return () => {
      active = false
      controller.abort()
    }
    // deps 由调用方保证长度稳定；version 用于手动 reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const reload = useCallback(() => {
    setVersion((value) => value + 1)
  }, [])

  const setData = useCallback((next: T | null) => {
    if (mountedRef.current) setDataState(next)
  }, [])

  return { data, loading, error, reload, setData }
}
