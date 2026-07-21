import { MATERIAL_CATEGORIES } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import type { MaterialCategory } from '@/lib/types'

export const SUPPLIER_DIRECTORY_SECTION_KEYS = [
  'all',
  'metal',
  'consumables',
  'transport',
  'outsourcing',
] as const

export type SupplierDirectorySection = typeof SUPPLIER_DIRECTORY_SECTION_KEYS[number]

export type SupplierDirectoryRecord = {
  categories: MaterialCategory[]
  can_transport?: boolean | null
  can_outsource?: boolean | null
}

export const SUPPLIER_PRIMARY_ROLES = [
  'supplier',
  'transport',
  'outsourcing',
] as const

export type SupplierPrimaryRole = typeof SUPPLIER_PRIMARY_ROLES[number]

export type SupplierRoleConfigurationInput = {
  primary_role: SupplierPrimaryRole | null
  supplies_metal: boolean | null
  supplies_consumables: boolean | null
  categories: MaterialCategory[]
}

export type SupplierRoleConfigurationResult =
  | {
      success: true
      data: {
        can_transport: boolean
        can_outsource: boolean
        categories: MaterialCategory[]
      }
    }
  | { success: false; error: string }

export const METAL_SUPPLIER_CATEGORIES = [
  'sheet_metal',
  'circle',
  'pipe',
  'mesh',
  'round_tube',
] as const satisfies readonly MaterialCategory[]

export const CONSUMABLE_SUPPLIER_CATEGORIES = [
  'knives',
  'paint',
  'components',
  'chain_cord',
  'other',
] as const satisfies readonly MaterialCategory[]

export const PRIMARY_SUPPLIER_DIRECTORY_SECTIONS = [
  'transport',
  'metal',
  'outsourcing',
  'consumables',
] as const satisfies readonly SupplierDirectorySection[]

export const SUPPLIER_DIRECTORY_SECTIONS: Record<SupplierDirectorySection, {
  title: string
  shortTitle: string
  description: string
  emptyTitle: string
  emptyDescription: string
}> = {
  all: {
    title: 'Все компании',
    shortTitle: 'Все записи',
    description: 'Полный реестр организаций с одним основным типом и направлениями поставки.',
    emptyTitle: 'База пока пуста',
    emptyDescription: 'Добавьте первую организацию, выберите её тип и направления поставки.',
  },
  metal: {
    title: 'Поставщики металла',
    shortTitle: 'Металл',
    description: 'Поставщики листового металла, круга, трубы и металлической сетки.',
    emptyTitle: 'Поставщики металла не найдены',
    emptyDescription: 'Добавьте организацию и выберите хотя бы одну категорию металла.',
  },
  consumables: {
    title: 'Поставщики расходников',
    shortTitle: 'Расходники',
    description: 'Поставщики ножей, краски, комплектации, цепей, шнуров и других расходных материалов.',
    emptyTitle: 'Поставщики расходников не найдены',
    emptyDescription: 'Добавьте организацию и выберите подходящие категории расходников.',
  },
  transport: {
    title: 'Транспорт',
    shortTitle: 'Транспорт',
    description: 'Перевозчики и транспортные компании, доступные в сценариях снабжения и аутсорсинга.',
    emptyTitle: 'Транспортные компании не найдены',
    emptyDescription: 'Добавьте организацию с основным типом «Перевозчик».',
  },
  outsourcing: {
    title: 'Аутсорсинговые компании',
    shortTitle: 'Аутсорсинг',
    description: 'Подрядчики для внешних производственных операций и связанных транспортных заказов.',
    emptyTitle: 'Аутсорсинговые компании не найдены',
    emptyDescription: 'Добавьте организацию с основным типом «Аутсорсинг».',
  },
}

const SECTION_ROUTES: Record<SupplierDirectorySection, string> = {
  all: ROUTES.ADMIN_DATABASE_ALL,
  metal: ROUTES.ADMIN_DATABASE_METAL,
  consumables: ROUTES.ADMIN_DATABASE_CONSUMABLES,
  transport: ROUTES.ADMIN_DATABASE_TRANSPORT,
  outsourcing: ROUTES.ADMIN_DATABASE_OUTSOURCING,
}

export function isSupplierDirectorySection(value: string): value is SupplierDirectorySection {
  return (SUPPLIER_DIRECTORY_SECTION_KEYS as readonly string[]).includes(value)
}

export function getSupplierDirectoryHref(section: SupplierDirectorySection) {
  return SECTION_ROUTES[section]
}

export function getSupplierCreateHref(section: SupplierDirectorySection) {
  return `${getSupplierDirectoryHref(section)}/new`
}

export function getSupplierEditHref(section: SupplierDirectorySection, supplierId: string) {
  return `${getSupplierDirectoryHref(section)}/${supplierId}`
}

export function getSupplierPrimaryRoleForCreateSection(
  section: SupplierDirectorySection,
): SupplierPrimaryRole {
  if (section === 'transport') return 'transport'
  if (section === 'outsourcing') return 'outsourcing'
  return 'supplier'
}

function hasCategoryFrom(
  categories: readonly MaterialCategory[],
  categorySet: readonly MaterialCategory[],
) {
  return categories.some((category) => categorySet.includes(category))
}

