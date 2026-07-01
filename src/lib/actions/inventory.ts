'use server'

import { revalidatePath } from 'next/cache'
import { INVENTORY_LIST_LIMIT } from '@/lib/constants/performance-limits'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { Factory, Inventory, InventoryReservation, InventoryTransaction, InventoryTransactionType, Material, MaterialCategory, MaterialVariant } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null; count?: number | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  gt: (column: string, value: unknown) => LooseQuery
  gte: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  range: (from: number, to: number) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
  update: (values: Record<string, unknown>) => LooseQuery
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
}

type ActionResult<T = unknown> = { success: boolean; error?: string; data?: T }
type RequestItemWeight = { weightKg: number; quantity: number | null }
type RequestItemWeightConfig = {
  columns: string
  weight: (row: Record<string, unknown>) => number | null
  quantity: (row: Record<string, unknown>) => number | null
}
const INVENTORY_LIST_COLUMNS = 'id, factory_id, material_id, material_variant_id, total_quantity, reserved_quantity, available_quantity, unit, total_secondary_quantity, reserved_secondary_quantity, available_secondary_quantity, secondary_unit, calculated_weight_kg, piece_length_mm, is_business_scrap, business_scrap_state, available_from_date, available_from_stage_id, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm, source_nesting_project_id, source_nesting_sheet_id, source_remnant_geom, deleted_at, deleted_by, delete_comment, last_updated_by, created_at, updated_at'
const INVENTORY_LIST_COLUMNS_WITHOUT_SOURCE_MACHINE = INVENTORY_LIST_COLUMNS.replace(', source_machine_id', '')
const MATERIAL_VARIANT_COLUMNS = 'id, material_id, category, steel_type_id, material_grade, thickness_mm, sheet_size, weight_per_unit_kg, length_m, weight_per_m_kg, piece_description, knife_dimensions, knife_material, standard_length_mm, specification, default_unit, ral_code, finish, default_waste_percent, diameter_mm, is_calibrated, pipe_type, wall_thickness_mm, width_mm, height_mm, mesh_description, mesh_length_mm, mesh_width_mm, chain_cord_type, chain_cord_parameters, unit_weight_kg, times_used, last_used_at, created_at'
const REQUEST_ITEM_WEIGHT_CONFIGS: Record<string, RequestItemWeightConfig> = {
  request_sheet_metal: {
    columns: 'id, calculated_weight_kg, quantity_sheets, remainder_qty',
    weight: (row) => numberOrNull(row.calculated_weight_kg),
    quantity: (row) => numberOrNull(row.remainder_qty) ?? numberOrNull(row.quantity_sheets),
  },
  request_round_tube: {
    columns: 'id, order_kg',
    weight: (row) => numberOrNull(row.order_kg),
    quantity: (row) => numberOrNull(row.order_kg),
  },
  request_knives: {
    columns: 'id, calculated_weight_kg, remainder_meters, to_order_mm, order_mm',
    weight: (row) => numberOrNull(row.calculated_weight_kg),
    quantity: (row) => {
      const remainderMeters = numberOrNull(row.remainder_meters)
      if (remainderMeters && remainderMeters > 0) return remainderMeters * 1000
      return numberOrNull(row.to_order_mm) ?? numberOrNull(row.order_mm)
    },
  },
  request_paint: {
    columns: 'id, weight_with_waste_kg, weight_kg, remainder_kg',
    weight: (row) => numberOrNull(row.weight_with_waste_kg) ?? numberOrNull(row.weight_kg),
    quantity: (row) => numberOrNull(row.remainder_kg) ?? numberOrNull(row.weight_with_waste_kg) ?? numberOrNull(row.weight_kg),
  },
  request_circle: {
    columns: 'id, calculated_weight_kg, remainder_mm',
    weight: (row) => numberOrNull(row.calculated_weight_kg),
    quantity: (row) => numberOrNull(row.remainder_mm),
  },
  request_pipe: {
    columns: 'id, calculated_weight_kg, pipe_type, remainder_length_mm, remainder_kg',
    weight: (row) => numberOrNull(row.calculated_weight_kg),
    quantity: (row) => row.pipe_type === 'wire' ? numberOrNull(row.remainder_kg) : numberOrNull(row.remainder_length_mm),
  },
}

function normalizeInventorySearch(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[\u0445\u00d7*]/g, 'x')
}

function inventoryVariantSearchText(variant: MaterialVariant | null | undefined) {
  if (!variant) return ''
  const knifeDimensions = variant.category === 'knives'
    ? variant.knife_dimensions || [variant.standard_length_mm, variant.width_mm, variant.height_mm].filter(Boolean).join('x')
    : null
  return [
    variant.material_grade,
    variant.sheet_size,
    variant.piece_description,
    variant.knife_dimensions,
    knifeDimensions,
    variant.knife_material,
    variant.specification,
    variant.default_unit,
    variant.ral_code,
    variant.finish,
    variant.mesh_description,
    variant.chain_cord_parameters,
    variant.pipe_type,
    variant.chain_cord_type,
    variant.thickness_mm,
    variant.length_m,
    variant.standard_length_mm,
    variant.diameter_mm,
    variant.wall_thickness_mm,
    variant.width_mm,
    variant.height_mm,
    variant.mesh_length_mm,
    variant.mesh_width_mm,
  ].filter((value) => value !== null && value !== undefined && value !== '').join(' ')
}

function inventoryMatchesSearch(row: InventoryWithMaterial, value: string) {
  const query = normalizeInventorySearch(value)
  if (!query) return true
  const haystack = normalizeInventorySearch([
    row.material?.name,
    row.unit,
    row.secondary_unit,
    row.supplier_name,
    inventoryVariantSearchText(row.variant),
    row.variant_options.map(inventoryVariantSearchText).join(' '),
    row.piece_length_mm,
  ].filter((item) => item !== null && item !== undefined && item !== '').join(' '))
  return haystack.includes(query)
}

