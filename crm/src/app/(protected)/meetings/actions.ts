'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isFactoryWorkshopAllowed } from '@/lib/constants/factory-workshops'
import { MEETINGS_LIST_LIMIT } from '@/lib/constants/meetings-performance'
import { requirePermission } from '@/lib/permissions/server'
import { dispatchPendingTelegramDeliveries, notifyNewTasks } from '@/lib/services/task-notifications'
import type {
  CurrentUser,
  MachineRelation,
  MaterialType,
  MeetingDetails,
  MeetingListItem,
  UpcomingMeeting,
} from '@/lib/types'
import type {
  CreateMeetingInput,
  UpdateMeetingInput,
  AddDecisionInput,
  AddActionItemInput,
  AddAgendaItemInput,
  AddExternalAttendeeInput
} from '@/lib/types/schemas'

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  gte: (column: string, value: unknown) => LooseQuery
  gt: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  lt: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  not: (column: string, operator: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<DbResult>
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
    if (parts.length > 0) return parts.join(' ')
  }
  return 'Неизвестная ошибка'
}

async function getFactoryName(db: LooseDb, factoryId: string) {
  const { data, error } = await db
    .from('factories')
    .select('id, name')
    .eq('id', factoryId)
    .single()

  if (error || !data) throw new Error('Завод не найден')
  return (data as { id: string; name: string }).name
}

async function getNextProductionQueueNumber(
  db: LooseDb,
  productionMonth: string,
  factoryId: string,
  productionWorkshop: number,
  excludeMachineId?: string
) {
  const { data, error } = await db
    .from('machines')
    .select('id, production_queue_number')
    .eq('production_month', productionMonth)
    .eq('factory_id', factoryId)
    .eq('production_workshop', productionWorkshop)

  if (error) throw new Error(error.message || 'Не удалось рассчитать очередь машины')

  const rows = ((data || []) as Array<{ id: string; production_queue_number: number | null }>)
    .filter((row) => row.id !== excludeMachineId)
  const maxQueueNumber = rows.reduce((max, row) => Math.max(max, row.production_queue_number || 0), 0)
  return maxQueueNumber + 1
}

type CreateMeetingPayload = CreateMeetingInput & {
  attendeeIds?: string[]
  externalAttendees?: AddExternalAttendeeInput[]
}

export type MeetingTypeOption = {
  key: string
  label: string
  color: string | null
  is_system: boolean
}

type AgendaCandidate = {
  source_key: string
  source_type: string
  meeting_id: string
  machine_id: string | null
  title: string
  description: string | null
  auto_generated: true
  sort_order: number
}

type AgendaSyncMeeting = {
  id: string
  meeting_type: CreateMeetingInput['meeting_type']
}

type AgendaLifecycleMeeting = {
  id: string
  meeting_date: string
  meeting_time: string
  duration_minutes?: number | null
  recurrence_rule_id?: string | null
}

type PlanMaterialFromAgendaInput = {
  machine_id: string
  planned_material_date: string
  material_type: MaterialType
  close_agenda_item: boolean
}

type CheckNewMachineFromAgendaInput = {
  machine_id: string
  factory_id: string
  production_workshop: number | null
  close_agenda_item: boolean
}

const MAX_RECURRING_MEETINGS = 104
const TECH_ENGINEER_SUPPLY_MEETING_TYPE = 'tech_engineer_supply'
const FACTORY_MEETING_KEYS = ['factory_bergovo', 'factory_uzhgorod'] as const
const ACTIVE_MACHINE_STATUSES = [
  'factory_assigned',
  'in_production',
  'planned',
  'request_ready',
  'purchasing',
  'material_received',
]

const FACTORY_MEETING_META: Partial<Record<CreateMeetingInput['meeting_type'], {
  factoryName: string
  productionLabel: string
  weldingLimitTons: number
}>> = {
  factory_bergovo: {
    factoryName: 'Берегово',
    productionLabel: 'Берегово',
    weldingLimitTons: 80,
  },
  factory_uzhgorod: {
    factoryName: 'Ужгород',
    productionLabel: 'Ужгород',
    weldingLimitTons: 25,
  },
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getIsoWeekday(date: Date) {
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

function addDaysIso(value: string, days: number) {
  const date = parseIsoDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return formatIsoDate(date)
}

function getCurrentWeekRange() {
  const today = getTodayIsoDate()
  const todayDate = parseIsoDate(today)
  const weekday = getIsoWeekday(todayDate)
  const weekStart = addDaysIso(today, 1 - weekday)
  const weekEnd = addDaysIso(weekStart, 6)
  return { weekStart, weekEnd }
}

function getCurrentMonthRange() {
  const todayDate = parseIsoDate(getTodayIsoDate())
  const monthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1))
  const nextMonthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1))
  const monthEnd = new Date(nextMonthStart)
  monthEnd.setUTCDate(monthEnd.getUTCDate() - 1)
  return {
    monthStart: formatIsoDate(monthStart),
    monthEnd: formatIsoDate(monthEnd),
  }
}

function getCurrentAndNextProductionMonths() {
  const todayDate = parseIsoDate(getTodayIsoDate())
  return [
    formatIsoDate(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1))),
    formatIsoDate(new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1))),
  ]
}

function isDateInRange(value: string | null | undefined, start: string, end: string) {
  return Boolean(value && value >= start && value <= end)
}

function pushMachineCandidate(
  candidates: AgendaCandidate[],
  meetingId: string,
  machineId: string,
  sourceType: string,
  title: string,
  description: string | null,
  sortOrder: number
) {
  candidates.push({
    meeting_id: meetingId,
    machine_id: machineId,
    source_type: sourceType,
    source_key: makeAgendaSourceKey(sourceType, machineId),
    title,
    description,
    auto_generated: true,
    sort_order: sortOrder,
  })
}

async function getFactoryIdByName(db: LooseDb, factoryName: string) {
  const { data, error } = await db
    .from('factories')
    .select('id')
    .eq('name', factoryName)
    .limit(1)

  if (error) throw error
  return ((data || []) as Array<{ id: string }>)[0]?.id || null
}

async function generateMeetingAgenda(
  db: LooseDb,
  meetingId: string,
  meetingType: CreateMeetingInput['meeting_type'],
  runRpc = true
) {
  if (runRpc) {
    const { error: rpcError } = await db.rpc('fn_generate_meeting_agenda', { p_meeting_id: meetingId })
    if (rpcError) {
      console.error('Ошибка авто-повестки:', rpcError)
    }
  }

  return syncMeetingAutoAgenda(db, meetingId, meetingType)
}

function makeAgendaSourceKey(sourceType: string, machineId: string) {
  return `${sourceType}:${machineId}`
}

async function isSalesMeetingType(db: LooseDb, meetingType: string) {
  if (meetingType.toLowerCase().includes('sales')) return true

  const { data, error } = await db
    .from('meeting_types')
    .select('label')
    .eq('key', meetingType)
    .single()

  if (error) return false
  const row = data as { label?: string | null } | null
  return row?.label?.toLowerCase().includes('sales') || false
}

type AgendaStage = {
  stage_type: string
  planned_date_end: string | null
  is_skipped: boolean | null
}

type AgendaMachine = {
  id: string
  name: string
  created_at: string
  status: string | null
  total_weight: number | null
  factory_id: string | null
  material_type: string | null
  is_confirmed?: boolean | null
  desired_shipping_date: string | null
  planned_material_date: string | null
  actual_material_date: string | null
  actual_shipping_date: string | null
  production_month?: string | null
  production_stages?: AgendaStage[] | null
}

async function buildSalesAgendaCandidates(
  db: LooseDb,
  meetingId: string
): Promise<AgendaCandidate[]> {
  const candidates: AgendaCandidate[] = []
  const productionMonths = getCurrentAndNextProductionMonths()

  const { data, error } = await db
    .from('machines_with_totals')
    .select('id, name, production_month, desired_shipping_date, is_confirmed')
    .eq('is_archived', false)
    .eq('is_confirmed', false)
    .in('production_month', productionMonths)
    .order('production_month', { ascending: true })

  if (error) throw error

  for (const [index, machine] of ((data || []) as AgendaMachine[]).entries()) {
    pushMachineCandidate(
      candidates,
      meetingId,
      machine.id,
      'sales_machine_unconfirmed',
      `Подтвердить машину: ${machine.name}`,
      `Месяц производства: ${machine.production_month || 'не указан'}. Обсудить подтверждение машины Sales.`,
      10 + index
    )
  }

  return candidates
}

