'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import {
  DEPARTMENT_REQUEST_TARGETS,
  canManageDepartmentRequestTarget,
  getDepartmentRequestTabStatuses,
  isDepartmentRequestTarget,
  type DepartmentRequestFilters,
  type DepartmentRequestStatus,
  type DepartmentRequestTarget,
} from '@/lib/department-requests'
import {
  type DepartmentRequestDirectUpload,
  validateDepartmentRequestUploads,
} from '@/lib/department-request-files'

const PAGE_SIZE = 40
const DIRECTORS = ['financial_director', 'commercial_director', 'planning_director']

const targetSchema = z.enum(['technologist', 'supply', 'production'])
const attachmentSchema = z.object({
  objectPath: z.string().min(1).max(700),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().max(160).nullable(),
  fileSize: z.number().int().positive(),
})
const createSchema = z.object({
  requestId: z.string().uuid(),
  target: targetSchema,
  title: z.string().trim().min(3, 'Напишите название задачи').max(160, 'Не больше 160 символов'),
  description: z.string().trim().min(3, 'Опишите, что нужно сделать').max(5000, 'Не больше 5000 символов'),
  machineId: z.string().uuid().nullable(),
  dueDate: z.string().refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Некорректная дата'),
  attachments: z.array(attachmentSchema).max(10, 'Можно прикрепить не больше 10 файлов'),
  mailLink: z.object({
    kind: z.enum(['thread', 'message']),
    id: z.string().uuid(),
  }).nullable().optional(),
})
const completionSchema = z.object({
  requestId: z.string().uuid(),
  response: z.string().trim().min(3, 'Опишите решение запроса').max(5000, 'Не больше 5000 символов'),
  attachments: z.array(attachmentSchema).max(10, 'Можно прикрепить не больше 10 файлов'),
})
const responseSchema = z.object({
  requestId: z.string().uuid(),
  response: z.string().trim().min(3, 'Укажите причину отклонения').max(5000, 'Не больше 5000 символов'),
})

export type DepartmentRequestAttachment = {
  id: string
  phase: 'source' | 'resolution'
  file_name: string
  mime_type: string | null
  file_size: number
  created_at: string
}

export type DepartmentRequestEvent = {
  id: string
  event_type: 'created' | 'claimed' | 'completed' | 'rejected' | 'cancelled'
  created_at: string
  actor: { id: string; full_name: string } | null
}

export type DepartmentRequestRow = {
  id: string
  target_department: DepartmentRequestTarget
  title: string
  description: string
  status: DepartmentRequestStatus
  created_by: string
  assigned_to: string | null
  completed_by: string | null
  factory_id: string | null
  machine_id: string | null
  due_date: string | null
  response: string | null
  completed_at: string | null
  result_viewed_at: string | null
  created_at: string
  updated_at: string
  creator: { id: string; full_name: string; role: string } | null
  assignee: { id: string; full_name: string } | null
  completer: { id: string; full_name: string } | null
  machine: {
    id: string
    name: string
    specification_number: string | null
    client: { id: string; name: string } | null
  } | null
  attachments: DepartmentRequestAttachment[]
  events?: DepartmentRequestEvent[]
}

export type DepartmentRequestFilterOption = {
  id: string
  label: string
}

export type DepartmentRequestWorkspace = {
  mode: 'mine' | 'inbox'
  target?: DepartmentRequestTarget
  userId: string
  requests: DepartmentRequestRow[]
  total: number
  page: number
  pageSize: number
  filters: DepartmentRequestFilters
  orderOptions: DepartmentRequestFilterOption[]
  assigneeOptions: DepartmentRequestFilterOption[]
}

export type DepartmentRequestActionResult = {
  ok: boolean
  message: string
  requestId?: string
}

export type DepartmentRequestMachineOption = {
  id: string
  label: string
  name: string
}

type RequestQueryResult = {
  data: unknown[] | null
  error: { message?: string } | null
  count?: number | null
}

type RequestFilterQuery = PromiseLike<RequestQueryResult> & {
  eq: (column: string, value: unknown) => RequestFilterQuery
  textSearch: (
    column: string,
    query: string,
    options: { config: string; type: 'websearch' },
  ) => RequestFilterQuery
  lt: (column: string, value: unknown) => RequestFilterQuery
  in: (column: string, values: unknown[]) => RequestFilterQuery
  not: (column: string, operator: string, value: unknown) => RequestFilterQuery
  is: (column: string, value: unknown) => RequestFilterQuery
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    error: { message?: string } | null
  }>
}

type ResultReadQuery = PromiseLike<{ error: { message?: string } | null }> & {
  eq: (column: string, value: unknown) => ResultReadQuery
  is: (column: string, value: unknown) => ResultReadQuery
}