export type InventoryWithMaterial = Inventory & {
  business_scrap_state?: 'available' | 'future'
  available_from_date?: string | null
  available_from_stage_id?: string | null
  source_nesting_project_id?: string | null
  source_nesting_sheet_id?: string | null
  source_remnant_geom?: unknown
  material: Pick<Material, 'id' | 'name' | 'category' | 'default_supplier_id'> | null
  variant: MaterialVariant | null
  variant_options: MaterialVariant[]
  is_legacy_variant: boolean
  supplier_name: string | null
  source_machine_name: string | null
}

export type InventoryFactory = Pick<Factory, 'id' | 'name'>

export type InventoryTransactionWithRelations = InventoryTransaction & {
  material_name?: string | null
  material_category?: MaterialCategory | null
  variant?: MaterialVariant | null
  weight_kg?: number | null
  unit?: string | null
  secondary_unit?: string | null
  supplier_name?: string | null
  machine_name?: string | null
  user_name?: string | null
}

export type InventoryWarehouseHistoryCategorySummary = {
  category: MaterialCategory
  currentWeightKg: number
  previousWeightKg: number
  deltaWeightKg: number
  deltaPercent: number | null
  transactionCount: number
  receiptWeightKg: number
  reserveWeightKg: number
  unreserveWeightKg: number
  writeOffWeightKg: number
  adjustmentWeightKg: number
}

export type InventoryWarehouseHistoryTrendPoint = {
  date: string
  weightKg: number
  deltaWeightKg: number
}

export type InventoryWarehouseHistoryOverview = {
  period: {
    from: string
    to: string
  }
  currentWeightKg: number
  previousWeightKg: number
  deltaWeightKg: number
  deltaPercent: number | null
  transactionCount: number
  receiptWeightKg: number
  reserveWeightKg: number
  unreserveWeightKg: number
  writeOffWeightKg: number
  adjustmentWeightKg: number
  categories: InventoryWarehouseHistoryCategorySummary[]
  trend: InventoryWarehouseHistoryTrendPoint[]
}

async function requireAccess(operation: PermissionOperation = 'view') {
  const { supabase, userId, role } = await requirePermission('inventory', operation)
  return { db: supabase as unknown as LooseDb, userId, role }
}

async function hydrateInventory(db: LooseDb, rows: Inventory[]): Promise<InventoryWithMaterial[]> {
  const materialIds = Array.from(new Set(rows.map((row) => row.material_id)))
  if (!materialIds.length) return []

  const { data: materialsData, error } = await db
    .from('materials')
    .select('id, name, category, default_supplier_id')
    .in('id', materialIds)
  if (error) throw new Error(error.message || 'Не удалось загрузить материалы')

  const materials = (materialsData || []) as Pick<Material, 'id' | 'name' | 'category' | 'default_supplier_id'>[]
  const materialMap = new Map(materials.map((material) => [material.id, material]))
  const variantMap = new Map<string, MaterialVariant>()
  const variantsByMaterial = new Map<string, MaterialVariant[]>()
  const { data: variantsData } = await db
    .from('material_variants')
    .select(MATERIAL_VARIANT_COLUMNS)
    .in('material_id', materialIds)

  for (const variant of (variantsData || []) as MaterialVariant[]) {
    variantMap.set(variant.id, variant)
    if (variant.material_id) {
      const current = variantsByMaterial.get(variant.material_id) || []
      current.push(variant)
      variantsByMaterial.set(variant.material_id, current)
    }
  }

  for (const variants of variantsByMaterial.values()) {
    variants.sort((a, b) => {
      const byUsage = (b.times_used || 0) - (a.times_used || 0)
      if (byUsage !== 0) return byUsage
      return new Date(b.last_used_at || b.created_at || 0).getTime() - new Date(a.last_used_at || a.created_at || 0).getTime()
    })
  }

  const missingVariantIds = Array.from(new Set(rows
    .map((row) => row.material_variant_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && !variantMap.has(id))
  ))
  if (missingVariantIds.length) {
    const { data: missingVariantsData } = await db
      .from('material_variants')
      .select(MATERIAL_VARIANT_COLUMNS)
      .in('id', missingVariantIds)
    for (const variant of (missingVariantsData || []) as MaterialVariant[]) {
      variantMap.set(variant.id, variant)
      if (variant.material_id) {
        const current = variantsByMaterial.get(variant.material_id) || []
        current.push(variant)
        variantsByMaterial.set(variant.material_id, current)
      }
    }
  }
  const supplierIds = Array.from(new Set(materials.map((material) => material.default_supplier_id).filter(Boolean))) as string[]
  const supplierMap = new Map<string, string>()
  if (supplierIds.length) {
    const { data: suppliersData, error: suppliersError } = await db.from('suppliers').select('id, name').in('id', supplierIds)
    if (suppliersError) throw new Error(suppliersError.message || 'Не удалось загрузить поставщиков')
    for (const supplier of (suppliersData || []) as { id: string; name: string }[]) supplierMap.set(supplier.id, supplier.name)
  }
  const transactionMachineByInventory = new Map<string, string>()
  const scrapIdsWithoutMachine = rows
    .filter((row) => row.is_business_scrap && !row.source_machine_id)
    .map((row) => row.id)
  if (scrapIdsWithoutMachine.length) {
    const { data: transactionData } = await db
      .from('inventory_transactions')
      .select('inventory_id, machine_id, created_at')
      .in('inventory_id', scrapIdsWithoutMachine)
      .order('created_at', { ascending: true })
    for (const transaction of (transactionData || []) as { inventory_id: string; machine_id: string | null }[]) {
      if (transaction.machine_id && !transactionMachineByInventory.has(transaction.inventory_id)) {
        transactionMachineByInventory.set(transaction.inventory_id, transaction.machine_id)
      }
    }
  }
  const sourceMachineIds = Array.from(new Set([
    ...rows.map((row) => row.source_machine_id).filter(Boolean),
    ...Array.from(transactionMachineByInventory.values()),
  ])) as string[]
  const sourceMachineMap = new Map<string, string>()
  if (sourceMachineIds.length) {
    const { data: machinesData, error: machinesError } = await db.from('machines').select('id, name').in('id', sourceMachineIds)
    if (machinesError) throw new Error(machinesError.message || 'Не удалось загрузить машины для делового отхода')
    for (const machine of (machinesData || []) as { id: string; name: string }[]) sourceMachineMap.set(machine.id, machine.name)
  }

  return rows.map((row) => {
    const material = materialMap.get(row.material_id) || null
    const variantOptions = variantsByMaterial.get(row.material_id) || []
    const exactVariant = row.material_variant_id ? variantMap.get(row.material_variant_id) || null : null
    const fallbackVariant = !row.material_variant_id && variantOptions.length === 1 ? variantOptions[0] : null
    return {
      ...row,
      material,
      variant: exactVariant || fallbackVariant,
      variant_options: variantOptions,
      is_legacy_variant: !row.material_variant_id,
      supplier_name: material?.default_supplier_id ? supplierMap.get(material.default_supplier_id) || null : null,
      source_machine_name: row.source_machine_id
        ? sourceMachineMap.get(row.source_machine_id) || null
        : sourceMachineMap.get(transactionMachineByInventory.get(row.id) || '') || null,
    }
  })
}

