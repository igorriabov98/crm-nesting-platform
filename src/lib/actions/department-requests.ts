'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/types/database'
import { requirePermission } from '@/lib/permissions/server'
import {
  DEPARTMENT_REQUEST_TARGETS,
  canManageDepartmentRequestTarget,
  isDepartmentRequestTarget,
  type DepartmentRequestPriority,
  type DepartmentRequestStatus,
  type DepartmentRequestTarget,
  type DepartmentRequestView,
} from '@/lib/department-requests'

const PAGE_SIZE = 40

type DepartmentRequestInsert = Database['public']['Tables']['department_requests']['Insert']
type DepartmentRequestUpdate = Database['public']['Tables']['department_requests']['Update']
type MutationResult = {
  data: unknown
  error: { message?: string } | null
}
type MutationQuery = PromiseLike<MutationResult> & {
  eq: (column: string, value: unknown) => MutationQuery
}
type DepartmentRequestMutationTable = {
  insert: (value: DepartmentRequestInsert) => PromiseLike<MutationResult>
  update: (value: DepartmentRequestUpdate) => MutationQuery
}

function departmentRequestMutations(admin: ReturnType<typeof createAdminClient>) {
  return admin.from('department_requests') as unknown as DepartmentRequestMutationTable
}

const createRequestSchema = z.object({
  target: z.enum(['technologist', 'supply', 'production']),
  title: z.string().trim().min(3, 'Напишите короткий заголовок').max(160, 'Не больше 160 символов'),
  description: z.string().trim().min(3, 'Опишите, что нужно сделать').max(5000, 'Не больше 5000 символов'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  dueDate: z.string().trim().refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Некорректная дата'),
})

const updateRequestSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(['in_progress', 'done', 'rejected', 'cancelled']),
  response: z.string().trim().max(2000, 'Не больше 2000 символов').optional(),
})

export type DepartmentRequestRow = {
  id: string
  target_department: DepartmentRequestTarget
  title: string
  description: string
  priority: DepartmentRequestPriority
  status: DepartmentRequestStatus
  created_by: string
  assigned_to: string | null
  factory_id: string | null
  due_date: string | null
  response: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  creator: { id: string; full_name: string; role: string } | null
  assignee: { id: string; full_name: string } | null
}

export type DepartmentRequestWorkspace = {
  target: DepartmentRequestTarget
  view: DepartmentRequestView
  canManageInbox: boolean
  requests: DepartmentRequestRow[]
  total: number
  page: number
  pageSize: number
}

export type DepartmentRequestActionState = {
  ok: boolean
  message: string
}

function membershipInput(permissionDetails: Awaited<ReturnType<typeof requirePermission>>['permissionDetails']) {
  return permissionDetails.memberships.map((membership) => ({
    departmentName: membership.departmentName,
  }))
}

function isDirectorRole(role: string) {
  return ['financial_director', 'commercial_director', 'planning_director'].includes(role)
}

function normalizeSearch(value: string) {
  return value.trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').slice(0, 120)
}

function requestRoute(target: DepartmentRequestTarget) {
  return DEPARTMENT_REQUEST_TARGETS[target].route
}

export async function getDepartmentRequestWorkspace(input: {
  target: string
  view?: string
  query?: string
  page?: number
}): Promise<DepartmentRequestWorkspace> {
  if (!isDepartmentRequestTarget(input.target)) throw new Error('Неизвестный отдел')
  const context = await requirePermission('department_requests', 'view')
  const canManageInbox = canManageDepartmentRequestTarget({
    target: input.target,
    role: context.role,
    memberships: membershipInput(context.permissionDetails),
  })
  const view: DepartmentRequestView = input.view === 'inbox' && canManageInbox ? 'inbox' : 'mine'
  const page = Math.max(0, Number.isFinite(input.page) ? Math.floor(input.page || 0) : 0)
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const admin = createAdminClient()

  let query = admin
    .from('department_requests')
    .select(`
      id,
      target_department,
      title,
      description,
      priority,
      status,
      created_by,
      assigned_to,
      factory_id,
      due_date,
      response,
      completed_at,
      created_at,
      updated_at,
      creator:users!department_requests_created_by_fkey(id, full_name, role),
      assignee:users!department_requests_assigned_to_fkey(id, full_name)
    `, { count: 'exact' })
    .eq('target_department', input.target)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (view === 'mine') {
    query = query.eq('created_by', context.userId)
  } else if (input.target === 'production' && !isDirectorRole(context.role) && context.factoryId) {
    query = query.eq('factory_id', context.factoryId)
  }

  const search = normalizeSearch(input.query || '')
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)

  const { data, error, count } = await query
  if (error) throw new Error(error.message || 'Не удалось загрузить запросы')

  return {
    target: input.target,
    view,
    canManageInbox,
    requests: (data || []) as DepartmentRequestRow[],
    total: count || 0,
    page,
    pageSize: PAGE_SIZE,
  }
}

