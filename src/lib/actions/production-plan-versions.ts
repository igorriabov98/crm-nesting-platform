'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { assertFactoryAccess, canAccessAllFactories } from '@/lib/permissions/factory-scope'
import { hasPermission } from '@/lib/permissions/resources'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { ROUTES } from '@/lib/constants/routes'
import { diffProductionPlanSnapshots, type ProductionPlanSnapshot } from '@/lib/production-plan-version-diff'
import { notifyMachineEnteredReadyProductionPlan, notifyProductionPlanShippingDateChanged } from '@/lib/actions/production-plan'
import { syncTransportCostTask } from '@/lib/actions/transport-cost-tasks'
import { syncOutsourcingTransportForProductionPlan } from '@/lib/actions/outsourcing'
import { STAGES } from '@/lib/constants/stages'
import type { StageType } from '@/lib/types'
import { promoteDueFutureBusinessScrap } from '@/lib/inventory/secure-rpc'

type DbError = { message: string } | null
type DbResult = { data: unknown; error: DbError }
type Query = PromiseLike<DbResult> & {
  select: (columns?: string) => Query
  insert: (value: unknown) => Query
  eq: (column: string, value: unknown) => Query
  in: (column: string, values: unknown[]) => Query
  order: (column: string, options?: { ascending?: boolean }) => Query
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type Db = {
  from: (table: string) => Query
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

const uuid = z.string().uuid()
const monthInput = z.string().regex(/^\d{4}-\d{2}(?:-01)?$/)
const dateValue = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
const nullableUuid = z.union([uuid, z.null()])
const nullableSmallInt = z.union([z.number().int().min(1).max(2), z.null()])
const nullableInteger = z.union([z.number().int().min(1), z.null()])

const fieldSchemas = {
  machine: {
    factory_id: nullableUuid,
    production_month: dateValue,
    production_workshop: nullableSmallInt,
    production_queue_number: nullableInteger,
    planned_material_date: dateValue,
  },
  stage: {
    date_start: dateValue,
    date_end: dateValue,
    workshop: nullableSmallInt,
    is_skipped: z.boolean(),
    is_night_shift: z.boolean(),
    night_shift_date: dateValue,
    night_shift_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  },
  interval: {
    operation: z.enum(['create', 'update', 'delete']),
    date_start: dateValue,
    date_end: dateValue,
    workshop: nullableSmallInt,
  },
  outsourcing: {
    planned_send_date: dateValue,
    planned_return_date: dateValue,
    incoming_date_start: dateValue,
    incoming_date_end: dateValue,
    incoming_production_month: dateValue,
    incoming_workshop: nullableSmallInt,
    incoming_queue_number: nullableInteger,
  },
} as const

type PlanTarget = keyof typeof fieldSchemas
export type ProductionPlanDraftPatch = {
  target: PlanTarget
  id: string
  stage_id?: string
  fields: Record<string, unknown>
}
export type ProductionPlanDraftSummary = {
  production_month_plan_id: string
  factory_id: string
  production_month: string
  base_version_number: number
  revision: number
  changes: Record<string, ProductionPlanDraftPatch>
  updated_at: string
}
export type ProductionPlanVersionSummary = {
  id: string
  production_month_plan_id: string
  version_number: number
  status: 'draft' | 'preliminary_ready' | 'confirmed'
  change_kind: 'baseline' | 'publish' | 'status' | 'restore'
  created_at: string
  created_by: string | null
  restored_from_version_id: string | null
}

type PlanLocation = { factoryId: string; month: string }

function db() { return createAdminClient() as unknown as Db }

async function syncAffectedPlanTransport(
  client: Db,
  locations: PlanLocation[],
  actorId: string,
) {
  const errors: string[] = []
  for (const location of locations) {
    try {
      const plan = await client.from('production_month_plans').select('status')
        .eq('factory_id', location.factoryId).eq('production_month', location.month).maybeSingle()
      if (plan.error) throw new Error(plan.error.message)
      const status = (plan.data as { status: 'draft' | 'preliminary_ready' | 'confirmed' } | null)?.status
      if (status) await syncOutsourcingTransportForProductionPlan(
        location.factoryId, location.month, status, actorId,
      )
    } catch (error) {
      errors.push(`${formatProductionMonth(location.month)}: ${getErrorMessage(error)}`)
    }
  }
  return errors
}

function normalizedMonth(value: string) {
  monthInput.parse(value)
  const result = normalizeProductionMonthValue(value)
  if (!result) throw new Error('Некорректный месяц производства')
  return result
}

function parsePatch(input: ProductionPlanDraftPatch): ProductionPlanDraftPatch {
  const target = z.enum(['machine', 'stage', 'interval', 'outsourcing']).parse(input.target)
  const id = uuid.parse(input.id)
  const stageId = target === 'stage' || target === 'interval' ? uuid.parse(input.stage_id) : undefined
  if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
    throw new Error('Некорректные поля плана')
  }
  const allowed = fieldSchemas[target] as Record<string, z.ZodType>
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.fields)) {
    const schema = allowed[key]
    if (!schema) throw new Error(`Поле ${key} не относится к плану производства`)
    fields[key] = schema.parse(value)
  }
  if (Object.keys(fields).length === 0) throw new Error('Нет изменений плана')
  if (target === 'interval' && !('operation' in fields)) throw new Error('Не указана операция с подходом')
  return { target, id, ...(stageId ? { stage_id: stageId } : {}), fields }
}

