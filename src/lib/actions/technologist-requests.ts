'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { ROUTES } from '@/lib/constants/routes'
import { recordMaterialUsage } from '@/lib/actions/materials'
import { repairImportedSheetMetalMaterials } from '@/lib/actions/request-sheet-metal-materials'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import { requirePermission } from '@/lib/permissions/server'
import { assertMachineCanUseTechnologistRequest } from '@/lib/actions/machine-progress'
import type { PermissionOperation } from '@/lib/permissions/resources'
import {
  availabilitySchema,
  chainCordSchema,
  chainCordUpdateSchema,
  circleSchema,
  circleUpdateSchema,
  componentSchema,
  componentUpdateSchema,
  knifeSchema,
  knifeUpdateSchema,
  meshSchema,
  meshUpdateSchema,
  paintSchema,
  paintUpdateSchema,
  pipeSchema,
  pipeUpdateSchema,
  roundTubeSchema,
  roundTubeUpdateSchema,
  sheetMetalSchema,
  sheetMetalUpdateSchema,
  type AvailabilityInput,
} from '@/lib/types/request-schemas'
import type {
  MaterialCategory,
  MaterialVariant,
  OrderItemStatus,
  RequestChainCord,
  RequestCircle,
  RequestComponents,
  RequestKnives,
  RequestMesh,
  RequestPaint,
  RequestPipe,
  RequestRoundTube,
  RequestSheetMetal,
  RequestStatus,
  Supplier,
  TechnologistRequest,
  UserRole,
} from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  delete: () => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery; rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult> }

export type WithMaterialName<T> = T & {
  materials?: { id: string; name: string } | null
}

export type TechnologistRequestPayload = {
  request: TechnologistRequest
  sheetMetal: WithMaterialName<RequestSheetMetal>[]
  roundTube: WithMaterialName<RequestRoundTube>[]
  circles: WithMaterialName<RequestCircle>[]
  pipes: WithMaterialName<RequestPipe>[]
  knives: WithMaterialName<RequestKnives>[]
  components: WithMaterialName<RequestComponents>[]
  paint: WithMaterialName<RequestPaint>[]
  meshItems: WithMaterialName<RequestMesh>[]
  chainCords: WithMaterialName<RequestChainCord>[]
  sheetMetals?: WithMaterialName<RequestSheetMetal>[]
  paints?: WithMaterialName<RequestPaint>[]
  roundTubes?: WithMaterialName<RequestRoundTube>[]
}

export type RequestLifecycleStatus = 'draft' | 'stock_check' | 'submitted_to_supply' | 'delivery' | 'received'

export type TechnologistRequestListItem = Pick<
  TechnologistRequest,
  'id' | 'machine_id' | 'status' | 'submitted_at' | 'created_at' | 'updated_at'
> & {
  lifecycle_status: RequestLifecycleStatus
  lifecycle_label: string
}

type RequestSectionTable =
  | 'request_sheet_metal'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_paint'
  | 'request_components'
  | 'request_mesh'
  | 'request_chain_cord'
  | 'request_round_tube'

type ActionResult<T = unknown> = {
  success: boolean
  error?: string
  data?: T
}

type RequestOrderStatusRow = {
  request_id?: string | null
  order_status?: OrderItemStatus | null
}

type MaterialVariantModeRow = Record<string, unknown> & {
  material_id?: string | null
  material_variant_id?: string | null
  is_custom_material_variant?: boolean | null
}

const REQUEST_SECTION_TABLES: RequestSectionTable[] = [
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]

const REQUEST_LIFECYCLE_LABELS: Record<RequestLifecycleStatus, string> = {
  draft: 'Черновик',
  stock_check: 'Проверка склада',
  submitted_to_supply: 'Отправлена в снабжение',
  delivery: 'Доставка',
  received: 'Принята на склад',
}

const MATERIAL_CHARACTERISTIC_FIELDS: Record<RequestSectionTable, Set<string>> = {
  request_sheet_metal: new Set(['material_name', 'material_grade', 'steel_type_id', 'sheet_size', 'thickness_mm']),
  request_circle: new Set(['diameter_mm', 'steel_grade', 'steel_type_id', 'is_calibrated']),
  request_pipe: new Set(['pipe_type', 'steel_type_id', 'size', 'wall_thickness_mm', 'diameter_mm']),
  request_knives: new Set(['knife_type', 'steel_grade', 'steel_type_id', 'length_mm', 'width_mm', 'height_mm']),
  request_components: new Set(['component_name', 'diameter_mm', 'unit']),
  request_paint: new Set(['paint_type', 'ral_code', 'finish']),
  request_mesh: new Set(['description', 'length_mm', 'width_mm']),
  request_chain_cord: new Set(['item_type', 'parameters']),
  request_round_tube: new Set(['material_name', 'piece_count']),
}

const RESERVED_ROW_PROTECTED_FIELDS: Record<RequestSectionTable, Set<string>> = {
  request_sheet_metal: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'material_name', 'material_grade', 'steel_type_id', 'sheet_size', 'thickness_mm', 'remainder_qty']),
  request_circle: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'diameter_mm', 'steel_grade', 'steel_type_id', 'is_calibrated', 'remainder_mm']),
  request_pipe: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'pipe_type', 'steel_type_id', 'size', 'wall_thickness_mm', 'diameter_mm', 'remainder_length_mm', 'remainder_qty', 'remainder_kg']),
  request_knives: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'knife_type', 'steel_grade', 'steel_type_id', 'length_mm', 'width_mm', 'height_mm', 'remainder_meters', 'remainder_qty']),
  request_components: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'component_name', 'diameter_mm', 'quantity_needed', 'stock_remainder', 'unit']),
  request_paint: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'paint_type', 'ral_code', 'finish', 'remainder_kg']),
  request_mesh: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'description', 'length_mm', 'width_mm', 'remainder_qty']),
  request_chain_cord: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'item_type', 'parameters', 'remainder_meters']),
  request_round_tube: new Set(['material_id', 'material_variant_id', 'is_custom_material_variant', 'material_name', 'piece_count', 'order_kg', 'order_meters']),
}

