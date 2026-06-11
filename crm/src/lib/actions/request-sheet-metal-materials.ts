import 'server-only'

import { recordMaterialUsage } from '@/lib/actions/materials'
import type { Material, MaterialVariant } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type RequestSheetMetalMaterialInput = {
  materialName: string | null
  materialGrade: string | null
  steelTypeId: string | null
  sheetSize: string | null
  thicknessMm: number | null
  weightPerUnitKg?: number | null
}

type ImportedSheetMetalRow = RequestSheetMetalMaterialInput & {
  id: string
  materialId: string | null
  materialVariantId: string | null
  sourceNestingRunId: string | null
  sourceNestingProjectId: string | null
}

export type SheetMetalMaterialResolution = {
  materialId: string
  materialName: string
  materialVariantId: string | null
}

function normalizeMaterialName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function fallbackSheetMetalName(value: string | null) {
  const name = value?.trim().replace(/\s+/g, ' ')
  return name || 'Листовой металл'
}

function hasVariantCharacteristics(input: RequestSheetMetalMaterialInput) {
  return Boolean(input.steelTypeId || input.materialGrade) && Boolean(input.sheetSize) && input.thicknessMm !== null
}

async function findOrCreateSheetMetalMaterial(db: LooseDb, userId: string, name: string) {
  const normalizedName = normalizeMaterialName(name)
  const { data, error } = await db
    .from('materials')
    .select('id, name, category, is_active')
    .eq('category', 'sheet_metal')
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(error.message || 'Не удалось найти материал листового металла')

  const existing = ((data || []) as Pick<Material, 'id' | 'name' | 'category' | 'is_active'>[])
    .find((row) => normalizeMaterialName(row.name) === normalizedName)
  if (existing) return { id: existing.id, name: existing.name }

  const { data: created, error: insertError } = await db
    .from('materials')
    .insert({
      name,
      category: 'sheet_metal',
      created_by: userId,
    })
    .select('id, name, category, is_active')
    .single()

  if (insertError || !created) {
    throw new Error(insertError?.message || 'Не удалось создать материал листового металла')
  }

  const row = created as Pick<Material, 'id' | 'name'>
  return { id: row.id, name: row.name }
}

async function recordSheetMetalVariant(materialId: string, input: RequestSheetMetalMaterialInput) {
  if (!hasVariantCharacteristics(input)) return null

  const result = await recordMaterialUsage({
    material_id: materialId,
    category: 'sheet_metal',
    characteristics: {
      material_grade: input.materialGrade,
      steel_type_id: input.steelTypeId,
      sheet_size: input.sheetSize,
      thickness_mm: input.thicknessMm,
      weight_per_unit_kg: input.weightPerUnitKg ?? null,
    },
  })

  return result.success && result.data ? (result.data as MaterialVariant).id : null
}

export async function resolveSheetMetalMaterialForRequestRow(
  db: LooseDb,
  userId: string,
  input: RequestSheetMetalMaterialInput,
): Promise<SheetMetalMaterialResolution> {
  const materialName = fallbackSheetMetalName(input.materialName)
  const material = await findOrCreateSheetMetalMaterial(db, userId, materialName)
  const materialVariantId = await recordSheetMetalVariant(material.id, input)

  return {
    materialId: material.id,
    materialName: material.name,
    materialVariantId,
  }
}

export async function repairImportedSheetMetalMaterials(db: LooseDb, userId: string, requestId: string) {
  const { data, error } = await db
    .from('request_sheet_metal')
    .select('id, material_name, material_grade, steel_type_id, sheet_size, thickness_mm, quantity_sheets, weight_order_kg, material_id, material_variant_id, source_nesting_run_id, source_nesting_project_id')
    .eq('request_id', requestId)

  if (error) throw new Error(error.message || 'Не удалось проверить листовой металл заявки')

  const rows = ((data || []) as Array<{
    id: string
    material_name: string | null
    material_grade: string | null
    steel_type_id: string | null
    sheet_size: string | null
    thickness_mm: number | null
    quantity_sheets: number | null
    weight_order_kg: number | null
    material_id: string | null
    material_variant_id: string | null
    source_nesting_run_id: string | null
    source_nesting_project_id: string | null
  }>)
    .map((row): ImportedSheetMetalRow => ({
      id: row.id,
      materialName: row.material_name,
      materialGrade: row.material_grade,
      steelTypeId: row.steel_type_id,
      sheetSize: row.sheet_size,
      thicknessMm: row.thickness_mm,
      weightPerUnitKg: row.quantity_sheets ? Number(row.weight_order_kg || 0) / Number(row.quantity_sheets) : null,
      materialId: row.material_id,
      materialVariantId: row.material_variant_id,
      sourceNestingRunId: row.source_nesting_run_id,
      sourceNestingProjectId: row.source_nesting_project_id,
    }))
    .filter((row) => !row.materialId && (row.sourceNestingRunId || row.sourceNestingProjectId))

  for (const row of rows) {
    const resolved = await resolveSheetMetalMaterialForRequestRow(db, userId, row)
    const { error: updateError } = await db
      .from('request_sheet_metal')
      .update({
        material_id: resolved.materialId,
        material_name: resolved.materialName,
        material_variant_id: resolved.materialVariantId,
        is_custom_material_variant: false,
      })
      .eq('id', row.id)

    if (updateError) throw new Error(updateError.message || 'Не удалось привязать материал листового металла')
  }
}