async function getOrCreatePlan(client: Db, factoryId: string, month: string) {
  const existing = await client.from('production_month_plans')
    .select('id, factory_id, production_month, published_version_number')
    .eq('factory_id', factoryId).eq('production_month', month).maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) return existing.data as { id: string; published_version_number: number }
  const inserted = await client.from('production_month_plans')
    .insert({ factory_id: factoryId, production_month: month, status: 'draft' })
    .select('id, published_version_number').single()
  if (inserted.error) {
    // Another editor may have created the month concurrently.
    const retried = await client.from('production_month_plans')
      .select('id, published_version_number')
      .eq('factory_id', factoryId).eq('production_month', month).maybeSingle()
    if (retried.error || !retried.data) throw new Error(inserted.error.message)
    return retried.data as { id: string; published_version_number: number }
  }
  return inserted.data as { id: string; published_version_number: number }
}

async function getTargetPlan(client: Db, patch: ProductionPlanDraftPatch) {
  if (patch.target === 'machine') {
    const result = await client.from('machines')
      .select('factory_id, production_month, is_archived').eq('id', patch.id).maybeSingle()
    if (result.error || !result.data) throw new Error('Машина не найдена')
    const machine = result.data as { factory_id: string | null; production_month: string | null; is_archived: boolean }
    if (machine.is_archived) throw new Error('Машина архивирована')
    const factoryId = machine.factory_id || (patch.fields.factory_id as string | null)
    const month = machine.production_month || (patch.fields.production_month as string | null)
    if (!factoryId || !month) throw new Error('Сначала укажите завод и месяц производства')
    return { factoryId, month: normalizedMonth(month) }
  }
  if (patch.target === 'stage' || patch.target === 'interval') {
    const result = await client.from('production_stages')
      .select('id, machine_id, stage_type, machines(factory_id, production_month, is_archived)')
      .eq('id', patch.stage_id).maybeSingle()
    if (result.error || !result.data) throw new Error('Этап не найден')
    const row = result.data as { id: string; machine_id: string; stage_type: string; machines: { factory_id: string | null; production_month: string | null; is_archived: boolean } | null }
    if (row.stage_type === 'actual_shipping') throw new Error('Факт отгрузки не входит в версии плана')
    if (row.machines?.is_archived) throw new Error('Машина этапа архивирована')
    if (row.machines?.factory_id && row.machines.production_month) {
      return { factoryId: row.machines.factory_id, month: normalizedMonth(row.machines.production_month) }
    }
    const pending = await findDraftMachinePlacement(client, row.machine_id)
    if (!pending) throw new Error('Машина этапа не входит в активный план')
    return pending
  }
  const result = await client.from('machine_outsourcing_operations')
    .select('machine_id, executor_factory_id, incoming_production_month, archived_at, machines(factory_id, production_month, is_archived)')
    .eq('id', patch.id).maybeSingle()
  if (result.error || !result.data) throw new Error('Операция аутсорсинга не найдена')
  const operation = result.data as {
    machine_id: string
    archived_at: string | null
    executor_factory_id: string | null
    incoming_production_month: string | null
    machines: { factory_id: string | null; production_month: string | null; is_archived: boolean } | null
  }
  if (operation.archived_at || operation.machines?.is_archived) throw new Error('Операция аутсорсинга архивирована')
  const incoming = Object.keys(patch.fields).some((field) => field.startsWith('incoming_'))
  const factoryId = incoming ? operation.executor_factory_id : operation.machines?.factory_id
  const month = incoming
    ? operation.incoming_production_month || (patch.fields.incoming_production_month as string | null)
    : operation.machines?.production_month
  if (!incoming && (!factoryId || !month)) {
    const pending = await findDraftMachinePlacement(client, operation.machine_id)
    if (pending) return pending
  }
  if (!factoryId || !month) throw new Error('Аутсорсинг не входит в план месяца')
  return { factoryId, month: normalizedMonth(month) }
}

