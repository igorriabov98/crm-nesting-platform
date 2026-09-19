'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { type AddDepartmentMemberInput, type CreateDepartmentInput, type CreatePositionInput, type UpdateDepartmentMemberInput, type UpdateDepartmentInput, type UpdatePositionInput } from '@/lib/types/schemas'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { Department, DepartmentMember, Position } from '@/lib/types/departments'

type DbError = {
  message: string
  code?: string
  details?: string
  hint?: string
} | null

type DbResult = {
  data: unknown
  error: DbError
  count?: number | null
}

type SelectOptions = {
  count?: 'exact'
  head?: boolean
}

type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: SelectOptions) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}

type LooseDb = {
  from: (table: string) => LooseQuery
}

type PositionsResult = {
  data: Position[] | null
  error: string | null
}

type PositionActionResult = {
  success: boolean
  error: string | null
}

type DepartmentQueryRow = Department & {
  department_members?: { count: number }[] | null
}

type DepartmentsResult = {
  data: Department[] | null
  error: string | null
}

type DepartmentResult = {
  data: Department | null
  error: string | null
}

type DepartmentActionResult = {
  success: boolean
  error: string | null
}

type CreateDepartmentResult = DepartmentActionResult & {
  data?: { id: string }
}

type DepartmentMembersResult = {
  data: DepartmentMember[] | null
  error: string | null
}

type DepartmentMemberActionResult = {
  success: boolean
  error: string | null
}

type SubordinateMember = DepartmentMember & {
  depth: number
}


type SubordinatesResult = {
  data: SubordinateMember[] | null
  error: string | null
}

type UserDepartmentsResult = {
  data: DepartmentMember[] | null
  error: string | null
}

type ActiveUser = {
  id: string
  full_name: string
}

type ActiveUsersResult = {
  data: ActiveUser[] | null
  error: string | null
}

const DEPARTMENT_SELECT = `
  *,
  head:users!head_user_id(id, full_name),
  factory:factories!factory_id(id, name),
  parent:departments!parent_id(id, name),
  department_members:department_members!department_id(count)
`

const DEPARTMENT_MEMBER_SELECT = `
  *,
  user:user_id(id, full_name, email, role, is_active),
  position:position_id(id, name, level),
  reports_to:reports_to_user_id(id, full_name)
`

const USER_DEPARTMENT_SELECT = `
  *,
  department:department_id(id, name),
  position:position_id(id, name, level)
`

function getOrganizationDb() {
  return createAdminClient() as unknown as LooseDb
}

function mapDepartment(row: DepartmentQueryRow): Department {
  const { department_members: members, ...department } = row
  return {
    ...department,
    members_count: members?.[0]?.count ?? 0,
  }
}

