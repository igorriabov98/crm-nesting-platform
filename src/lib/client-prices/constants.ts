import { COATING_OPTIONS, COATINGS } from '@/lib/constants/coatings'
import type { CoatingType } from '@/lib/types'

export const CLIENT_PRICE_COATINGS = COATING_OPTIONS

export const CLIENT_PRICE_COATING_LABELS = Object.fromEntries(
  CLIENT_PRICE_COATINGS.map((coating) => [coating, COATINGS[coating].label]),
) as Record<CoatingType, string>