async function findDraftMachinePlacement(client: Db, machineId: string) {
  const result = await client.from('production_plan_drafts')
    .select('changes, production_month_plans(factory_id, production_month)')
  if (result.error) throw new Error(result.error.message)
  for (const item of result.data as Array<{
    changes: Record<string, ProductionPlanDraftPatch>
    production_month_plans: { factory_id: string; production_month: string } | null
  }>) {
    if (item.changes[`machine:${machineId}`] && item.production_month_plans) {
      return {
        factoryId: item.production_month_plans.factory_id,
        month: normalizedMonth(item.production_month_plans.production_month),
      }
    }
  }
  return null
}

function mergePatch(previous: ProductionPlanDraftPatch | undefined, next: ProductionPlanDraftPatch) {
  if (!previous) return next
  const fields = { ...previous.fields, ...next.fields }
  if (next.target === 'interval' && previous.fields.operation === 'create' && fields.operation === 'update') {
    fields.operation = 'create'
  }
  return { ...next, fields }
}

export async function stageProductionPlanChange(input: ProductionPlanDraftPatch, expectedRevision?: number) {
  try {
    const patch = parsePatch(input)
    const salesDerivedSkip = patch.target === 'stage' && Object.keys(patch.fields).length === 1
      && Object.hasOwn(patch.fields, 'is_skipped')
    const supplyOutsourcingDates = patch.target === 'outsourcing'
      && Object.keys(patch.fields).every((field) => field === 'planned_send_date' || field === 'planned_return_date')
    const context = patch.target === 'machine' || salesDerivedSkip || supplyOutsourcingDates
      ? await requireAnyPermission([
        { resourceKey: 'production', operation: 'manage' },
        { resourceKey: 'sales_plan', operation: 'manage' },
        ...(patch.target === 'machine' ? [{ resourceKey: 'meetings' as const, operation: 'manage' as const }] : []),
        ...(supplyOutsourcingDates ? [{ resourceKey: 'supply_transport' as const, operation: 'manage' as const }] : []),
      ])
      : await requirePermission('production', 'manage')
    const client = db()
    const { factoryId, month } = await getTargetPlan(client, patch)
    const resource = hasPermission(context.permissions, 'production', 'manage')
      ? 'production'
      : supplyOutsourcingDates && hasPermission(context.permissions, 'supply_transport', 'manage')
        ? 'supply_transport'
        : patch.target === 'machine' && hasPermission(context.permissions, 'meetings', 'manage')
          ? 'meetings' : 'sales_plan'
    assertFactoryAccess(context, resource, 'manage', factoryId)
    if (patch.target === 'machine' && patch.fields.factory_id) {
      assertFactoryAccess(context, resource, 'manage', patch.fields.factory_id as string)
    }
    const plan = await getOrCreatePlan(client, factoryId, month)
    const draftResult = await client.from('production_plan_drafts')
      .select('revision, changes').eq('production_month_plan_id', plan.id).maybeSingle()
    if (draftResult.error) throw new Error(draftResult.error.message)
    const draft = draftResult.data as { revision: number; changes: Record<string, ProductionPlanDraftPatch> } | null
    const revision = draft?.revision ?? 0
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      throw new Error('Черновик изменён другим редактором. Обновите страницу.')
    }
    const key = `${patch.target}:${patch.id}`
    if (expectedRevision === undefined && draft?.changes[key]) {
      const oldFields = draft.changes[key].fields
      const overlappingChange = Object.entries(patch.fields).some(([field, value]) =>
        Object.hasOwn(oldFields, field) && JSON.stringify(oldFields[field]) !== JSON.stringify(value))
      if (overlappingChange) {
        throw new Error('Эта запись уже изменена в общем черновике. Обновите страницу перед повторным изменением.')
      }
    }
    const merged = mergePatch(draft?.changes[key], patch)
    const saved = await client.rpc('fn_patch_production_plan_draft', {
      p_plan_id: plan.id, p_key: key, p_patch: merged,
      p_expected_revision: revision, p_actor: context.userId,
    })
    if (saved.error) throw new Error(saved.error.message)
    revalidatePath(ROUTES.PRODUCTION)
    return { success: true as const, revision: Number(saved.data), error: null }
  } catch (error) {
    return { success: false as const, revision: null, error: getErrorMessage(error) }
  }
}