export async function getInventory(filters: { factory_id?: string | null; category?: MaterialCategory; search?: string; only_available?: boolean } = {}) {
  try {
    const { db } = await requireAccess()
    try {
      await db.rpc('fn_promote_due_future_business_scrap', {})
    } catch {
      // Inventory loading should remain available if best-effort promotion fails.
    }
    let query = db
      .from('inventory')
      .select(INVENTORY_LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(INVENTORY_LIST_LIMIT)
    if (filters.factory_id) query = query.eq('factory_id', filters.factory_id)
    if (filters.only_available) query = query.gt('available_quantity', 0)
    let { data, error } = await query
    if (error && error.message?.includes('source_machine_id')) {
      let fallbackQuery = db
        .from('inventory')
        .select(INVENTORY_LIST_COLUMNS_WITHOUT_SOURCE_MACHINE)
        .order('updated_at', { ascending: false })
        .limit(INVENTORY_LIST_LIMIT)
      if (filters.factory_id) fallbackQuery = fallbackQuery.eq('factory_id', filters.factory_id)
      if (filters.only_available) fallbackQuery = fallbackQuery.gt('available_quantity', 0)
      const fallbackResult = await fallbackQuery
      data = fallbackResult.data
      error = fallbackResult.error
    }
    if (error) throw new Error(error.message || 'Не удалось загрузить склад')

    let rows = await hydrateInventory(db, (data || []) as Inventory[])
    rows = rows.filter((row) => !row.deleted_at)
    if (filters.category) rows = rows.filter((row) => row.material?.category === filters.category)
    if (filters.search?.trim()) {
      rows = rows.filter((row) => inventoryMatchesSearch(row, filters.search || ''))
    }
    rows.sort((a, b) => (a.material?.name || '').localeCompare(b.material?.name || '', 'ru'))

    return { data: rows, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить склад' }
  }
}

export async function getInventoryFactories(): Promise<{ data: InventoryFactory[] | null; error: string | null }> {
  try {
    const { db } = await requireAccess()
    const { data, error } = await db
      .from('factories')
      .select('id, name')
      .order('name', { ascending: true })

    if (error) throw new Error(error.message || 'Не удалось загрузить заводы')

    return { data: (data || []) as InventoryFactory[], error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заводы' }
  }
}

export async function getStockForMaterial(materialId: string, factoryId?: string | null) {
  try {
    const { db } = await requireAccess()
    let query = db.from('inventory').select(INVENTORY_LIST_COLUMNS).eq('material_id', materialId)
    if (factoryId) query = query.eq('factory_id', factoryId)
    const { data, error } = await query.maybeSingle()
    if (error) throw new Error(error.message || 'Не удалось загрузить остаток')
    if (!data) {
      return { data: { total: 0, reserved: 0, available: 0, unit: 'кг', reservations: [] }, error: null }
    }
    const inventory = data as Inventory
    const { data: reservationsData, error: reservationsError } = await db
      .from('inventory_reservations')
      .select('id, machine_id, reserved_quantity, created_at')
      .eq('inventory_id', inventory.id)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
    if (reservationsError) throw new Error(reservationsError.message || 'Не удалось загрузить бронирования')
    const reservations = (reservationsData || []) as Pick<InventoryReservation, 'id' | 'machine_id' | 'reserved_quantity' | 'created_at'>[]
    const machineIds = Array.from(new Set(reservations.map((item) => item.machine_id)))
    const machineMap = new Map<string, string>()
    if (machineIds.length) {
      const { data: machinesData } = await db.from('machines').select('id, name').in('id', machineIds)
      for (const machine of (machinesData || []) as { id: string; name: string }[]) machineMap.set(machine.id, machine.name)
    }

    return {
      data: {
        total: inventory.total_quantity,
        reserved: inventory.reserved_quantity,
        available: inventory.available_quantity,
        unit: inventory.unit,
        reservations: reservations.map((item) => ({
          machine_name: machineMap.get(item.machine_id) || 'Машина',
          quantity: item.reserved_quantity,
          reserved_at: item.created_at,
        })),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить остаток' }
  }
}

export async function addReceipt(data: {
  factory_id: string
  material_id: string
  material_variant_id?: string | null
  quantity: number
  unit?: string
  comment?: string
  secondary_quantity?: number | null
  secondary_unit?: string | null
  supplier_id?: string | null
  piece_length_mm?: number | null
}): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    if (!data.factory_id) throw new Error('Выберите завод склада')
    const { error } = await db.rpc('fn_add_inventory_receipt', {
      p_factory_id: data.factory_id,
      p_material_id: data.material_id,
      p_quantity: Number(data.quantity),
      p_unit: data.unit || 'кг',
      p_performed_by: userId,
      p_comment: data.comment || null,
      p_secondary_quantity: data.secondary_quantity ?? null,
      p_secondary_unit: data.secondary_unit ?? null,
      p_supplier_id: data.supplier_id ?? null,
      p_material_variant_id: data.material_variant_id ?? null,
      p_piece_length_mm: data.piece_length_mm ?? null,
    })
    if (error) throw new Error(error.message || 'Не удалось оприходовать материал')
    if (data.material_variant_id) {
      let verifyQuery = db
        .from('inventory')
        .select('id')
        .eq('factory_id', data.factory_id)
        .eq('material_id', data.material_id)
        .eq('material_variant_id', data.material_variant_id)
      verifyQuery = data.piece_length_mm === null || data.piece_length_mm === undefined
        ? verifyQuery.is('piece_length_mm', null)
        : verifyQuery.eq('piece_length_mm', data.piece_length_mm)
      const { data: inventoryRow, error: verifyError } = await verifyQuery
        .maybeSingle()
      if (verifyError) throw new Error(verifyError.message || 'Не удалось проверить складскую строку по характеристикам')
      if (!inventoryRow) {
        throw new Error('Приход не создал отдельный остаток по характеристикам. Примените миграцию 65_inventory_by_material_variant.sql к Supabase.')
      }
    }
    revalidateInventory(data.material_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось оприходовать материал' }
  }
}

export async function reserveForMachine(data: {
  inventory_id?: string | null
  material_id: string
  material_variant_id?: string | null
  piece_length_mm?: number | null
  machine_id: string
  quantity: number
  request_item_table: string
  request_item_id: string
  secondary_quantity?: number | null
  use_cut_reservation?: boolean
}): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { error } = data.inventory_id
      ? await db.rpc('fn_reserve_inventory_row_for_machine', {
          p_inventory_id: data.inventory_id,
          p_machine_id: data.machine_id,
          p_quantity: Number(data.quantity),
          p_request_item_table: data.request_item_table,
          p_request_item_id: data.request_item_id,
          p_reserved_by: userId,
          p_secondary_quantity: data.secondary_quantity ?? null,
          p_is_cut_reservation: data.use_cut_reservation ?? null,
        })
      : await db.rpc('fn_reserve_inventory_for_machine', {
          p_material_id: data.material_id,
          p_machine_id: data.machine_id,
          p_quantity: Number(data.quantity),
          p_request_item_table: data.request_item_table,
          p_request_item_id: data.request_item_id,
          p_reserved_by: userId,
          p_secondary_quantity: data.secondary_quantity ?? null,
          p_material_variant_id: data.material_variant_id ?? null,
          p_piece_length_mm: data.piece_length_mm ?? null,
        })
    if (error) throw new Error(error.message || 'Не удалось забронировать материал')
    revalidateOrderAndMachine(data.machine_id, data.material_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось забронировать материал' }
  }
}

export async function reserveFutureBusinessScrapForMachine(data: {
  inventory_id: string
  machine_id: string
  quantity: number
  request_item_table: string
  request_item_id: string
  secondary_quantity?: number | null
}): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { error } = await db.rpc('fn_reserve_future_business_scrap_for_machine', {
      p_inventory_id: data.inventory_id,
      p_machine_id: data.machine_id,
      p_quantity: Number(data.quantity),
      p_request_item_table: data.request_item_table,
      p_request_item_id: data.request_item_id,
      p_reserved_by: userId,
      p_secondary_quantity: data.secondary_quantity ?? null,
    })
    if (error) throw new Error(error.message || 'Не удалось забронировать будущий деловой остаток')
    revalidateOrderAndMachine(data.machine_id)
    revalidatePath(ROUTES.INVENTORY)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось забронировать будущий деловой остаток' }
  }
}

export async function unreserveFromMachine(reservationId: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { data: reservationData } = await db
      .from('inventory_reservations')
      .select('material_id, machine_id, business_scrap_inventory_id, business_scrap_quantity, consumed_at')
      .eq('id', reservationId)
      .maybeSingle()
    const reservation = reservationData as Pick<InventoryReservation, 'material_id' | 'machine_id' | 'business_scrap_inventory_id' | 'business_scrap_quantity' | 'consumed_at'> | null
    if (reservation?.consumed_at) throw new Error('Бронь уже списана по факту заготовки')
    const { error } = await db.rpc('fn_unreserve_inventory_reservation', {
      p_reservation_id: reservationId,
      p_performed_by: userId,
      p_comment: 'Снятие брони',
    })
    if (error) throw new Error(error.message || 'Не удалось снять бронь')
    await archiveConsumedBusinessScrap(reservation, userId)
    revalidateOrderAndMachine(reservation?.machine_id, reservation?.material_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось снять бронь' }
  }
}

export async function unreserveRequestItem(table: string, id: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { data } = await db
      .from('inventory_reservations')
      .select('id, business_scrap_inventory_id, business_scrap_quantity')
      .eq('request_item_table', table)
      .eq('request_item_id', id)
      .is('consumed_at', null)
    const reservations = (data || []) as Pick<InventoryReservation, 'id' | 'business_scrap_inventory_id' | 'business_scrap_quantity'>[]
    for (const reservation of reservations) {
      const { error } = await db.rpc('fn_unreserve_inventory_reservation', {
        p_reservation_id: reservation.id,
        p_performed_by: userId,
        p_comment: 'Позиция заявки удалена',
      })
      if (error) throw new Error(error.message || 'Не удалось снять бронь позиции')
      await archiveConsumedBusinessScrap(reservation, userId)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось снять бронь позиции' }
  }
}

export async function adjustInventory(data: {
  inventory_id: string
  material_id: string
  new_total: number
  comment: string
  new_secondary_total?: number | null
}): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { error } = await db.rpc('fn_adjust_inventory_record', {
      p_inventory_id: data.inventory_id,
      p_new_total: Number(data.new_total),
      p_performed_by: userId,
      p_comment: data.comment,
      p_new_secondary_total: data.new_secondary_total ?? null,
    })
    if (error) throw new Error(error.message || 'Не удалось скорректировать остаток')
    revalidateInventory(data.material_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось скорректировать остаток' }
  }
}

