'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { TASKS_LIST_LIMIT } from '@/lib/constants/performance-limits'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import type { ProductProject, ProductProjectFile, ProductProjectVersion, Task, TaskDelegation, TaskDelegationStatus, TaskStatus, TaskType, UserRole } from '@/lib/types'

type DbResult = {
  data: unknown
  error: { message?: string } | null
}

type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
}

type LooseSupabaseClient = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
  auth: Awaited<ReturnType<typeof createServerSupabaseClient>>['auth']
}

export type TaskFilters = {
  machine_id?: string
  product_project_id?: string
  assigned_to?: string
  status?: TaskStatus
  statuses?: TaskStatus[]
  task_type?: TaskType
  limit?: number
}

export type TaskWithRelations = Task & {
  machine: { id: string; name: string; factory_id: string | null; is_archived?: boolean | null } | null
  product_project: { id: string; title: string; status: ProductProject['status'] } | null
  assigned_user: { id: string; full_name: string } | null
  pending_delegation?: TaskDelegationSummary | null
  can_delegate?: boolean
}

export type TaskDelegationSummary = Pick<
  TaskDelegation,
  | 'id'
  | 'task_id'
  | 'delegated_by'
  | 'delegated_from'
  | 'delegated_to'
  | 'department_id'
  | 'status'
  | 'note'
  | 'decline_reason'
  | 'delegated_at'
  | 'responded_at'
> & {
  delegated_by_user?: { id: string; full_name: string } | null
  delegated_from_user?: { id: string; full_name: string } | null
  delegated_to_user?: { id: string; full_name: string } | null
  department?: { id: string; name: string } | null
}

export type TaskDelegationWithTask = TaskDelegationSummary & {
  task: TaskWithRelations | null
}

export type TaskDelegationCandidate = {
  membership_id: string
  user_id: string
  full_name: string
  email: string | null
  department_id: string
  department_name: string
  position_name: string | null
  position_level: number | null
}

export type CuttingRollbackPreview = {
  canRollback: boolean
  blockers: string[]
  eventCount: number
  stage: {
    currentDateStart: string | null
    afterDateStart: string | null
  }
  reservations: {
    count: number
    quantity: number
  }
  scrap: {
    count: number
    reservedCount: number
    deletedCount: number
  }
}

const DIRECTOR_ROLES: UserRole[] = [
  'financial_director',
  'commercial_director',
  'planning_director',
]
const CUTTING_ROLLBACK_TASK_TYPE = 'production_cutting_rollback_review' as const

async function getCurrentUser() {
  const { supabase, userId, user, role, factoryId } = await getCurrentUserContext()
  return { supabase, userId, user, role, factoryId }
}