// ──────────────────────────────────────
// getPositions
// ──────────────────────────────────────
export async function getPositions(): Promise<PositionsResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('positions')
      .select('*')
      .order('level', { ascending: false })
      .order('name', { ascending: true })

    if (error) throw error

    return { data: (data || []) as Position[], error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// createPosition
// ──────────────────────────────────────
export async function createPosition(data: CreatePositionInput): Promise<PositionActionResult> {
  void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// updatePosition
// ──────────────────────────────────────
export async function updatePosition(id: string, data: UpdatePositionInput): Promise<PositionActionResult> {
  void id; void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// deletePosition
// ──────────────────────────────────────
export async function deletePosition(id: string): Promise<PositionActionResult> {
  void id
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// getDepartments
// ──────────────────────────────────────
export async function getDepartments(): Promise<DepartmentsResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('departments')
      .select(DEPARTMENT_SELECT)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    const rows = Array.isArray(data) ? data as DepartmentQueryRow[] : []
    return { data: rows.map(mapDepartment), error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// getDepartmentById
// ──────────────────────────────────────
export async function getDepartmentById(id: string): Promise<DepartmentResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('departments')
      .select(DEPARTMENT_SELECT)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!data) throw new Error('Отдел не найден')

    return { data: mapDepartment(data as DepartmentQueryRow), error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// createDepartment
// ──────────────────────────────────────
export async function createDepartment(data: CreateDepartmentInput): Promise<CreateDepartmentResult> {
  void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// updateDepartment
// ──────────────────────────────────────
export async function updateDepartment(
  id: string,
  data: UpdateDepartmentInput
): Promise<DepartmentActionResult> {
  void id; void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// deleteDepartment
// ──────────────────────────────────────
export async function deleteDepartment(id: string): Promise<DepartmentActionResult> {
  void id
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// getDepartmentMembers
// ──────────────────────────────────────
export async function getDepartmentMembers(departmentId: string): Promise<DepartmentMembersResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('department_members')
      .select(DEPARTMENT_MEMBER_SELECT)
      .eq('department_id', departmentId)

    if (error) throw error

    const members = (Array.isArray(data) ? data : []) as DepartmentMember[]
    members.sort((left, right) => {
      if (left.is_department_head !== right.is_department_head) {
        return left.is_department_head ? -1 : 1
      }

      const levelDifference = (right.position?.level ?? -1) - (left.position?.level ?? -1)
      if (levelDifference !== 0) return levelDifference

      return (left.user?.full_name ?? '').localeCompare(right.user?.full_name ?? '', 'ru')
    })

    return { data: members, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// addMember
// ──────────────────────────────────────
export async function addMember(data: AddDepartmentMemberInput): Promise<DepartmentMemberActionResult> {
  void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// updateMember
// ──────────────────────────────────────
export async function updateMember(
  memberId: string,
  data: UpdateDepartmentMemberInput
): Promise<DepartmentMemberActionResult> {
  void memberId; void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// removeMember
// ──────────────────────────────────────
export async function removeMember(memberId: string): Promise<DepartmentMemberActionResult> {
  void memberId
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

// ──────────────────────────────────────
// getSubordinates
// ──────────────────────────────────────
export async function getSubordinates(userId: string): Promise<SubordinatesResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('department_members')
      .select(DEPARTMENT_MEMBER_SELECT)

    if (error) throw error

    const members = (Array.isArray(data) ? data : []) as DepartmentMember[]
    const membersByManager = new Map<string, DepartmentMember[]>()

    for (const member of members) {
      if (!member.reports_to_user_id) continue
      const directReports = membersByManager.get(member.reports_to_user_id) || []
      directReports.push(member)
      membersByManager.set(member.reports_to_user_id, directReports)
    }

    const result: SubordinateMember[] = []
    const visited = new Set<string>([userId])

    function collectSubordinates(managerId: string, depth: number) {
      for (const member of membersByManager.get(managerId) || []) {
        if (visited.has(member.user_id)) continue
        visited.add(member.user_id)
        result.push({ ...member, depth })
        collectSubordinates(member.user_id, depth + 1)
      }
    }

    collectSubordinates(userId, 1)
    return { data: result, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// getManagementChain
// ──────────────────────────────────────
export async function getManagementChain(userId: string): Promise<DepartmentMembersResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('department_members')
      .select(DEPARTMENT_MEMBER_SELECT)

    if (error) throw error

    const members = (Array.isArray(data) ? data : []) as DepartmentMember[]
    const chain: DepartmentMember[] = []
    const visited = new Set<string>([userId])
    let currentMember = members.find((member) => member.user_id === userId)

    while (currentMember?.reports_to_user_id) {
      const managerId = currentMember.reports_to_user_id
      if (visited.has(managerId)) break
      visited.add(managerId)

      const manager = members.find((member) => member.user_id === managerId)
      if (!manager) break

      chain.push(manager)
      currentMember = manager
    }

    return { data: chain, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// getUserDepartments
// ──────────────────────────────────────
export async function getUserDepartments(userId: string): Promise<UserDepartmentsResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('department_members')
      .select(USER_DEPARTMENT_SELECT)
      .eq('user_id', userId)

    if (error) throw error

    return {
      data: (Array.isArray(data) ? data : []) as DepartmentMember[],
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// getActiveUsers
// ──────────────────────────────────────
export async function getActiveUsers(): Promise<ActiveUsersResult> {
  try {
    await requirePermission('departments', 'view')
    const db = getOrganizationDb()

    const { data, error } = await db
      .from('users')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (error) throw error

    return {
      data: (Array.isArray(data) ? data : []) as ActiveUser[],
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}