async function requireRequestPermission(operation: PermissionOperation = 'view') {
  const { supabase, userId, role } = await requirePermission('technologist_requests', operation)
  return { supabase, db: supabase as unknown as LooseDb, userId, role }
}

async function assertMachineNotArchived(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select('is_archived')
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error('Машина не найдена')
  if ((data as { is_archived?: boolean }).is_archived) {
    throw new Error('Машина архивирована. Действия с ней остановлены.')
  }
}

function isDirector(role: UserRole) {
  return DIRECTOR_ROLES.includes(role)
}

function assertRole(role: UserRole, allowed: UserRole[], message = 'Недостаточно прав') {
  if (!allowed.includes(role)) throw new Error(message)
}

function requestPath(machineId: string) {
  return `${ROUTES.SALES_PLAN}/${machineId}/request`
}

function requestDetailPath(machineId: string, requestId: string) {
  return `${requestPath(machineId)}/${requestId}`
}

function revalidateRequest(machineId: string, requestId?: string) {
  revalidatePath(requestPath(machineId))
  if (requestId) revalidatePath(requestDetailPath(machineId, requestId))
  revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
}

async function getRequestMachine(db: LooseDb, requestId: string) {
  const { data, error } = await db
    .from('technologist_requests')
    .select('id, machine_id, status')
    .eq('id', requestId)
    .single()

  if (error || !data) throw new Error('Заявка не найдена')
  return data as { id: string; machine_id: string; status: RequestStatus }
}

function timeRank(value?: string | null) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function requestTimeRank(request: Pick<TechnologistRequest, 'created_at' | 'updated_at' | 'submitted_at'>) {
  return Math.max(timeRank(request.updated_at), timeRank(request.submitted_at), timeRank(request.created_at))
}

function pickActiveRequest(requests: TechnologistRequest[]) {
  return [...requests].sort((left, right) => requestTimeRank(right) - requestTimeRank(left)).at(0) || null
}

function isRequestVisibleForRequestRole(request: TechnologistRequest, role: UserRole) {
  if (role !== 'supply_manager') return true
  return request.status === 'submitted_to_supply' || request.status === 'completed'
}

function deriveRequestLifecycleStatus(request: TechnologistRequest, orderStatuses: OrderItemStatus[]): RequestLifecycleStatus {
  if (request.status === 'draft') return 'draft'
  if (request.status === 'pending_stock_check' || request.status === 'stock_checked') return 'stock_check'
  if (request.status === 'completed') return 'received'

  if (orderStatuses.length > 0 && orderStatuses.every((status) => status === 'delivered')) {
    return 'received'
  }
  if (orderStatuses.some((status) => status === 'ordered' || status === 'delivered')) {
    return 'delivery'
  }
  return 'submitted_to_supply'
}

async function loadMachineRequests(db: LooseDb, machineId: string, role: UserRole) {
  const { data, error } = await db
    .from('technologist_requests')
    .select('*')
    .eq('machine_id', machineId)
    .order('created_at', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message || 'Не удалось загрузить заявки')
  return ((data || []) as TechnologistRequest[]).filter((request) => isRequestVisibleForRequestRole(request, role))
}

async function loadRequestOrderStatuses(db: LooseDb, requestIds: string[]) {
  const statuses = new Map<string, OrderItemStatus[]>()
  const ids = Array.from(new Set(requestIds.filter(Boolean)))
  for (const requestId of ids) statuses.set(requestId, [])
  if (ids.length === 0) return statuses

  const results = await Promise.all(
    REQUEST_SECTION_TABLES.map((table) => db
      .from(table)
      .select('request_id, order_status')
      .in('request_id', ids))
  )

  for (const result of results) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить статусы закупки')
    for (const row of (result.data || []) as RequestOrderStatusRow[]) {
      if (!row.request_id || !row.order_status) continue
      const list = statuses.get(row.request_id) || []
      list.push(row.order_status)
      statuses.set(row.request_id, list)
    }
  }

  return statuses
}

function requiredNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function optionalPositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseDimensions(value: unknown) {
  if (typeof value !== 'string') return null
  const numbers = value
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => Number(part.trim().replace(',', '.')))
    .filter((number) => Number.isFinite(number) && number > 0)
  return numbers.length >= 2 ? numbers : null
}

