import type { FactorySummary } from '@/lib/types'

export type FactoryWorkshopOption = {
  value: number
  label: string
}

const DEFAULT_WORKSHOPS: FactoryWorkshopOption[] = [{ value: 1, label: 'Цех 1' }]
const BERGOVO_WORKSHOPS: FactoryWorkshopOption[] = [
  { value: 1, label: 'Цех 1' },
  { value: 2, label: 'Цех 2' },
]

function normalizeFactoryName(name: string) {
  return name.trim().toLowerCase()
}

export function getFactoryWorkshopOptions(factoryName?: string | null): FactoryWorkshopOption[] {
  if (!factoryName) return []

  const normalizedName = normalizeFactoryName(factoryName)
  if (normalizedName.includes('берегово') || normalizedName.includes('bergovo') || normalizedName.includes('berehovo')) {
    return BERGOVO_WORKSHOPS
  }

  return DEFAULT_WORKSHOPS
}

export function getFactoryWorkshopOptionsById(factories: FactorySummary[], factoryId?: string | null) {
  const factory = factories.find((item) => item.id === factoryId)
  return getFactoryWorkshopOptions(factory?.name)
}

export function isFactoryWorkshopAllowed(factoryName: string | null | undefined, workshop: number | null | undefined) {
  if (!workshop) return false
  return getFactoryWorkshopOptions(factoryName).some((option) => option.value === workshop)
}

export function productionQueueLabel(workshop?: number | null, queueNumber?: number | null) {
  if (!workshop || !queueNumber) return 'Без очереди'
  return `Цех ${workshop} · Очередь ${queueNumber}`
}