function getAdminTaskDb() {
  return createAdminClient() as unknown as LooseSupabaseClient
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function isActiveTaskStatus(status: TaskStatus) {
  return status === 'pending' || status === 'in_progress'
}

function isOpenDelegationStatus(status: TaskDelegationStatus) {
  return status === 'pending'
}

function filterVisibleMachineTasks(tasks: TaskWithRelations[], role: UserRole, factoryId: string | null) {
  if (role !== 'production_manager') return tasks

  return tasks.filter((task) => {
    if (!task.machine_id) return true
    if (!task.machine) return false
    return task.machine.factory_id === null || task.machine.factory_id === factoryId
  })
}

type HeadDepartmentRow = {
  department_id: string
  department?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
}

type CandidateMembershipRow = {
  id: string
  user_id: string
  department_id: string
  user?: { id: string; full_name: string | null; email: string | null; is_active: boolean | null } | { id: string; full_name: string | null; email: string | null; is_active: boolean | null }[] | null
  department?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
  position?: { id: string; name: string | null; level: number | null } | { id: string; name: string | null; level: number | null }[] | null
}

type DelegationQueryRow = TaskDelegation & {
  task?: TaskWithRelations | TaskWithRelations[] | null
  delegated_by_user?: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null
  delegated_from_user?: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null
  delegated_to_user?: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null
  department?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
}

async function getHeadDepartments(db: LooseSupabaseClient, userId: string) {
  const { data, error } = await db
    .from('department_members')
    .select('department_id, department:departments!inner(id, name, is_active)')
    .eq('user_id', userId)
    .eq('is_department_head', true)
    .eq('department.is_active', true)

  if (error) throw new Error(error.message || 'Не удалось проверить отделы руководителя')
  return (Array.isArray(data) ? data : []) as HeadDepartmentRow[]
}

function normalizeDelegationSummary(row: DelegationQueryRow): TaskDelegationSummary {
  const delegatedByUser = relationOne(row.delegated_by_user)
  const delegatedFromUser = relationOne(row.delegated_from_user)
  const delegatedToUser = relationOne(row.delegated_to_user)
  const department = relationOne(row.department)

  return {
    id: row.id,
    task_id: row.task_id,
    delegated_by: row.delegated_by,
    delegated_from: row.delegated_from,
    delegated_to: row.delegated_to,
    department_id: row.department_id,
    status: row.status,
    note: row.note,
    decline_reason: row.decline_reason,
    delegated_at: row.delegated_at,
    responded_at: row.responded_at,
    delegated_by_user: delegatedByUser ? { id: delegatedByUser.id, full_name: delegatedByUser.full_name || 'Руководитель' } : null,
    delegated_from_user: delegatedFromUser ? { id: delegatedFromUser.id, full_name: delegatedFromUser.full_name || 'Руководитель' } : null,
    delegated_to_user: delegatedToUser ? { id: delegatedToUser.id, full_name: delegatedToUser.full_name || 'Сотрудник' } : null,
    department: department ? { id: department.id, name: department.name || 'Отдел' } : null,
  }
}

async function getPendingDelegationsForTaskIds(db: LooseSupabaseClient, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, TaskDelegationSummary>()

  const { data, error } = await db
    .from('task_delegations')
    .select(`
      *,
      delegated_by_user:users!task_delegations_delegated_by_fkey(id, full_name),
      delegated_from_user:users!task_delegations_delegated_from_fkey(id, full_name),
      delegated_to_user:users!task_delegations_delegated_to_fkey(id, full_name),
      department:departments(id, name)
    `)
    .in('task_id', taskIds)
    .eq('status', 'pending')

  if (error) throw new Error(error.message || 'Не удалось проверить делегирование задач')

  const delegationsByTaskId = new Map<string, TaskDelegationSummary>()
  for (const row of (Array.isArray(data) ? data : []) as DelegationQueryRow[]) {
    delegationsByTaskId.set(row.task_id, normalizeDelegationSummary(row))
  }
  return delegationsByTaskId
}

async function getPendingDelegationForTask(db: LooseSupabaseClient, taskId: string) {
  const delegations = await getPendingDelegationsForTaskIds(db, [taskId])
  return delegations.get(taskId) || null
}

async function enrichTasksWithDelegationState(
  tasks: TaskWithRelations[],
  userId: string,
  role: UserRole,
  factoryId: string | null,
) {
  const visibleTasks = filterVisibleMachineTasks(tasks, role, factoryId)
  if (visibleTasks.length === 0) return visibleTasks

  const adminDb = getAdminTaskDb()
  const [headDepartments, pendingDelegations] = await Promise.all([
    getHeadDepartments(adminDb, userId),
    getPendingDelegationsForTaskIds(adminDb, visibleTasks.map((task) => task.id)),
  ])
  const canDelegateFromAnyDepartment = headDepartments.length > 0

  return visibleTasks.map((task) => {
    const pendingDelegation = pendingDelegations.get(task.id) || null
    return {
      ...task,
      pending_delegation: pendingDelegation,
      can_delegate: (
        task.assigned_to === userId &&
        isActiveTaskStatus(task.status) &&
        !pendingDelegation &&
        canDelegateFromAnyDepartment
      ),
    }
  })
}

async function notifyTechnologistsAboutDrawingConfirmation(db: LooseSupabaseClient, machineId: string | null, machineName?: string | null) {
  if (!machineId) return

  const message = machineName
    ? `Инженер подтвердил чертежи по машине "${machineName}". Можно готовить заявку технолога.`
    : 'Инженер подтвердил чертежи по машине. Можно готовить заявку технолога.'

  const { error } = await db.rpc('notify_users_by_role', {
    p_role: 'technologist',
    p_type: 'task_completed',
    p_title: 'Чертежи подтверждены',
    p_message: message,
    p_machine_id: machineId,
  })

  if (error) throw new Error(error.message || 'Не удалось создать уведомление технологу')

  await dispatchPendingTelegramDeliveries({ machineId })
  revalidatePath(ROUTES.NOTIFICATIONS)
}

async function hasSubmittedTechnologistRequest(db: LooseSupabaseClient, machineId: string | null) {
  if (!machineId) return false

  const { data, error } = await db
    .from('technologist_requests')
    .select('id')
    .eq('machine_id', machineId)
    .in('status', ['submitted_to_supply', 'completed'])

  if (error) throw new Error(error.message || 'Не удалось проверить заявку технолога')
  return ((data || []) as { id: string }[]).length > 0
}

class TaskBusinessError extends Error {
  code?: string
  projectId?: string

  constructor(message: string, code?: string, projectId?: string) {
    super(message)
    this.name = 'TaskBusinessError'
    this.code = code
    this.projectId = projectId
  }
}

function normalizeCuttingRollbackPreview(value: unknown): CuttingRollbackPreview {
  const record = (value || {}) as Record<string, unknown>
  const stage = (record.stage || {}) as Record<string, unknown>
  const reservations = (record.reservations || {}) as Record<string, unknown>
  const scrap = (record.scrap || {}) as Record<string, unknown>
  return {
    canRollback: Boolean(record.canRollback),
    blockers: Array.isArray(record.blockers) ? record.blockers.map(String) : [],
    eventCount: Number(record.eventCount || 0),
    stage: {
      currentDateStart: typeof stage.currentDateStart === 'string' ? stage.currentDateStart : null,
      afterDateStart: typeof stage.afterDateStart === 'string' ? stage.afterDateStart : null,
    },
    reservations: {
      count: Number(reservations.count || 0),
      quantity: Number(reservations.quantity || 0),
    },
    scrap: {
      count: Number(scrap.count || 0),
      reservedCount: Number(scrap.reservedCount || 0),
      deletedCount: Number(scrap.deletedCount || 0),
    },
  }
}

async function getCuttingRollbackTaskForUser(db: LooseSupabaseClient, taskId: string, userId: string, role: UserRole, factoryId: string | null) {
  const { data: task, error } = await db
    .from('tasks')
    .select('id, assigned_to, machine_id, task_type, status, machine:machines(id, name, factory_id)')
    .eq('id', taskId)
    .single()

  if (error || !task) throw new Error('Задача не найдена')
  const taskRow = task as unknown as {
    id: string
    assigned_to: string
    machine_id: string | null
    task_type: TaskType
    status: TaskStatus
    machine: { id: string; name: string | null; factory_id: string | null } | null
  }

  if (taskRow.task_type !== CUTTING_ROLLBACK_TASK_TYPE) throw new Error('Это не задача отката заготовки')
  if (!taskRow.machine_id) throw new Error('Задача не привязана к машине')

  const canUpdate = taskRow.assigned_to === userId || DIRECTOR_ROLES.includes(role)
  if (!canUpdate) throw new Error('Недостаточно прав для изменения задачи')
  if (
    role === 'production_manager' &&
    (!taskRow.machine || (taskRow.machine.factory_id !== null && taskRow.machine.factory_id !== factoryId))
  ) {
    throw new Error('Задача относится к машине другого завода')
  }

  const pendingDelegation = await getPendingDelegationForTask(getAdminTaskDb(), taskId)
  if (pendingDelegation) {
    throw new Error('Задача ожидает принятия после делегирования. Сначала отмените делегирование или дождитесь ответа сотрудника.')
  }

  return taskRow
}

function revalidateCuttingRollbackTaskPaths(machineId: string | null) {
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.PRODUCTION)
  revalidatePath(ROUTES.GANTT)
  revalidatePath(ROUTES.PRODUCTION_FACT)
  revalidatePath(ROUTES.INVENTORY)
  if (machineId) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
}

function datePlusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function drawingNumberFromFileName(name: string) {
  return name.replace(/\.[^/.]+$/, '').trim()
}

async function loadLatestProjectVersion(db: LooseSupabaseClient, projectId: string) {
  const { data, error } = await db
    .from('product_project_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message || 'Не удалось загрузить версию проекта')
  const version = ((data || []) as ProductProjectVersion[])[0]
  if (!version) throw new TaskBusinessError('Версия проекта не найдена')
  return version
}

async function getProjectVersionFiles(db: LooseSupabaseClient, projectId: string, versionId: string) {
  const { data, error } = await db
    .from('product_project_files')
    .select('*')
    .eq('project_id', projectId)

  if (error) throw new Error(error.message || 'Не удалось загрузить файлы проекта')
  return ((data || []) as ProductProjectFile[]).filter((file) => !file.version_id || file.version_id === versionId)
}

async function validateProjectEngineeringDeliverables(db: LooseSupabaseClient, projectId: string) {
  const version = await loadLatestProjectVersion(db, projectId)
  const files = await getProjectVersionFiles(db, projectId, version.id)
  const drawingFile = files.find((file) => file.file_kind === 'drawing')
  const photoFile = files.find((file) => file.file_kind === 'photo')
  const missing: string[] = []

  if (!drawingFile) missing.push('чертеж')
  if (!photoFile) missing.push('фото изделия')
  if (!Number(version.unit_weight_kg || 0)) missing.push('вес изделия')

  if (missing.length > 0) {
    throw new TaskBusinessError(
      `Нельзя завершить задачу: заполните ${missing.join(', ')}.`,
      'PROJECT_DELIVERABLES_REQUIRED',
      projectId,
    )
  }

  if (!version.drawing_number && drawingFile) {
    const { error } = await db
      .from('product_project_versions')
      .update({ drawing_number: drawingNumberFromFileName(drawingFile.file_name) })
      .eq('id', version.id)
    if (error) throw new Error(error.message || 'Не удалось записать номер чертежа')
    version.drawing_number = drawingNumberFromFileName(drawingFile.file_name)
  }

  return version
}

async function ensureSalesReviewTask(
  db: LooseSupabaseClient,
  projectId: string,
  projectTitle: string,
  assignedTo: string,
) {
  const { data: existing, error: existingError } = await db
    .from('tasks')
    .select('id')
    .eq('product_project_id', projectId)
    .eq('task_type', 'product_project_sales_review')
    .in('status', ['pending', 'in_progress'])
    .limit(1)

  if (existingError) throw new Error(existingError.message || 'Не удалось проверить задачи проекта')
  if (((existing || []) as Array<{ id: string }>).length > 0) return

  const { error } = await db.from('tasks').insert({
    product_project_id: projectId,
    machine_id: null,
    assigned_to: assignedTo,
    task_type: 'product_project_sales_review',
    title: `Согласовать изделие с клиентом: ${projectTitle}`,
    description: 'Заполните цену, украинское и английское название, УКТЗЕД и утвердите модель с клиентом.',
    status: 'pending',
    start_date: new Date().toISOString().slice(0, 10),
    deadline: datePlusDays(1),
  })
  if (error) throw new Error(error.message || 'Не удалось создать задачу менеджеру')
}

async function finishProjectEngineering(
  db: LooseSupabaseClient,
  project: Pick<ProductProject, 'id' | 'title' | 'created_by'>,
  version: ProductProjectVersion,
  fallbackUserId: string,
) {
  const now = new Date().toISOString()
  const { error: versionError } = await db
    .from('product_project_versions')
    .update({ status: 'client_review' })
    .eq('id', version.id)
  if (versionError) throw new Error(versionError.message || 'Не удалось обновить версию проекта')

  const { error: projectError } = await db
    .from('product_projects')
    .update({ status: 'client_review', updated_at: now })
    .eq('id', project.id)
  if (projectError) throw new Error(projectError.message || 'Не удалось обновить статус проекта')

  await ensureSalesReviewTask(db, project.id, project.title, project.created_by || fallbackUserId)
}

async function createPlanningDirectorReasonTasks(
  db: LooseSupabaseClient,
  machineId: string,
  machineName: string | null | undefined,
  reason: string,
) {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('role', 'planning_director')
    .eq('is_active', true)

  if (error) throw new Error(error.message || 'Не удалось загрузить директоров планирования')

  const deadline = new Date().toISOString().slice(0, 10)
  const machineLabel = machineName || 'машине'

  for (const director of (data || []) as { id: string }[]) {
    const { error: insertError } = await db.from('tasks').insert({
      machine_id: machineId,
      assigned_to: director.id,
      task_type: 'technologist_request_exception',
      title: `Ознакомиться с причиной отсутствия заявки: ${machineLabel}`,
      description: `Технолог завершил задачу без передачи заявки в снабжение.\n\nПричина: ${reason}`,
      status: 'pending',
      deadline,
    })

    if (insertError && !String(insertError.message || '').includes('duplicate key')) {
      throw new Error(insertError.message || 'Не удалось создать задачу директору планирования')
    }
  }
}

export async function getTasks(filters: TaskFilters = {}) {
  const { supabase, userId, role, factoryId } = await getCurrentUser()
  const db = supabase as unknown as LooseSupabaseClient

  let query = db
    .from('tasks')
    .select(`
      *,
      machine:machines(id, name, factory_id, is_archived),
      product_project:product_projects(id, title, status),
      assigned_user:users!tasks_assigned_to_fkey(id, full_name)
    `)
    .order('deadline', { ascending: true })
    .order('created_at', { ascending: true })

  if (filters.machine_id) query = query.eq('machine_id', filters.machine_id)
  if (filters.product_project_id) query = query.eq('product_project_id', filters.product_project_id)
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.statuses?.length) query = query.in('status', filters.statuses)
  if (filters.task_type) query = query.eq('task_type', filters.task_type)
  if (filters.limit) query = query.limit(filters.limit)

  const { data, error } = await query
  if (error) return { data: null, error: error.message }

  return {
    data: await enrichTasksWithDelegationState((data || []) as unknown as TaskWithRelations[], userId, role, factoryId),
    error: null,
  }
}