export async function getProductionPlanDraftsForFactory(factoryId: string) {
  const context = await requirePermission('production', 'view')
  assertFactoryAccess(context, 'production', 'view', factoryId)
  if (!hasPermission(context.permissions, 'production', 'manage')) return [] as ProductionPlanDraftSummary[]
  assertFactoryAccess(context, 'production', 'manage', factoryId)
  const client = db()
  const plans = await client.from('production_month_plans')
    .select('id, factory_id, production_month').eq('factory_id', factoryId)
  if (plans.error) throw new Error(plans.error.message)
  const planRows = plans.data as Array<{ id: string; factory_id: string; production_month: string }>
  if (planRows.length === 0) return [] as ProductionPlanDraftSummary[]
  const drafts = await client.from('production_plan_drafts')
    .select('production_month_plan_id, base_version_number, revision, changes, updated_at')
    .in('production_month_plan_id', planRows.map((plan) => plan.id))
  if (drafts.error) throw new Error(drafts.error.message)
  const byId = new Map(planRows.map((plan) => [plan.id, plan]))
  return (drafts.data as Array<Omit<ProductionPlanDraftSummary, 'factory_id' | 'production_month'>>)
    .map((draft) => ({ ...draft, ...byId.get(draft.production_month_plan_id)! }))
}

export async function getProductionPlanVersionHistory(factoryId: string, monthValue: string) {
  const context = await requirePermission('production', 'manage')
  assertFactoryAccess(context, 'production', 'manage', factoryId)
  const month = normalizedMonth(monthValue)
  const client = db()
  const plan = await client.from('production_month_plans')
    .select('id').eq('factory_id', factoryId).eq('production_month', month).maybeSingle()
  if (plan.error) throw new Error(plan.error.message)
  if (!plan.data) return [] as ProductionPlanVersionSummary[]
  const result = await client.from('production_plan_versions')
    .select('id, production_month_plan_id, version_number, status, change_kind, created_at, created_by, restored_from_version_id')
    .eq('production_month_plan_id', (plan.data as { id: string }).id)
    .order('version_number', { ascending: false })
  if (result.error) throw new Error(result.error.message)
  return result.data as ProductionPlanVersionSummary[]
}

const draftFieldLabels: Record<string, string> = {
  factory_id: 'завод', production_month: 'месяц', production_workshop: 'цех',
  production_queue_number: 'очередь', planned_material_date: 'дата материала',
  date_start: 'начало', date_end: 'завершение', workshop: 'цех',
  is_skipped: 'пропуск этапа', is_night_shift: 'ночная смена',
  night_shift_date: 'дата ночной смены', night_shift_dates: 'даты ночных смен',
  planned_send_date: 'отправка на аутсорсинг', planned_return_date: 'возврат с аутсорсинга',
  incoming_production_month: 'месяц входящего аутсорсинга',
  incoming_workshop: 'цех входящего аутсорсинга',
  incoming_queue_number: 'очередь входящего аутсорсинга',
  incoming_date_start: 'начало входящего аутсорсинга',
  incoming_date_end: 'окончание входящего аутсорсинга',
}

function displayDraftValue(field: string, value: unknown, factoryNames: Map<string, string>) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (field === 'production_month' || field === 'incoming_production_month') {
    return formatProductionMonth(String(value))
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split('-')
    return `${day}.${month}.${year}`
  }
  return factoryNames.get(String(value)) || String(value)
}

