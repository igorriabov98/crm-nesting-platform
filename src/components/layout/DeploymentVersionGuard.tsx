'use client'

import { useEffect } from 'react'

const RELOAD_MARKER_KEY = 'crm-deployment-version-reload'
const VERSION_CHECK_INTERVAL_MS = 60_000

type VersionResponse = {
  sha?: string | null
}

function normalizeSha(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

export function DeploymentVersionGuard({ buildSha }: { buildSha: string | null }) {
  useEffect(() => {
    const currentSha = normalizeSha(buildSha)
    if (!currentSha) return

    let stopped = false
    let checking = false

    const checkVersion = async () => {
      if (stopped || checking) return
      checking = true

      try {
        const response = await fetch(`/api/version?ts=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (!response.ok || stopped) return

        const payload = await response.json() as VersionResponse
        const deployedSha = normalizeSha(payload.sha)
        if (!deployedSha || deployedSha === currentSha) {
          sessionStorage.removeItem(RELOAD_MARKER_KEY)
          return
        }

        const marker = `${currentSha}:${deployedSha}`
        if (sessionStorage.getItem(RELOAD_MARKER_KEY) === marker) return

        sessionStorage.setItem(RELOAD_MARKER_KEY, marker)
        window.location.reload()
      } catch {
        // A temporary version-check failure must not interrupt the current CRM session.
      } finally {
        checking = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkVersion()
    }

    void checkVersion()
    const interval = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS)
    window.addEventListener('focus', checkVersion)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopped = true
      window.clearInterval(interval)
      window.removeEventListener('focus', checkVersion)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [buildSha])

  return null
}
