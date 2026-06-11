"use client"

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { canSeeAllFactories } from '@/lib/utils/permissions'
import type { CurrentUser, FactorySummary } from '@/lib/types'

type FactoryFilterValue = string | null

export function useFactoryFilter(user: CurrentUser, factories: FactorySummary[]) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isProductionManager = !canSeeAllFactories(user.role)

  const selectedFactory: FactoryFilterValue = isProductionManager
    ? user.factory_id
    : searchParams.get('factory')

  function setFactory(id: FactoryFilterValue) {
    if (isProductionManager) return

    const params = new URLSearchParams(searchParams.toString())
    if (!id || id === 'all') {
      params.delete('factory')
    } else {
      params.set('factory', id)
    }

    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
    router.refresh()
  }

  return {
    selectedFactory,
    setFactory,
    factories,
    isProductionManager,
  }
}