type ResultReadClient = {
  from: (table: 'department_requests') => {
    update: (values: { result_viewed_at: string }) => ResultReadQuery
  }
}

type FilterOptionRow = {
  machine_id: string | null
  assigned_to: string | null
  machine: { name?: string; specification_number?: string | null } | Array<{ name?: string; specification_number?: string | null }> | null
  assignee: { full_name?: string } | Array<{ full_name?: string }> | null
}

type MachineSearchRow = {
  id: string
  name: string
  specification_number: string | null
  client: { name?: string } | Array<{ name?: string }> | null
}

const requestListSelect = `
  id,
  target_department,
  title,
  description,
  status,
  created_by,
  assigned_to,
  completed_by,
  factory_id,
  machine_id,
  due_date,
  response,
  completed_at,
  result_viewed_at,
  created_at,
  updated_at,
  creator:users!department_requests_created_by_fkey(id, full_name, role),
  assignee:users!department_requests_assigned_to_fkey(id, full_name),
  completer:users!department_requests_completed_by_fkey(id, full_name),
  machine:machines!department_requests_machine_id_fkey(
    id,
    name,
    specification_number,
    client:clients(id, name)
  ),
  attachments:department_request_attachments(
    id,
    phase,
    file_name,
    mime_type,
    file_size,
    created_at
  )
`

const requestDetailSelect = `
  ${requestListSelect},
  events:department_request_events(
    id,
    event_type,
    created_at,
    actor:users!department_request_events_actor_id_fkey(id, full_name)
  )
`

function membershipInput(permissionDetails: Awaited<ReturnType<typeof requirePermission>>['permissionDetails']) {
  return permissionDetails.memberships.map((membership) => ({
    departmentName: membership.departmentName,
  }))
}

function isDirector(role: string) {
  return DIRECTORS.includes(role)
}

function normalizeSearch(value: string) {
  return value.trim().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').slice(0, 120)
}

function applyFilters(query: RequestFilterQuery, filters: DepartmentRequestFilters, userId: string, includeTarget: boolean) {
  let result = query
  if (filters.query) {
    result = result.textSearch('search_document', filters.query, { config: 'simple', type: 'websearch' })
  }
  result = result.in('status', getDepartmentRequestTabStatuses(filters.tab))
  if (filters.status !== 'all') result = result.eq('status', filters.status)
  if (includeTarget && filters.target !== 'all') result = result.eq('target_department', filters.target)

  const today = new Date().toISOString().slice(0, 10)
  if (filters.deadline === 'overdue') {
    result = result.lt('due_date', today).in('status', ['new', 'in_progress'])
  } else if (filters.deadline === 'with_date') {
    result = result.not('due_date', 'is', null)
  } else if (filters.deadline === 'without_date') {
    result = result.is('due_date', null)
  }

  if (filters.order === 'with_order') result = result.not('machine_id', 'is', null)
  else if (filters.order === 'without_order') result = result.is('machine_id', null)
  else if (z.string().uuid().safeParse(filters.order).success) result = result.eq('machine_id', filters.order)

  if (filters.assignee === 'unassigned') result = result.is('assigned_to', null)
  else if (filters.assignee === 'mine') result = result.eq('assigned_to', userId)
  else if (z.string().uuid().safeParse(filters.assignee).success) result = result.eq('assigned_to', filters.assignee)
  return result
}

function applyScope(
  query: RequestFilterQuery,
  input: {
    mode: 'mine' | 'inbox'
    userId: string
    target?: DepartmentRequestTarget
    role: string
    factoryId: string | null
  },
) {
  if (input.mode === 'mine') return query.eq('created_by', input.userId)
  let result = query.eq('target_department', input.target)
  if (input.target === 'production' && !isDirector(input.role) && input.factoryId) {
    result = result.eq('factory_id', input.factoryId)
  }
  return result
}

