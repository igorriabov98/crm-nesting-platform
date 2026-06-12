'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NestingProjectStatus } from '@/lib/nesting/api'

type ProjectPollingOptions = {
  onStatusChange?: (status: string, payload: NestingProjectStatus) => void
  onTargetStatus?: (status: string, payload: NestingProjectStatus) => void
  onError?: (message: string) => void
}

export function useProjectPolling(
  projectId: string,
  targetStatuses: string[],
  interval = 2000,
  enabled = true,
  options: ProjectPollingOptions = {}
) {
  const [status, setStatus] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(enabled)
  const targetKey = targetStatuses.join('|')
  const targetSet = useMemo(() => new Set(targetStatuses), [targetKey])
  const optionsRef = useRef(options)
  const targetReachedRef = useRef(false)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const poll = useCallback(async () => {
    const res = await fetch(`/api/nesting/status/${projectId}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({ error: 'Не удалось получить статус проекта' }))

    if (!res.ok) {
      const message = data.error || data.message || 'Не удалось получить статус проекта'
      setErrorMessage(message)
      setIsPolling(false)
      optionsRef.current.onError?.(message)
      return null
    }

    const next = data as NestingProjectStatus
    setStatus(next.status)
    setErrorMessage(next.errorMessage)
    optionsRef.current.onStatusChange?.(next.status, next)

    if (targetSet.has(next.status) || next.status === 'error') {
      setIsPolling(false)
      if (!targetReachedRef.current) {
        targetReachedRef.current = true
        optionsRef.current.onTargetStatus?.(next.status, next)
      }
    }

    return next
  }, [projectId, targetSet])

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    targetReachedRef.current = false
    setIsPolling(true)

    const run = async () => {
      if (cancelled || targetReachedRef.current) return

      try {
        const next = await poll()
        if (!next || targetSet.has(next.status) || next.status === 'error') {
          if (timer) clearInterval(timer)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Не удалось получить статус проекта'
          setErrorMessage(message)
          setIsPolling(false)
          optionsRef.current.onError?.(message)
          if (timer) clearInterval(timer)
        }
      }
    }

    run()
    timer = setInterval(run, interval)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [enabled, interval, poll, targetSet])

  return { status, errorMessage, isPolling, refetch: poll }
}