async function buildGeneralAgendaCandidates(
  db: LooseDb,
  meetingId: string
) {
  const candidates: AgendaCandidate[] = []
  const { data: noFactoryData, error: noFactoryError } = await db
    .from('machines')
    .select('id, name, desired_shipping_date')
    .is('factory_id', null)
    .eq('is_archived', false)
    .in('status', ['created', 'under_review'])
    .order('created_at', { ascending: true })

  if (noFactoryError) throw noFactoryError

  for (const [index, machine] of ((noFactoryData || []) as Array<{ id: string; name: string; desired_shipping_date: string | null }>).entries()) {
    candidates.push({
      meeting_id: meetingId,
      machine_id: machine.id,
      source_type: 'machine_without_factory',
      source_key: makeAgendaSourceKey('machine_without_factory', machine.id),
      title: `Назначить завод: ${machine.name}`,
      description: machine.desired_shipping_date
        ? `Машина без назначенного завода. Желаемая отгрузка: ${machine.desired_shipping_date}.`
        : 'Машина без назначенного завода. Нужно определить завод.',
      auto_generated: true,
      sort_order: 10 + index,
    })
  }

  if (candidates.length === 0) {
    candidates.push({
      meeting_id: meetingId,
      machine_id: null,
      source_type: 'general_empty_review',
      source_key: 'general_empty_review',
      title: 'Обсудить общий статус машин',
      description: 'Автоматические проблемные пункты не найдены. Проверьте новые машины, назначение заводов и ближайшие риски.',
      auto_generated: true,
      sort_order: 90,
    })
  }

  return candidates
}

async function buildFactoryProductionAgendaCandidates(
  db: LooseDb,
  meetingId: string,
  meetingType: CreateMeetingInput['meeting_type']
): Promise<AgendaCandidate[]> {
  const candidates: AgendaCandidate[] = []
  const meta = FACTORY_MEETING_META[meetingType]
  if (!meta) return candidates

  const factoryId = await getFactoryIdByName(db, meta.factoryName)
  if (!factoryId) return candidates

  const today = getTodayIsoDate()
  const sevenDaysAgo = addDaysIso(today, -7)
  const { weekStart, weekEnd } = getCurrentWeekRange()
  const { monthStart, monthEnd } = getCurrentMonthRange()

  const { data, error } = await db
    .from('machines_with_totals')
    .select(`
      id, name, created_at, status, total_weight, factory_id, material_type,
      desired_shipping_date, planned_material_date, actual_material_date, actual_shipping_date,
      production_stages(stage_type, planned_date_end, is_skipped)
    `)
    .eq('factory_id', factoryId)
    .eq('is_archived', false)
    .in('status', ACTIVE_MACHINE_STATUSES)
    .order('created_at', { ascending: true })

  if (error) throw error

  let weldingLoadTons = 0
  const machines = (data || []) as AgendaMachine[]

  for (const [index, machine] of machines.entries()) {
    const stages = (machine.production_stages || []).filter((stage) => !stage.is_skipped)
    const shippingStages = stages.filter((stage) => stage.stage_type === 'shipping')
    const assemblyInMonth = stages.some((stage) =>
      stage.stage_type === 'assembly' && isDateInRange(stage.planned_date_end, monthStart, monthEnd)
    )

    if (assemblyInMonth) weldingLoadTons += Number(machine.total_weight || 0)

    if (machine.created_at.slice(0, 10) >= sevenDaysAgo) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_new_machine',
        `Новая машина завода ${meta.productionLabel}: ${machine.name}`,
        `Машина создана ${machine.created_at.slice(0, 10)}.`,
        10 + index
      )
    }

    if (!machine.planned_material_date) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_missing_material_date',
        `Нет даты поставки материала: ${machine.name}`,
        'На карточке машины не заполнена плановая дата прихода материала.',
        100 + index
      )
    }

    if (stages.some((stage) => !stage.planned_date_end)) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_missing_stage_plan_dates',
        `Не заполнены плановые даты этапов: ${machine.name}`,
        'У одного или нескольких не пропущенных этапов производства не заполнена плановая дата окончания.',
        200 + index
      )
    }

    if (machine.planned_material_date && machine.planned_material_date < today && !machine.actual_material_date) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_material_late',
        `Материал опаздывает: ${machine.name}`,
        `Плановая дата материала ${machine.planned_material_date}, фактическая дата прихода не заполнена.`,
        300 + index
      )
    }

    if (!machine.actual_shipping_date && shippingStages.some((stage) => stage.planned_date_end && stage.planned_date_end <= today)) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_ready_without_actual_shipping',
        `Нет фактической даты отгрузки: ${machine.name}`,
        'Этап отгрузки уже запланирован на сегодня или раньше, но фактическая дата отгрузки не заполнена.',
        400 + index
      )
    }

    if (!machine.actual_shipping_date && shippingStages.some((stage) => isDateInRange(stage.planned_date_end, weekStart, weekEnd))) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_shipping_this_week',
        `Проверить отгрузку этой недели: ${machine.name}`,
        `Плановая отгрузка попадает в неделю ${weekStart} - ${weekEnd}.`,
        500 + index
      )
    }

    const desiredShippingDate = machine.desired_shipping_date
    if (
      desiredShippingDate &&
      shippingStages.some((stage) => stage.planned_date_end && stage.planned_date_end > desiredShippingDate)
    ) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'factory_shipping_later_than_desired',
        `Готовность позже желаемой даты: ${machine.name}`,
        `Желаемая дата менеджера ${desiredShippingDate}, плановая отгрузка стоит позже.`,
        600 + index
      )
    }
  }

  if (weldingLoadTons >= meta.weldingLimitTons) {
    candidates.push({
      meeting_id: meetingId,
      machine_id: null,
      source_type: 'factory_welding_month_load',
      source_key: `factory_welding_month_load:${meetingType}:${monthStart}`,
      title: `Загрузка сварки ${meta.productionLabel}: ${weldingLoadTons.toFixed(1)} т`,
      description: `В текущем месяце по этапу сборки загружено ${weldingLoadTons.toFixed(1)} т. Порог завода: ${meta.weldingLimitTons} т.`,
      auto_generated: true,
      sort_order: 900,
    })
  }

  return candidates
}

function isMeetingAtOrAfterNow(meeting: { meeting_date: string; meeting_time: string }) {
  const [year, month, day] = meeting.meeting_date.split('-').map(Number)
  const [hours = 0, minutes = 0, seconds = 0] = meeting.meeting_time.split(':').map(Number)
  const meetingDate = new Date(year, month - 1, day, hours, minutes, seconds)
  return meetingDate >= new Date()
}

async function isNearestPlannedTechEngineerSupplyMeeting(db: LooseDb, meetingId: string) {
  const { data, error } = await db
    .from('meetings')
    .select('id, meeting_date, meeting_time')
    .eq('meeting_type', TECH_ENGINEER_SUPPLY_MEETING_TYPE)
    .eq('status', 'planned')
    .gte('meeting_date', getTodayIsoDate())
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true })
    .limit(20)

  if (error) throw error

  const nearest = ((data || []) as Array<{ id: string; meeting_date: string; meeting_time: string }>)
    .find(isMeetingAtOrAfterNow)
  return nearest?.id === meetingId
}

