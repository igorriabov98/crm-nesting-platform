import type { CoatingType } from '@/lib/types'

export const COATING_OPTIONS = ['cold_zinc', 'zinc', 'powder_coating', 'none'] as const satisfies readonly CoatingType[]
export const ZINC_COATINGS = ['cold_zinc', 'zinc'] as const satisfies readonly CoatingType[]

export const COATINGS: Record<CoatingType, { label: string; color: string }> = {
  cold_zinc: { label: 'Холодный цинк', color: 'sky' },
  zinc: { label: 'Горячий цинк', color: 'gray' },
  powder_coating: { label: 'Порошковая покраска', color: 'orange' },
  none: { label: 'Без покрытия', color: 'slate' },
}

export function getCoatingLabel(coating: CoatingType | null | undefined) {
  return coating ? COATINGS[coating].label : 'Выберите покрытие'
}

export function isZincCoating(coating: string | null | undefined): coating is typeof ZINC_COATINGS[number] {
  return coating === 'cold_zinc' || coating === 'zinc'
}

export function normalizeRalNumberForCoating(
  coating: CoatingType | null | undefined,
  value: string | null | undefined,
) {
  if (coating !== 'powder_coating') return null
  return value?.trim() || null
}