export async function createDepartmentRequest(
  _previousState: DepartmentRequestActionState,
  formData: FormData,
): Promise<DepartmentRequestActionState> {
  try {
    const context = await requirePermission('department_requests', 'manage')
    const parsed = createRequestSchema.safeParse({
      target: formData.get('target'),
      title: formData.get('title'),
      description: formData.get('description'),
      priority: formData.get('priority'),
      dueDate: formData.get('dueDate'),
    })

    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message || 'Проверьте поля запроса' }
    }

    const admin = createAdminClient()
    const { error } = await departmentRequestMutations(admin).insert({
      target_department: parsed.data.target,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      due_date: parsed.data.dueDate || null,
      created_by: context.userId,
      factory_id: context.factoryId,
    })
    if (error) throw new Error(error.message)

    revalidatePath(requestRoute(parsed.data.target))
    revalidatePath('/notifications')
    return { ok: true, message: `Запрос отправлен ${DEPARTMENT_REQUEST_TARGETS[parsed.data.target].recipientLabel}` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Не удалось отправить запрос',
    }
  }
}

function assertStatusTransition(current: DepartmentRequestStatus, next: DepartmentRequestStatus) {
  const transitions: Record<DepartmentRequestStatus, DepartmentRequestStatus[]> = {
    new: ['in_progress', 'done', 'rejected', 'cancelled'],
    in_progress: ['done', 'rejected', 'cancelled'],
    done: [],
    rejected: [],
    cancelled: [],
  }
  if (!transitions[current].includes(next)) throw new Error('Этот статус уже нельзя изменить')
}

export async function updateDepartmentRequest(formData: FormData): Promise<void> {
  const context = await requirePermission('department_requests', 'manage')
  const parsed = updateRequestSchema.parse({
    requestId: formData.get('requestId'),
    status: formData.get('status'),
    response: formData.get('response') || '',
  })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('department_requests')
    .select('id, target_department, status, created_by, factory_id')
    .eq('id', parsed.requestId)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message || 'Запрос не найден')

  const request = data as Pick<DepartmentRequestRow, 'id' | 'target_department' | 'status' | 'created_by' | 'factory_id'>
  assertStatusTransition(request.status, parsed.status)

  const isOwnerCancellation = request.created_by === context.userId && parsed.status === 'cancelled'
  const canManageInbox = canManageDepartmentRequestTarget({
    target: request.target_department,
    role: context.role,
    memberships: membershipInput(context.permissionDetails),
  })
  const factoryAllowed = request.target_department !== 'production'
    || isDirectorRole(context.role)
    || !request.factory_id
    || request.factory_id === context.factoryId

  if (!isOwnerCancellation && (!canManageInbox || !factoryAllowed)) {
    throw new Error('Недостаточно прав для изменения этого запроса')
  }

  const terminal = ['done', 'rejected', 'cancelled'].includes(parsed.status)
  const { error: updateError } = await departmentRequestMutations(admin)
    .update({
      status: parsed.status,
      response: parsed.response || null,
      assigned_to: isOwnerCancellation ? null : context.userId,
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq('id', request.id)
  if (updateError) throw new Error(updateError.message)

  revalidatePath(requestRoute(request.target_department))
  revalidatePath('/notifications')
}
