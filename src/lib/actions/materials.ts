'use server'

import { revalidatePath } from 'next/cache'
import { ACTIVE_MATERIAL_CATEGORIES, CHAIN_CORD_SUBTYPE_LABELS, MATERIAL_CATEGORY_LABELS, PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { Material, MaterialCategory, MaterialVariant, Supplier } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null; count?: number | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  ilike: (column: string, pattern: string) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  or: (filters: string) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  range: (from: number, to: number) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type MaterialWithSupplier = Material & {
  supplier_name: string | null
  variants_count?: number
  last_used_at?: string | null
  sheet_grades?: string[]
  sheet_thicknesses?: number[]
  sheet_sizes?: string[]
}

export type MaterialVariantWithSteelType = MaterialVariant & {
  steel_types?: { name: string | null } | null
}

type MaterialUsageInput = {
  material_id: string
  category: MaterialCategory
  characteristics: Record<string, unknown>
}

async function requireMaterialPermission(operation: PermissionOperation = 'view') {
  const { supabase, userId, role } = await requirePermission('materials', operation)
  return { db: supabase as unknown as LooseDb, userId, role }
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return Boolean(value)
}

function normalizeMaterialName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[\u0445\u00d7*]/g, 'x')
}

function escapeIlike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function searchTextVariants(value: string) {
  const variants = new Set([value])
  if (value.includes('x')) {
    variants.add(value.replace(/x/g, '\u0445'))
    variants.add(value.replace(/x/g, '\u00d7'))
    variants.add(value.replace(/x/g, '*'))
  }
  return Array.from(variants)
}

function dimensionParts(value: unknown) {
  const parts = normalizeMaterialName(String(value ?? ''))
    .replace(/\s+/g, '')
    .split('x')
    .map((part) => Number(part.replace(',', '.')))
  return parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part > 0) ? parts : []
}