export async function getMyTasks() {
  const { supabase, userId, role, factoryId } = await getCurrentUser()
  const db = supabase as unknown as LooseSupabaseClient

  const { data, error } = await db
    .from('tasks')
    .select(`
      *,
      machine:machines(id, name, factory_id, is_archived),
      product_project:product_projects(id, title, status),
      assigned_user:users!tasks_assigned_to_fkey(id, full_name)
    `)
    .eq('assigned_to', userId)
    .in('status', ['pending', 'in_progress'])
    .order('deadline', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(TASKS_LIST_LIMIT)

  if (error) return { data: null, error: error.message }

  return {
    data: await enrichTasksWithDelegationState((data || []) as unknown as TaskWithRelations[], userId, role, factoryId),
    error: null,
  }
}

export async function getTasksByMachine(machineId: string) {
  return getTasks({ machine_id: machineId })
}

function normalizeCandidate(row: CandidateMembershipRow): TaskDelegationCandidate | null {
  const user = relationOne(row.user)
  const department = relationOne(row.department)
  const position = relationOne(row.position)
  if (!user || user.is_active === false) return null

  return {
    membership_id: row.id,
    user_id: row.user_id,
    full_name: user.full_name || 'Сотрудник',
    email: user.email || null,
    department_id: row.department_id,
    department_name: department?.name || 'Отдел',
    position_name: position?.name || null,
    position_level: typeof position?.level === 'number' ? position.level : null,
  }
}

async function getCandidatesForHeadDepartments(
  db: LooseSupabaseClient,
  currentUserId: string,
  departmentIds: string[],
) {
  if (departmentIds.length === 0) return []

  const { data, error } = await db
    .from('department_members')
    .select(`
      id,
      user_id,
      department_id,
      user:users!department_members_user_id_fkey!inner(id, full_name, email, is_active),
      department:departments!inner(id, name, is_active),
      position:positions(id, name, level)
    `)
    .in('department_id', departmentIds)
    .eq('user.is_active', true)
    .eq('department.is_active', true)

  if (error) throw new Error(error.message || 'Не удалось загрузить сотрудников отдела')

  return ((Array.isArray(data) ? data : []) as CandidateMembershipRow[])
    .map(normalizeCandidate)
    .filter((candidate): candidate is TaskDelegationCandidate => Boolean(candidate && candidate.user_id !== currentUserId))
    .sort((left, right) => {
      const departmentCompare = left.department_name.localeCompare(right.department_name, 'ru')
      if (departmentCompare !== 0) return departmentCompare
      const levelCompare = (right.position_level ?? -1) - (left.position_level ?? -1)
      if (levelCompare !== 0) return levelCompare
      return left.full_name.localeCompare(right.full_name, 'ru')
    })
}

async function assertTaskCanBeDelegated(db: LooseSupabaseClient, taskId: string, userId: string) {
  const { data, error } = await db
    .from('tasks')
    .select('id, title, assigned_to, status, machine_id, product_project_id')
    .eq('id', taskId)
    .single()

  if (error || !data) throw new Error('Задача не найдена')

  const task = data as Pick<Task, 'id' | 'title' | 'assigned_to' | 'status' | 'machine_id' | 'product_project_id'>
  if (task.assigned_to !== userId) throw new Error('Делегировать можно только задачу, назначенную вам')
  if (!isActiveTaskStatus(task.status)) throw new Error('Завершённые и отменённые задачи нельзя делегировать')

  const pendingDelegation = await getPendingDelegationForTask(db, taskId)
  if (pendingDelegation) throw new Error('По задаче уже есть делегирование, ожидающее ответа')

  return task
}

async function assertDelegationCandidate(
  db: LooseSupabaseClient,
  currentUserId: string,
  delegatedTo: string,
  departmentId: string,
) {
  const headDepartments = await getHeadDepartments(db, currentUserId)
  const headDepartmentIds = new Set(headDepartments.map((membership) => membership.department_id))
  if (!headDepartmentIds.has(departmentId)) {
    throw new Error('Выберите сотрудника из отдела, где вы являетесь начальником')
  }

  const { data, error } = await db
    .from('department_members')
    .select(`
      id,
      user_id,
      department_id,
      user:users!department_members_user_id_fkey!inner(id, full_name, email, is_active),
      department:departments!inner(id, name, is_active),
      position:positions(id, name, level)
    `)
    .eq('department_id', departmentId)
    .eq('user_id', delegatedTo)
    .eq('user.is_active', true)
    .eq('department.is_active', true)

  if (error) throw new Error(error.message || 'Не удалось проверить сотрудника отдела')

  const candidate = ((Array.isArray(data) ? data : []) as CandidateMembershipRow[])
    .map(normalizeCandidate)
    .find((item): item is TaskDelegationCandidate => Boolean(item && item.user_id !== currentUserId))

  if (!candidate) throw new Error('Сотрудник не найден в вашем отделе или неактивен')
  return candidate
}

async function createDelegationNotification(
  db: LooseSupabaseClient,
  input: {
    userId: string
    type: string
    title: string
    message: string
    machineId: string | null
  },
) {
  const { error } = await db.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    related_machine_id: input.machineId,
  })

  if (error) throw new Error(error.message || 'Не удалось создать уведомление')
}

