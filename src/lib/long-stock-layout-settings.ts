import { z } from 'zod'

export const LONG_STOCK_LAYOUT_CATEGORY_KEYS = [
  'circle',
  'pipe',
  'knife_bevel_1',
  'knife_bevel_2',
] as const

export type LongStockLayoutCategoryKey = typeof LONG_STOCK_LAYOUT_CATEGORY_KEYS[number]

export const LONG_STOCK_LAYOUT_CATEGORY_LABELS: Record<LongStockLayoutCategoryKey, string> = {
  circle: 'Круг',
  pipe: 'Труба (кроме проволоки)',
  knife_bevel_1: 'Нож, 1 скос',
  knife_bevel_2: 'Нож, 2 скоса',
}

const positiveIntegerLengthsSchema = z.array(z.number().int().positive()).max(100)

const categorySchema = z.object({
  key: z.enum(LONG_STOCK_LAYOUT_CATEGORY_KEYS),
  minimumUsefulLengthMm: z.number().nonnegative(),
  standardLengths: positiveIntegerLengthsSchema.min(1),
  nonstandardLengths: positiveIntegerLengthsSchema,
}).superRefine((category, context) => {
  const seen = new Set<number>()
  for (const [group, lengths] of [
    ['standardLengths', category.standardLengths],
    ['nonstandardLengths', category.nonstandardLengths],
  ] as const) {
    lengths.forEach((length, index) => {
      if (seen.has(length)) {
        context.addIssue({
          code: 'custom',
          message: `Длина ${length} мм повторяется внутри или между группами`,
          path: [group, index],
        })
      }
      seen.add(length)
    })
  }
})

export const longStockLayoutSettingsInputSchema = z.object({
  kerfMm: z.number().nonnegative(),
  endTrimMm: z.number().nonnegative(),
  optimizationHintThresholdPercent: z.number().min(0).max(100),
  categories: z.array(categorySchema).length(LONG_STOCK_LAYOUT_CATEGORY_KEYS.length),
}).superRefine((settings, context) => {
  const keys = settings.categories.map((category) => category.key)
  for (const key of LONG_STOCK_LAYOUT_CATEGORY_KEYS) {
    const matches = keys.filter((candidate) => candidate === key).length
    if (matches !== 1) {
      context.addIssue({
        code: 'custom',
        message: `Категория «${LONG_STOCK_LAYOUT_CATEGORY_LABELS[key]}» должна присутствовать один раз`,
        path: ['categories'],
      })
    }
  }
})

export type LongStockLayoutSettingsInput = z.infer<typeof longStockLayoutSettingsInputSchema>

export type LongStockLayoutCategorySettings = LongStockLayoutSettingsInput['categories'][number] & {
  materialCategory: 'circle' | 'pipe' | 'knives'
  knifeBevelCount: 1 | 2 | null
  businessScrapThresholdMm: 0
}

export type LongStockLayoutSettingsSnapshot = Omit<LongStockLayoutSettingsInput, 'categories'> & {
  schemaVersion: 1
  revision: number
  categories: LongStockLayoutCategorySettings[]
}

export type LongStockLayoutSettingsAuditEntry = {
  id: string
  changedAt: string
  changedBy: string
  revisionFrom: number
  revisionTo: number
  changedFields: string[]
  previousValue: LongStockLayoutSettingsSnapshot
  newValue: LongStockLayoutSettingsSnapshot
}

export function parseLongStockLayoutSettingsInput(input: unknown): LongStockLayoutSettingsInput {
  const parsed = longStockLayoutSettingsInputSchema.parse(input)
  const byKey = new Map(parsed.categories.map((category) => [category.key, category]))
  return {
    ...parsed,
    categories: LONG_STOCK_LAYOUT_CATEGORY_KEYS.map((key) => {
      const category = byKey.get(key)!
      return {
        ...category,
        standardLengths: [...category.standardLengths].sort((left, right) => left - right),
        nonstandardLengths: [...category.nonstandardLengths].sort((left, right) => left - right),
      }
    }),
  }
}

export function formatLongStockLayoutAuditField(field: string) {
  if (field === 'kerf_mm') return 'Пропил'
  if (field === 'end_trim_mm') return 'Торцовка'
  if (field === 'optimization_hint_threshold_percent') return 'Порог подсказки'
  return LONG_STOCK_LAYOUT_CATEGORY_LABELS[field as LongStockLayoutCategoryKey] || field
}