function parseSingleDimension(value: unknown) {
  if (typeof value !== 'string') return null
  const number = Number(value.trim().replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

function objectKeys(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>)
}

function pickParsedPatch(parsed: Record<string, unknown>, keys: string[]) {
  if (keys.length === 0) return parsed
  return Object.fromEntries(keys.filter((key) => key in parsed).map((key) => [key, parsed[key]]))
}

function hasSelectedMaterial(row: Record<string, unknown>) {
  return typeof row.material_id === 'string' && row.material_id.length > 0
}

function validatePipeGeometry(row: Record<string, unknown>) {
  if (row.pipe_type === 'wire') return
  const wall = optionalPositiveNumber(row.wall_thickness_mm)
  if (wall === null) return

  if (row.pipe_type === 'round') {
    const diameter = parseSingleDimension(row.size) ?? optionalPositiveNumber(row.diameter_mm)
    if (diameter !== null && wall * 2 >= diameter) {
      throw new Error('Толщина стенки трубы не может быть больше или равна половине диаметра.')
    }
    return
  }

  if (row.pipe_type === 'square' || row.pipe_type === 'rectangular') {
    const dimensions = parseDimensions(row.size)
    if (!dimensions) return
    const minSide = Math.min(dimensions[0], dimensions[1])
    if (wall * 2 >= minSide) {
      throw new Error('Толщина стенки трубы не может быть больше или равна половине меньшей стороны размера.')
    }
  }
}

function validateRequiredRequestRows(input: {
  sheetMetal: Record<string, unknown>[]
  circles: Record<string, unknown>[]
  pipes: Record<string, unknown>[]
  knives: Record<string, unknown>[]
  components: Record<string, unknown>[]
  paint: Record<string, unknown>[]
  meshItems: Record<string, unknown>[]
  chainCords: Record<string, unknown>[]
}) {
  const errors: string[] = []
  const checkMaterial = (label: string, rows: Record<string, unknown>[]) => {
    rows.forEach((row, index) => {
      if (!hasSelectedMaterial(row)) errors.push(`${label}, позиция ${index + 1}: выберите материал`)
    })
  }

  checkMaterial('Листовой металл', input.sheetMetal)
  input.sheetMetal.forEach((row, index) => {
    if (requiredNumber(row.remainder_qty) <= 0) errors.push(`Листовой металл, позиция ${index + 1}: укажите "Необходимо, шт"`)
  })

  checkMaterial('Круг', input.circles)
  input.circles.forEach((row, index) => {
    if (requiredNumber(row.remainder_mm) <= 0) errors.push(`Круг, позиция ${index + 1}: укажите "Необходимо, мм"`)
  })

  checkMaterial('Труба', input.pipes)
  input.pipes.forEach((row, index) => {
    if (row.pipe_type === 'wire') {
      if (requiredNumber(row.remainder_kg) <= 0) errors.push(`Труба, позиция ${index + 1}: укажите "Необходимо, кг"`)
    } else if (requiredNumber(row.remainder_length_mm) <= 0) {
      errors.push(`Труба, позиция ${index + 1}: укажите "Необходимо длина, мм"`)
    }
  })

  checkMaterial('Ножи', input.knives)
  input.knives.forEach((row, index) => {
    if (requiredNumber(row.remainder_meters) <= 0) errors.push(`Ножи, позиция ${index + 1}: укажите "Необходимо, мм"`)
  })

  checkMaterial('Комплектация', input.components)
  input.components.forEach((row, index) => {
    if (requiredNumber(row.quantity_needed) <= 0) errors.push(`Комплектация, позиция ${index + 1}: укажите "Необходимо, шт"`)
  })

  checkMaterial('Краска', input.paint)
  input.paint.forEach((row, index) => {
    if (requiredNumber(row.remainder_kg) <= 0) errors.push(`Краска, позиция ${index + 1}: укажите "Необходимо, кг"`)
  })

  checkMaterial('Сетка', input.meshItems)
  input.meshItems.forEach((row, index) => {
    if (requiredNumber(row.remainder_qty) <= 0) errors.push(`Сетка, позиция ${index + 1}: укажите "Необходимо, шт"`)
  })

  checkMaterial('Цепь / Шнур', input.chainCords)
  input.chainCords.forEach((row, index) => {
    if (requiredNumber(row.remainder_meters) <= 0) errors.push(`Цепь / Шнур, позиция ${index + 1}: укажите "Необходимо, мм"`)
  })

  if (errors.length > 0) throw new Error(errors.slice(0, 5).join('; '))
}

async function validateRequestReadyForSupply(db: LooseDb, requestId: string, userId?: string) {
  if (userId) await repairImportedSheetMetalMaterials(db, userId, requestId)

  const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
    db.from('request_sheet_metal').select('id, material_id, remainder_qty').eq('request_id', requestId),
    db.from('request_round_tube').select('id').eq('request_id', requestId),
    db.from('request_circle').select('id, material_id, remainder_mm').eq('request_id', requestId),
    db.from('request_pipe').select('id, material_id, pipe_type, remainder_length_mm, remainder_kg').eq('request_id', requestId),
    db.from('request_knives').select('id, material_id, remainder_meters').eq('request_id', requestId),
    db.from('request_components').select('id, material_id, quantity_needed').eq('request_id', requestId),
    db.from('request_paint').select('id, material_id, remainder_kg').eq('request_id', requestId),
    db.from('request_mesh').select('id, material_id, remainder_qty').eq('request_id', requestId),
    db.from('request_chain_cord').select('id, material_id, remainder_meters').eq('request_id', requestId),
  ])

  for (const result of [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось проверить заявку')
  }

  const totalRows = [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords]
    .reduce((sum, result) => sum + ((result.data || []) as unknown[]).length, 0)
  if (totalRows === 0) throw new Error('Добавьте хотя бы одну позицию в заявку')

  validateRequiredRequestRows({
    sheetMetal: (sheetMetal.data || []) as Record<string, unknown>[],
    circles: (circles.data || []) as Record<string, unknown>[],
    pipes: (pipes.data || []) as Record<string, unknown>[],
    knives: (knives.data || []) as Record<string, unknown>[],
    components: (components.data || []) as Record<string, unknown>[],
    paint: (paint.data || []) as Record<string, unknown>[],
    meshItems: (meshItems.data || []) as Record<string, unknown>[],
    chainCords: (chainCords.data || []) as Record<string, unknown>[],
  })
}

async function getRequestIdAndMachineByItem(db: LooseDb, table: RequestSectionTable, id: string) {
  const { data, error } = await db
    .from(table)
    .select('id, request_id, technologist_requests(machine_id, status)')
    .eq('id', id)
    .single()

  if (error || !data) throw new Error('Позиция не найдена')
  const row = data as {
    request_id: string
    technologist_requests: { machine_id: string; status: RequestStatus } | null
  }

  if (!row.technologist_requests) throw new Error('Заявка не найдена')
  return {
    requestId: row.request_id,
    machineId: row.technologist_requests.machine_id,
    status: row.technologist_requests.status,
  }
}