export async function deleteInventoryItem(inventoryId: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireAccess('manage')
    const { data: rowData } = await db
      .from('inventory')
      .select('material_id')
      .eq('id', inventoryId)
      .maybeSingle()
    const row = rowData as { material_id: string } | null

    const { error } = await db.rpc('fn_archive_inventory_item', {
      p_inventory_id: inventoryId,
      p_performed_by: userId,
      p_comment: 'Удаление со склада',
    })
    if (error) throw new Error(error.message || 'Не удалось удалить материал со склада')
    revalidateInventory(row?.material_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить материал со склада' }
  }
}

type InventoryHistoryStockRow = Pick<Inventory, 'id' | 'material_id' | 'total_quantity' | 'unit' | 'total_secondary_quantity' | 'secondary_unit' | 'calculated_weight_kg' | 'business_scrap_state'>
type InventoryHistoryTransactionRow = Pick<InventoryTransaction, 'id' | 'inventory_id' | 'material_id' | 'material_variant_id' | 'transaction_type' | 'quantity' | 'secondary_quantity' | 'request_item_table' | 'request_item_id' | 'created_at'>

export async function getWarehouseHistoryOverview(filters: {
  factory_id?: string | null
  from_date?: string
  to_date?: string
} = {}) {
  try {
    const { db } = await requireAccess()
    const period = normalizeHistoryPeriod(filters.from_date, filters.to_date)

    let currentQuery = db
      .from('inventory')
      .select('id, material_id, total_quantity, unit, total_secondary_quantity, secondary_unit, calculated_weight_kg, business_scrap_state')
      .is('deleted_at', null)
    if (filters.factory_id) currentQuery = currentQuery.eq('factory_id', filters.factory_id)

    let transactionQuery = db
      .from('inventory_transactions')
      .select('id, factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity, secondary_quantity, request_item_table, request_item_id, created_at')
      .gte('created_at', period.fromIso)
      .lte('created_at', period.toIso)
      .order('created_at', { ascending: true })
    if (filters.factory_id) transactionQuery = transactionQuery.eq('factory_id', filters.factory_id)

    const [currentResult, transactionResult] = await Promise.all([currentQuery, transactionQuery])
    if (currentResult.error) throw new Error(currentResult.error.message || 'Не удалось загрузить текущие остатки склада')
    if (transactionResult.error) throw new Error(transactionResult.error.message || 'Не удалось загрузить историю склада')

    const currentRows = ((currentResult.data || []) as InventoryHistoryStockRow[])
      .filter((row) => (row.business_scrap_state || 'available') !== 'future')
    const transactionRows = (transactionResult.data || []) as InventoryHistoryTransactionRow[]
    const transactionInventoryIds = Array.from(new Set(transactionRows.map((row) => row.inventory_id).filter(Boolean)))
    const transactionVariantIds = Array.from(new Set(transactionRows.map((row) => row.material_variant_id).filter(Boolean))) as string[]
    const transactionStockMap = new Map<string, InventoryHistoryStockRow>()
    const transactionVariantMap = new Map<string, MaterialVariant>()

    if (transactionInventoryIds.length) {
      const { data, error } = await db
        .from('inventory')
        .select('id, material_id, total_quantity, unit, total_secondary_quantity, secondary_unit, calculated_weight_kg, business_scrap_state')
        .in('id', transactionInventoryIds)
      if (error) throw new Error(error.message || 'Не удалось загрузить веса движений склада')
      for (const row of (data || []) as InventoryHistoryStockRow[]) transactionStockMap.set(row.id, row)
    }
    if (transactionVariantIds.length) {
      const { data, error } = await db
        .from('material_variants')
        .select(MATERIAL_VARIANT_COLUMNS)
        .in('id', transactionVariantIds)
      if (error) throw new Error(error.message || 'Не удалось загрузить веса вариантов материалов')
      for (const row of (data || []) as MaterialVariant[]) transactionVariantMap.set(row.id, row)
    }
    const requestItemWeightMap = await loadRequestItemWeightMap(db, transactionRows)

    const materialIds = Array.from(new Set([
      ...currentRows.map((row) => row.material_id),
      ...transactionRows.map((row) => row.material_id),
      ...Array.from(transactionStockMap.values()).map((row) => row.material_id),
    ].filter(Boolean)))
    const materialCategoryMap = new Map<string, MaterialCategory>()
    if (materialIds.length) {
      const { data, error } = await db.from('materials').select('id, category').in('id', materialIds)
      if (error) throw new Error(error.message || 'Не удалось загрузить категории материалов')
      for (const item of (data || []) as Array<{ id: string; category: MaterialCategory }>) {
        materialCategoryMap.set(item.id, item.category)
      }
    }

    const categories = new Map<MaterialCategory, InventoryWarehouseHistoryCategorySummary>()
    const ensureCategory = (category: MaterialCategory) => {
      const existing = categories.get(category)
      if (existing) return existing
      const created: InventoryWarehouseHistoryCategorySummary = {
        category,
        currentWeightKg: 0,
        previousWeightKg: 0,
        deltaWeightKg: 0,
        deltaPercent: null,
        transactionCount: 0,
        receiptWeightKg: 0,
        reserveWeightKg: 0,
        unreserveWeightKg: 0,
        writeOffWeightKg: 0,
        adjustmentWeightKg: 0,
      }
      categories.set(category, created)
      return created
    }

    let currentWeightKg = 0
    for (const row of currentRows) {
      const category = materialCategoryMap.get(row.material_id) || 'other'
      const weight = normalizeWeight(row.calculated_weight_kg)
      currentWeightKg += weight
      ensureCategory(category).currentWeightKg += weight
    }

    let deltaWeightKg = 0
    let receiptWeightKg = 0
    let reserveWeightKg = 0
    let unreserveWeightKg = 0
    let writeOffWeightKg = 0
    let adjustmentWeightKg = 0
    const dailyDelta = new Map<string, number>()

    for (const row of transactionRows) {
      const stock = transactionStockMap.get(row.inventory_id)
      const variant = row.material_variant_id ? transactionVariantMap.get(row.material_variant_id) : null
      const category = materialCategoryMap.get(row.material_id) || materialCategoryMap.get(stock?.material_id || '') || 'other'
      const summary = ensureCategory(category)
      const movementWeight = requestItemTransactionWeight(row, requestItemWeightMap) ?? estimateTransactionWeight(row, stock, variant)
      const totalDelta = totalStockDeltaWeight(row, movementWeight)

      summary.transactionCount += 1
      if (row.transaction_type === 'receipt') {
        receiptWeightKg += movementWeight
        summary.receiptWeightKg += movementWeight
      } else if (row.transaction_type === 'reserve') {
        reserveWeightKg += movementWeight
        summary.reserveWeightKg += movementWeight
      } else if (row.transaction_type === 'unreserve') {
        unreserveWeightKg += movementWeight
        summary.unreserveWeightKg += movementWeight
      } else if (row.transaction_type === 'write_off') {
        writeOffWeightKg += movementWeight
        summary.writeOffWeightKg += movementWeight
      } else if (row.transaction_type === 'adjustment') {
        adjustmentWeightKg += totalDelta
        summary.adjustmentWeightKg += totalDelta
      }

      if (totalDelta !== 0) {
        deltaWeightKg += totalDelta
        summary.deltaWeightKg += totalDelta
        const day = dayKey(row.created_at)
        dailyDelta.set(day, (dailyDelta.get(day) || 0) + totalDelta)
      }
    }

    const previousWeightKg = currentWeightKg - deltaWeightKg
    const trend = buildWeightTrend(period.from, period.to, previousWeightKg, dailyDelta)
    const sortedCategories = Array.from(categories.values())
      .map((summary) => {
        const previousWeight = summary.currentWeightKg - summary.deltaWeightKg
        return {
          ...summary,
          previousWeightKg: previousWeight,
          deltaPercent: percentDelta(summary.deltaWeightKg, previousWeight),
        }
      })
      .sort((left, right) => Math.abs(right.currentWeightKg) - Math.abs(left.currentWeightKg))

    return {
      data: {
        period: { from: period.from, to: period.to },
        currentWeightKg,
        previousWeightKg,
        deltaWeightKg,
        deltaPercent: percentDelta(deltaWeightKg, previousWeightKg),
        transactionCount: transactionRows.length,
        receiptWeightKg,
        reserveWeightKg,
        unreserveWeightKg,
        writeOffWeightKg,
        adjustmentWeightKg,
        categories: sortedCategories,
        trend,
      } satisfies InventoryWarehouseHistoryOverview,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить историю склада',
    }
  }
}