export async function previewProductionPlanDraft(factoryId: string, monthValue: string) {
  const context = await requirePermission('production', 'manage')
  assertFactoryAccess(context, 'production', 'manage', factoryId)
  const month = normalizedMonth(monthValue)
  const client = db()
  const plan = await client.from('production_month_plans').select('id')
    .eq('factory_id', factoryId).eq('production_month', month).maybeSingle()
  if (plan.error) throw new Error(plan.error.message)
  if (!plan.data) return { changes: [] as string[], affectedMonths: [{ factoryId, month }] }
  const draftResult = await client.from('production_plan_drafts').select('changes')
    .eq('production_month_plan_id', (plan.data as { id: string }).id).maybeSingle()
  if (draftResult.error) throw new Error(draftResult.error.message)
  const patches = Object.values((draftResult.data as { changes: Record<string, ProductionPlanDraftPatch> } | null)?.changes ?? {})
  const factoriesResult = await client.from('factories').select('id, name')
  if (factoriesResult.error) throw new Error(factoriesResult.error.message)
  const factoryNames = new Map((factoriesResult.data as Array<{ id: string; name: string }>)
    .map((factory) => [factory.id, factory.name]))
  const changes: string[] = []
  const affected = new Set([`${factoryId}|${month}`])
  for (const patch of patches) {
    const table = patch.target === 'machine' ? 'machines'
      : patch.target === 'stage' ? 'production_stages'
        : patch.target === 'interval' ? 'production_stage_intervals'
          : 'machine_outsourcing_operations'
    const current = await client.from(table).select('*').eq('id', patch.id).maybeSingle()
    if (current.error) throw new Error(current.error.message)
    const row = current.data as Record<string, unknown> | null
    const label = patch.target === 'machine'
      ? String(row?.name || 'Машина')
      : patch.target === 'stage'
        ? `Этап ${STAGES[String(row?.stage_type) as StageType]?.label || row?.stage_type || ''}`
        : patch.target === 'interval' ? 'Подход этапа' : 'Аутсорсинг'
    if (patch.target === 'interval') {
      changes.push(`${label}: ${patch.fields.operation === 'delete' ? 'удалить' : patch.fields.operation === 'create' ? 'добавить' : 'изменить'}`)
    }
    for (const [field, value] of Object.entries(patch.fields)) {
      if (field === 'operation') continue
      if (row && JSON.stringify(row[field]) === JSON.stringify(value)) continue
      changes.push(`${label} · ${draftFieldLabels[field] || field}: ${displayDraftValue(field, row?.[field], factoryNames)} → ${displayDraftValue(field, value, factoryNames)}`)
    }
    if (patch.target === 'machine') {
      const destinationFactory = (patch.fields.factory_id as string | null | undefined) || row?.factory_id
      const destinationMonth = (patch.fields.production_month as string | null | undefined) || row?.production_month
      if (destinationFactory && destinationMonth) {
        affected.add(`${destinationFactory}|${normalizedMonth(String(destinationMonth))}`)
      }
    }
    if (patch.target === 'outsourcing' && Object.hasOwn(patch.fields, 'incoming_production_month')) {
      const destinationFactory = row?.executor_factory_id
      const destinationMonth = patch.fields.incoming_production_month
      if (destinationFactory && destinationMonth) {
        affected.add(`${destinationFactory}|${normalizedMonth(String(destinationMonth))}`)
      }
    }
  }
  for (const location of affected) assertFactoryAccess(context, 'production', 'manage', location.split('|')[0])
  return {
    changes,
    affectedMonths: [...affected].map((location) => {
      const [affectedFactoryId, affectedMonth] = location.split('|')
      return { factoryId: affectedFactoryId, month: affectedMonth }
    }),
  }
}

export async function getProductionPlanVersionSnapshot(versionId: string) {
  const context = await requirePermission('production', 'manage')
  const client = db()
  const result = await client.from('production_plan_versions')
    .select('id, version_number, status, snapshot, production_month_plan_id, production_month_plans(factory_id, production_month)')
    .eq('id', uuid.parse(versionId)).maybeSingle()
  if (result.error || !result.data) throw new Error('Версия не найдена')
  const version = result.data as {
    id: string; version_number: number; status: string; snapshot: unknown
    production_month_plan_id: string
    production_month_plans: { factory_id: string; production_month: string } | null
  }
  assertFactoryAccess(context, 'production', 'manage', version.production_month_plans?.factory_id)
  return version
}

