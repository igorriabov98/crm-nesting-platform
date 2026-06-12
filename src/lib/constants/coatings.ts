import { CoatingType } from '@/lib/types'

export const COATINGS: Record<CoatingType, { label: string; color: string }> = {
  zinc: { label: 'Цинк', color: 'gray' },
  powder_coating: { label: 'Порошковая покраска', color: 'orange' },
  none: { label: 'Без покрытия', color: 'slate' },
}