async function buildTechEngineerSupplyAgendaCandidates(
  db: LooseDb,
  meetingId: string
): Promise<AgendaCandidate[]> {
  const candidates: AgendaCandidate[] = []
  const today = getTodayIsoDate()
  const materialEnd = addDaysIso(today, 14)
  const { weekStart, weekEnd } = getCurrentWeekRange()

  const { data: taskData, error: taskError } = await db
    .from('tasks')
    .select('id, machine_id, assigned_to, task_type, title, deadline, status')
    .in('status', ['pending', 'in_progress'])
    .lt('deadline', today)
    .order('deadline', { ascending: true })

  if (taskError) throw taskError

  const tasks = (taskData || []) as Array<{
    id: string
    machine_id: string | null
    assigned_to: string
    task_type: string
    title: string
    deadline: string
    status: string
  }>
  const assignedUserIds = [...new Set(tasks.map((task) => task.assigned_to).filter(Boolean))]
  const roleByUserId = new Map<string, string>()

  if (assignedUserIds.length > 0) {
    const { data: usersData, error: usersError } = await db
      .from('users')
      .select('id, role')
      .in('id', assignedUserIds)

    if (usersError) throw usersError
    ;((usersData || []) as Array<{ id: string; role: string }>).forEach((user) => roleByUserId.set(user.id, user.role))
  }

  tasks.forEach((task, index) => {
    const role = roleByUserId.get(task.assigned_to)
    if (!role || !['engineer', 'technologist', 'supply_manager'].includes(role)) return

    candidates.push({
      meeting_id: meetingId,
      machine_id: task.machine_id,
      source_type: 'tech_overdue_task',
      source_key: `tech_overdue_task:${task.id}`,
      title: `Просрочена задача: ${task.title}`,
      description: `Роль: ${role}. Дедлайн: ${task.deadline}. Тип задачи: ${task.task_type}.`,
      auto_generated: true,
      sort_order: 10 + index,
    })
  })

  const { data: materialData, error: materialError } = await db
    .from('machines_with_totals')
    .select('id, name, planned_material_date, actual_material_date')
    .eq('is_archived', false)
    .gte('planned_material_date', today)
    .lte('planned_material_date', materialEnd)
    .is('actual_material_date', null)
    .order('planned_material_date', { ascending: true })

  if (materialError) throw materialError

  for (const [index, machine] of ((materialData || []) as AgendaMachine[]).entries()) {
    pushMachineCandidate(
      candidates,
      meetingId,
      machine.id,
      'tech_material_delivery_14_days',
      `Подтвердить поставку материала: ${machine.name}`,
      `Плановая дата прихода материала: ${machine.planned_material_date}.`,
      200 + index
    )
  }

  const { data: nonStandardData, error: nonStandardError } = await db
    .from('machines_with_totals')
    .select('id, name, material_type, production_stages(stage_type, planned_date_end, is_skipped)')
    .eq('is_archived', false)
    .eq('material_type', 'non_standard')
    .order('created_at', { ascending: true })

  if (nonStandardError) throw nonStandardError

  for (const [index, machine] of ((nonStandardData || []) as AgendaMachine[]).entries()) {
    const hasStageThisWeek = (machine.production_stages || [])
      .filter((stage) => !stage.is_skipped)
      .some((stage) => isDateInRange(stage.planned_date_end, weekStart, weekEnd))

    if (!hasStageThisWeek) continue

    pushMachineCandidate(
      candidates,
      meetingId,
      machine.id,
      'tech_non_standard_this_week',
      `Нестандартный материал на этой неделе: ${machine.name}`,
      `У машины с нестандартным материалом есть этап производства в неделе ${weekStart} - ${weekEnd}.`,
      400 + index
    )
  }

  if (await isNearestPlannedTechEngineerSupplyMeeting(db, meetingId)) {
    const { data: undefinedMaterialData, error: undefinedMaterialError } = await db
      .from('machines')
      .select('id, name')
      .eq('material_type', 'undefined')
      .eq('is_archived', false)
      .neq('status', 'shipped')
      .order('created_at', { ascending: true })

    if (undefinedMaterialError) throw undefinedMaterialError

    for (const [index, machine] of ((undefinedMaterialData || []) as Array<{ id: string; name: string }>).entries()) {
      pushMachineCandidate(
        candidates,
        meetingId,
        machine.id,
        'material_undefined',
        `Определить тип материала: ${machine.name}`,
        'Тип материала не определён.',
        600 + index
      )
    }
  }

  return candidates
}

async function buildAutoAgendaCandidates(
  db: LooseDb,
  meetingId: string,
  meetingType: CreateMeetingInput['meeting_type']
): Promise<AgendaCandidate[]> {
  if (await isSalesMeetingType(db, meetingType)) return buildSalesAgendaCandidates(db, meetingId)
  if (meetingType === TECH_ENGINEER_SUPPLY_MEETING_TYPE) return buildTechEngineerSupplyAgendaCandidates(db, meetingId)
  if (FACTORY_MEETING_KEYS.includes(meetingType as (typeof FACTORY_MEETING_KEYS)[number])) {
    return buildFactoryProductionAgendaCandidates(db, meetingId, meetingType)
  }
  if (meetingType === 'general') return buildGeneralAgendaCandidates(db, meetingId)
  return []
}

async function removeResolvedAgendaCandidates(db: LooseDb, candidates: AgendaCandidate[]) {
  const sourceKeys = [...new Set(candidates.map((candidate) => candidate.source_key).filter(Boolean))]
  if (sourceKeys.length === 0) return candidates

  const { data, error } = await db
    .from('meeting_agenda_items')
    .select('source_key')
    .in('source_key', sourceKeys)
    .is('resolved_at', null)

  if (error) throw error

  const unresolvedKeys = new Set(((data || []) as Array<{ source_key: string | null }>).map((item) => item.source_key).filter(Boolean))
  const hasAgendaHistory = unresolvedKeys.size > 0
  if (!hasAgendaHistory) {
    const { data: resolvedData, error: resolvedError } = await db
      .from('meeting_agenda_items')
      .select('source_key')
      .in('source_key', sourceKeys)

    if (resolvedError) throw resolvedError
    const usedKeys = new Set(((resolvedData || []) as Array<{ source_key: string | null }>).map((item) => item.source_key).filter(Boolean))
    return candidates.filter((candidate) => !usedKeys.has(candidate.source_key))
  }

  const { data: resolvedData, error: resolvedError } = await db
    .from('meeting_agenda_items')
    .select('source_key')
    .in('source_key', sourceKeys)
    .not('resolved_at', 'is', null)

  if (resolvedError) throw resolvedError
  const resolvedKeys = new Set(((resolvedData || []) as Array<{ source_key: string | null }>).map((item) => item.source_key).filter(Boolean))
  return candidates.filter((candidate) => !resolvedKeys.has(candidate.source_key))
}

async function syncMeetingAutoAgenda(
  db: LooseDb,
  meetingId: string,
  meetingType: CreateMeetingInput['meeting_type']
) {
  try {
    const candidates = await removeResolvedAgendaCandidates(
      db,
      await buildAutoAgendaCandidates(db, meetingId, meetingType)
    )
    const candidateKeys = new Set(candidates.map((candidate) => candidate.source_key))

    const { data: existingData, error: existingError } = await db
      .from('meeting_agenda_items')
      .select('id, source_key, resolved_at, machine_id')
      .eq('meeting_id', meetingId)
      .eq('auto_generated', true)

    if (existingError) throw existingError

    const existingItems = (existingData || []) as Array<{
      id: string
      source_key: string | null
      resolved_at: string | null
      machine_id: string | null
    }>
    const staleIds = existingItems
      .filter((item) => {
        return Boolean(item.source_key && !item.resolved_at && !candidateKeys.has(item.source_key))
      })
      .map((item) => item.id)

    if (staleIds.length > 0) {
      const { error: deleteError } = await db
        .from('meeting_agenda_items')
        .delete()
        .in('id', staleIds)

      if (deleteError) throw deleteError
    }

    const existingKeys = new Set(existingItems.map((item) => item.source_key).filter((value): value is string => Boolean(value)))
    const toInsert = candidates.filter((candidate) => !existingKeys.has(candidate.source_key))

    if (toInsert.length > 0) {
      const { error: insertError } = await db
        .from('meeting_agenda_items')
        .insert(toInsert)

      if (insertError) throw insertError
    }

    return { hasAgendaWarning: false }
  } catch (error) {
    console.error('Ошибка синхронизации авто-повестки:', error)
    return { hasAgendaWarning: true }
  }
}

function getMeetingEndTime(meeting: AgendaLifecycleMeeting) {
  const time = meeting.meeting_time.slice(0, 8)
  const end = new Date(`${meeting.meeting_date}T${time}`)
  end.setMinutes(end.getMinutes() + (meeting.duration_minutes || 60))
  return end
}

async function cleanupStaleAutoAgendaItems(db: LooseDb) {
  const { error } = await db.rpc('fn_cleanup_stale_auto_agenda_items')
  if (error) {
    console.error('Ошибка очистки устаревшей авто-повестки:', error)
  }
}