function revalidateTaskDelegationPaths(task: Pick<Task, 'machine_id' | 'product_project_id'> | null) {
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
  if (task?.machine_id) revalidatePath(`${ROUTES.SALES_PLAN}/${task.machine_id}`)
  if (task?.product_project_id) revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${task.product_project_id}`)
}

function normalizeDelegationWithTask(row: DelegationQueryRow): TaskDelegationWithTask {
  const summary = normalizeDelegationSummary(row)
  const task = relationOne(row.task)
  return {
    ...summary,
    task: task ? { ...task, pending_delegation: summary, can_delegate: false } : null,
  }
}

async function getDelegationById(db: LooseSupabaseClient, delegationId: string) {
  const { data, error } = await db
    .from('task_delegations')
    .select(`
      *,
      task:tasks(
        *,
        machine:machines(id, name, factory_id, is_archived),
        product_project:product_projects(id, title, status),
        assigned_user:users!tasks_assigned_to_fkey(id, full_name)
      ),
      delegated_by_user:users!task_delegations_delegated_by_fkey(id, full_name),
      delegated_from_user:users!task_delegations_delegated_from_fkey(id, full_name),
      delegated_to_user:users!task_delegations_delegated_to_fkey(id, full_name),
      department:departments(id, name)
    `)
    .eq('id', delegationId)
    .single()

  if (error || !data) throw new Error('Делегирование не найдено')
  return normalizeDelegationWithTask(data as DelegationQueryRow)
}

export async function getDelegationCandidates(taskId: string): Promise<{ data: TaskDelegationCandidate[] | null; error: string | null }> {
  try {
    const { userId } = await getCurrentUser()
    const db = getAdminTaskDb()

    await assertTaskCanBeDelegated(db, taskId, userId)
    const headDepartments = await getHeadDepartments(db, userId)
    const candidates = await getCandidatesForHeadDepartments(
      db,
      userId,
      Array.from(new Set(headDepartments.map((membership) => membership.department_id))),
    )

    return { data: candidates, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить сотрудников для делегирования' }
  }
}

export async function getTaskDelegationOverview(): Promise<{
  data: { incoming: TaskDelegationWithTask[]; outgoing: TaskDelegationWithTask[] } | null
  error: string | null
}> {
  try {
    const { userId, role, factoryId } = await getCurrentUser()
    const db = getAdminTaskDb()
    const select = `
      *,
      task:tasks(
        *,
        machine:machines(id, name, factory_id, is_archived),
        product_project:product_projects(id, title, status),
        assigned_user:users!tasks_assigned_to_fkey(id, full_name)
      ),
      delegated_by_user:users!task_delegations_delegated_by_fkey(id, full_name),
      delegated_from_user:users!task_delegations_delegated_from_fkey(id, full_name),
      delegated_to_user:users!task_delegations_delegated_to_fkey(id, full_name),
      department:departments(id, name)
    `

    const [incomingResult, outgoingResult] = await Promise.all([
      db
        .from('task_delegations')
        .select(select)
        .eq('delegated_to', userId)
        .eq('status', 'pending')
        .order('delegated_at', { ascending: false }),
      db
        .from('task_delegations')
        .select(select)
        .eq('delegated_by', userId)
        .in('status', ['pending', 'accepted', 'declined', 'cancelled'])
        .order('delegated_at', { ascending: false })
        .limit(20),
    ])

    if (incomingResult.error) throw new Error(incomingResult.error.message || 'Не удалось загрузить входящие делегирования')
    if (outgoingResult.error) throw new Error(outgoingResult.error.message || 'Не удалось загрузить исходящие делегирования')

    const isVisible = (item: TaskDelegationWithTask) => {
      if (!item.task) return false
      return filterVisibleMachineTasks([item.task], role, factoryId).length > 0
    }

    return {
      data: {
        incoming: ((incomingResult.data || []) as DelegationQueryRow[]).map(normalizeDelegationWithTask).filter(isVisible),
        outgoing: ((outgoingResult.data || []) as DelegationQueryRow[]).map(normalizeDelegationWithTask).filter(isVisible),
      },
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить делегированные задачи',
    }
  }
}

export async function delegateTask(input: {
  taskId: string
  delegatedTo: string
  departmentId: string
  note?: string
}) {
  try {
    const { userId, user } = await getCurrentUser()
    const db = getAdminTaskDb()
    const task = await assertTaskCanBeDelegated(db, input.taskId, userId)
    const candidate = await assertDelegationCandidate(db, userId, input.delegatedTo, input.departmentId)
    const note = input.note?.trim() || null

    const { error } = await db.from('task_delegations').insert({
      task_id: task.id,
      delegated_by: userId,
      delegated_from: task.assigned_to,
      delegated_to: candidate.user_id,
      department_id: candidate.department_id,
      status: 'pending',
      note,
    })

    if (error) throw new Error(error.message || 'Не удалось делегировать задачу')

    const message = [
      `${user.full_name || 'Руководитель'} делегировал вам задачу: ${task.title}.`,
      note ? `Комментарий: ${note}` : null,
      'Откройте задачи и нажмите "Принять", чтобы взять её в работу.',
    ].filter(Boolean).join('\n')

    await createDelegationNotification(db, {
      userId: candidate.user_id,
      type: 'task_delegation_request',
      title: 'Задача на принятие',
      message,
      machineId: task.machine_id,
    })
    await dispatchPendingTelegramDeliveries({ userId: candidate.user_id })
    revalidateTaskDelegationPaths(task)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось делегировать задачу',
    }
  }
}

export async function acceptTaskDelegation(delegationId: string) {
  try {
    const { userId } = await getCurrentUser()
    const db = getAdminTaskDb()
    const delegation = await getDelegationById(db, delegationId)
    if (!isOpenDelegationStatus(delegation.status)) throw new Error('Делегирование уже обработано')
    if (delegation.delegated_to !== userId) throw new Error('Принять можно только задачу, делегированную вам')
    if (!delegation.task) throw new Error('Задача не найдена')
    if (!isActiveTaskStatus(delegation.task.status)) throw new Error('Задача уже завершена или отменена')
    if (delegation.task.assigned_to !== delegation.delegated_from) {
      throw new Error('Ответственный по задаче уже изменился')
    }

    const { error: acceptError } = await db.rpc('accept_task_delegation', {
      p_delegation_id: delegation.id,
      p_user_id: userId,
    })

    if (acceptError) throw new Error(acceptError.message || 'Не удалось принять задачу')

    await createDelegationNotification(db, {
      userId: delegation.delegated_by,
      type: 'task_delegation_accepted',
      title: 'Делегирование принято',
      message: `${delegation.delegated_to_user?.full_name || 'Сотрудник'} принял задачу: ${delegation.task.title}.`,
      machineId: delegation.task.machine_id,
    })
    await dispatchPendingTelegramDeliveries({ userId })
    await dispatchPendingTelegramDeliveries({ userId: delegation.delegated_by })
    revalidateTaskDelegationPaths(delegation.task)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось принять задачу',
    }
  }
}

export async function declineTaskDelegation(delegationId: string, reason: string) {
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 3) {
    return { success: false, error: 'Укажите причину отказа' }
  }

  try {
    const { userId } = await getCurrentUser()
    const db = getAdminTaskDb()
    const delegation = await getDelegationById(db, delegationId)
    if (!isOpenDelegationStatus(delegation.status)) throw new Error('Делегирование уже обработано')
    if (delegation.delegated_to !== userId) throw new Error('Отказаться можно только от задачи, делегированной вам')
    if (!delegation.task) throw new Error('Задача не найдена')

    const now = new Date().toISOString()
    const { error } = await db
      .from('task_delegations')
      .update({
        status: 'declined',
        decline_reason: trimmedReason,
        responded_at: now,
      })
      .eq('id', delegation.id)

    if (error) throw new Error(error.message || 'Не удалось отказаться от задачи')

    await createDelegationNotification(db, {
      userId: delegation.delegated_by,
      type: 'task_delegation_declined',
      title: 'Делегирование отклонено',
      message: `${delegation.delegated_to_user?.full_name || 'Сотрудник'} отказался от задачи: ${delegation.task.title}.\nПричина: ${trimmedReason}`,
      machineId: delegation.task.machine_id,
    })
    await dispatchPendingTelegramDeliveries({ userId: delegation.delegated_by })
    revalidateTaskDelegationPaths(delegation.task)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось отказаться от задачи',
    }
  }
}

export async function cancelTaskDelegation(delegationId: string) {
  try {
    const { userId } = await getCurrentUser()
    const db = getAdminTaskDb()
    const delegation = await getDelegationById(db, delegationId)
    if (!isOpenDelegationStatus(delegation.status)) throw new Error('Делегирование уже обработано')
    if (delegation.delegated_by !== userId && delegation.delegated_from !== userId) {
      throw new Error('Отменить можно только своё делегирование')
    }
    if (!delegation.task) throw new Error('Задача не найдена')

    const { error } = await db
      .from('task_delegations')
      .update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
      })
      .eq('id', delegation.id)

    if (error) throw new Error(error.message || 'Не удалось отменить делегирование')

    await createDelegationNotification(db, {
      userId: delegation.delegated_to,
      type: 'task_delegation_cancelled',
      title: 'Делегирование отменено',
      message: `Делегирование задачи отменено: ${delegation.task.title}.`,
      machineId: delegation.task.machine_id,
    })
    await dispatchPendingTelegramDeliveries({ userId: delegation.delegated_to })
    revalidateTaskDelegationPaths(delegation.task)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось отменить делегирование',
    }
  }
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const allowedStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'cancelled']
  if (!allowedStatuses.includes(status)) {
    return { success: false, error: 'Некорректный статус задачи' }
  }

  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient

    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select(`
        id,
        assigned_to,
        machine_id,
        product_project_id,
        task_type,
        status,
        machine:machines(id, name, factory_id),
        product_project:product_projects(id, title, status, created_by)
      `)
      .eq('id', taskId)
      .single()

    if (fetchError || !task) throw new Error('Задача не найдена')
    const taskRow = task as unknown as {
      assigned_to: string
      machine_id: string | null
      product_project_id: string | null
      task_type: TaskType
      status: TaskStatus
      machine: { id: string; name: string | null; factory_id: string | null } | null
      product_project: { id: string; title: string; status: ProductProject['status']; created_by: string | null } | null
    }

    const canUpdate = taskRow.assigned_to === userId || DIRECTOR_ROLES.includes(role)
    if (!canUpdate) throw new Error('Недостаточно прав для изменения задачи')
    if (
      role === 'production_manager' &&
      taskRow.machine_id &&
      (!taskRow.machine || (taskRow.machine.factory_id !== null && taskRow.machine.factory_id !== factoryId))
    ) {
      throw new Error('Задача относится к машине другого завода')
    }

    const pendingDelegation = await getPendingDelegationForTask(getAdminTaskDb(), taskId)
    if (pendingDelegation) {
      throw new Error('Задача ожидает принятия после делегирования. Сначала отмените делегирование или дождитесь ответа сотрудника.')
    }

    if (
      taskRow.task_type === CUTTING_ROLLBACK_TASK_TYPE &&
      (status === 'in_progress' || status === 'completed')
    ) {
      throw new TaskBusinessError(
        'Откройте preview отката и выберите действие в модальном окне.',
        'CUTTING_ROLLBACK_PREVIEW_REQUIRED',
      )
    }

    if (status === 'completed' && taskRow.task_type === 'technologist_request') {
      const hasSubmittedRequest = await hasSubmittedTechnologistRequest(db, taskRow.machine_id)
      if (!hasSubmittedRequest) {
        throw new Error('Нельзя завершить задачу технолога без переданной заявки. Передайте заявку в снабжение или завершите задачу с указанием причины.')
      }
    }

    if (
      status === 'completed'
      && (taskRow.task_type === 'consumable_request_review' || taskRow.task_type === 'consumable_request_shortage')
    ) {
      throw new Error(
        taskRow.task_type === 'consumable_request_review'
          ? 'Эта задача завершится автоматически после статуса заявки «Взят счёт».'
          : 'Эта задача завершится автоматически после полного получения или закрытия недопоставленного остатка.'
      )
    }

    let completedEngineeringVersion: ProductProjectVersion | null = null
    if (status === 'completed' && taskRow.task_type === 'product_project_engineering') {
      if (!taskRow.product_project_id || !taskRow.product_project) {
        throw new TaskBusinessError('Задача не привязана к проекту изделия')
      }
      completedEngineeringVersion = await validateProjectEngineeringDeliverables(db, taskRow.product_project_id)
    }

    if (status === 'completed' && taskRow.task_type === 'product_project_sales_review') {
      if (!taskRow.product_project_id || !taskRow.product_project) {
        throw new TaskBusinessError('Задача не привязана к проекту изделия')
      }
      if (taskRow.product_project.status !== 'approved') {
        throw new TaskBusinessError(
          'Сначала заполните цену, названия, УКТЗЕД и утвердите проект с клиентом в карточке проекта.',
          'PROJECT_APPROVAL_REQUIRED',
          taskRow.product_project_id,
        )
      }
    }

    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const { error } = await db
      .from('tasks')
      .update({
        status,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)

    if (error) throw error

    if (status === 'in_progress' && taskRow.task_type === 'product_project_engineering' && taskRow.product_project_id) {
      const { error: projectStatusError } = await db
        .from('product_projects')
        .update({ status: 'engineering', updated_at: new Date().toISOString() })
        .eq('id', taskRow.product_project_id)
      if (projectStatusError) throw projectStatusError
    }

    if (
      status === 'completed' &&
      taskRow.status !== 'completed' &&
      taskRow.task_type === 'product_project_engineering' &&
      taskRow.product_project &&
      completedEngineeringVersion
    ) {
      await finishProjectEngineering(db, taskRow.product_project, completedEngineeringVersion, userId)
      await dispatchPendingTelegramDeliveries({ userId: taskRow.product_project.created_by || userId })
    }

    if (status === 'completed' && taskRow.status !== 'completed' && taskRow.task_type === 'engineer_confirm') {
      await notifyTechnologistsAboutDrawingConfirmation(db, taskRow.machine_id, taskRow.machine?.name || null)
    }

    revalidatePath(ROUTES.TASKS)
    if (taskRow.machine_id) revalidatePath(`${ROUTES.SALES_PLAN}/${taskRow.machine_id}`)
    if (taskRow.product_project_id) revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${taskRow.product_project_id}`)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось обновить задачу',
      code: error instanceof TaskBusinessError ? error.code : undefined,
      projectId: error instanceof TaskBusinessError ? error.projectId : undefined,
    }
  }
}