function numberFromSearch(value: string) {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function pipeSubtypesForSearch(normalized: string) {
  return Object.entries(PIPE_SUBTYPE_LABELS)
    .filter(([value, label]) => normalizeMaterialName(value).includes(normalized) || normalizeMaterialName(label).includes(normalized))
    .map(([value]) => value)
}

function chainCordTypesForSearch(normalized: string) {
  return Object.entries(CHAIN_CORD_SUBTYPE_LABELS)
    .filter(([value, label]) => normalizeMaterialName(value).includes(normalized) || normalizeMaterialName(label).includes(normalized))
    .map(([value]) => value)
}

function scopeVariantQuery(query: LooseQuery, category?: MaterialCategory | null, matchedCategory?: MaterialCategory | null) {
  if (category) return query.eq('category', category)
  if (matchedCategory) return query.eq('category', matchedCategory)
  return query.in('category', [...ACTIVE_MATERIAL_CATEGORIES])
}

function variantTextColumnsForSearch(category?: MaterialCategory | null, matchedCategory?: MaterialCategory | null) {
  const scopedCategory = category || matchedCategory
  const byCategory: Partial<Record<MaterialCategory, string[]>> = {
    sheet_metal: ['material_grade', 'sheet_size'],
    round_tube: ['piece_description'],
    circle: ['material_grade'],
    pipe: ['material_grade', 'piece_description'],
    knives: ['material_grade', 'knife_dimensions', 'knife_material'],
    components: ['specification', 'default_unit'],
    paint: ['ral_code', 'finish'],
    mesh: ['mesh_description'],
    chain_cord: ['chain_cord_parameters'],
  }
  if (scopedCategory) return byCategory[scopedCategory] || []
  return [
    'material_grade',
    'sheet_size',
    'piece_description',
    'knife_dimensions',
    'knife_material',
    'specification',
    'default_unit',
    'ral_code',
    'finish',
    'mesh_description',
    'chain_cord_parameters',
  ]
}

function variantNumericColumnsForSearch(category?: MaterialCategory | null, matchedCategory?: MaterialCategory | null) {
  const scopedCategory = category || matchedCategory
  const byCategory: Partial<Record<MaterialCategory, string[]>> = {
    sheet_metal: ['thickness_mm'],
    round_tube: ['length_m'],
    circle: ['diameter_mm'],
    pipe: ['diameter_mm', 'wall_thickness_mm'],
    knives: ['standard_length_mm', 'width_mm', 'height_mm'],
    components: ['diameter_mm'],
    mesh: ['mesh_length_mm', 'mesh_width_mm'],
  }
  if (scopedCategory) return byCategory[scopedCategory] || []
  return [
    'thickness_mm',
    'length_m',
    'standard_length_mm',
    'diameter_mm',
    'wall_thickness_mm',
    'width_mm',
    'height_mm',
    'mesh_length_mm',
    'mesh_width_mm',
  ]
}

function dimensionText(...values: unknown[]) {
  const numbers = values.map((value) => num(value))
  return numbers.every((value) => value !== null && value > 0) ? numbers.join('x') : null
}

function usageToVariant(data: MaterialUsageInput) {
  const c = data.characteristics
  return {
    material_id: data.material_id,
    category: data.category,
    steel_type_id: text(c.steel_type_id),
    material_grade: text(c.material_grade) || text(c.steel_grade),
    thickness_mm: num(c.thickness_mm),
    sheet_size: text(c.sheet_size),
    weight_per_unit_kg: num(c.weight_per_unit_kg),
    unit_weight_kg: num(c.unit_weight_kg) ?? num(c.weight_per_unit_kg),
    length_m: num(c.length_m),
    weight_per_m_kg: num(c.weight_per_m_kg),
    piece_description: text(c.piece_description) || text(c.size),
    knife_dimensions: text(c.knife_dimensions) || dimensionText(c.standard_length_mm, c.width_mm, c.height_mm),
    knife_material: text(c.knife_material),
    standard_length_mm: num(c.standard_length_mm),
    specification: text(c.specification),
    default_unit: text(c.default_unit) || 'шт',
    ral_code: text(c.ral_code),
    finish: text(c.finish),
    default_waste_percent: num(c.default_waste_percent),
    diameter_mm: num(c.diameter_mm),
    is_calibrated: bool(c.is_calibrated),
    pipe_type: text(c.pipe_type),
    wall_thickness_mm: num(c.wall_thickness_mm),
    width_mm: num(c.width_mm),
    height_mm: num(c.height_mm),
    mesh_description: text(c.mesh_description) || text(c.description),
    mesh_length_mm: num(c.mesh_length_mm) ?? num(c.length_mm),
    mesh_width_mm: num(c.mesh_width_mm) ?? num(c.width_mm),
    chain_cord_type: text(c.chain_cord_type) || text(c.item_type),
    chain_cord_parameters: text(c.chain_cord_parameters) || text(c.parameters),
  }
}

function isSameVariant(row: MaterialVariant, input: ReturnType<typeof usageToVariant>) {
  const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
  const sameText = (a: unknown, b: unknown) => normalizeMaterialName(String(a ?? '')) === normalizeMaterialName(String(b ?? ''))
  const sameKnifeDimensions = () => {
    const rowTextDimensions = dimensionParts(row.knife_dimensions)
    const inputTextDimensions = dimensionParts(input.knife_dimensions)
    const rowDimensions = [
      row.standard_length_mm ?? rowTextDimensions[0],
      row.width_mm ?? rowTextDimensions[1],
      row.height_mm ?? rowTextDimensions[2],
    ]
    const inputDimensions = [
      input.standard_length_mm ?? inputTextDimensions[0],
      input.width_mm ?? inputTextDimensions[1],
      input.height_mm ?? inputTextDimensions[2],
    ]
    return same(rowDimensions[0], inputDimensions[0])
      && same(rowDimensions[1], inputDimensions[1])
      && same(rowDimensions[2], inputDimensions[2])
  }
  const sameKnifeSteel = () => {
    const rowSteel = row.material_grade || row.knife_material
    const inputSteel = input.material_grade || input.knife_material
    return sameText(rowSteel, inputSteel)
  }
  if (input.category === 'sheet_metal') return same(row.steel_type_id, input.steel_type_id) && sameText(row.material_grade, input.material_grade) && same(row.thickness_mm, input.thickness_mm) && sameText(row.sheet_size, input.sheet_size)
  if (input.category === 'round_tube') return same(row.length_m, input.length_m) && sameText(row.piece_description, input.piece_description)
  if (input.category === 'circle') return same(row.diameter_mm, input.diameter_mm) && same(row.steel_type_id, input.steel_type_id) && sameText(row.material_grade, input.material_grade) && same(row.is_calibrated, input.is_calibrated)
  if (input.category === 'pipe') {
    const sameGeometry = sameText(row.pipe_type, input.pipe_type)
      && sameText(row.piece_description, input.piece_description)
      && same(row.wall_thickness_mm, input.wall_thickness_mm)
      && same(row.diameter_mm, input.diameter_mm)
    if (input.pipe_type === 'wire') return sameGeometry
    return sameGeometry
      && same(row.steel_type_id, input.steel_type_id)
      && sameText(row.material_grade, input.material_grade)
  }
  if (input.category === 'knives') {
    return sameKnifeDimensions()
      && (sameText(row.knife_material, input.knife_material) || sameText(row.knife_material, input.material_grade) || sameText(row.material_grade, input.knife_material))
      && same(row.steel_type_id, input.steel_type_id)
      && sameKnifeSteel()
  }
  if (input.category === 'components') {
    return same(row.diameter_mm, input.diameter_mm)
      && sameText(row.specification, input.specification)
      && sameText(row.default_unit, input.default_unit)
      && same(row.unit_weight_kg, input.unit_weight_kg)
  }
  if (input.category === 'paint') return sameText(row.ral_code, input.ral_code) && sameText(row.finish, input.finish)
  if (input.category === 'mesh') return sameText(row.mesh_description, input.mesh_description) && same(row.mesh_length_mm, input.mesh_length_mm) && same(row.mesh_width_mm, input.mesh_width_mm)
  if (input.category === 'chain_cord') return sameText(row.chain_cord_type, input.chain_cord_type) && sameText(row.chain_cord_parameters, input.chain_cord_parameters)
  return false
}

async function hydrateSuppliers(db: LooseDb, materials: Material[]): Promise<MaterialWithSupplier[]> {
  const supplierIds = Array.from(new Set(materials.map((item) => item.default_supplier_id).filter(Boolean))) as string[]
  const supplierMap = new Map<string, string>()
  if (supplierIds.length) {
    const { data, error } = await db.from('suppliers').select('id, name').in('id', supplierIds)
    if (error) throw new Error(error.message || 'Не удалось загрузить поставщиков')
    for (const supplier of (data || []) as Supplier[]) supplierMap.set(supplier.id, supplier.name)
  }
  return materials.map((item) => ({
    ...item,
    supplier_name: item.default_supplier_id ? supplierMap.get(item.default_supplier_id) || null : null,
  }))
}

export async function searchMaterials(query: string, category?: MaterialCategory | null) {
  try {
    const { db } = await requireMaterialPermission('view')
    const normalized = normalizeMaterialName(query)
    if (normalized.length < 2) return { data: [], error: null }

    const categoryLabelMatchesQuery = category
      ? normalizeMaterialName(MATERIAL_CATEGORY_LABELS[category] ?? category).includes(normalized)
      : false
    const matchedCategory = !category
      ? ACTIVE_MATERIAL_CATEGORIES.find((item) => normalizeMaterialName(MATERIAL_CATEGORY_LABELS[item] ?? item).includes(normalized))
      : null
    const searchVariants = searchTextVariants(normalized)

    let queryBuilder = db
      .from('materials')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .limit(20)

    if (!categoryLabelMatchesQuery && !matchedCategory) {
      queryBuilder = queryBuilder.or(searchVariants.map((term) => `name.ilike.%${escapeIlike(term)}%`).join(','))
    }

    queryBuilder = category
      ? queryBuilder.eq('category', category)
      : matchedCategory
        ? queryBuilder.eq('category', matchedCategory)
        : queryBuilder.in('category', [...ACTIVE_MATERIAL_CATEGORIES])

    const { data, error } = await queryBuilder
    if (error) throw new Error(error.message || 'Не удалось найти материалы')

    const variantMaterialIds = new Set<string>()
    const variantTextColumns = variantTextColumnsForSearch(category, matchedCategory)
    const escapedTerms = searchVariants.map(escapeIlike)
    const textFilters = variantTextColumns.flatMap((column) => escapedTerms.map((term) => `${column}.ilike.%${term}%`))
    const pipeSubtypes = pipeSubtypesForSearch(normalized)
    const chainCordTypes = chainCordTypesForSearch(normalized)
    for (const subtype of pipeSubtypes) textFilters.push(`pipe_type.eq.${subtype}`)
    for (const itemType of chainCordTypes) textFilters.push(`chain_cord_type.eq.${itemType}`)
    if (['да', 'калибр', 'калибровка'].some((word) => word.includes(normalized) || normalized.includes(word))) {
      textFilters.push('is_calibrated.eq.true')
    }
    if (['нет', 'некалибр'].some((word) => word.includes(normalized) || normalized.includes(word))) {
      textFilters.push('is_calibrated.eq.false')
    }

    if (textFilters.length) {
      const { data: variantTextData, error: variantTextError } = await scopeVariantQuery(
        db
          .from('material_variants')
          .select('material_id')
          .or(textFilters.join(','))
          .limit(100),
        category,
        matchedCategory,
      )
      if (variantTextError) throw new Error(variantTextError.message || 'Не удалось найти характеристики материалов')
      for (const variant of (variantTextData || []) as Pick<MaterialVariant, 'material_id'>[]) {
        if (variant.material_id) variantMaterialIds.add(variant.material_id)
      }
    }

    const numericValue = numberFromSearch(normalized)
    if (numericValue !== null) {
      const numericColumns = variantNumericColumnsForSearch(category, matchedCategory)
      const numericResults = await Promise.all(numericColumns.map(async (column) => {
        const { data: numericData, error: numericError } = await scopeVariantQuery(
          db
            .from('material_variants')
            .select('material_id')
            .eq(column, numericValue)
            .limit(50),
          category,
          matchedCategory,
        )
        if (numericError) throw new Error(numericError.message || 'Не удалось найти числовые характеристики материалов')
        return (numericData || []) as Pick<MaterialVariant, 'material_id'>[]
      }))
      for (const rows of numericResults) {
        for (const variant of rows) {
          if (variant.material_id) variantMaterialIds.add(variant.material_id)
        }
      }
    }

    const dimensionValues = dimensionParts(normalized)
    const canSearchKnifeDimensions = dimensionValues.length >= 2
      && (!category || category === 'knives')
      && (!matchedCategory || matchedCategory === 'knives')
    if (canSearchKnifeDimensions) {
      let dimensionQuery = db
        .from('material_variants')
        .select('material_id')
        .eq('category', 'knives')
        .eq('standard_length_mm', dimensionValues[0])
        .eq('width_mm', dimensionValues[1])
        .limit(100)
      if (dimensionValues[2]) dimensionQuery = dimensionQuery.eq('height_mm', dimensionValues[2])
      const { data: dimensionData, error: dimensionError } = await dimensionQuery
      if (dimensionError) throw new Error(dimensionError.message || 'Не удалось найти размеры ножей')
      for (const variant of (dimensionData || []) as Pick<MaterialVariant, 'material_id'>[]) {
        if (variant.material_id) variantMaterialIds.add(variant.material_id)
      }
    }

    const matchedVariantMaterialIds = Array.from(variantMaterialIds)

    let variantMaterials: Material[] = []
    if (matchedVariantMaterialIds.length) {
      const { data: variantMaterialsData, error: variantMaterialsError } = await db
        .from('materials')
        .select('*')
        .eq('is_active', true)
        .in('id', matchedVariantMaterialIds)
      if (variantMaterialsError) throw new Error(variantMaterialsError.message || 'Не удалось найти материалы по характеристикам')
      variantMaterials = (variantMaterialsData || []) as Material[]
    }

    const materialMap = new Map<string, Material>()
    for (const row of (data || []) as Material[]) materialMap.set(row.id, row)
    for (const row of variantMaterials) materialMap.set(row.id, row)

    const rows = Array.from(materialMap.values())
      .sort((a, b) => {
        const aName = normalizeMaterialName(a.name)
        const bName = normalizeMaterialName(b.name)
        const aVariantMatch = matchedVariantMaterialIds.includes(a.id)
        const bVariantMatch = matchedVariantMaterialIds.includes(b.id)
        const aExact = aName === normalized ? -1 : aName.startsWith(normalized) ? 0 : aVariantMatch ? 1 : 2
        const bExact = bName === normalized ? -1 : bName.startsWith(normalized) ? 0 : bVariantMatch ? 1 : 2
        return aExact - bExact || a.name.localeCompare(b.name)
      })
      .slice(0, 10)
    return { data: await hydrateSuppliers(db, rows), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось найти материалы' }
  }
}

export async function getMaterialVariants(materialId: string, category: MaterialCategory) {
  try {
    const { db } = await requireMaterialPermission('view')
    const { data, error } = await db
      .from('material_variants')
      .select('*, steel_types(name)')
      .eq('material_id', materialId)
      .eq('category', category)
      .order('times_used', { ascending: false })
      .limit(20)
    if (error) throw new Error(error.message || 'Не удалось загрузить варианты')
    return { data: (data || []) as MaterialVariantWithSteelType[], error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить варианты' }
  }
}

export async function createMaterial(data: { name: string; category: MaterialCategory; comment?: string | null }) {
  try {
    const { db, userId } = await requireMaterialPermission('manage')
    const name = data.name.trim().replace(/\s+/g, ' ')
    if (!name) throw new Error('Введите название материала')

    const { data: existingRows, error: existingError } = await db
      .from('materials')
      .select('*')
      .eq('category', data.category)
      .eq('is_active', true)
      .or(searchTextVariants(normalizeMaterialName(name)).map((term) => `name.ilike.${escapeIlike(term)}`).join(','))
      .limit(20)
    if (existingError) throw new Error(existingError.message || 'Не удалось проверить материал')
    const existing = ((existingRows || []) as Material[]).find((row) => normalizeMaterialName(row.name) === normalizeMaterialName(name))
    if (existing) return { success: true, data: existing as Material }

    const { data: row, error } = await db
      .from('materials')
      .insert({
        name,
        category: data.category,
        comment: data.comment || null,
        default_supplier_id: null,
        created_by: userId,
      })
      .select('*')
      .single()
    if (error || !row) throw new Error(error?.message || 'Не удалось создать материал')
    revalidatePath('/admin/materials')
    return { success: true, data: row as Material }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать материал' }
  }
}

export async function updateMaterial(id: string, data: { name?: string; default_supplier_id?: string | null; comment?: string | null; is_active?: boolean }) {
  try {
    const { db } = await requireMaterialPermission('manage')
    const values: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() }
    if (values.default_supplier_id === '') values.default_supplier_id = null

    const { data: row, error } = await db.from('materials').update(values).eq('id', id).select('*').single()
    if (error || !row) throw new Error(error?.message || 'Не удалось обновить материал')
    revalidatePath('/admin/materials')
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    return { success: true, data: row as Material }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить материал' }
  }
}

export async function recordMaterialUsage(input: MaterialUsageInput) {
  try {
    const { db } = await requireMaterialPermission('manage')
    const variant = usageToVariant(input)
    const { data, error } = await db
      .from('material_variants')
      .select('*')
      .eq('material_id', input.material_id)
      .eq('category', input.category)
      .limit(100)
    if (error) throw new Error(error.message || 'Не удалось загрузить варианты')

    const existing = ((data || []) as MaterialVariant[]).find((row) => isSameVariant(row, variant))
    if (existing) {
      const { data: updated, error: updateError } = await db
        .from('material_variants')
        .update({
          times_used: existing.times_used + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (updateError || !updated) throw new Error(updateError?.message || 'Не удалось обновить вариант')
      return { success: true, data: updated as MaterialVariant }
    }

    const { data: created, error: insertError } = await db.from('material_variants').insert(variant).select('*').single()
    if (insertError || !created) throw new Error(insertError?.message || 'Не удалось создать вариант')
    return { success: true, data: created as MaterialVariant }
  } catch (error) {
    console.warn('[materials] recordMaterialUsage failed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось записать вариант' }
  }
}

export async function getMaterials(filters: {
  category?: MaterialCategory
  supplier_id?: string
  active_only?: boolean
  search?: string
  page?: number
  pageSize?: number
} = {}) {
  try {
    const { supabase } = await requirePermission('materials', 'view')
    const db = supabase as unknown as LooseDb
    const page = Math.max(0, Number.isFinite(filters.page) ? Math.floor(filters.page || 0) : 0)
    const pageSize = Math.min(100, Math.max(1, Number.isFinite(filters.pageSize) ? Math.floor(filters.pageSize || 50) : 50))
    let query = db
      .from('materials')
      .select('id, name, category, comment, default_supplier_id, is_active, created_by, created_at, updated_at', { count: 'exact' })
      .order('name')
      .range(page * pageSize, page * pageSize + pageSize - 1)
    if (filters.category) query = query.eq('category', filters.category)
    if (filters.active_only) query = query.eq('is_active', true)
    if (filters.supplier_id && filters.supplier_id !== 'none') query = query.eq('default_supplier_id', filters.supplier_id)

    const { data, error, count } = await query
    if (error) throw new Error(error.message || 'Не удалось загрузить материалы')
    let rows = (data || []) as Material[]
    if (filters.supplier_id === 'none') rows = rows.filter((item) => !item.default_supplier_id)
    if (filters.search?.trim()) {
      const search = normalizeMaterialName(filters.search)
      rows = rows.filter((item) => normalizeMaterialName(item.name).includes(search))
    }

    const hydrated = await hydrateSuppliers(db, rows)
    const ids = hydrated.map((item) => item.id)
    const variantMap = new Map<string, {
      count: number
      last: string | null
      grades: Set<string>
      thicknesses: Set<number>
      sizes: Set<string>
    }>()
    if (ids.length) {
      const { data: variants } = await db
        .from('material_variants')
        .select('material_id, category, material_grade, thickness_mm, sheet_size, last_used_at')
        .in('material_id', ids)
      for (const variant of (variants || []) as Pick<MaterialVariant, 'material_id' | 'category' | 'material_grade' | 'thickness_mm' | 'sheet_size' | 'last_used_at'>[]) {
        const current = variantMap.get(variant.material_id) || {
          count: 0,
          last: null,
          grades: new Set<string>(),
          thicknesses: new Set<number>(),
          sizes: new Set<string>(),
        }
        if (variant.category === 'sheet_metal') {
          if (variant.material_grade) current.grades.add(variant.material_grade)
          if (variant.thickness_mm !== null) current.thicknesses.add(Number(variant.thickness_mm))
          if (variant.sheet_size) current.sizes.add(variant.sheet_size)
        }
        variantMap.set(variant.material_id, {
          ...current,
          count: current.count + 1,
          last: !current.last || variant.last_used_at > current.last ? variant.last_used_at : current.last,
        })
      }
    }
    return {
      data: hydrated.map((item) => ({
        ...item,
        variants_count: variantMap.get(item.id)?.count || 0,
        last_used_at: variantMap.get(item.id)?.last || null,
        sheet_grades: Array.from(variantMap.get(item.id)?.grades || []),
        sheet_thicknesses: Array.from(variantMap.get(item.id)?.thicknesses || []).sort((a, b) => a - b),
        sheet_sizes: Array.from(variantMap.get(item.id)?.sizes || []),
      })),
      error: null,
      pagination: { page, pageSize, total: count || 0 },
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить материалы',
      pagination: null,
    }
  }
}

export async function assignSupplierToMaterial(materialId: string, supplierId: string | null) {
  return updateMaterial(materialId, { default_supplier_id: supplierId || null })
}