async function createUnresolvedAgendaTask(
  db: LooseDb,
  meeting: AgendaLifecycleMeeting,
  unresolvedItems: Array<{ title: string }>
) {
  const { data: directorsData, error: directorsError } = await db
    .from('users')
    .select('id')
    .eq('role', 'planning_director')
    .eq('is_active', true)

  if (directorsError) throw directorsError

  const directors = (directorsData || []) as Array<{ id: string }>
  const description = [
    `Собрание ${meeting.meeting_date} ${meeting.meeting_time.slice(0, 5)} прошло, но в повестке остались нерешённые пункты:`,
    ...unresolvedItems.map((item) => `- ${item.title}`),
  ].join('\n')

  for (const director of directors) {
    const { data: existingTask, error: existingError } = await db
      .from('tasks')
      .select('id')
      .eq('related_meeting_id', meeting.id)
      .eq('task_type', 'meeting_unresolved_agenda')
      .limit(1)

    if (existingError) throw existingError
    if (((existingTask || []) as unknown[]).length > 0) continue

    const { error: insertError } = await db
      .from('tasks')
      .insert({
        machine_id: null,
        related_meeting_id: meeting.id,
        assigned_to: director.id,
        task_type: 'meeting_unresolved_agenda',
        title: 'Завершить нерешённую повестку прошедшего собрания',
        description,
        status: 'pending',
        start_date: meeting.meeting_date,
        deadline: meeting.meeting_date,
      })

    if (insertError) throw insertError
    await dispatchPendingTelegramDeliveries({ userId: director.id })
  }
}

async function carryUnresolvedAgendaItems(
  db: LooseDb,
  fromMeeting: AgendaLifecycleMeeting,
  unresolvedItems: Array<{
    id: string
    machine_id: string | null
    title: string
    description: string | null
    auto_generated: boolean | null
    source_type: string | null
    source_key: string | null
    sort_order: number
  }>
) {
  if (!fromMeeting.recurrence_rule_id) return false

  const { data: nextData, error: nextError } = await db
    .from('meetings')
    .select('id')
    .eq('recurrence_rule_id', fromMeeting.recurrence_rule_id)
    .eq('status', 'planned')
    .gte('meeting_date', fromMeeting.meeting_date)
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true })

  if (nextError) throw nextError

  const nextMeeting = ((nextData || []) as Array<{ id: string }>).find((meeting) => meeting.id !== fromMeeting.id)
  if (!nextMeeting) return false

  const carryRows = unresolvedItems.map((item, index) => ({
    meeting_id: nextMeeting.id,
    machine_id: item.machine_id,
    title: item.title,
    description: item.description,
    auto_generated: item.auto_generated,
    source_type: item.source_type || 'carried_unresolved',
    source_key: item.source_key ? `carried:${nextMeeting.id}:${item.source_key}` : `carried:${nextMeeting.id}:${item.id}`,
    carried_from_item_id: item.id,
    sort_order: 200 + index,
  }))

  const { error: insertError } = await db
    .from('meeting_agenda_items')
    .insert(carryRows)

  if (insertError && insertError.code !== '23505') throw insertError

  return true
}

async function syncPastPlannedMeetings(db: LooseDb) {
  await cleanupStaleAutoAgendaItems(db)

  const { data: meetingsData, error: meetingsError } = await db
    .from('meetings')
    .select('id, meeting_date, meeting_time, duration_minutes, recurrence_rule_id')
    .eq('status', 'planned')
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true })

  if (meetingsError) throw meetingsError

  const now = new Date()
  const pastMeetings = ((meetingsData || []) as AgendaLifecycleMeeting[])
    .filter((meeting) => getMeetingEndTime(meeting) < now)

  for (const meeting of pastMeetings) {
    const { data: agendaData, error: agendaError } = await db
      .from('meeting_agenda_items')
      .select('id, machine_id, title, description, auto_generated, source_type, source_key, sort_order, resolved_at')
      .eq('meeting_id', meeting.id)

    if (agendaError) throw agendaError

    const unresolvedItems = ((agendaData || []) as Array<{
      id: string
      machine_id: string | null
      title: string
      description: string | null
      auto_generated: boolean | null
      source_type: string | null
      source_key: string | null
      sort_order: number
      resolved_at: string | null
    }>).filter((item) => !item.resolved_at)

    if (unresolvedItems.length > 0) {
      const carried = await carryUnresolvedAgendaItems(db, meeting, unresolvedItems)
      if (!carried) await createUnresolvedAgendaTask(db, meeting, unresolvedItems)
    }

    const { error: updateError } = await db
      .from('meetings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', meeting.id)

    if (updateError) throw updateError
  }
}

function buildRecurringDates(data: CreateMeetingPayload) {
  const weekdays = [...new Set(data.recurrence_weekdays || [])]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b)

  if (weekdays.length === 0) {
    throw new Error('Выберите дни недели для повторения')
  }

  const count = Math.min(Math.max(data.recurrence_count || 8, 1), MAX_RECURRING_MEETINGS)
  const current = parseIsoDate(data.meeting_date)
  const endDate = data.recurrence_end_date ? parseIsoDate(data.recurrence_end_date) : null

  if (endDate && endDate < current) {
    throw new Error('Дата окончания повторения не может быть раньше даты старта')
  }

  const dates: string[] = []
  const allowedWeekdays = new Set(weekdays)
  let guard = 0

  while (dates.length < count && guard < 3660) {
    if (endDate && current > endDate) break
    if (allowedWeekdays.has(getIsoWeekday(current))) {
      dates.push(formatIsoDate(current))
    }
    current.setUTCDate(current.getUTCDate() + 1)
    guard += 1
  }

  if (dates.length === 0) {
    throw new Error('Не найдено ни одной даты для повторяющегося собрания')
  }

  return { dates, weekdays, count }
}

async function insertMeetingOccurrence(
  db: LooseDb,
  userId: string,
  data: CreateMeetingPayload,
  meetingDate: string,
  recurrenceRuleId?: string
) {
  const { data: newMeeting, error: meetingError } = await db
    .from('meetings')
    .insert({
      meeting_type: data.meeting_type,
      title: data.title || null,
      meeting_date: meetingDate,
      meeting_time: data.meeting_time,
      duration_minutes: data.duration_minutes || 60,
      status: 'planned',
      recurrence_rule_id: recurrenceRuleId || null,
      recurrence_occurrence_date: recurrenceRuleId ? meetingDate : null,
      created_by: userId
    })
    .select('id')
    .single()

  if (meetingError) throw meetingError

  const meetingId = (newMeeting as { id: string }).id

  if (data.attendeeIds && data.attendeeIds.length > 0) {
    const attendees = [...new Set(data.attendeeIds)].map((uid: string) => ({
      meeting_id: meetingId,
      user_id: uid
    }))
    const { error } = await db.from('meeting_attendees').insert(attendees)
    if (error) throw error
  }

  if (data.externalAttendees && data.externalAttendees.length > 0) {
    const extAttendees = data.externalAttendees.map(ext => ({
      meeting_id: meetingId,
      full_name: ext.full_name,
      role_description: ext.role_description || null,
      phone: ext.phone || null,
      email: ext.email || null
    }))
    const { error } = await db.from('meeting_external_attendees').insert(extAttendees)
    if (error) throw error
  }

  const agendaResult = await generateMeetingAgenda(db, meetingId, data.meeting_type, false)

  return { meetingId, hasAgendaWarning: agendaResult.hasAgendaWarning }

}

async function requireAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const typedProfile = profile as unknown as CurrentUser
  if (!typedProfile) throw new Error('Профиль не найден')

  const canManageMeetings = await requirePermission('meetings', 'manage')
    .then(() => true)
    .catch(() => false)

  return { supabase, db: supabase as unknown as LooseDb, user: typedProfile, isDirector: canManageMeetings }
}

// === ПОЛУЧЕНИЕ ===