async function notifyRole(
  db: LooseDb,
  role: UserRole,
  title: string,
  message: string,
  machineId: string,
) {
  const { error: notifyError } = await db.rpc('notify_users_by_role', {
    p_role: role,
    p_type: 'technologist_request',
    p_title: title,
    p_message: message,
    p_machine_id: machineId,
  })

  if (notifyError) throw new Error(notifyError.message || 'Не удалось создать уведомления')
  await dispatchPendingTelegramDeliveries({ machineId })
}

export async function getRequest(machineId: string) {
  try {
    const { db, role } = await requireRequestPermission('view')
    const requests = await loadMachineRequests(db, machineId, role)
    const request = pickActiveRequest(requests)
    if (!request) return { data: null, error: null }

    return { data: await loadRequestPayload(db, request), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заявку' }
  }
}

export async function getRequestsForMachine(machineId: string) {
  try {
    const { db, role } = await requireRequestPermission('view')
    const requests = await loadMachineRequests(db, machineId, role)
    const statusesByRequest = await loadRequestOrderStatuses(db, requests.map((request) => request.id))
    const data: TechnologistRequestListItem[] = requests.map((request) => {
      const lifecycleStatus = deriveRequestLifecycleStatus(request, statusesByRequest.get(request.id) || [])
      return {
        id: request.id,
        machine_id: request.machine_id,
        status: request.status,
        submitted_at: request.submitted_at,
        created_at: request.created_at,
        updated_at: request.updated_at,
        lifecycle_status: lifecycleStatus,
        lifecycle_label: REQUEST_LIFECYCLE_LABELS[lifecycleStatus],
      }
    })

    return { data, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заявки' }
  }
}

export async function getRequestById(machineId: string, requestId: string) {
  try {
    const { db, role } = await requireRequestPermission('view')

    const { data: requestData, error } = await db
      .from('technologist_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (error) throw new Error(error.message || 'Не удалось загрузить заявку')
    if (!requestData) return { data: null, error: null }

    const request = requestData as TechnologistRequest
    if (request.machine_id !== machineId) return { data: null, error: 'Заявка не относится к этой машине' }
    if (!isRequestVisibleForRequestRole(request, role) && !isDirector(role)) {
      return { data: null, error: 'Заявка ещё не отправлена в снабжение' }
    }

    return { data: await loadRequestPayload(db, request), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заявку' }
  }
}

async function loadRequestPayload(db: LooseDb, request: TechnologistRequest): Promise<TechnologistRequestPayload> {
  const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
    db.from('request_sheet_metal').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_round_tube').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_circle').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_pipe').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_knives').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_components').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_paint').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_mesh').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_chain_cord').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
  ])

  for (const result of [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить раздел заявки')
  }

  return {
    request,
    sheetMetal: (sheetMetal.data || []) as WithMaterialName<RequestSheetMetal>[],
    sheetMetals: (sheetMetal.data || []) as WithMaterialName<RequestSheetMetal>[],
    roundTube: (roundTube.data || []) as WithMaterialName<RequestRoundTube>[],
    roundTubes: (roundTube.data || []) as WithMaterialName<RequestRoundTube>[],
    circles: (circles.data || []) as WithMaterialName<RequestCircle>[],
    pipes: (pipes.data || []) as WithMaterialName<RequestPipe>[],
    knives: (knives.data || []) as WithMaterialName<RequestKnives>[],
    components: (components.data || []) as WithMaterialName<RequestComponents>[],
    paint: (paint.data || []) as WithMaterialName<RequestPaint>[],
    paints: (paint.data || []) as WithMaterialName<RequestPaint>[],
    meshItems: (meshItems.data || []) as WithMaterialName<RequestMesh>[],
    chainCords: (chainCords.data || []) as WithMaterialName<RequestChainCord>[],
  }
}

export async function createRequest(machineId: string): Promise<ActionResult<TechnologistRequest>> {
  try {
    const { db, userId } = await requireRequestPermission('manage')
    await assertMachineNotArchived(db, machineId)
    await assertMachineCanUseTechnologistRequest(db, machineId)

    const { data, error } = await db
      .from('technologist_requests')
      .insert({ machine_id: machineId, created_by: userId, status: 'draft' })
      .select('*')
      .single()

    if (error || !data) throw new Error(error?.message || 'Не удалось создать заявку')
    const request = data as TechnologistRequest
    revalidateRequest(machineId, request.id)
    return { success: true, data: request }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать заявку' }
  }
}

