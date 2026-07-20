'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Employee,
  EmployeeAssignment,
  EmployeeRate,
  FactorySummary,
  ProductionFactSection,
  UserRole,
} from '@/lib/types'
import { planningDateRange, todayInUzhgorod } from '@/lib/people-planning/slots'
import type {
  PeoplePlanningActionResult,
  PeoplePlanningMachine,
  PeoplePlanningSection,
  PeoplePlanningView,
  PeoplePlanningWorkspace,
} from '@/lib/people-planning/types'

type DbError = { message?: string; details?: string; hint?: string; code?: string }
type DbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  gte: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}
type PeopleDb = { from: (table: string) => LooseQuery }
type PeopleRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>
}

function peopleDb(client: unknown) {
  return client as PeopleDb
}

const DIRECTORS: UserRole[] = ['financial_director', 'commercial_director', 'planning_director']
const ALLOWED_ROLES: UserRole[] = [...DIRECTORS, 'production_manager']
const uuid = z.string().uuid()
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const employeeSchema = z.object({
  id: uuid.optional(),
  fullName: z.string().trim().min(2).max(160),
  factoryId: uuid,
  defaultSectionId: uuid.nullable().optional(),
  active: z.boolean().optional(),
})

const rateSchema = z.object({
  employeeId: uuid,
  sectionId: uuid,
  kgPerDay: z.coerce.number().positive().max(1_000_000),
  active: z.boolean().optional(),
})

const scheduleSchema = z.object({
  employeeId: uuid,
  machineId: uuid,
  sectionId: uuid,
  startDate: dateOnly,
  startHalf: z.union([z.literal(1), z.literal(2)]),
})

const assignmentUpdateSchema = z.object({
  id: uuid,
  employeeId: uuid,
  machineId: uuid,
  sectionId: uuid,
  workDate: dateOnly,
  half: z.union([z.literal(1), z.literal(2)]),
})

function isDirector(role: UserRole) {
  return DIRECTORS.includes(role)
}

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message || 'Проверьте заполнение полей'
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const dbError = error as { message?: string; details?: string; hint?: string; code?: string }
    if (dbError.code === '23505') return 'Этот сотрудник уже занят в выбранную половину дня'
    return [dbError.message, dbError.details, dbError.hint].filter(Boolean).join(' ')
  }
  return 'Неизвестная ошибка'
}

async function requirePeoplePlanning(operation: PermissionOperation = 'view') {
  const context = await requirePermission('production_fact', operation)
  if (!ALLOWED_ROLES.includes(context.role)) throw new Error('Нет доступа к планированию людей')
  if (context.role === 'production_manager' && !context.factoryId) {
    throw new Error('Для начальника производства не указан завод')
  }
  return context
}

function assertFactory(role: UserRole, userFactoryId: string | null, factoryId: string) {
  if (isDirector(role) || userFactoryId === factoryId) return
  throw new Error('Недостаточно прав для выбранного завода')
}