export function getSupplierPrimaryRole(
  supplier: SupplierDirectoryRecord,
): SupplierPrimaryRole | null {
  const hasSupplierDirection = hasCategoryFrom(supplier.categories, [
    ...METAL_SUPPLIER_CATEGORIES,
    ...CONSUMABLE_SUPPLIER_CATEGORIES,
  ])
  const directions = [
    hasSupplierDirection,
    supplier.can_transport === true,
    supplier.can_outsource === true,
  ].filter(Boolean).length

  if (directions > 1) return null
  if (supplier.can_transport === true) return 'transport'
  if (supplier.can_outsource === true) return 'outsourcing'
  return 'supplier'
}

export function validateSupplierRoleConfiguration(
  input: SupplierRoleConfigurationInput,
): SupplierRoleConfigurationResult {
  if (
    !input.primary_role
    || !(SUPPLIER_PRIMARY_ROLES as readonly string[]).includes(input.primary_role)
  ) {
    return { success: false, error: 'Выберите один основной тип контрагента.' }
  }

  const categories = Array.from(new Set(input.categories))
  const hasUnknownCategory = categories.some(
    (category) => !(MATERIAL_CATEGORIES as readonly MaterialCategory[]).includes(category),
  )
  if (hasUnknownCategory) {
    return { success: false, error: 'Выбрана неизвестная категория материалов.' }
  }

  if (input.primary_role === 'transport' || input.primary_role === 'outsourcing') {
    if (
      input.supplies_metal === true
      || input.supplies_consumables === true
      || categories.length > 0
    ) {
      const typeLabel = input.primary_role === 'transport' ? 'Перевозчик' : 'Аутсорсинговая компания'
      return {
        success: false,
        error: `${typeLabel} не может одновременно быть поставщиком металла или расходников.`,
      }
    }

    return {
      success: true,
      data: {
        can_transport: input.primary_role === 'transport',
        can_outsource: input.primary_role === 'outsourcing',
        categories: [],
      },
    }
  }

  if (typeof input.supplies_metal !== 'boolean') {
    return { success: false, error: 'Укажите, поставляет ли компания металл.' }
  }
  if (typeof input.supplies_consumables !== 'boolean') {
    return {
      success: false,
      error: 'Укажите, поставляет ли компания расходники по заявкам производства.',
    }
  }
  if (!input.supplies_metal && !input.supplies_consumables) {
    return {
      success: false,
      error: 'Поставщик должен поставлять металл, расходники или оба направления.',
    }
  }

  const metalCategories = categories.filter((category) =>
    hasCategoryFrom([category], METAL_SUPPLIER_CATEGORIES)
  )
  const consumableCategories = categories.filter((category) =>
    hasCategoryFrom([category], CONSUMABLE_SUPPLIER_CATEGORIES)
  )

  if (input.supplies_metal && metalCategories.length === 0) {
    return { success: false, error: 'Выберите хотя бы одну категорию металла.' }
  }
  if (!input.supplies_metal && metalCategories.length > 0) {
    return { success: false, error: 'Уберите категории металла или выберите для металла ответ «Да».' }
  }
  if (input.supplies_consumables && consumableCategories.length === 0) {
    return { success: false, error: 'Выберите хотя бы одну категорию расходников.' }
  }
  if (!input.supplies_consumables && consumableCategories.length > 0) {
    return {
      success: false,
      error: 'Уберите категории расходников или выберите для расходников ответ «Да».',
    }
  }

  return {
    success: true,
    data: {
      can_transport: false,
      can_outsource: false,
      categories,
    },
  }
}

export function supplierMatchesDirectorySection(
  supplier: SupplierDirectoryRecord,
  section: SupplierDirectorySection,
) {
  if (section === 'all') return true
  const primaryRole = getSupplierPrimaryRole(supplier)
  if (section === 'transport') return primaryRole === 'transport'
  if (section === 'outsourcing') return primaryRole === 'outsourcing'
  if (primaryRole !== 'supplier') return false

  const categorySet: readonly MaterialCategory[] = section === 'metal'
    ? METAL_SUPPLIER_CATEGORIES
    : CONSUMABLE_SUPPLIER_CATEGORIES

  return supplier.categories.some((category) => categorySet.includes(category))
}

export function filterSuppliersByDirectorySection<T extends SupplierDirectoryRecord>(
  suppliers: T[],
  section: SupplierDirectorySection,
) {
  return suppliers.filter((supplier) => supplierMatchesDirectorySection(supplier, section))
}

export function getSupplierDirectorySections(supplier: SupplierDirectoryRecord) {
  return PRIMARY_SUPPLIER_DIRECTORY_SECTIONS.filter((section) =>
    supplierMatchesDirectorySection(supplier, section)
  )
}

export function getUnmappedMaterialCategories() {
  const mapped = new Set<MaterialCategory>([
    ...METAL_SUPPLIER_CATEGORIES,
    ...CONSUMABLE_SUPPLIER_CATEGORIES,
  ])
  return MATERIAL_CATEGORIES.filter((category) => !mapped.has(category))
}
