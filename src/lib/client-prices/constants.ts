import type { CoatingType } from '@/lib/types'

export const CLIENT_PRICE_COATINGS = ['none', 'zinc', 'powder_coating'] as const satisfies readonly CoatingType[]

export const CLIENT_PRICE_COATING_LABELS: Record<CoatingType, string> = {
  none: 'Без покрытия',
  zinc: 'Цинк',
  powder_coating: 'Порошковая покраска',
}