export async function getProductionCuttingRollbackPreview(taskId: string) {
  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient
    const task = await getCuttingRollbackTaskForUser(db, taskId, userId, role, factoryId)

    const { data, error } = await db.rpc('fn_get_production_cutting_rollback_preview', {
      p_machine_id: task.machine_id,
    })

    if (error) throw new Error(error.message || 'Не удалось загрузить preview отката')
    return { success: true, data: normalizeCuttingRollbackPreview(data), error: null }
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Не удалось загрузить preview отката',
    }
  }
}

export async function applyProductionCuttingRollbackTask(taskId: string, comment?: string | null) {
  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient
    const task = await getCuttingRollbackTaskForUser(db, taskId, userId, role, factoryId)

    const { error } = await db.rpc('fn_apply_production_cutting_rollback', {
      p_machine_id: task.machine_id,
      p_task_id: task.id,
      p_performed_by: userId,
      p_comment: comment || null,
    })

    if (error) throw new Error(error.message || 'Не удалось выполнить автоматический откат')
    revalidateCuttingRollbackTaskPaths(task.machine_id)
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось выполнить автоматический откат',
    }
  }
}

export async function keepProductionCuttingRollbackTask(taskId: string, comment?: string | null) {
  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient
    const task = await getCuttingRollbackTaskForUser(db, taskId, userId, role, factoryId)

    const { error } = await db.rpc('fn_keep_production_cutting_rollback', {
      p_machine_id: task.machine_id,
      p_task_id: task.id,
      p_performed_by: userId,
      p_comment: comment || null,
    })

    if (error) throw new Error(error.message || 'Не удалось закрыть задачу без отката')
    revalidateCuttingRollbackTaskPaths(task.machine_id)
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось закрыть задачу без отката',
    }
  }
}

