"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useNavigationProgress } from "@/lib/hooks/useNavigationProgress"

export function TopProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isLoading, start, finish } = useNavigationProgress()

  useEffect(() => {
    finish()
  }, [finish, pathname, searchParams])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target && anchor.target !== "_self") return
      if (anchor.hasAttribute("download")) return

      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)

      if (nextUrl.origin !== currentUrl.origin) return
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search
      ) {
        return
      }

      start()
    }

    document.addEventListener("click", handleClick, true)

    return () => {
      document.removeEventListener("click", handleClick, true)
    }
  }, [start])

  if (!isLoading) return null

  return (
    <div className="fixed left-0 right-0 top-0 z-[9999] h-0.5">
      <div className="h-full bg-[#2563EB] animate-progress-bar" />
    </div>
  )
}