export async function previewProductionPlanRestore(factoryId: string, monthValue: string, versionId: string) {
  const context = await requirePermission('production', 'manage')
  assertFactoryAccess(context, 'production', 'manage', factoryId)
  const month = normalizedMonth(monthValue)
  const version = await getProductionPlanVersionSnapshot(versionId)
  if (version.production_month_plans?.factory_id !== factoryId ||
      version.production_month_plans.production_month !== month) {
    throw new Error('Версия относится к другому заводу или месяцу')
  }
  const client = db()
  const current = await client.rpc('fn_capture_production_plan', {
    p_factory_id: factoryId, p_month: month,
  })
  if (current.error) throw new Error(current.error.message)
  const target = version.snapshot as ProductionPlanSnapshot
  const ids = target.machines.map((machine) => machine.id)
  const locations = ids.length > 0
    ? await client.from('machines').select('id, name, factory_id, production_month, is_archived').in('id', ids)
    : { data: [], error: null }
  if (locations.error) throw new Error(locations.error.message)
  const machineLocations = locations.data as Array<{
    id: string; name: string; factory_id: string | null; production_month: string | null; is_archived: boolean
  }>
  const locationById = new Map(machineLocations.map((machine) => [machine.id, machine]))
  const blockers: string[] = []
  const affected = new Set([`${factoryId}|${month}`])
  const currentStages = ids.length > 0
    ? await client.from('production_stages').select('id, machine_id, stage_type').in('machine_id', ids)
    : { data: [], error: null }
  if (currentStages.error) throw new Error(currentStages.error.message)
  const mandatoryStages = currentStages.data as Array<{ id: string; machine_id: string; stage_type: string }>
  for (const machine of target.machines) {
    const actual = locationById.get(machine.id)
    if (!actual || actual.is_archived) {
      blockers.push(`${machine.name}: машина удалена или архивирована`)
      continue
    }
    if (actual.factory_id && actual.production_month) {
      affected.add(`${actual.factory_id}|${normalizedMonth(actual.production_month)}`)
    }
    const historicalStageIds = new Set(machine.stages.map((stage) => stage.id))
    for (const stage of mandatoryStages) {
      if (stage.machine_id === machine.id && ['cutting', 'shipping'].includes(stage.stage_type)
        && !historicalStageIds.has(stage.id)) {
        blockers.push(`${machine.name}: обязательный этап ${stage.stage_type} появился после версии`)
      }
    }
  }
  for (const operation of target.incoming) {
    const currentOperation = await client.from('machine_outsourcing_operations')
      .select('id, executor_factory_id, incoming_production_month, archived_at')
      .eq('id', operation.id).maybeSingle()
    if (currentOperation.error) throw new Error(currentOperation.error.message)
    const actual = currentOperation.data as {
      executor_factory_id: string | null; incoming_production_month: string | null; archived_at: string | null
    } | null
    if (!actual || actual.archived_at) {
      blockers.push(`Входящий аутсорсинг ${operation.id}: операция удалена или архивирована`)
      continue
    }
    if (actual.executor_factory_id && actual.incoming_production_month) {
      affected.add(`${actual.executor_factory_id}|${normalizedMonth(actual.incoming_production_month)}`)
    }
  }
  for (const location of affected) {
    assertFactoryAccess(context, 'production', 'manage', location.split('|')[0])
  }
  return {
    changes: diffProductionPlanSnapshots(current.data as ProductionPlanSnapshot, target),
    affectedMonths: [...affected].map((location) => {
      const [affectedFactoryId, affectedMonth] = location.split('|')
      return { factoryId: affectedFactoryId, month: affectedMonth }
    }),
    blockers,
  }
}