export async function completeTechnologistTaskWithoutRequest(taskId: string, reason: string) {
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 3) {
    return { success: false, error: 'Укажите причину завершения задачи без заявки' }
  }

  try {
    const { supabase, userId, role, factoryId } = await getCurrentUser()
    const db = supabase as unknown as LooseSupabaseClient

    const { data: task, error: fetchError } = await db
      .from('tasks')
      .select('id, assigned_to, machine_id, task_type, status, description, machine:machines(id, name, factory_id)')
      .eq('id', taskId)
      .single()

    if (fetchError || !task) throw new Error('Задача не найдена')
    const taskRow = task as unknown as {
      assigned_to: string
      machine_id: string | null
      task_type: TaskType
      status: TaskStatus
      description: string | null
      machine: { id: string; name: string | null; factory_id: string | null } | null
    }

    if (taskRow.task_type !== 'technologist_request') throw new Error('Так можно завершить только задачу технолога по заявке')
    if (!taskRow.machine_id) throw new Error('Задача не привязана к машине')
    if (taskRow.status === 'completed') throw new Error('Задача уже завершена')

    const canUpdate = taskRow.assigned_to === userId || DIRECTOR_ROLES.includes(role)
    if (!canUpdate) throw new Error('Недостаточно прав для изменения задачи')
    if (
      role === 'production_manager' &&
      (!taskRow.machine || (taskRow.machine.factory_id !== null && taskRow.machine.factory_id !== factoryId))
    ) {
      throw new Error('Задача относится к машине другого завода')
    }

    const pendingDelegation = await getPendingDelegationForTask(getAdminTaskDb(), taskId)
    if (pendingDelegation) {
      throw new Error('Задача ожидает принятия после делегирования. Сначала отмените делегирование или дождитесь ответа сотрудника.')
    }

    const hasSubmittedRequest = await hasSubmittedTechnologistRequest(db, taskRow.machine_id)
    if (hasSubmittedRequest) {
      throw new Error('По машине уже есть переданная заявка. Завершите задачу обычным способом.')
    }

    const reasonBlock = `Завершено без передачи заявки.\nПричина: ${trimmedReason}`
    const description = taskRow.description ? `${taskRow.description}\n\n${reasonBlock}` : reasonBlock
    const now = new Date().toISOString()

    const { error: updateError } = await db
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: now,
        updated_at: now,
        description,
      })
      .eq('id', taskId)

    if (updateError) throw updateError

    await createPlanningDirectorReasonTasks(db, taskRow.machine_id, taskRow.machine?.name || null, trimmedReason)
    await dispatchPendingTelegramDeliveries({ machineId: taskRow.machine_id })

    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.NOTIFICATIONS)
    revalidatePath(`${ROUTES.SALES_PLAN}/${taskRow.machine_id}`)

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось завершить задачу без заявки',
    }
  }
}
