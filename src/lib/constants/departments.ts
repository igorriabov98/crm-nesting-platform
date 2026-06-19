export const POSITION_LEVELS = {
  0: 'Рядовой',
  1: 'Старший',
  2: 'Начальник',
  3: 'Директор',
} as const

export const POSITION_LEVEL_OPTIONS = Object.entries(POSITION_LEVELS).map(
  ([value, label]) => ({ value: Number(value), label })
)