export async function getTransactions(filters: {
  factory_id?: string | null
  material_id?: string
  machine_id?: string
  type?: InventoryTransactionType
  from_date?: string
  to_date?: string
  page?: number
  pageSize?: number
} = {}) {
  try {
    const { db } = await requireAccess()
    const page = Math.max(0, Number.isFinite(filters.page) ? Math.floor(filters.page || 0) : 0)
    const pageSize = Math.min(100, Math.max(1, Number.isFinite(filters.pageSize) ? Math.floor(filters.pageSize || 50) : 50))
    const from = page * pageSize
    const to = from + pageSize - 1
    let query = db
      .from('inventory_transactions')
      .select('id, factory_id, inventory_id, material_id, material_variant_id, transaction_type, quantity, secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, supplier_id, comment, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
    if (filters.factory_id) query = query.eq('factory_id', filters.factory_id)
    if (filters.material_id) query = query.eq('material_id', filters.material_id)
    if (filters.machine_id) query = query.eq('machine_id', filters.machine_id)
    if (filters.type) query = query.eq('transaction_type', filters.type)
    if (filters.from_date) query = query.gte('created_at', filters.from_date)
    if (filters.to_date) query = query.lte('created_at', filters.to_date)
    const { data, error, count } = await query
    if (error) throw new Error(error.message || 'Не удалось загрузить историю')
    const rows = (data || []) as InventoryTransaction[]
    return {
      data: await hydrateTransactions(db, rows),
      error: null,
      pagination: { page, pageSize, total: count || 0 },
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить историю',
      pagination: null,
    }
  }
}

export async function getAvailableStockForMaterials(materialIds: string[]) {
  try {
    const { db } = await requireAccess()
    if (!materialIds.length) return { data: new Map<string, { available: number; unit: string }>(), error: null }
    const { data, error } = await db.from('inventory').select('material_id, available_quantity, unit').in('material_id', materialIds)
    if (error) throw new Error(error.message || 'Не удалось загрузить остатки')
    const map = new Map<string, { available: number; unit: string }>()
    for (const row of (data || []) as { material_id: string; available_quantity: number; unit: string }[]) {
      const current = map.get(row.material_id)
      map.set(row.material_id, { available: (current?.available || 0) + row.available_quantity, unit: current?.unit || row.unit })
    }
    return { data: map, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить остатки' }
  }
}

function normalizeHistoryPeriod(fromDate?: string, toDate?: string) {
  const today = new Date()
  const fallbackTo = dateOnly(today)
  const fallbackFrom = dateOnly(addDays(today, -29))
  const from = safeDateOnly(fromDate) || fallbackFrom
  const to = safeDateOnly(toDate) || fallbackTo
  const orderedFrom = from <= to ? from : to
  const orderedTo = from <= to ? to : from

  return {
    from: orderedFrom,
    to: orderedTo,
    fromIso: `${orderedFrom}T00:00:00.000Z`,
    toIso: `${orderedTo}T23:59:59.999Z`,
  }
}

function safeDateOnly(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return value
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function normalizeWeight(value: number | null | undefined) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function estimateTransactionWeight(row: InventoryHistoryTransactionRow, stock?: InventoryHistoryStockRow, variant?: MaterialVariant | null) {
  const quantity = Math.abs(Number(row.quantity || 0))
  if (!Number.isFinite(quantity) || quantity <= 0) return 0
  const primaryUnit = stock?.unit || variant?.default_unit || ''
  if (isKgUnit(primaryUnit)) return quantity

  const totalQuantity = Math.abs(Number(stock?.total_quantity || 0))
  const totalWeight = normalizeWeight(stock?.calculated_weight_kg)
  if (totalQuantity > 0 && totalWeight > 0) return quantity * (totalWeight / totalQuantity)

  return estimateVariantWeight(row, stock, variant, quantity, primaryUnit)
}

function totalStockDeltaWeight(row: InventoryHistoryTransactionRow, movementWeight: number) {
  if (row.transaction_type === 'receipt') return movementWeight
  if (row.transaction_type === 'write_off') return -movementWeight
  if (row.transaction_type === 'adjustment') return signedDirection(row.quantity) * movementWeight
  return 0
}

function signedDirection(value: number) {
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

function estimateVariantWeight(
  row: InventoryHistoryTransactionRow,
  stock: InventoryHistoryStockRow | undefined,
  variant: MaterialVariant | null | undefined,
  quantity: number,
  primaryUnit: string,
) {
  if (!variant) return 0

  const meterQuantity = isMeterUnit(primaryUnit)
    ? quantity
    : isMeterUnit(stock?.secondary_unit || '') ? Math.abs(Number(row.secondary_quantity || 0)) : 0
  const weightPerMeter = normalizeWeight(variant.weight_per_m_kg)
  if (meterQuantity > 0 && weightPerMeter > 0) return meterQuantity * weightPerMeter

  const unitWeight = normalizeWeight(variant.weight_per_unit_kg) || normalizeWeight(variant.unit_weight_kg)
  if (unitWeight > 0) return quantity * unitWeight

  const lengthMeters = normalizeWeight(variant.length_m)
  if (lengthMeters > 0 && weightPerMeter > 0) return quantity * lengthMeters * weightPerMeter

  return 0
}

function isKgUnit(value: string | null | undefined) {
  return ['кг', 'kg'].includes(String(value || '').trim().toLowerCase())
}

function isMeterUnit(value: string | null | undefined) {
  return ['м', 'm'].includes(String(value || '').trim().toLowerCase())
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

function buildWeightTrend(from: string, to: string, previousWeightKg: number, dailyDelta: Map<string, number>) {
  const trend: InventoryWarehouseHistoryTrendPoint[] = []
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  let cursor = start
  let runningWeight = previousWeightKg
  let guard = 0

  while (cursor <= end && guard < 370) {
    const date = dateOnly(cursor)
    const delta = dailyDelta.get(date) || 0
    runningWeight += delta
    trend.push({ date, deltaWeightKg: delta, weightKg: Math.max(0, runningWeight) })
    cursor = addDays(cursor, 1)
    guard += 1
  }

  return trend
}

function percentDelta(delta: number, base: number) {
  if (!Number.isFinite(base) || Math.abs(base) < 0.001) return null
  return (delta / Math.abs(base)) * 100
}

async function archiveConsumedBusinessScrap(
  reservation: Pick<InventoryReservation, 'business_scrap_inventory_id' | 'business_scrap_quantity'> | null,
  userId: string,
) {
  if (!reservation?.business_scrap_inventory_id || Number(reservation.business_scrap_quantity || 0) <= 0) return

  const adminDb = createAdminClient() as unknown as LooseDb
  const { data, error } = await adminDb
    .from('inventory')
    .select('id, total_quantity, reserved_quantity, total_secondary_quantity, reserved_secondary_quantity, deleted_at')
    .eq('id', reservation.business_scrap_inventory_id)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Не удалось проверить деловой отход после снятия брони')
  const scrap = data as Pick<Inventory, 'id' | 'total_quantity' | 'reserved_quantity' | 'total_secondary_quantity' | 'reserved_secondary_quantity' | 'deleted_at'> | null
  if (!scrap || scrap.deleted_at) return

  const hasQuantity = Number(scrap.total_quantity || 0) > 0 || Number(scrap.total_secondary_quantity || 0) > 0
  const hasReservation = Number(scrap.reserved_quantity || 0) > 0 || Number(scrap.reserved_secondary_quantity || 0) > 0
  if (hasQuantity || hasReservation) return

  const now = new Date().toISOString()
  const { error: archiveError } = await adminDb
    .from('inventory')
    .update({
      deleted_at: now,
      deleted_by: userId,
      delete_comment: 'Деловой отход удален после снятия брони и восстановления исходного куска',
      source_reservation_id: null,
      last_updated_by: userId,
      updated_at: now,
    })
    .eq('id', scrap.id)

  if (archiveError) throw new Error(archiveError.message || 'Не удалось удалить деловой отход после снятия брони')
}

async function hydrateTransactions(db: LooseDb, rows: InventoryTransaction[]): Promise<InventoryTransactionWithRelations[]> {
  const materialIds = Array.from(new Set(rows.map((row) => row.material_id).filter(Boolean)))
  const variantIds = Array.from(new Set(rows.map((row) => row.material_variant_id).filter(Boolean))) as string[]
  const inventoryIds = Array.from(new Set(rows.map((row) => row.inventory_id).filter(Boolean)))
  const machineIds = Array.from(new Set(rows.map((row) => row.machine_id).filter(Boolean))) as string[]
  const userIds = Array.from(new Set(rows.map((row) => row.performed_by).filter(Boolean)))
  const supplierIds = Array.from(new Set(rows.map((row) => row.supplier_id).filter(Boolean))) as string[]
  const materialMap = new Map<string, { name: string; category: MaterialCategory }>()
  const variantMap = new Map<string, MaterialVariant>()
  const inventoryMap = new Map<string, { unit: string; secondary_unit: string | null; total_quantity: number; calculated_weight_kg: number | null }>()
  const machineMap = new Map<string, string>()
  const userMap = new Map<string, string>()
  const supplierMap = new Map<string, string>()

  if (materialIds.length) {
    const { data } = await db.from('materials').select('id, name, category').in('id', materialIds)
    for (const item of (data || []) as { id: string; name: string; category: MaterialCategory }[]) {
      materialMap.set(item.id, { name: item.name, category: item.category })
    }
  }
  if (variantIds.length) {
    const { data } = await db.from('material_variants').select(MATERIAL_VARIANT_COLUMNS).in('id', variantIds)
    for (const item of (data || []) as MaterialVariant[]) variantMap.set(item.id, item)
  }
  if (inventoryIds.length) {
    const { data } = await db.from('inventory').select('id, unit, secondary_unit, total_quantity, calculated_weight_kg').in('id', inventoryIds)
    for (const item of (data || []) as { id: string; unit: string; secondary_unit: string | null; total_quantity: number; calculated_weight_kg: number | null }[]) {
      inventoryMap.set(item.id, { unit: item.unit, secondary_unit: item.secondary_unit, total_quantity: item.total_quantity, calculated_weight_kg: item.calculated_weight_kg })
    }
  }
  if (machineIds.length) {
    const { data } = await db.from('machines').select('id, name').in('id', machineIds)
    for (const item of (data || []) as { id: string; name: string }[]) machineMap.set(item.id, item.name)
  }
  if (userIds.length) {
    const { data } = await db.from('users').select('id, full_name').in('id', userIds)
    for (const item of (data || []) as { id: string; full_name: string }[]) userMap.set(item.id, item.full_name)
  }
  if (supplierIds.length) {
    const { data } = await db.from('suppliers').select('id, name').in('id', supplierIds)
    for (const item of (data || []) as { id: string; name: string }[]) supplierMap.set(item.id, item.name)
  }
  const requestItemWeightMap = await loadRequestItemWeightMap(db, rows)

  return rows.map((row) => {
    const inventory = inventoryMap.get(row.inventory_id)
    const variant = row.material_variant_id ? variantMap.get(row.material_variant_id) || null : null
    const stock = inventory
      ? {
          id: row.inventory_id,
          material_id: row.material_id,
          total_quantity: inventory.total_quantity,
          unit: inventory.unit,
          total_secondary_quantity: null,
          secondary_unit: inventory.secondary_unit,
          calculated_weight_kg: inventory.calculated_weight_kg,
          business_scrap_state: 'available' as const,
        }
      : undefined
    const weightKg = requestItemTransactionWeight(row, requestItemWeightMap) ?? estimateTransactionWeight(row, stock, variant)

    return {
      ...row,
      material_name: materialMap.get(row.material_id)?.name || null,
      material_category: materialMap.get(row.material_id)?.category || null,
      variant,
      weight_kg: weightKg > 0 ? weightKg : null,
      unit: inventory?.unit || null,
      secondary_unit: inventory?.secondary_unit || null,
      supplier_name: row.supplier_id ? supplierMap.get(row.supplier_id) || null : null,
      machine_name: row.machine_id ? machineMap.get(row.machine_id) || null : null,
      user_name: userMap.get(row.performed_by) || null,
    }
  })
}

async function loadRequestItemWeightMap(db: LooseDb, rows: Array<Pick<InventoryTransaction, 'request_item_table' | 'request_item_id'>>) {
  const idsByTable = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.request_item_table || !row.request_item_id || !REQUEST_ITEM_WEIGHT_CONFIGS[row.request_item_table]) continue
    const ids = idsByTable.get(row.request_item_table) || []
    ids.push(row.request_item_id)
    idsByTable.set(row.request_item_table, ids)
  }

  const weightMap = new Map<string, RequestItemWeight>()
  for (const [table, ids] of idsByTable.entries()) {
    const config = REQUEST_ITEM_WEIGHT_CONFIGS[table]
    const uniqueIds = Array.from(new Set(ids))
    const { data, error } = await db.from(table).select(config.columns).in('id', uniqueIds)
    if (error) throw new Error(error.message || 'Не удалось загрузить веса позиций заявки')
    for (const item of (data || []) as Array<Record<string, unknown> & { id: string }>) {
      const weightKg = config.weight(item)
      if (!weightKg || weightKg <= 0) continue
      weightMap.set(requestItemWeightKey(table, item.id), {
        weightKg,
        quantity: config.quantity(item),
      })
    }
  }
  return weightMap
}

function requestItemTransactionWeight(
  row: Pick<InventoryTransaction, 'request_item_table' | 'request_item_id' | 'quantity'>,
  weightMap: Map<string, RequestItemWeight>,
) {
  if (!row.request_item_table || !row.request_item_id) return null
  const item = weightMap.get(requestItemWeightKey(row.request_item_table, row.request_item_id))
  if (!item || item.weightKg <= 0) return null
  const transactionQuantity = Math.abs(Number(row.quantity || 0))
  const itemQuantity = Math.abs(Number(item.quantity || 0))
  if (transactionQuantity > 0 && itemQuantity > 0 && transactionQuantity < itemQuantity) {
    return item.weightKg * (transactionQuantity / itemQuantity)
  }
  return item.weightKg
}

function requestItemWeightKey(table: string, id: string) {
  return `${table}:${id}`
}

function numberOrNull(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

function revalidateInventory(materialId?: string | null) {
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.INVENTORY_HISTORY)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  if (materialId) revalidatePath(`${ROUTES.INVENTORY}/${materialId}/history`)
}

function revalidateOrderAndMachine(machineId?: string | null, materialId?: string | null) {
  revalidateInventory(materialId)
  revalidatePath(ROUTES.SUPPLY)
  revalidatePath(ROUTES.SALES_PLAN)
  if (machineId) {
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
  }
}
