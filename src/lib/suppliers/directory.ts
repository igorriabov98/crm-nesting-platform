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
    description: 'Полный реестр организаций со всеми категориями материалов и сервисными возможностями.',
    emptyTitle: 'База пока пуста',
    emptyDescription: 'Добавьте первую организацию и укажите, в каких разделах она должна отображаться.',
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
    emptyDescription: 'Добавьте организацию с включённой сервисной возможностью «Транспорт».',
  },
  outsourcing: {
    title: 'Аутсорсинговые компании',
    shortTitle: 'Аутсорсинг',
    description: 'Подрядчики для внешних производственных операций и связанных транспортных заказов.',
    emptyTitle: 'Аутсорсинговые компании не найдены',
    emptyDescription: 'Добавьте организацию с включённой сервисной возможностью «Аутсорсинг».',
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

export function supplierMatchesDirectorySection(
  supplier: SupplierDirectoryRecord,
  section: SupplierDirectorySection,
) {
  if (section === 'all') return true
  if (section === 'transport') return supplier.can_transport === true
  if (section === 'outsourcing') return supplier.can_outsource === true

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