export async function getMeetings(filters?: {
  month?: number
  year?: number
  type?: string
  status?: string
}) {
  try {
    const { db } = await requireAuth()
    await syncPastPlannedMeetings(db)

    let query = db
      .from('meetings')
      .select(`
        *,
        attendees:meeting_attendees(id),
        agenda:meeting_agenda_items(id),
        decisions:meeting_decisions(id)
      `)
      .neq('status', 'cancelled')
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(MEETINGS_LIST_LIMIT)

    if (filters?.type && filters.type !== 'all') {
      query = query.eq('meeting_type', filters.type)
    }
    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status)
    }

    const { data: rawData, error } = await query
    if (error) throw error

    let finalData = (rawData || []) as MeetingListItem[]
    if (filters?.month !== undefined && filters?.year !== undefined) {
      finalData = finalData.filter((m) => {
        const d = new Date(m.meeting_date)
        return d.getMonth() === filters.month && d.getFullYear() === filters.year
      })
    }

    const mapped: MeetingListItem[] = finalData.map((m) => ({
      ...m,
      agenda_items_count: m.agenda?.length || 0,
      attendees_count: m.attendees?.length || 0,
      decisions_count: m.decisions?.length || 0,
    }))

    return { data: mapped, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getMeetingTypes() {
  try {
    const { db } = await requireAuth()
    const { data, error } = await db
      .from('meeting_types')
      .select('key, label, color, is_system')
      .eq('is_active', true)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) throw error
    return { data: (data || []) as MeetingTypeOption[], error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createMeetingType(label: string) {
  try {
    const { db, user, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const normalizedLabel = label.trim()
    if (normalizedLabel.length < 2) throw new Error('Введите название типа собрания')

    const key = `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const { data, error } = await db
      .from('meeting_types')
      .insert({
        key,
        label: normalizedLabel,
        color: 'blue',
        is_system: false,
        is_active: true,
        created_by: user.id,
      })
      .select('key, label, color, is_system')
      .single()

    if (error) throw error

    revalidatePath('/meetings')
    revalidatePath('/meetings/new')
    return { success: true, data: data as MeetingTypeOption, error: null }
  } catch (error: unknown) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function updateMeetingType(key: string, label: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const normalizedKey = key.trim()
    const normalizedLabel = label.trim()
    if (!normalizedKey) throw new Error('Тип собрания не найден')
    if (normalizedLabel.length < 2) throw new Error('Введите название типа собрания')

    const { data, error } = await db
      .from('meeting_types')
      .update({
        label: normalizedLabel,
        updated_at: new Date().toISOString(),
      })
      .eq('key', normalizedKey)
      .select('key, label, color, is_system')
      .single()

    if (error) throw error

    revalidatePath('/meetings')
    revalidatePath('/meetings/new')
    revalidatePath('/meetings/agenda-pool')
    return { success: true, data: data as MeetingTypeOption, error: null }
  } catch (error: unknown) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function deleteMeetingType(key: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const normalizedKey = key.trim()
    if (!normalizedKey) throw new Error('Тип собрания не найден')

    const { data: typeData, error: typeError } = await db
      .from('meeting_types')
      .select('key, is_system')
      .eq('key', normalizedKey)
      .single()

    if (typeError) throw typeError
    const meetingType = typeData as { key: string; is_system: boolean } | null
    if (!meetingType) throw new Error('Тип собрания не найден')
    if (meetingType.is_system) throw new Error('Системный тип собрания нельзя удалить')

    const { data: meetingsData, error: meetingsError } = await db
      .from('meetings')
      .select('id')
      .eq('meeting_type', normalizedKey)
      .limit(1)

    if (meetingsError) throw meetingsError
    if (((meetingsData || []) as unknown[]).length > 0) {
      throw new Error('Этот тип уже используется в собраниях. Сначала измените тип у этих собраний.')
    }

    const { data: recurrenceData, error: recurrenceError } = await db
      .from('meeting_recurrence_rules')
      .select('id')
      .eq('meeting_type', normalizedKey)
      .limit(1)

    if (recurrenceError) throw recurrenceError
    if (((recurrenceData || []) as unknown[]).length > 0) {
      throw new Error('Этот тип уже используется в повторяющихся сериях.')
    }

    const { error: deleteError } = await db
      .from('meeting_types')
      .delete()
      .eq('key', normalizedKey)

    if (deleteError) throw deleteError

    revalidatePath('/meetings')
    revalidatePath('/meetings/new')
    revalidatePath('/meetings/agenda-pool')
    return { success: true, key: normalizedKey, error: null }
  } catch (error: unknown) {
    return { success: false, key: null, error: getErrorMessage(error) }
  }
}

export async function getMeeting(id: string) {
  try {
    const { db } = await requireAuth()
    await syncPastPlannedMeetings(db)

    const { data: meetingSeed, error: seedError } = await db
      .from('meetings')
      .select('id, meeting_type, status')
      .eq('id', id)
      .single()

    if (seedError) throw seedError
    const seed = meetingSeed as AgendaSyncMeeting & { status: string }
    if (seed.status === 'planned') {
      await syncMeetingAutoAgenda(db, id, seed.meeting_type)
    }

    const { data, error } = await db
      .from('meetings')
      .select(`
        *,
        created_by_user:users!meetings_created_by_fkey(full_name),
        attendees:meeting_attendees(id, is_confirmed, attended, user:users(id, full_name, role)),
        external_attendees:meeting_external_attendees(*),
        agenda:meeting_agenda_items(
          *,
          machine:machines(id, name, status, factory_id, material_type, desired_shipping_date,
            planned_material_date, production_month, production_workshop, production_queue_number,
            machine_items(id, drawing_number, product_name, price, quantity, weight, coating, ral_number, is_sample, sort_order)
          )
        ),
        decisions:meeting_decisions(
          *,
          machine:machines(id, name),
          assigned_factory:factories(name),
          responsible:users!meeting_decisions_responsible_user_id_fkey(full_name)
        ),
        action_items:meeting_action_items(
          *,
          responsible:users!meeting_action_items_responsible_user_id_fkey(full_name)
        )
      `)
      .eq('id', id)
      .single()

    if (error) throw error

    const meetingData = data as MeetingDetails
    if (meetingData?.agenda) {
      meetingData.agenda = meetingData.agenda.map((item) => {
        if (item.machine && item.machine.machine_items) {
          const items = item.machine.machine_items
          const total_weight = items.reduce((sum, i) => sum + (Number(i.weight) * Number(i.quantity)), 0)
          const total_cost = items.reduce((sum, i) => sum + (Number(i.price) * Number(i.quantity)), 0)
          return {
            ...item,
            machine: {
              ...item.machine,
              total_weight: total_weight / 1000,
              total_cost,
              item_count: items.length
            } satisfies MachineRelation
          }
        }
        return item
      })
      meetingData.agenda.sort((a, b) => a.sort_order - b.sort_order)
    }

    return { data: meetingData, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUpcomingMeeting() {
  try {
    const { db } = await requireAuth()
    await syncPastPlannedMeetings(db)

    const { data, error } = await db
      .from('meetings')
      .select('id, meeting_type, meeting_date, meeting_time, title, agenda:meeting_agenda_items(id), attendees:meeting_attendees(id)')
      .eq('status', 'planned')
      .gte('meeting_date', new Date().toISOString().split('T')[0])
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return { data: null, error: null }
      throw error
    }

    const upcoming = data as UpcomingMeeting
    return {
      data: {
        ...upcoming,
        agenda_items_count: upcoming?.agenda?.length || 0,
        attendees_count: upcoming?.attendees?.length || 0
      },
      error: null
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// === СОЗДАНИЕ ===
export type AgendaPoolItem = {
  id: string
  source_type: string
  machine_id: string | null
  title: string
  description: string | null
  created_at: string
  machine?: { id: string; name: string; status: string; desired_shipping_date: string | null } | null
}

export type AgendaPoolMeetingOption = {
  id: string
  meeting_type: MeetingListItem['meeting_type']
  meeting_type_label: string | null
  title: string | null
  meeting_date: string
  meeting_time: string
}

export async function getAgendaPool() {
  try {
    await requirePermission('meetings_agenda_pool', 'view')
    const { db } = await requireAuth()
    await syncPastPlannedMeetings(db)
    const { error: refreshError } = await db.rpc('fn_refresh_meeting_agenda_pool')
    if (refreshError) throw refreshError

    const { data, error } = await db
      .from('meeting_agenda_pool_items')
      .select(`
        id,
        source_type,
        machine_id,
        title,
        description,
        created_at,
        machine:machines(id, name, status, desired_shipping_date)
      `)
      .eq('status', 'new')
      .order('created_at', { ascending: true })

    if (error) throw error

    return { data: (data || []) as AgendaPoolItem[], error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getAgendaPoolMeetingOptions() {
  try {
    await requirePermission('meetings_agenda_pool', 'view')
    const { db } = await requireAuth()
    await syncPastPlannedMeetings(db)
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await db
      .from('meetings')
      .select('id, meeting_type, title, meeting_date, meeting_time')
      .eq('status', 'planned')
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })

    if (error) throw error

    const meetings = (data || []) as Omit<AgendaPoolMeetingOption, 'meeting_type_label'>[]
    const typeKeys = Array.from(new Set(meetings.map((meeting) => meeting.meeting_type).filter(Boolean)))
    const typeLabels = new Map<string, string>()

    if (typeKeys.length > 0) {
      const { data: meetingTypes, error: meetingTypesError } = await db
        .from('meeting_types')
        .select('key, label')
        .in('key', typeKeys)

      if (meetingTypesError) throw meetingTypesError

      for (const type of (meetingTypes || []) as Array<{ key: string; label: string }>) {
        typeLabels.set(type.key, type.label)
      }
    }

    return {
      data: meetings.map((meeting) => ({
        ...meeting,
        meeting_type_label: typeLabels.get(meeting.meeting_type) || null,
      })),
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function assignAgendaPoolItem(poolItemId: string, meetingId: string) {
  try {
    await requirePermission('meetings_agenda_pool', 'manage')
    const { db } = await requireAuth()

    const { data: poolItem, error: poolError } = await db
      .from('meeting_agenda_pool_items')
      .select('id, title, description, machine_id, status, source_type, source_key')
      .eq('id', poolItemId)
      .single()

    if (poolError) throw poolError

    const item = poolItem as {
      id: string
      title: string
      description: string | null
      machine_id: string | null
      status: string
      source_type: string | null
      source_key: string | null
    }

    if (item.status !== 'new') throw new Error('Пункт уже распределён или удалён из пула')

    const { data: meeting, error: meetingError } = await db
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .single()

    if (meetingError || !meeting) throw new Error('Собрание не найдено')

    const { error: insertError } = await db
      .from('meeting_agenda_items')
      .insert({
        meeting_id: meetingId,
        machine_id: item.machine_id,
        title: item.title,
        description: item.description,
        auto_generated: true,
        source_type: item.source_type,
        source_key: item.source_key ? `pool:${item.source_key}` : `pool:${item.id}`,
        sort_order: 99,
      })

    if (insertError) throw insertError

    const { error: updateError } = await db
      .from('meeting_agenda_pool_items')
      .update({
        status: 'assigned',
        assigned_meeting_id: meetingId,
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', poolItemId)

    if (updateError) throw updateError

    revalidatePath('/meetings')
    revalidatePath('/meetings/agenda-pool')
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createMeeting(data: CreateMeetingPayload) {
  try {
    await requirePermission('meetings', 'manage')
    const { db, user } = await requireAuth()

    if (data.is_recurring) {
      const { dates, weekdays, count } = buildRecurringDates(data)
      const attendeeIds = [...new Set(data.attendeeIds || [])]

      const { data: recurrenceRule, error: recurrenceError } = await db
        .from('meeting_recurrence_rules')
        .insert({
          meeting_type: data.meeting_type,
          title: data.title || null,
          meeting_time: data.meeting_time,
          duration_minutes: data.duration_minutes || 60,
          weekdays,
          start_date: data.meeting_date,
          end_date: data.recurrence_end_date || null,
          occurrence_count: count,
          attendee_ids: attendeeIds,
          external_attendees: data.externalAttendees || [],
          created_by: user.id
        })
        .select('id')
        .single()

      if (recurrenceError) throw recurrenceError

      const recurrenceRuleId = (recurrenceRule as { id: string }).id
      const createdMeetings = []
      let hasAgendaWarning = false

      for (const meetingDate of dates) {
        const result = await insertMeetingOccurrence(db, user.id, data, meetingDate, recurrenceRuleId)
        createdMeetings.push(result.meetingId)
        hasAgendaWarning = hasAgendaWarning || result.hasAgendaWarning
      }

      await dispatchPendingTelegramDeliveries()

      revalidatePath('/meetings')
      revalidatePath('/')
      revalidatePath(`/meetings/${createdMeetings[0]}`)
      return {
        success: true,
        meetingId: createdMeetings[0],
        createdCount: createdMeetings.length,
        warning: hasAgendaWarning
          ? 'Собрания созданы, но для части встреч повестка не сгенерировалась. Попробуйте обновить её на странице собрания.'
          : undefined,
        error: null
      }
    }

    const result = await insertMeetingOccurrence(db, user.id, data, data.meeting_date)
    await dispatchPendingTelegramDeliveries()

    revalidatePath('/meetings')
    revalidatePath('/')
    revalidatePath(`/meetings/${result.meetingId}`)
    return {
      success: true,
      meetingId: result.meetingId,
      createdCount: 1,
      warning: result.hasAgendaWarning
        ? 'Собрание назначено, но повестка не сгенерировалась. Попробуйте обновить её на странице собрания.'
        : undefined,
      error: null
    }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === ОБНОВЛЕНИЕ ===
export async function updateMeeting(id: string, data: UpdateMeetingInput) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error } = await db.from('meetings').update(data).eq('id', id)
    if (error) throw error

    revalidatePath('/meetings')
    revalidatePath(`/meetings/${id}`)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function completeMeeting(id: string, notes: string, actuallyAttendedIds: string[]) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error: mError } = await db
      .from('meetings')
      .update({ status: 'completed', notes })
      .eq('id', id)
    if (mError) throw mError

    if (actuallyAttendedIds.length > 0) {
      await db
        .from('meeting_attendees')
        .update({ attended: true })
        .eq('meeting_id', id)
        .in('user_id', actuallyAttendedIds)
    }

    revalidatePath('/meetings')
    revalidatePath(`/meetings/${id}`)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

async function moveMeetingAgendaToPool(
  db: LooseDb,
  meetings: Array<{ id: string; meeting_date: string; meeting_time: string; title: string | null }>
) {
  if (meetings.length === 0) return 0

  const meetingIds = meetings.map((meeting) => meeting.id)
  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]))
  const { data: agendaData, error: agendaError } = await db
    .from('meeting_agenda_items')
    .select('id, meeting_id, machine_id, title, description, source_type')
    .in('meeting_id', meetingIds)

  if (agendaError) throw agendaError

  const agendaItems = (agendaData || []) as Array<{
    id: string
    meeting_id: string
    machine_id: string | null
    title: string
    description: string | null
    source_type: string | null
  }>

  if (agendaItems.length === 0) return 0

  const rows = agendaItems.map((item) => {
    const meeting = meetingById.get(item.meeting_id)
    const meetingLabel = meeting
      ? `${meeting.title || 'Собрание'} ${meeting.meeting_date} ${meeting.meeting_time.slice(0, 5)}`
      : 'Отменённое собрание'

    return {
      source_key: `cancelled_meeting:${item.meeting_id}:${item.id}`,
      source_type: item.source_type || 'cancelled_meeting_agenda',
      machine_id: item.machine_id,
      title: item.title,
      description: [
        item.description,
        `Перенесено из отменённого собрания: ${meetingLabel}.`,
      ].filter(Boolean).join('\n\n'),
      status: 'new',
      assigned_meeting_id: null,
      assigned_at: null,
      dismissed_at: null,
      updated_at: new Date().toISOString(),
    }
  })

  let movedCount = 0
  for (const row of rows) {
    const { error: insertError } = await db
      .from('meeting_agenda_pool_items')
      .insert(row)

    if (insertError) {
      if (insertError.code === '23505') continue
      throw insertError
    }
    movedCount += 1
  }

  return movedCount
}

async function createAgendaPoolDistributionTasks(db: LooseDb, poolCount: number) {
  if (poolCount <= 0) return

  const today = getTodayIsoDate()
  const { data: directorsData, error: directorsError } = await db
    .from('users')
    .select('id')
    .eq('role', 'planning_director')
    .eq('is_active', true)

  if (directorsError) throw directorsError

  const directors = (directorsData || []) as Array<{ id: string }>
  for (const director of directors) {
    const { data: existingData, error: existingError } = await db
      .from('tasks')
      .select('id')
      .eq('assigned_to', director.id)
      .eq('task_type', 'agenda_pool_distribution')
      .eq('status', 'pending')
      .eq('deadline', today)
      .limit(1)

    if (existingError) throw existingError
    if (((existingData || []) as unknown[]).length > 0) continue

    const { error: insertError } = await db
      .from('tasks')
      .insert({
        machine_id: null,
        assigned_to: director.id,
        task_type: 'agenda_pool_distribution',
        title: 'Распределить повестки из пула',
        description: `После отмены собраний в пул повесток перенесено пунктов: ${poolCount}. Откройте пул и назначьте их на будущие собрания.`,
        status: 'pending',
        start_date: today,
        deadline: today,
      })

    if (insertError) throw insertError
    await dispatchPendingTelegramDeliveries({ userId: director.id })
  }
}

export async function cancelMeeting(id: string, scope: 'single' | 'series' = 'single') {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    const { data: meetingData, error: meetingError } = await db
      .from('meetings')
      .select('id, title, meeting_date, meeting_time, status, recurrence_rule_id')
      .eq('id', id)
      .single()

    if (meetingError) throw meetingError
    const meeting = meetingData as {
      id: string
      title: string | null
      meeting_date: string
      meeting_time: string
      status: string
      recurrence_rule_id: string | null
    } | null

    if (!meeting) throw new Error('Собрание не найдено')
    if (meeting.status !== 'planned') throw new Error('Можно отменять только запланированные собрания')

    let meetingsToCancel: Array<{ id: string; meeting_date: string; meeting_time: string; title: string | null }> = [meeting]
    if (scope === 'series') {
      if (!meeting.recurrence_rule_id) throw new Error('Это собрание не входит в повторяющуюся серию')

      const { data: seriesData, error: seriesError } = await db
        .from('meetings')
        .select('id, title, meeting_date, meeting_time')
        .eq('recurrence_rule_id', meeting.recurrence_rule_id)
        .eq('status', 'planned')
        .gte('meeting_date', getTodayIsoDate())
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })

      if (seriesError) throw seriesError
      meetingsToCancel = (seriesData || []) as Array<{ id: string; meeting_date: string; meeting_time: string; title: string | null }>
    }

    if (meetingsToCancel.length === 0) {
      return { success: true, cancelledIds: [], cancelledCount: 0, movedToPoolCount: 0, error: null }
    }

    const movedToPoolCount = await moveMeetingAgendaToPool(db, meetingsToCancel)
    const idsToCancel = meetingsToCancel.map((item) => item.id)
    const { error } = await db
      .from('meetings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', idsToCancel)
    if (error) throw error
    await createAgendaPoolDistributionTasks(db, movedToPoolCount)

    revalidatePath('/meetings')
    revalidatePath(`/meetings/${id}`)
    revalidatePath('/meetings/agenda-pool')
    revalidatePath('/tasks')
    return { success: true, cancelledIds: idsToCancel, cancelledCount: idsToCancel.length, movedToPoolCount, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === ПОВЕСТКА ===
export async function regenerateAgenda(meetingId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    await db.from('meeting_agenda_items')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('auto_generated', true)

    const { data: meetingData, error: meetingError } = await db
      .from('meetings')
      .select('meeting_type')
      .eq('id', meetingId)
      .single()

    if (meetingError) throw meetingError

    const agendaResult = await generateMeetingAgenda(
      db,
      meetingId,
      (meetingData as { meeting_type: CreateMeetingInput['meeting_type'] }).meeting_type,
      false
    )

    if (agendaResult.hasAgendaWarning) throw new Error('Не удалось сформировать повестку')

    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function addAgendaItem(meetingId: string, data: AddAgendaItemInput) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error } = await db.from('meeting_agenda_items').insert({
      meeting_id: meetingId,
      title: data.title,
      description: data.description || null,
      machine_id: data.machine_id || null,
      auto_generated: false,
      sort_order: 99
    })

    if (error) throw error
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function removeAgendaItem(id: string, meetingId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    const { error } = await db.from('meeting_agenda_items').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

// === РЕШЕНИЯ И ЗАВОДЫ ===
export async function moveAgendaItem(id: string, fromMeetingId: string, toMeetingId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    if (fromMeetingId === toMeetingId) throw new Error('Выберите другое собрание')

    const { data: itemData, error: itemError } = await db
      .from('meeting_agenda_items')
      .select('id, meeting_id')
      .eq('id', id)
      .single()

    if (itemError) throw itemError

    const item = itemData as { id: string; meeting_id: string } | null
    if (!item || item.meeting_id !== fromMeetingId) {
      throw new Error('Пункт повестки не найден в текущем собрании')
    }

    const { data: targetMeeting, error: targetError } = await db
      .from('meetings')
      .select('id')
      .eq('id', toMeetingId)
      .single()

    if (targetError) throw targetError
    if (!(targetMeeting as { id: string } | null)?.id) {
      throw new Error('Собрание для переноса не найдено')
    }

    const { error } = await db
      .from('meeting_agenda_items')
      .update({ meeting_id: toMeetingId, sort_order: 99 })
      .eq('id', id)

    if (error) throw error

    revalidatePath('/meetings')
    revalidatePath(`/meetings/${fromMeetingId}`)
    revalidatePath(`/meetings/${toMeetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function addDecision(meetingId: string, data: AddDecisionInput) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error: decError } = await db.from('meeting_decisions').insert({
      meeting_id: meetingId,
      machine_id: data.machine_id || null,
      assigned_factory_id: data.assigned_factory_id || null,
      assigned_material_type: data.assigned_material_type || null,
      decision_text: data.decision_text,
      responsible_user_id: data.responsible_user_id || null,
      deadline: data.deadline || null
    })

    if (decError) throw decError

    if (data.machine_id) {
      const updates: { factory_id?: string; status?: 'factory_assigned'; material_type?: MaterialType } = {}
      if (data.assigned_factory_id) {
        updates.factory_id = data.assigned_factory_id
        updates.status = 'factory_assigned'
      }
      if (data.assigned_material_type) {
        updates.material_type = data.assigned_material_type
      }

      if (Object.keys(updates).length > 0) {
        const { error: machError } = await db.from('machines').update(updates).eq('id', data.machine_id)
        if (machError) throw machError

        await notifyNewTasks(data.machine_id)
      }
    }

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/sales-plan')
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function resolveAgendaItem(
  meetingId: string,
  agendaItemId: string,
  data: AddDecisionInput
) {
  try {
    const { db, user, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { data: agendaItemData, error: agendaError } = await db
      .from('meeting_agenda_items')
      .select('id, meeting_id, resolved_at')
      .eq('id', agendaItemId)
      .single()

    if (agendaError) throw agendaError
    const agendaItem = agendaItemData as { id: string; meeting_id: string; resolved_at: string | null } | null
    if (!agendaItem || agendaItem.meeting_id !== meetingId) throw new Error('Пункт повестки не найден')
    if (agendaItem.resolved_at) return { success: true, error: null }

    const { data: decisionData, error: decError } = await db
      .from('meeting_decisions')
      .insert({
        meeting_id: meetingId,
        machine_id: data.machine_id || null,
        assigned_factory_id: data.assigned_factory_id || null,
        assigned_material_type: data.assigned_material_type || null,
        decision_text: data.decision_text,
        responsible_user_id: data.responsible_user_id || null,
        deadline: data.deadline || null
      })
      .select('id')
      .single()

    if (decError) throw decError
    const decisionId = (decisionData as { id: string }).id

    const updates: { factory_id?: string; status?: 'factory_assigned'; material_type?: MaterialType } = {}
    if (data.assigned_factory_id) {
      updates.factory_id = data.assigned_factory_id
      updates.status = 'factory_assigned'
    }
    if (data.assigned_material_type) {
      updates.material_type = data.assigned_material_type
    }

    if (data.machine_id && Object.keys(updates).length > 0) {
      const { error: machError } = await db.from('machines').update(updates).eq('id', data.machine_id)
      if (machError) throw machError

      await notifyNewTasks(data.machine_id)
    }

    const { error: resolveError } = await db
      .from('meeting_agenda_items')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolved_decision_id: decisionId,
      })
      .eq('id', agendaItemId)

    if (resolveError) throw resolveError

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/sales-plan')
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

async function getAgendaItemForMachine(
  db: LooseDb,
  meetingId: string,
  agendaItemId: string,
  expectedSourceType: string,
  machineId: string
) {
  const { data, error } = await db
    .from('meeting_agenda_items')
    .select('id, meeting_id, machine_id, source_type, resolved_at')
    .eq('id', agendaItemId)
    .single()

  if (error) throw error
  const item = data as {
    id: string
    meeting_id: string
    machine_id: string | null
    source_type: string | null
    resolved_at: string | null
  } | null

  if (!item || item.meeting_id !== meetingId) throw new Error('Пункт повестки не найден')
  if (item.machine_id !== machineId) throw new Error('Пункт повестки относится к другой машине')
  if (item.source_type !== expectedSourceType) throw new Error('Для этого пункта повестки доступно другое действие')
  return item
}

async function resolveAgendaItemWithDecision(db: LooseDb, agendaItemId: string, decisionId: string, userId: string) {
  const { error } = await db
    .from('meeting_agenda_items')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolved_decision_id: decisionId,
    })
    .eq('id', agendaItemId)

  if (error) throw error
}

export async function planMaterialFromAgenda(
  meetingId: string,
  agendaItemId: string,
  input: PlanMaterialFromAgendaInput
) {
  try {
    const { db, user, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    if (!input.planned_material_date) throw new Error('Выберите дату поставки материала')
    if (!input.material_type || input.material_type === 'undefined') throw new Error('Выберите тип материала')

    const agendaItem = await getAgendaItemForMachine(
      db,
      meetingId,
      agendaItemId,
      'factory_missing_material_date',
      input.machine_id
    )

    if (agendaItem.resolved_at) return { success: true, error: null }

    const { error: machineError } = await db
      .from('machines')
      .update({
        planned_material_date: input.planned_material_date,
        material_type: input.material_type,
      })
      .eq('id', input.machine_id)

    if (machineError) throw machineError

    const { data: decisionData, error: decisionError } = await db
      .from('meeting_decisions')
      .insert({
        meeting_id: meetingId,
        machine_id: input.machine_id,
        assigned_material_type: input.material_type,
        decision_text: `Запланирована поставка материала на ${input.planned_material_date}. Тип материала: ${input.material_type}.`,
      })
      .select('id')
      .single()

    if (decisionError) throw decisionError

    await notifyNewTasks(input.machine_id)

    if (input.close_agenda_item) {
      await resolveAgendaItemWithDecision(db, agendaItemId, (decisionData as { id: string }).id, user.id)
    }

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/sales-plan')
    revalidatePath('/production')
    revalidatePath('/production/gantt')
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function checkNewMachineFromAgenda(
  meetingId: string,
  agendaItemId: string,
  input: CheckNewMachineFromAgendaInput
) {
  try {
    const { db, user, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    if (!input.factory_id) throw new Error('Выберите завод')

    const agendaItem = await getAgendaItemForMachine(
      db,
      meetingId,
      agendaItemId,
      'factory_new_machine',
      input.machine_id
    )

    if (agendaItem.resolved_at) return { success: true, error: null }

    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('name, factory_id, production_month, production_workshop, production_queue_number')
      .eq('id', input.machine_id)
      .single()

    if (machineError || !machineData) throw new Error('Машина не найдена')
    const machine = machineData as {
      name: string
      factory_id: string | null
      production_month: string | null
      production_workshop: number | null
      production_queue_number: number | null
    }

    const nextWorkshop = input.production_workshop || null
    const updates: {
      factory_id?: string
      production_workshop?: number | null
      production_queue_number?: number | null
      production_month?: string | null
      status?: 'factory_assigned'
    } = {}

    const changedFactory = input.factory_id !== machine.factory_id
    const changedWorkshop = nextWorkshop !== machine.production_workshop

    if (changedFactory) {
      updates.factory_id = input.factory_id
      updates.status = 'factory_assigned'
    }
    if (changedWorkshop) {
      updates.production_workshop = nextWorkshop
    }

    if (changedFactory || changedWorkshop) {
      if (input.factory_id && machine.production_month && nextWorkshop) {
        const factoryName = await getFactoryName(db, input.factory_id)
        if (!isFactoryWorkshopAllowed(factoryName, nextWorkshop)) {
          throw new Error('Выбранный цех недоступен для этого завода')
        }

        const sameProductionGroup =
          input.factory_id === machine.factory_id &&
          machine.production_month &&
          nextWorkshop === machine.production_workshop &&
          machine.production_queue_number

        updates.production_queue_number = sameProductionGroup
          ? machine.production_queue_number
          : await getNextProductionQueueNumber(db, machine.production_month, input.factory_id, nextWorkshop, input.machine_id)
      } else {
        updates.production_workshop = null
        updates.production_queue_number = null
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await db
        .from('machines')
        .update(updates)
        .eq('id', input.machine_id)

      if (updateError) throw updateError
    }

    const decisionText = input.close_agenda_item
      ? 'Новая машина проверена.'
      : 'Новая машина просмотрена без закрытия пункта повестки.'
    const { data: decisionData, error: decisionError } = await db
      .from('meeting_decisions')
      .insert({
        meeting_id: meetingId,
        machine_id: input.machine_id,
        assigned_factory_id: input.factory_id,
        decision_text: decisionText,
      })
      .select('id')
      .single()

    if (decisionError) throw decisionError

    if (input.close_agenda_item) {
      await resolveAgendaItemWithDecision(db, agendaItemId, (decisionData as { id: string }).id, user.id)
    }

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/sales-plan')
    revalidatePath('/production')
    revalidatePath('/production/gantt')
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function assignFactoryDirectly(machineId: string, factoryId: string, materialType: string, meetingId?: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error: machError } = await db.from('machines').update({
      factory_id: factoryId,
      status: 'factory_assigned',
      material_type: materialType
    }).eq('id', machineId)
    if (machError) throw machError

    await notifyNewTasks(machineId)

    if (meetingId) {
      await db.from('meeting_decisions').insert({
        meeting_id: meetingId,
        machine_id: machineId,
        assigned_factory_id: factoryId,
        assigned_material_type: materialType,
        decision_text: 'Назначен завод и тип материала',
      })

      await db.from('meeting_agenda_items')
        .delete()
        .eq('meeting_id', meetingId)
        .eq('machine_id', machineId)

      revalidatePath(`/meetings/${meetingId}`)
    }

    revalidatePath('/sales-plan')
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

// === ИТОГИ / ЗАДАЧИ ===
export async function addActionItem(meetingId: string, data: AddActionItemInput) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { data: actionData, error } = await db.from('meeting_action_items').insert({
      meeting_id: meetingId,
      title: data.title,
      description: data.description?.trim() || null,
      responsible_user_id: data.responsible_user_id,
      deadline: data.deadline,
      status: 'open'
    })
      .select('id')
      .single()

    if (error) throw error

    const actionItem = actionData as { id: string } | null
    const { data: taskData, error: taskError } = await db.from('tasks').insert({
      related_meeting_id: meetingId,
      assigned_to: data.responsible_user_id,
      task_type: 'meeting_action_item',
      title: data.title,
      description: data.description?.trim() || null,
      status: 'pending',
      deadline: data.deadline,
    })
      .select('id')
      .single()

    if (taskError) {
      if (actionItem?.id) await db.from('meeting_action_items').delete().eq('id', actionItem.id)
      throw taskError
    }

    const task = taskData as { id: string } | null
    if (actionItem?.id && task?.id) {
      const { error: linkError } = await db
        .from('meeting_action_items')
        .update({ related_task_id: task.id })
        .eq('id', actionItem.id)

      if (linkError) throw linkError
    }

    await dispatchPendingTelegramDeliveries({ userId: data.responsible_user_id })

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function toggleActionItem(id: string, meetingId: string, currentStatus: string) {
  try {
    const { db } = await requireAuth()
    const nextStatus = currentStatus === 'open' ? 'done' : 'open'
    const { error } = await db.from('meeting_action_items')
      .update({ status: nextStatus })
      .eq('id', id)
    if (error) throw error

    const { data: actionData } = await db
      .from('meeting_action_items')
      .select('related_task_id')
      .eq('id', id)
      .single()

    const action = actionData as { related_task_id: string | null } | null
    if (action?.related_task_id) {
      const { error: taskError } = await db
        .from('tasks')
        .update({
          status: nextStatus === 'done' ? 'completed' : 'pending',
          completed_at: nextStatus === 'done' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', action.related_task_id)

      if (taskError) throw taskError
    }

    revalidatePath(`/meetings/${meetingId}`)
    revalidatePath('/tasks')
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

// === УЧАСТНИКИ ===
export async function addAttendee(meetingId: string, userId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error } = await db.from('meeting_attendees').insert({
      meeting_id: meetingId,
      user_id: userId
    })

    if (error) {
      if (error.code === '23505') return { success: true, error: null }
      throw error
    }
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function removeAttendee(meetingId: string, userId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    const { error } = await db.from('meeting_attendees').delete()
      .eq('meeting_id', meetingId)
      .eq('user_id', userId)
    if (error) throw error
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function addExternalAttendee(meetingId: string, data: AddExternalAttendeeInput) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')

    const { error } = await db.from('meeting_external_attendees').insert({
      meeting_id: meetingId,
      full_name: data.full_name,
      role_description: data.role_description || null,
      phone: data.phone || null,
      email: data.email || null
    })
    if (error) throw error
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function removeExternalAttendee(id: string, meetingId: string) {
  try {
    const { db, isDirector } = await requireAuth()
    if (!isDirector) throw new Error('Нет прав')
    const { error } = await db.from('meeting_external_attendees').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`/meetings/${meetingId}`)
    return { success: true, error: null }
  } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
}

export async function assignFactory(machineId: string, factoryId: string, materialType: string, meetingId?: string) {
  return assignFactoryDirectly(machineId, factoryId, materialType, meetingId)
}
