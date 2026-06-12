// Константы этапов производства
import { StageType } from '@/lib/types'

export const STAGES: Record<
  StageType,
  {
    label: string
    color: string
    fixedWorkshop: number | null
    canSkip: boolean
  }
> = {
  cutting:     { label: 'Заготовка',  color: '#3B82F6', fixedWorkshop: 1,    canSkip: false },
  assembly:    { label: 'Сборка',     color: '#22C55E', fixedWorkshop: null,  canSkip: true },
  cleaning:    { label: 'Зачистка',   color: '#EAB308', fixedWorkshop: null,  canSkip: true },
  galvanizing: { label: 'Цинк',       color: '#6B7280', fixedWorkshop: null,  canSkip: true }, // canSkip=false если coating=zinc (дополнительная проверка в UI и триггере БД)
  post_galvanizing_cleaning: { label: 'Зачистка после цинка', color: '#D6A500', fixedWorkshop: null, canSkip: true },
  painting:    { label: 'Малярка',    color: '#F97316', fixedWorkshop: 2,     canSkip: true },
  packaging:   { label: 'Упаковка',   color: '#8B5CF6', fixedWorkshop: 2,     canSkip: true },
  shipping:    { label: 'Готовность к погрузке', color: '#EF4444', fixedWorkshop: null,  canSkip: false },
  actual_shipping: { label: 'Факт отгрузки', color: '#B91C1C', fixedWorkshop: null, canSkip: false },
}

// Порядок этапов — важен для рендеринга Ганта и UI таблицы
export const STAGE_ORDER: StageType[] = [
  'cutting',
  'assembly',
  'cleaning',
  'galvanizing',
  'post_galvanizing_cleaning',
  'painting',
  'packaging',
  'shipping',
  'actual_shipping',
]

// Цвет ночной смены (оверлей поверх основного цвета этапа)
export const NIGHT_SHIFT_COLOR = '#1E3A5F'
