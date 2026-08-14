export const FEATURE_FLAG_KEYS = [
  'long_stock_cutting_enabled',
] as const

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number]

export type FeatureFlagDefinition = {
  key: FeatureFlagKey
  label: string
  description: string
}

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
  {
    key: 'long_stock_cutting_enabled',
    label: 'Раскрой длинномерного материала',
    description: 'Общий kill switch будущего модуля раскроя. Пока не подключён к продуктовой логике.',
  },
]
