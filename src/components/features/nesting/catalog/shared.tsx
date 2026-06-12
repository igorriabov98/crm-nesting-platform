'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

export const MATERIAL_OPTIONS = ['Сталь', 'Нержавейка', 'Алюминий'] as const

export function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

export function formatMm(value: number) {
  return `${formatNumber(value)} мм`
}

export function formatSize(width: number, height: number) {
  return `${formatNumber(width)}×${formatNumber(height)} мм`
}

export function formatPrice(value: number | null) {
  if (value === null || Number.isNaN(value)) return '-'
  return `${formatNumber(value)} ₴`
}

export function formatCatalogDate(value: string | null) {
  if (!value) return '-'
  try {
    return format(new Date(value), 'dd.MM.yyyy', { locale: ru })
  } catch {
    return '-'
  }
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function parseRequiredPositive(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}: введите число больше 0`)
  }
  return parsed
}

export function parseRequiredNonNegative(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}: введите число не меньше 0`)
  }
  return parsed
}

export function parseOptionalNonNegative(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}: введите число не меньше 0`)
  }
  return parsed
}

export function parseStock(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Кол-во на складе: введите целое число не меньше 0')
  }
  return parsed
}

export function useCatalogSearchUpdater() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useCallback((updates: Record<string, string | number | boolean | null | undefined>, resetPage = true) => {
    const params = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, String(value))
      }
    }

    if (resetPage) params.delete('page')

    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])
}
