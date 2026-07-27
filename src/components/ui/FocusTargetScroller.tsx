'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export function FocusTargetScroller() {
  const searchParams = useSearchParams()
  const focus = searchParams.get('focus')

  useEffect(() => {
    if (!focus) return
    let focusedElement: HTMLElement | null = null
    const findAndFocus = () => {
      const element = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focus)}"]`)
      if (!element) return false
      focusedElement = element
      element.dataset.focusActive = 'true'
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element.focus({ preventScroll: true })
      return true
    }
    if (findAndFocus()) return () => { if (focusedElement) delete focusedElement.dataset.focusActive }

    const observer = new MutationObserver(() => {
      if (findAndFocus()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => observer.disconnect(), 10_000)
    return () => {
      window.clearTimeout(timeout)
      observer.disconnect()
      if (focusedElement) delete focusedElement.dataset.focusActive
    }
  }, [focus])

  return null
}