export async function publishProductionPlanDraft(factoryId: string, monthValue: string, expectedRevision: number) {
  try {
    const context = await requirePermission('production', 'manage')
    assertFactoryAccess(context, 'production', 'manage', factoryId)
    const month = normalizedMonth(monthValue)
    const client = db()
    const plan = await getOrCreatePlan(client, factoryId, month)
    const draftResult = await client.from('production_plan_drafts')
      .select('revision, changes').eq('production_month_plan_id', plan.id).maybeSingle()
    if (draftResult.error) throw new Error(draftResult.error.message)
    const draft = draftResult.data as { revision: number; changes: Record<string, ProductionPlanDraftPatch> } | null
    if (!draft || draft.revision !== expectedRevision) {
      throw new Error('Черновик изменён другим редактором. Обновите страницу.')
    }
    const preview = await previewProductionPlanDraft(factoryId, month)
    for (const patch of Object.values(draft.changes)) {
      if (patch.target === 'machine') {
        const destination = patch.fields.factory_id as string | null | undefined
        if (destination) assertFactoryAccess(context, 'production', 'manage', destination)
      }
    }
    const factoryAssignments: Array<{ machineId: string; machineName: string; previousFactoryId: string | null }> = []
    const shippingChanges: Array<{ machineId: string; previousDate: string | null; stageId: string }> = []
    let cuttingChanged = false
    for (const patch of Object.values(draft.changes)) {
      if (patch.target === 'machine' && patch.fields.factory_id) {
        const current = await client.from('machines').select('id, name, factory_id')
          .eq('id', patch.id).maybeSingle()
        if (current.error) throw new Error(current.error.message)
        if (current.data) {
          const machine = current.data as { id: string; name: string; factory_id: string | null }
          factoryAssignments.push({ machineId: machine.id, machineName: machine.name,
            previousFactoryId: machine.factory_id })
        }
      }
      if (patch.target === 'stage' && Object.hasOwn(patch.fields, 'date_end')) {
        const current = await client.from('production_stages')
          .select('id, machine_id, stage_type, date_end').eq('id', patch.id).maybeSingle()
        if (current.error) throw new Error(current.error.message)
        const stage = current.data as { id: string; machine_id: string; stage_type: string; date_end: string | null } | null
        if (stage?.stage_type === 'shipping') shippingChanges.push({
          machineId: stage.machine_id, previousDate: stage.date_end, stageId: stage.id,
        })
      }
      if (patch.target === 'stage' || patch.target === 'interval') {
        const stageId = patch.stage_id || patch.id
        const stage = await client.from('production_stages').select('stage_type')
          .eq('id', stageId).maybeSingle()
        if (stage.error) throw new Error(stage.error.message)
        if ((stage.data as { stage_type: string } | null)?.stage_type === 'cutting') cuttingChanged = true
      }
    }
    const result = await client.rpc('fn_publish_production_plan_draft', {
      p_plan_id: plan.id, p_expected_revision: expectedRevision, p_actor: context.userId,
      p_allowed_factory_id: canAccessAllFactories(context, 'production', 'manage') ? null : context.factoryId,
    })
    if (result.error) throw new Error(result.error.message)
    const notificationErrors: string[] = []
    for (const assignment of factoryAssignments) {
      const current = await client.from('machines').select('factory_id')
        .eq('id', assignment.machineId).maybeSingle()
      const destination = (current.data as { factory_id: string | null } | null)?.factory_id
      if (!destination || destination === assignment.previousFactoryId) continue
      try {
        const result = await (context.supabase as unknown as {
          rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
        }).rpc('notify_users_by_role_in_factory', {
          p_factory_id: destination,
          p_role: 'production_manager',
          p_type: 'factory_assigned',
          p_title: 'Машина назначена на завод',
          p_message: `Машина ${assignment.machineName} назначена на ваш завод.`,
          p_machine_id: assignment.machineId,
        })
        if (result.error) throw new Error(result.error.message)
        await notifyMachineEnteredReadyProductionPlan(assignment.machineId, context.userId)
      } catch (error) {
        notificationErrors.push(getErrorMessage(error))
      }
    }
    for (const change of shippingChanges) {
      try {
        const current = await client.from('production_stages').select('date_end')
          .eq('id', change.stageId).maybeSingle()
        const newDate = (current.data as { date_end: string | null } | null)?.date_end ?? null
        await syncTransportCostTask(context.supabase, change.machineId)
        await notifyProductionPlanShippingDateChanged(
          change.machineId, change.previousDate, newDate, context.userId,
        )
      } catch (error) {
        notificationErrors.push(getErrorMessage(error))
      }
    }
    if (cuttingChanged) {
      try {
        await promoteDueFutureBusinessScrap()
        revalidatePath(ROUTES.INVENTORY)
      } catch (error) {
        notificationErrors.push(getErrorMessage(error))
      }
    }
    if (Object.values(draft.changes).some((patch) =>
      patch.target === 'outsourcing' || patch.target === 'machine'
      || patch.target === 'stage')) {
      notificationErrors.push(...await syncAffectedPlanTransport(
        client, preview.affectedMonths, context.userId,
      ))
    }
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(ROUTES.DASHBOARD)
    revalidatePath(ROUTES.TASKS)
    return {
      success: true as const, version: Number(result.data), error: null,
      warning: notificationErrors.length > 0
        ? `План опубликован, но часть уведомлений не отправлена: ${notificationErrors.join('; ')}`
        : null,
    }
  } catch (error) {
    return { success: false as const, version: null, error: getErrorMessage(error) }
  }
}

