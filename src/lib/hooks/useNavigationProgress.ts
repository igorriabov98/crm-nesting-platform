"use client"

import { useCallback, useEffect, useState } from "react"

const MIN_VISIBLE_MS = 250

let loading = false
let startedAt = 0
let finishTimer: number | null = null

const listeners = new Set<(value: boolean) => void>()

function emit(value: boolean) {
  loading = value
  listeners.forEach((listener) => listener(value))
}

function startNavigationProgress() {
  if (finishTimer) {
    window.clearTimeout(finishTimer)
    finishTimer = null
  }

  startedAt = Date.now()
  if (!loading) {
    emit(true)
  }
}

function finishNavigationProgress() {
  if (!loading) return

  const elapsed = Date.now() - startedAt
  const remaining = Math.max(MIN_VISIBLE_MS - elapsed, 0)

  if (finishTimer) {
    window.clearTimeout(finishTimer)
  }

  finishTimer = window.setTimeout(() => {
    finishTimer = null
    emit(false)
  }, remaining)
}

function subscribe(listener: (value: boolean) => void) {
  listeners.add(listener)
  listener(loading)

  return () => {
    listeners.delete(listener)
  }
}

export function useNavigationProgress() {
  const [isLoading, setIsLoading] = useState(loading)

  useEffect(() => subscribe(setIsLoading), [])

  const start = useCallback(() => {
    startNavigationProgress()
  }, [])

  const finish = useCallback(() => {
    finishNavigationProgress()
  }, [])

  return { isLoading, start, finish }
}