export async function submitRequest(requestId: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireRequestPermission('manage')
    const request = await getRequestMachine(db, requestId)
    await assertMachineNotArchived(db, request.machine_id)
    await assertMachineCanUseTechnologistRequest(db, request.machine_id)

    await validateRequestReadyForSupply(db, requestId, userId)

    const { error } = await db
      .from('technologist_requests')
      .update({
        status: 'pending_stock_check',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    if (error) throw new Error(error.message || 'Не удалось оформить заявку')

    revalidateRequest(request.machine_id, requestId)
    revalidatePath(`${ROUTES.SUPPLY_REQUEST}/${requestId}`)
    revalidatePath(ROUTES.SUPPLY)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось оформить заявку' }
  }
}

export async function completeStockReservation(requestId: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireRequestPermission('manage')
    const request = await getRequestMachine(db, requestId)
    await assertMachineNotArchived(db, request.machine_id)
    await assertMachineCanUseTechnologistRequest(db, request.machine_id)

    if (request.status !== 'pending_stock_check' && request.status !== 'stock_checked') {
      throw new Error('Бронь уже завершена или заявка не находится на проверке склада')
    }

    await validateRequestReadyForSupply(db, requestId, userId)

    const timestamp = new Date().toISOString()
    const { error } = await db
      .from('technologist_requests')
      .update({
        status: 'submitted_to_supply',
        submitted_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', requestId)

    if (error) throw new Error(error.message || 'Не удалось завершить бронь')

    const { error: machineError } = await db
      .from('machines')
      .update({ status: 'request_ready', updated_at: timestamp })
      .eq('id', request.machine_id)
      .eq('status', 'planned')
    if (machineError) throw new Error(machineError.message || 'Не удалось обновить статус машины')

    await notifyRole(db, 'supply_manager', 'Заявка готова для снабжения', 'Проверка склада завершена. Заявка передана в снабжение.', request.machine_id)
    revalidateRequest(request.machine_id, requestId)
    revalidatePath(`${ROUTES.SUPPLY_REQUEST}/${requestId}`)
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.MATERIAL_REQUESTS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось завершить бронь' }
  }
}

export async function markStockChecked(requestId: string): Promise<ActionResult> {
  try {
    const { db } = await requireRequestPermission('manage')
    const request = await getRequestMachine(db, requestId)
    await assertMachineNotArchived(db, request.machine_id)

    const { error } = await db
      .from('technologist_requests')
      .update({ status: 'stock_checked', updated_at: new Date().toISOString() })
      .eq('id', requestId)

    if (error) throw new Error(error.message || 'Не удалось обновить статус')
    revalidateRequest(request.machine_id, requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить статус' }
  }
}

export async function submitToSupply(requestId: string): Promise<ActionResult> {
  try {
    const { db, userId } = await requireRequestPermission('manage')
    const request = await getRequestMachine(db, requestId)
    await assertMachineNotArchived(db, request.machine_id)
    await assertMachineCanUseTechnologistRequest(db, request.machine_id)
    if (request.status !== 'submitted_to_supply' && request.status !== 'stock_checked') throw new Error('Заявка ещё не отправлена в снабжение')
    if (request.status !== 'submitted_to_supply') {
      await validateRequestReadyForSupply(db, requestId, userId)
    }

    const { error } = await db
      .from('technologist_requests')
      .update({ status: 'submitted_to_supply', updated_at: new Date().toISOString() })
      .eq('id', requestId)
    if (error) throw new Error(error.message || 'Не удалось отправить в снабжение')

    const { error: machineError } = await db
      .from('machines')
      .update({ status: 'request_ready', updated_at: new Date().toISOString() })
      .eq('id', request.machine_id)
      .eq('status', 'planned')
    if (machineError) throw new Error(machineError.message || 'Не удалось обновить статус машины')

    if (request.status !== 'submitted_to_supply') {
      await notifyRole(db, 'supply_manager', 'Заявка готова для снабжения', 'Заявка технолога отправлена в снабжение.', request.machine_id)
    }
    revalidateRequest(request.machine_id, requestId)
    revalidatePath(ROUTES.TASKS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отправить в снабжение' }
  }
}

export async function getSuppliers(category?: MaterialCategory) {
  try {
    const { db } = await requireRequestPermission('view')
    let supplierIds: string[] | null = null

    if (category) {
      const { data, error } = await db
        .from('supplier_material_categories')
        .select('supplier_id')
        .eq('category', category)
      if (error) throw new Error(error.message || 'Не удалось загрузить категории поставщиков')
      supplierIds = ((data || []) as { supplier_id: string }[]).map((row) => row.supplier_id)
      if (supplierIds.length === 0) return { data: [], error: null }
    }

    let query = db.from('suppliers').select('*').eq('is_active', true).order('name')
    if (supplierIds) query = query.in('id', supplierIds)
    const { data, error } = await query
    if (error) throw new Error(error.message || 'Не удалось загрузить поставщиков')
    return { data: (data || []) as Supplier[], error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить поставщиков' }
  }
}

async function addSectionRow<T>(requestId: string, table: RequestSectionTable, schema: { parse: (value: unknown) => T }, data: unknown): Promise<ActionResult> {
  try {
    const { db } = await requireRequestPermission('manage')
    const request = await getRequestMachine(db, requestId)
    await assertMachineNotArchived(db, request.machine_id)
    const parsed = schema.parse(data) as Record<string, unknown>
    const insertResult = await db.from(table).insert({ request_id: requestId, ...parsed }).select('*').single()
    let row = insertResult.data
    if (insertResult.error) throw new Error(insertResult.error.message || 'Не удалось добавить позицию')
    if ((row as MaterialVariantModeRow).is_custom_material_variant === true && isRequestMaterialVariantComplete(table, row as Record<string, unknown>)) {
      const variant = await recordUsageFromRow(table, row as Record<string, unknown>)
      if (variant?.id) {
        const variantUpdate = await db
          .from(table)
          .update({ material_variant_id: variant.id, is_custom_material_variant: true })
          .eq('id', (row as { id?: string }).id)
          .select('*')
          .single()
        if (variantUpdate.error) throw new Error(variantUpdate.error.message || 'Не удалось привязать вариант материала')
        row = variantUpdate.data
      }
    }
    revalidateRequest(request.machine_id, requestId)
    return { success: true, data: row }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось добавить позицию' }
  }
}

async function updateSectionRow<T>(id: string, table: RequestSectionTable, schema: { parse: (value: unknown) => T }, data: unknown): Promise<ActionResult> {
  try {
    const { db } = await requireRequestPermission('manage')
    const meta = await getRequestIdAndMachineByItem(db, table, id)
    await assertMachineNotArchived(db, meta.machineId)
    const parsed = schema.parse(data) as Record<string, unknown>
    const explicitKeys = objectKeys(data)
    const patchKeys = explicitKeys.length > 0 ? explicitKeys : Object.keys(parsed)
    const patch = pickParsedPatch(parsed, patchKeys)
    const { data: currentData, error: currentError } = await db.from(table).select('*').eq('id', id).single()
    if (currentError || !currentData) throw new Error(currentError?.message || 'Не удалось загрузить позицию')

    const current = currentData as MaterialVariantModeRow
    const characteristicFields = MATERIAL_CHARACTERISTIC_FIELDS[table]
    const touchesCharacteristics = patchKeys.some((key) => characteristicFields.has(key))
    const touchesReservedProtectedFields = patchKeys.some((key) => RESERVED_ROW_PROTECTED_FIELDS[table].has(key))
    if (touchesReservedProtectedFields) {
      const { data: reservationsData, error: reservationsError } = await db
        .from('inventory_reservations')
        .select('id')
        .eq('request_item_table', table)
        .eq('request_item_id', id)
      if (reservationsError) throw new Error(reservationsError.message || 'Не удалось проверить бронь позиции')
      if (((reservationsData || []) as { id: string }[]).length > 0) {
        throw new Error('Позиция уже забронирована на складе. Сначала снимите бронь, затем измените материал или количество.')
      }
    }
    const changesMaterial = patch.material_id !== undefined && patch.material_id !== current.material_id
    const changesVariant = patch.material_variant_id !== undefined && patch.material_variant_id !== current.material_variant_id
    const changesMaterialSelection = changesMaterial || changesVariant
    const entersCustomMode = patch.is_custom_material_variant === true
    const selectsExistingVariant = changesVariant && typeof patch.material_variant_id === 'string' && !entersCustomMode
    const characteristicsLocked = current.is_custom_material_variant === true
      ? Boolean(current.material_variant_id)
      : true
    const canEditCharacteristics = !characteristicsLocked || entersCustomMode || changesMaterialSelection || selectsExistingVariant

    if (touchesCharacteristics && !canEditCharacteristics) {
      throw new Error('Характеристики материала из базы нельзя редактировать в заявке. Используйте кнопку "Добавить материал" для нового варианта.')
    }

    if (entersCustomMode) {
      patch.is_custom_material_variant = true
      if (!patch.material_variant_id) patch.material_variant_id = null
    } else if (selectsExistingVariant || changesMaterial) {
      patch.is_custom_material_variant = false
    }

    if (table === 'request_pipe') {
      validatePipeGeometry({ ...(currentData as Record<string, unknown>), ...patch })
    }

    const updateResult = await db.from(table).update(patch).eq('id', id).select('*').single()
    let row = updateResult.data
    if (updateResult.error) throw new Error(updateResult.error.message || 'Не удалось обновить позицию')
    if ((row as MaterialVariantModeRow).is_custom_material_variant === true && (touchesCharacteristics || changesMaterial) && isRequestMaterialVariantComplete(table, row as Record<string, unknown>)) {
      const variant = await recordUsageFromRow(table, row as Record<string, unknown>)
      if (variant?.id && (row as MaterialVariantModeRow).material_variant_id !== variant.id) {
        const variantUpdate = await db
          .from(table)
          .update({ material_variant_id: variant.id, is_custom_material_variant: true })
          .eq('id', id)
          .select('*')
          .single()
        if (variantUpdate.error) throw new Error(variantUpdate.error.message || 'Не удалось привязать вариант материала')
        row = variantUpdate.data
      }
    }
    revalidateRequest(meta.machineId, meta.requestId)
    return { success: true, data: row }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить позицию' }
  }
}

async function recordUsageFromRow(table: RequestSectionTable, row: Record<string, unknown>): Promise<MaterialVariant | null> {
  const materialId = typeof row.material_id === 'string' ? row.material_id : null
  if (!materialId) return null

  const categoryByTable: Record<string, MaterialCategory> = {
    request_sheet_metal: 'sheet_metal',
    request_round_tube: 'round_tube',
    request_circle: 'circle',
    request_pipe: 'pipe',
    request_knives: 'knives',
    request_components: 'components',
    request_paint: 'paint',
    request_mesh: 'mesh',
    request_chain_cord: 'chain_cord',
  }
  const category = categoryByTable[table]
  if (!category) return null

  const quantitySheets = Number(row.quantity_sheets || 1) || 1
  const result = await recordMaterialUsage({
    material_id: materialId,
    category,
    characteristics: {
      thickness_mm: row.thickness_mm,
      steel_type_id: row.steel_type_id,
      material_grade: row.material_grade,
      steel_grade: row.steel_grade,
      sheet_size: row.sheet_size,
      weight_per_unit_kg: row.weight_order_kg === undefined ? null : Number(row.weight_order_kg || 0) / quantitySheets,
      length_m: row.order_meters,
      weight_per_m_kg: row.order_meters ? Number(row.order_kg || 0) / Number(row.order_meters) : null,
      piece_description: row.piece_count,
      diameter_mm: row.diameter_mm,
      is_calibrated: row.is_calibrated,
      pipe_type: row.pipe_type,
      size: row.size,
      wall_thickness_mm: row.wall_thickness_mm,
      knife_dimensions: null,
      knife_material: row.steel_grade || row.knife_type,
      standard_length_mm: row.length_mm || row.order_mm,
      width_mm: row.width_mm,
      height_mm: row.height_mm,
      specification: row.specification,
      component_diameter_mm: row.diameter_mm,
      default_unit: row.unit,
      ral_code: row.ral_code,
      finish: row.finish,
      default_waste_percent: row.waste_percent,
      mesh_description: row.description,
      mesh_length_mm: row.length_mm,
      mesh_width_mm: row.width_mm,
      chain_cord_type: row.item_type,
      chain_cord_parameters: row.parameters,
    },
  })
  return result.success && result.data ? result.data as MaterialVariant : null
}

function isRequestMaterialVariantComplete(table: RequestSectionTable, row: Record<string, unknown>) {
  const hasValue = (value: unknown) => value !== null && value !== undefined && value !== ''
  const hasSteel = () => hasValue(row.steel_type_id) || hasValue(row.material_grade) || hasValue(row.steel_grade)
  if (table === 'request_sheet_metal') return hasSteel() && hasValue(row.sheet_size) && hasValue(row.thickness_mm)
  if (table === 'request_circle') return hasSteel() && hasValue(row.diameter_mm)
  if (table === 'request_pipe') {
    if (!hasValue(row.pipe_type)) return false
    if (row.pipe_type === 'wire') return hasValue(row.diameter_mm)
    return hasSteel() && hasValue(row.size) && hasValue(row.wall_thickness_mm)
  }
  if (table === 'request_knives') return hasSteel() && hasValue(row.length_mm) && hasValue(row.width_mm) && hasValue(row.height_mm)
  if (table === 'request_components') return hasValue(row.component_name) && hasValue(row.unit)
  if (table === 'request_paint') return hasValue(row.ral_code) && hasValue(row.finish)
  if (table === 'request_mesh') return hasValue(row.description) && hasValue(row.length_mm) && hasValue(row.width_mm)
  if (table === 'request_chain_cord') return hasValue(row.item_type) && hasValue(row.parameters)
  if (table === 'request_round_tube') return hasValue(row.piece_count)
  return false
}

async function deleteSectionRow(id: string, table: RequestSectionTable): Promise<ActionResult> {
  try {
    const { db, userId } = await requireRequestPermission('manage')
    let meta: Awaited<ReturnType<typeof getRequestIdAndMachineByItem>>
    try {
      meta = await getRequestIdAndMachineByItem(db, table, id)
    } catch (error) {
      if (error instanceof Error && error.message === 'Позиция не найдена') {
        return { success: true }
      }
      throw error
    }
    await assertMachineNotArchived(db, meta.machineId)
    const { data: reservationsData, error: reservationsError } = await db
      .from('inventory_reservations')
      .select('id')
      .eq('request_item_table', table)
      .eq('request_item_id', id)
    if (reservationsError) throw new Error(reservationsError.message || 'Не удалось проверить бронирование позиции')
    for (const reservation of (reservationsData || []) as { id: string }[]) {
      const { error: unreserveError } = await db.rpc('fn_unreserve_inventory_reservation', {
        p_reservation_id: reservation.id,
        p_performed_by: userId,
        p_comment: 'Позиция заявки удалена',
      })
      if (unreserveError) throw new Error(unreserveError.message || 'Не удалось снять бронь позиции')
    }
    const adminDb = createAdminClient() as unknown as LooseDb
    const { data: deletedRow, error } = await adminDb.from(table).delete().eq('id', id).select('id').maybeSingle()
    if (error) throw new Error(error.message || 'Не удалось удалить позицию')
    if (!deletedRow) throw new Error('Не удалось удалить позицию: база не подтвердила удаление')
    revalidateRequest(meta.machineId, meta.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить позицию' }
  }
}

export async function addSheetMetal(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = sheetMetalSchema.parse(data)
  return addSectionRow(requestId, 'request_sheet_metal', sheetMetalSchema, {
    material_name: parsed.material_name ?? 'Материал',
    material_grade: parsed.material_grade ?? null,
    steel_type_id: parsed.steel_type_id ?? null,
    sheet_size: parsed.sheet_size ?? null,
    thickness_mm: parsed.thickness_mm ?? null,
    remainder_qty: parsed.remainder_qty ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateSheetMetal(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_sheet_metal', sheetMetalUpdateSchema, data)
}
export async function deleteSheetMetal(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_sheet_metal')
}

// @deprecated - request_round_tube оставлен только для обратной совместимости.
export async function addRoundTube(requestId: string, data: unknown): Promise<ActionResult> {
  return addSectionRow(requestId, 'request_round_tube', roundTubeSchema, data)
}
// @deprecated - request_round_tube оставлен только для обратной совместимости.
export async function updateRoundTube(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_round_tube', roundTubeUpdateSchema, data)
}
// @deprecated - request_round_tube оставлен только для обратной совместимости.
export async function deleteRoundTube(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_round_tube')
}

export async function addCircle(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = circleSchema.parse(data)
  return addSectionRow(requestId, 'request_circle', circleSchema, {
    diameter_mm: parsed.diameter_mm ?? null,
    steel_grade: parsed.steel_grade ?? null,
    steel_type_id: parsed.steel_type_id ?? null,
    is_calibrated: parsed.is_calibrated ?? false,
    remainder_mm: parsed.remainder_mm ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateCircle(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_circle', circleUpdateSchema, data)
}
export async function deleteCircle(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_circle')
}

export async function addPipe(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = pipeSchema.parse(data)
  return addSectionRow(requestId, 'request_pipe', pipeSchema, {
    pipe_type: parsed.pipe_type,
    steel_type_id: parsed.steel_type_id ?? null,
    size: parsed.size ?? null,
    wall_thickness_mm: parsed.wall_thickness_mm ?? null,
    diameter_mm: parsed.diameter_mm ?? null,
    remainder_length_mm: parsed.remainder_length_mm ?? 0,
    remainder_qty: parsed.remainder_qty ?? 0,
    remainder_kg: parsed.remainder_kg ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updatePipe(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_pipe', pipeUpdateSchema, data)
}
export async function deletePipe(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_pipe')
}

export async function addKnife(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = knifeSchema.parse(data)
  return addSectionRow(requestId, 'request_knives', knifeSchema, {
    knife_type: parsed.knife_type ?? 'Нож',
    steel_grade: parsed.steel_grade ?? null,
    steel_type_id: parsed.steel_type_id ?? null,
    length_mm: parsed.length_mm ?? null,
    width_mm: parsed.width_mm ?? null,
    height_mm: parsed.height_mm ?? null,
    remainder_meters: parsed.remainder_meters ?? 0,
    remainder_qty: 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateKnife(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_knives', knifeUpdateSchema, data)
}
export async function deleteKnife(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_knives')
}

export async function addComponent(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = componentSchema.parse(data)
  return addSectionRow(requestId, 'request_components', componentSchema, {
    component_name: parsed.component_name ?? 'Комплектация',
    diameter_mm: parsed.diameter_mm ?? null,
    quantity_needed: parsed.quantity_needed ?? 0,
    stock_remainder: parsed.stock_remainder ?? 0,
    unit: parsed.unit ?? 'шт',
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateComponent(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_components', componentUpdateSchema, data)
}
export async function deleteComponent(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_components')
}

export async function addPaint(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = paintSchema.parse(data)
  return addSectionRow(requestId, 'request_paint', paintSchema, {
    paint_type: parsed.paint_type ?? 'Краска',
    ral_code: parsed.ral_code ?? 'RAL',
    finish: parsed.finish ?? null,
    remainder_kg: parsed.remainder_kg ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updatePaint(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_paint', paintUpdateSchema, data)
}
export async function deletePaint(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_paint')
}

export async function addMesh(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = meshSchema.parse(data)
  return addSectionRow(requestId, 'request_mesh', meshSchema, {
    description: parsed.description ?? null,
    length_mm: parsed.length_mm ?? null,
    width_mm: parsed.width_mm ?? null,
    remainder_qty: parsed.remainder_qty ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateMesh(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_mesh', meshUpdateSchema, data)
}
export async function deleteMesh(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_mesh')
}

export async function addChainCord(requestId: string, data: unknown): Promise<ActionResult> {
  const parsed = chainCordSchema.parse(data)
  return addSectionRow(requestId, 'request_chain_cord', chainCordSchema, {
    item_type: parsed.item_type,
    parameters: parsed.parameters ?? null,
    remainder_meters: parsed.remainder_meters ?? 0,
    material_id: parsed.material_id ?? null,
    material_variant_id: parsed.material_variant_id ?? null,
    is_custom_material_variant: parsed.is_custom_material_variant ?? false,
    custom_delivery_date: parsed.custom_delivery_date ?? null,
    sort_order: parsed.sort_order,
  })
}
export async function updateChainCord(id: string, data: unknown): Promise<ActionResult> {
  return updateSectionRow(id, 'request_chain_cord', chainCordUpdateSchema, data)
}
export async function deleteChainCord(id: string): Promise<ActionResult> {
  return deleteSectionRow(id, 'request_chain_cord')
}

export async function updateKnifeStock(id: string, stock_remainder_mm: number): Promise<ActionResult> {
  try {
    const { db, role } = await requireRequestPermission('manage')
    assertRole(role, ['procurement_head', ...DIRECTOR_ROLES])
    const meta = await getRequestIdAndMachineByItem(db, 'request_knives', id)
    const { error } = await db.from('request_knives').update({ stock_remainder_mm }).eq('id', id)
    if (error) throw new Error(error.message || 'Не удалось обновить остаток')
    revalidateRequest(meta.machineId, meta.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить остаток' }
  }
}

export async function updateComponentStock(id: string, data: { stock_remainder: number; availability: AvailabilityInput }): Promise<ActionResult> {
  try {
    const { db, role } = await requireRequestPermission('manage')
    assertRole(role, ['procurement_head', ...DIRECTOR_ROLES])
    const parsed = {
      stock_remainder: Number(data.stock_remainder),
      availability: availabilitySchema.parse(data.availability),
    }
    const meta = await getRequestIdAndMachineByItem(db, 'request_components', id)
    const { error } = await db.from('request_components').update(parsed).eq('id', id)
    if (error) throw new Error(error.message || 'Не удалось обновить остаток')
    revalidateRequest(meta.machineId, meta.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить остаток' }
  }
}

export async function updatePaintStock(id: string, stock_remainder_kg: number): Promise<ActionResult> {
  try {
    const { db, role } = await requireRequestPermission('manage')
    assertRole(role, ['painting_head', ...DIRECTOR_ROLES])
    const meta = await getRequestIdAndMachineByItem(db, 'request_paint', id)
    const { error } = await db.from('request_paint').update({ stock_remainder_kg }).eq('id', id)
    if (error) throw new Error(error.message || 'Не удалось обновить остаток')
    revalidateRequest(meta.machineId, meta.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить остаток' }
  }
}

export async function bulkUpdateKnifeStock(items: { id: string; stock_remainder_mm: number }[]) {
  for (const item of items) {
    const result = await updateKnifeStock(item.id, item.stock_remainder_mm)
    if (!result.success) return result
  }
  return { success: true }
}

export async function bulkUpdateComponentStock(items: { id: string; stock_remainder: number; availability: AvailabilityInput }[]) {
  for (const item of items) {
    const result = await updateComponentStock(item.id, item)
    if (!result.success) return result
  }
  return { success: true }
}

export async function bulkUpdatePaintStock(items: { id: string; stock_remainder_kg: number }[]) {
  for (const item of items) {
    const result = await updatePaintStock(item.id, item.stock_remainder_kg)
    if (!result.success) return result
  }
  return { success: true }
}
