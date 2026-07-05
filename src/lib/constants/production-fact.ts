import type { ProductionFactSection, StageType } from '@/lib/types'

export type ProductionFactStageKey =
  | 'cutting'
  | 'assembly'
  | 'cleaning'
  | 'painting'
  | 'packaging'
  | 'actual_shipping'

export type ProductionFactStageDefinition = {
  key: ProductionFactStageKey
  label: string
  stageType: StageType
  sortOrder: number
  isShipping?: boolean
  productionStageType: StageType | null
  children: Array<{
    key: string
    label: string
    sortOrder: number
  }>
}

export type ProductionFactResolvedStage = {
  definition: ProductionFactStageDefinition
  parent: ProductionFactSection | null
  sections: Array<{
    key: string
    label: string
    section: ProductionFactSection | null
  }>
}

export const PRODUCTION_FACT_STANDARD_STAGES: readonly ProductionFactStageDefinition[] = [
  {
    key: 'cutting',
    label: 'Заготовка',
    stageType: 'cutting',
    sortOrder: 10,
    productionStageType: 'cutting',
    children: [{ key: 'cutting', label: 'Заготовка', sortOrder: 10 }],
  },
  {
    key: 'assembly',
    label: 'Сборка/Сварка',
    stageType: 'assembly',
    sortOrder: 20,
    productionStageType: null,
    children: [
      { key: 'workshop_1', label: 'Цех 1', sortOrder: 10 },
      { key: 'workshop_2', label: 'Цех 2', sortOrder: 20 },
    ],
  },
  {
    key: 'cleaning',
    label: 'Зачистка',
    stageType: 'cleaning',
    sortOrder: 30,
    productionStageType: null,
    children: [{ key: 'cleaning', label: 'Зачистка', sortOrder: 10 }],
  },
  {
    key: 'painting',
    label: 'Малярка',
    stageType: 'painting',
    sortOrder: 40,
    productionStageType: null,
    children: [{ key: 'painting', label: 'Малярка', sortOrder: 10 }],
  },
  {
    key: 'packaging',
    label: 'Упаковка',
    stageType: 'packaging',
    sortOrder: 50,
    productionStageType: null,
    children: [{ key: 'packaging', label: 'Упаковка', sortOrder: 10 }],
  },
  {
    key: 'actual_shipping',
    label: 'Отгрузка',
    stageType: 'actual_shipping',
    sortOrder: 60,
    isShipping: true,
    productionStageType: null,
    children: [{ key: 'actual_shipping', label: 'Отгрузка', sortOrder: 10 }],
  },
] as const

export const PRODUCTION_FACT_STAGE_KEYS = PRODUCTION_FACT_STANDARD_STAGES.map((stage) => stage.key)

export function isProductionFactStageKey(value: string): value is ProductionFactStageKey {
  return (PRODUCTION_FACT_STAGE_KEYS as readonly string[]).includes(value)
}

export function getProductionFactStageDefinition(key: ProductionFactStageKey): ProductionFactStageDefinition {
  return PRODUCTION_FACT_STANDARD_STAGES.find((stage) => stage.key === key) || PRODUCTION_FACT_STANDARD_STAGES[0]
}

export function normalizeProductionFactSectionName(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU')
}

function isActive(section: ProductionFactSection | null | undefined) {
  return Boolean(section?.is_active && !section.archived_at)
}

export function resolveProductionFactStandardStages(sections: ProductionFactSection[]): ProductionFactResolvedStage[] {
  const activeSections = sections.filter(isActive)
  const parents = activeSections.filter((section) => !section.parent_id)

  return PRODUCTION_FACT_STANDARD_STAGES.map((definition) => {
    const parentName = normalizeProductionFactSectionName(definition.label)
    const parent = parents
      .filter((section) => normalizeProductionFactSectionName(section.name) === parentName)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'))[0] || null

    const children = parent
      ? activeSections.filter((section) => section.parent_id === parent.id)
      : []

    return {
      definition,
      parent,
      sections: definition.children.map((child) => {
        const childName = normalizeProductionFactSectionName(child.label)
        const section = children
          .filter((item) => normalizeProductionFactSectionName(item.name) === childName)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'))[0] || null

        return { key: child.key, label: child.label, section }
      }),
    }
  })
}