async function getEmployeeFactory(employeeId: string) {
  const { data, error } = await peopleDb(createAdminClient())
    .from('employees')
    .select('factory_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message || 'Сотрудник не найден')
  return (data as { factory_id: string }).factory_id
}

async function getAssignmentFactory(assignmentId: string) {
  const db = peopleDb(createAdminClient())
  const { data: assignment, error: assignmentError } = await db.from('employee_assignments')
    .select('employee_id')
    .eq('id', assignmentId)
    .maybeSingle()
  if (assignmentError || !assignment) throw new Error(assignmentError?.message || 'Назначение не найдено')
  return getEmployeeFactory((assignment as { employee_id: string }).employee_id)
}

export async function getPeoplePlanningWorkspace(input?: {
  factoryId?: string
  date?: string
  view?: PeoplePlanningView
}): Promise<PeoplePlanningWorkspace> {
  const context = await requirePeoplePlanning()
  const admin = peopleDb(createAdminClient())
  let factoryQuery = admin.from('factories').select('id, name').order('name')
  if (!isDirector(context.role)) factoryQuery = factoryQuery.eq('id', context.factoryId!)
  const { data: factoryRows, error: factoryError } = await factoryQuery
  if (factoryError) throw factoryError
  const factories = (factoryRows || []) as FactorySummary[]
  if (factories.length === 0) throw new Error('Нет доступных заводов')

  const selectedFactoryId = factories.some((factory) => factory.id === input?.factoryId)
    ? input!.factoryId!
    : (context.factoryId && factories.some((factory) => factory.id === context.factoryId)
      ? context.factoryId
      : factories[0].id)
  assertFactory(context.role, context.factoryId, selectedFactoryId)
  const selectedDate = dateOnly.safeParse(input?.date).success ? input!.date! : todayInUzhgorod()
  const view: PeoplePlanningView = input?.view === 'week' ? 'week' : 'day'
  const dates = planningDateRange(selectedDate, view)
  const endDate = dates.at(-1)!

  const [sectionsResult, employeesResult, machinesResult, assignmentsResult] = await Promise.all([
    admin.from('production_fact_sections').select('*')
      .eq('factory_id', selectedFactoryId).eq('is_active', true).is('archived_at', null)
      .order('sort_order').order('name'),
    admin.from('employees').select('*').eq('factory_id', selectedFactoryId).order('active', { ascending: false }).order('full_name'),
    admin.from('machines_with_totals')
      .select('id, name, factory_id, total_weight, production_month, production_queue_number, is_archived')
      .eq('factory_id', selectedFactoryId).eq('is_archived', false)
      .order('production_month', { ascending: false, nullsFirst: false })
      .order('production_queue_number', { ascending: true, nullsFirst: false })
      .order('name'),
    admin.from('employee_assignments').select('*')
      .gte('work_date', selectedDate).lte('work_date', endDate)
      .order('work_date').order('half'),
  ])
  if (sectionsResult.error) throw sectionsResult.error
  if (employeesResult.error) throw employeesResult.error
  if (machinesResult.error) throw machinesResult.error
  if (assignmentsResult.error) throw assignmentsResult.error

  const allSections = (sectionsResult.data || []) as ProductionFactSection[]
  const parentMap = new Map(allSections.filter((section) => !section.parent_id).map((section) => [section.id, section]))
  const sections: PeoplePlanningSection[] = allSections
    .filter((section) => section.parent_id && parentMap.has(section.parent_id))
    .map((section) => {
      const parentName = parentMap.get(section.parent_id!)!.name
      return { ...section, parentName, displayName: `${parentName} · ${section.name}` }
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.displayName.localeCompare(b.displayName, 'ru'))
  const machineRows = (machinesResult.data || []) as Array<{
    id: string
    name: string
    factory_id: string | null
    total_weight: number
    production_month: string | null
    production_queue_number: number | null
  }>
  const sectionIds = new Set(sections.map((section) => section.id))
  const employees = (employeesResult.data || []) as Employee[]
  const employeeIds = employees.map((employee) => employee.id)
  const assignments = ((assignmentsResult.data || []) as EmployeeAssignment[])
    .filter((assignment) => sectionIds.has(assignment.section_id) && employeeIds.includes(assignment.employee_id))

  const [ratesResult, confirmedResult] = await Promise.all([
    employeeIds.length > 0
      ? admin.from('employee_rates').select('*').in('employee_id', employeeIds).order('created_at')
      : Promise.resolve({ data: [] as EmployeeRate[], error: null }),
    admin.from('employee_assignments').select('machine_id, kg_planned')
      .eq('status', 'confirmed')
      .in('machine_id', machineRows.map((machine) => machine.id).length > 0
        ? machineRows.map((machine) => machine.id)
        : ['00000000-0000-0000-0000-000000000000']),
  ])
  if (ratesResult.error) throw ratesResult.error
  if (confirmedResult.error) throw confirmedResult.error
  const confirmedByMachine = new Map<string, number>()
  for (const row of (confirmedResult.data || []) as Array<{ machine_id: string; kg_planned: number }>) {
    confirmedByMachine.set(row.machine_id, (confirmedByMachine.get(row.machine_id) || 0) + Number(row.kg_planned || 0))
  }
  const machines: PeoplePlanningMachine[] = machineRows.map((machine) => {
    const totalWeightKg = Number(machine.total_weight || 0) * 1000
    const confirmedKg = confirmedByMachine.get(machine.id) || 0
    return {
      id: machine.id,
      name: machine.name,
      factoryId: machine.factory_id!,
      totalWeightKg,
      confirmedKg,
      progressPercent: totalWeightKg > 0 ? Math.round((confirmedKg / totalWeightKg) * 1000) / 10 : 0,
      productionMonth: machine.production_month,
      queueNumber: machine.production_queue_number,
    }
  })

  return {
    factories,
    selectedFactoryId,
    selectedDate,
    view,
    dates,
    sections,
    employees,
    rates: (ratesResult.data || []) as EmployeeRate[],
    assignments,
    machines,
    isDirector: isDirector(context.role),
  }
}

export async function saveEmployeeAction(input: z.input<typeof employeeSchema>): Promise<PeoplePlanningActionResult<Employee>> {
  try {
    const context = await requirePeoplePlanning('manage')
    const parsed = employeeSchema.parse(input)
    assertFactory(context.role, context.factoryId, parsed.factoryId)
    const admin = peopleDb(createAdminClient())
    const payload = {
      full_name: parsed.fullName,
      factory_id: parsed.factoryId,
      default_section_id: parsed.defaultSectionId || null,
      active: parsed.active ?? true,
      updated_by: context.userId,
    }
    const query = parsed.id
      ? admin.from('employees').update(payload).eq('id', parsed.id).eq('factory_id', parsed.factoryId)
      : admin.from('employees').insert({ ...payload, created_by: context.userId })
    const { data, error } = await query.select('*').single()
    if (error) throw error
    revalidatePath(ROUTES.PRODUCTION_PEOPLE)
    return { success: true, data: data as Employee, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function saveEmployeeRateAction(input: z.input<typeof rateSchema>): Promise<PeoplePlanningActionResult<EmployeeRate>> {
  try {
    const context = await requirePeoplePlanning('manage')
    const parsed = rateSchema.parse(input)
    const factoryId = await getEmployeeFactory(parsed.employeeId)
    assertFactory(context.role, context.factoryId, factoryId)
    const { data, error } = await peopleDb(createAdminClient()).from('employee_rates').upsert({
      employee_id: parsed.employeeId,
      section_id: parsed.sectionId,
      kg_per_day: parsed.kgPerDay,
      active: parsed.active ?? true,
    }, { onConflict: 'employee_id,section_id' }).select('*').single()
    if (error) throw error
    revalidatePath(ROUTES.PRODUCTION_PEOPLE)
    return { success: true, data: data as EmployeeRate, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function scheduleEmployeeAction(input: z.input<typeof scheduleSchema>): Promise<PeoplePlanningActionResult<EmployeeAssignment[]>> {
  try {
    const context = await requirePeoplePlanning('manage')
    const parsed = scheduleSchema.parse(input)
    const factoryId = await getEmployeeFactory(parsed.employeeId)
    assertFactory(context.role, context.factoryId, factoryId)
    const { data, error } = await (context.supabase as unknown as PeopleRpc).rpc('fn_people_schedule_assignment', {
      p_employee_id: parsed.employeeId,
      p_machine_id: parsed.machineId,
      p_section_id: parsed.sectionId,
      p_start_date: parsed.startDate,
      p_start_half: parsed.startHalf,
    })
    if (error) throw error
    revalidatePath(ROUTES.PRODUCTION_PEOPLE)
    return { success: true, data: (data || []) as EmployeeAssignment[], error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function confirmEmployeeAssignmentAction(id: string): Promise<PeoplePlanningActionResult<EmployeeAssignment>> {
  try {
    const context = await requirePeoplePlanning('manage')
    const assignmentId = uuid.parse(id)
    const { data, error } = await (context.supabase as unknown as PeopleRpc).rpc('fn_people_confirm_assignment', { p_assignment_id: assignmentId })
    if (error) throw error
    revalidatePath(ROUTES.PRODUCTION_PEOPLE)
    return { success: true, data: data as EmployeeAssignment, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function updateEmployeeAssignmentAction(input: z.input<typeof assignmentUpdateSchema>): Promise<PeoplePlanningActionResult<EmployeeAssignment>> {
  try {
    const context = await requirePeoplePlanning('manage')
    const parsed = assignmentUpdateSchema.parse(input)
    const [sourceFactoryId, targetFactoryId] = await Promise.all([
      getAssignmentFactory(parsed.id),
      getEmployeeFactory(parsed.employeeId),
    ])
    assertFactory(context.role, context.factoryId, sourceFactoryId)
    assertFactory(context.role, context.factoryId, targetFactoryId)
    const { data, error } = await peopleDb(createAdminClient()).from('employee_assignments').update({
      employee_id: parsed.employeeId,
      machine_id: parsed.machineId,
      section_id: parsed.sectionId,
      work_date: parsed.workDate,
      half: parsed.half,
      updated_by: context.userId,
    }).eq('id', parsed.id).select('*').single()
    if (error) throw error
    revalidatePath(ROUTES.PRODUCTION_PEOPLE)
    return { success: true, data: data as EmployeeAssignment, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}
