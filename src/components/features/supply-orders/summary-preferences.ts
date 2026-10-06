'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import type { AggregateFiltersState } from './supply-order-view'

export type SupplySummaryPreferences = {
  view: 'list' | 'cards'
  section: 'unscheduled' | 'ordered' | 'redelivery' | 'all'
  allStatus: 'all' | 'open' | 'closed'
  filters: AggregateFiltersState
}
export const defaultSummaryPreferences: SupplySummaryPreferences = {
  view: 'list', section: 'unscheduled', allStatus: 'all',
  filters: { query: '', supplier: 'all', category: 'all', status: 'open', schedule: 'all', sort: 'date_asc' },
}
export function parseSummaryPreferences(raw: string | null): SupplySummaryPreferences {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || !['list', 'cards'].includes(value.view)
      || !['unscheduled', 'ordered', 'redelivery', 'all'].includes(value.section)
      || !['all', 'open', 'closed'].includes(value.allStatus)) return defaultSummaryPreferences
    const filters = value.filters
    if (!filters || typeof filters.query !== 'string' || typeof filters.supplier !== 'string'
      || !['all', 'sheet_metal', 'circle', 'pipe', 'knives', 'components', 'paint', 'mesh', 'chain_cord', 'round_tube'].includes(filters.category)
      || !['all', 'open', 'closed', 'review', 'scheduled', 'unscheduled', 'pending', 'ordered'].includes(filters.status)
      || !['all', 'scheduled', 'unscheduled'].includes(filters.schedule)
      || !['date_asc', 'date_desc', 'material_asc', 'quantity_desc', 'remaining_desc'].includes(filters.sort)) return defaultSummaryPreferences
    return { view: value.view, section: value.section, allStatus: value.allStatus, filters }
  } catch { return defaultSummaryPreferences }
}
const subscribe = (callback: () => void) => {
  window.addEventListener('storage', callback)
  window.addEventListener('supply-summary-preferences', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('supply-summary-preferences', callback)
  }
}
export function useSupplySummaryPreferences(userId: string) {
  const key = `supply-summary:v2:${userId}`
  // In-memory fallback keeps controls usable when browser storage is disabled.
  const [fallback, setFallback] = useState<{ key: string; value: string } | null>(null)
  const raw = useSyncExternalStore(subscribe, () => {
    try { return window.localStorage.getItem(key) ?? (fallback?.key === key ? fallback.value : null) }
    catch { return fallback?.key === key ? fallback.value : null }
  }, () => null)
  const value = useMemo(() => parseSummaryPreferences(raw), [raw])
  const set = (next: SupplySummaryPreferences) => {
    const serialized = JSON.stringify(next)
    setFallback({ key, value: serialized })
    try { window.localStorage.setItem(key, serialized) } catch { /* session fallback */ }
    window.dispatchEvent(new Event('supply-summary-preferences'))
  }
  return [value, set] as const
}