export async function restoreProductionPlanVersion(factoryId: string, monthValue: string, versionId: string, expectedVersion: number) {
  try {
    const context = await requirePermission('production', 'manage')
    assertFactoryAccess(context, 'production', 'manage', factoryId)
    const month = normalizedMonth(monthValue)
    const preview = await previewProductionPlanRestore(factoryId, month, versionId)
    if (preview.blockers.length > 0) throw new Error(preview.blockers.join('; '))
    const client = db()
    const selectedVersion = await getProductionPlanVersionSnapshot(versionId)
    const affectedMachineIds = new Set((selectedVersion.snapshot as ProductionPlanSnapshot)
      .machines.map((machine) => machine.id))
    for (const location of preview.affectedMonths) {
      const machines = await client.from('machines').select('id')
        .eq('factory_id', location.factoryId).eq('production_month', location.month)
      if (machines.error) throw new Error(machines.error.message)
      for (const machine of machines.data as Array<{ id: string }>) affectedMachineIds.add(machine.id)
    }
    const machineIds = [...affectedMachineIds]
    const shippingBefore = machineIds.length > 0
      ? await client.from('production_stages').select('machine_id, date_end')
        .in('machine_id', machineIds).eq('stage_type', 'shipping')
      : { data: [], error: null }
    if (shippingBefore.error) throw new Error(shippingBefore.error.message)
    const beforeByMachine = new Map((shippingBefore.data as Array<{
      machine_id: string; date_end: string | null
    }>).map((stage) => [stage.machine_id, stage.date_end]))
    const plan = await getOrCreatePlan(client, factoryId, month)
    const result = await client.rpc('fn_restore_production_plan_version', {
      p_plan_id: plan.id, p_version_id: uuid.parse(versionId),
      p_expected_version: expectedVersion, p_actor: context.userId,
      p_allowed_factory_id: canAccessAllFactories(context, 'production', 'manage') ? null : context.factoryId,
    })
    if (result.error) throw new Error(result.error.message)
    const notificationErrors = await syncAffectedPlanTransport(
      client, preview.affectedMonths, context.userId,
    )
    if (machineIds.length > 0) {
      const shippingAfter = await client.from('production_stages').select('machine_id, date_end')
        .in('machine_id', machineIds).eq('stage_type', 'shipping')
      if (shippingAfter.error) notificationErrors.push(shippingAfter.error.message)
      else for (const stage of shippingAfter.data as Array<{
        machine_id: string; date_end: string | null
      }>) {
        const previousDate = beforeByMachine.get(stage.machine_id) ?? null
        if (previousDate === stage.date_end) continue
        try {
          await syncTransportCostTask(context.supabase, stage.machine_id)
          await notifyProductionPlanShippingDateChanged(
            stage.machine_id, previousDate, stage.date_end, context.userId,
          )
        } catch (error) {
          notificationErrors.push(getErrorMessage(error))
        }
      }
    }
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(ROUTES.DASHBOARD)
    revalidatePath(ROUTES.TASKS)
    return {
      success: true as const, version: Number(result.data), error: null,
      warning: notificationErrors.length > 0
        ? `План восстановлен, но часть уведомлений или задач не обновлена: ${notificationErrors.join('; ')}`
        : null,
    }
  } catch (error) {
    return { success: false as const, version: null, error: getErrorMessage(error) }
  }
}