async function loadFilterOptions(
  admin: ReturnType<typeof createAdminClient>,
  scope: {
    mode: 'mine' | 'inbox'
    userId: string
    target?: DepartmentRequestTarget
    role: string
    factoryId: string | null
  },
) {
  let optionQuery = admin
    .from('department_requests')
    .select(`
      machine_id,
      assigned_to,
      machine:machines!department_requests_machine_id_fkey(id, name, specification_number),
      assignee:users!department_requests_assigned_to_fkey(id, full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(300) as unknown as RequestFilterQuery
  optionQuery = applyScope(optionQuery, scope)
  const { data } = await optionQuery

  const orders = new Map<string, string>()
  const assignees = new Map<string, string>()
  for (const row of (data || []) as unknown as FilterOptionRow[]) {
    const machine = Array.isArray(row.machine) ? row.machine[0] : row.machine
    const assignee = Array.isArray(row.assignee) ? row.assignee[0] : row.assignee
    if (row.machine_id && machine?.name) {
      const suffix = machine.specification_number ? ` · ${machine.specification_number}` : ''
      orders.set(row.machine_id, `${machine.name}${suffix}`)
    }
    if (row.assigned_to && assignee?.full_name) {
      assignees.set(row.assigned_to, assignee.full_name)
    }
  }
  return {
    orderOptions: Array.from(orders, ([id, label]) => ({ id, label })),
    assigneeOptions: Array.from(assignees, ([id, label]) => ({ id, label })),
  }
}

async function loadWorkspace(input: {
  mode: 'mine' | 'inbox'
  target?: DepartmentRequestTarget
  filters: DepartmentRequestFilters
}) {
  const context = await requirePermission('department_requests', 'view')
  if (input.mode === 'inbox') {
    if (!input.target) throw new Error('Неизвестный отдел')
    const canManage = canManageDepartmentRequestTarget({
      target: input.target,
      role: context.role,
      memberships: membershipInput(context.permissionDetails),
    })
    if (!canManage) throw new Error('Недостаточно прав для просмотра запросов отдела')
  }

  const scope = {
    mode: input.mode,
    userId: context.userId,
    target: input.target,
    role: context.role,
    factoryId: context.factoryId,
  } as const
  const admin = createAdminClient()
  const from = input.filters.page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  let listQuery = admin
    .from('department_requests')
    .select(requestListSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to) as unknown as RequestFilterQuery
  listQuery = applyScope(listQuery, scope)
  listQuery = applyFilters(listQuery, input.filters, context.userId, input.mode === 'mine')

  const [{ data, error, count }, options] = await Promise.all([
    listQuery,
    loadFilterOptions(admin, scope),
  ])
  if (error) throw new Error(error.message || 'Не удалось загрузить запросы')

  return {
    mode: input.mode,
    target: input.target,
    userId: context.userId,
    requests: (data || []) as unknown as DepartmentRequestRow[],
    total: count || 0,
    page: input.filters.page,
    pageSize: PAGE_SIZE,
    filters: input.filters,
    ...options,
  } satisfies DepartmentRequestWorkspace
}

export async function getMyDepartmentRequestWorkspace(filters: DepartmentRequestFilters) {
  return loadWorkspace({ mode: 'mine', filters })
}

export async function getDepartmentRequestWorkspace(input: {
  target: string
  filters: DepartmentRequestFilters
}) {
  if (!isDepartmentRequestTarget(input.target)) throw new Error('Неизвестный отдел')
  return loadWorkspace({ mode: 'inbox', target: input.target, filters: input.filters })
}

export async function getDepartmentRequestDetail(requestId: string) {
  const id = z.string().uuid().parse(requestId)
  const context = await requirePermission('department_requests', 'view')
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('department_requests')
    .select(requestDetailSelect)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const request = data as unknown as DepartmentRequestRow

  const departmentAllowed = canManageDepartmentRequestTarget({
    target: request.target_department,
    role: context.role,
    memberships: membershipInput(context.permissionDetails),
  })
  const factoryAllowed = request.target_department !== 'production'
    || isDirector(context.role)
    || !request.factory_id
    || request.factory_id === context.factoryId
  const canManage = departmentAllowed && factoryAllowed
  if (request.created_by !== context.userId && !canManage) return null

  if (
    request.created_by === context.userId
    && ['done', 'rejected'].includes(request.status)
    && request.result_viewed_at === null
  ) {
    const viewedAt = new Date().toISOString()
    const { error: readError } = await (admin as unknown as ResultReadClient)
      .from('department_requests')
      .update({ result_viewed_at: viewedAt })
      .eq('id', id)
      .eq('created_by', context.userId)
      .is('result_viewed_at', null)
    if (!readError) request.result_viewed_at = viewedAt
  }

  return {
    request,
    userId: context.userId,
    canManage,
  }
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ error: { message?: string } | null }> {
  const context = await requirePermission('department_requests', 'manage')
  return (context.supabase as unknown as RpcClient).rpc(name, args)
}

function revalidateRequest(requestId: string, target?: DepartmentRequestTarget) {
  revalidatePath('/requests')
  revalidatePath(`/requests/detail/${requestId}`)
  if (target) revalidatePath(DEPARTMENT_REQUEST_TARGETS[target].route)
  else {
    Object.values(DEPARTMENT_REQUEST_TARGETS).forEach((config) => revalidatePath(config.route))
  }
  revalidatePath('/notifications')
  revalidatePath(ROUTES.TASKS)
}

export async function createDepartmentRequest(
  input: z.input<typeof createSchema>,
): Promise<DepartmentRequestActionResult> {
  try {
    const context = await requirePermission('department_requests', 'manage')
    const parsed = createSchema.parse(input)
    const attachments = validateDepartmentRequestUploads(
      parsed.requestId,
      context.userId,
      'source',
      parsed.attachments as DepartmentRequestDirectUpload[],
    )
    const rpcName = parsed.mailLink ? 'create_department_request_with_mail' : 'create_department_request'
    const rpcArgs: Record<string, unknown> = {
      p_request_id: parsed.requestId,
      p_target_department: parsed.target,
      p_title: parsed.title,
      p_description: parsed.description,
      p_machine_id: parsed.machineId,
      p_due_date: parsed.dueDate || null,
      p_attachments: attachments,
    }
    if (parsed.mailLink) rpcArgs.p_mail_link = parsed.mailLink
    const { error } = await (context.supabase as unknown as RpcClient).rpc(rpcName, rpcArgs)
    if (error) throw new Error(error.message)
    revalidateRequest(parsed.requestId, parsed.target)
    return {
      ok: true,
      message: `Запрос отправлен ${DEPARTMENT_REQUEST_TARGETS[parsed.target].recipientLabel}`,
      requestId: parsed.requestId,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось создать запрос' }
  }
}

export async function claimDepartmentRequest(requestId: string): Promise<DepartmentRequestActionResult> {
  try {
    const id = z.string().uuid().parse(requestId)
    const { error } = await callRpc('claim_department_request', { p_request_id: id })
    if (error) throw new Error(error.message)
    revalidateRequest(id)
    return { ok: true, message: 'Запрос взят в работу', requestId: id }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось взять запрос в работу' }
  }
}

export async function completeDepartmentRequest(
  input: z.input<typeof completionSchema>,
): Promise<DepartmentRequestActionResult> {
  try {
    const context = await requirePermission('department_requests', 'manage')
    const parsed = completionSchema.parse(input)
    const attachments = validateDepartmentRequestUploads(
      parsed.requestId,
      context.userId,
      'resolution',
      parsed.attachments as DepartmentRequestDirectUpload[],
    )
    const { error } = await (context.supabase as unknown as RpcClient).rpc('complete_department_request', {
      p_request_id: parsed.requestId,
      p_response: parsed.response,
      p_attachments: attachments,
    })
    if (error) throw new Error(error.message)
    revalidateRequest(parsed.requestId)
    return { ok: true, message: 'Запрос завершён', requestId: parsed.requestId }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось завершить запрос' }
  }
}

export async function rejectDepartmentRequest(
  input: z.input<typeof responseSchema>,
): Promise<DepartmentRequestActionResult> {
  try {
    const parsed = responseSchema.parse(input)
    const { error } = await callRpc('reject_department_request', {
      p_request_id: parsed.requestId,
      p_response: parsed.response,
    })
    if (error) throw new Error(error.message)
    revalidateRequest(parsed.requestId)
    return { ok: true, message: 'Запрос отклонён', requestId: parsed.requestId }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось отклонить запрос' }
  }
}

export async function cancelDepartmentRequest(requestId: string): Promise<DepartmentRequestActionResult> {
  try {
    const id = z.string().uuid().parse(requestId)
    const { error } = await callRpc('cancel_department_request', { p_request_id: id })
    if (error) throw new Error(error.message)
    revalidateRequest(id)
    return { ok: true, message: 'Запрос отменён', requestId: id }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось отменить запрос' }
  }
}

export async function searchDepartmentRequestMachines(query: string): Promise<DepartmentRequestMachineOption[]> {
  const context = await requirePermission('department_requests', 'manage')
  const search = normalizeSearch(query)
  let machineQuery = createAdminClient()
    .from('machines')
    .select('id, name, specification_number, factory_id, client:clients(name)')
    .eq('is_archived', false)
    .is('actual_shipping_date', null)
    .neq('status', 'shipped')
    .order('created_at', { ascending: false })
    .limit(20)
  if (context.factoryId) machineQuery = machineQuery.eq('factory_id', context.factoryId)
  if (search) machineQuery = machineQuery.or(`name.ilike.%${search}%,specification_number.ilike.%${search}%`)

  const { data, error } = await machineQuery
  if (error) throw new Error(error.message)
  return ((data || []) as unknown as MachineSearchRow[]).map((row) => {
    const client = Array.isArray(row.client) ? row.client[0] : row.client
    const details = [row.specification_number, client?.name].filter(Boolean).join(' · ')
    return {
      id: row.id,
      name: row.name,
      label: details ? `${row.name} · ${details}` : row.name,
    }
  })
}
