'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import {
  addDepartmentMemberSchema,
  createDepartmentSchema,
  createPositionSchema,
  updateDepartmentMemberSchema,
  updateDepartmentSchema,
  updatePositionSchema,
  type AddDepartmentMemberInput,
  type CreateDepartmentInput,
  type CreatePositionInput,
  type UpdateDepartmentMemberInput,
  type UpdateDepartmentInput,
  type UpdatePositionInput,
} from '@/lib/types/schemas'
import { ROUTES } from '@/lib/constants/routes'
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

async function assertActiveHeadUser(db: LooseDb, headUserId: string | null | undefined) {
  if (!headUserId) return

  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('id', headUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Указанный руководитель не найден или неактивен')
}

// ──────────────────────────────────────
// validateNoCircularDependency (внутренняя)
// ──────────────────────────────────────
async function validateNoCircularDependency(
  departmentId: string,
  newParentId: string | null
): Promise<boolean> {
  if (!newParentId) return true
  if (newParentId === departmentId) return false

  const db = getOrganizationDb()
  let currentId: string | null = newParentId
  const visited = new Set<string>()

  while (currentId) {
    if (visited.has(currentId)) return false
    if (currentId === departmentId) return false
    visited.add(currentId)

    const { data, error } = await db
      .from('departments')
      .select('parent_id')
      .eq('id', currentId)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new Error('Родительский отдел не найден')

    currentId = (data as { parent_id: string | null }).parent_id
  }

  return true
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
  try {
    const context = await requirePermission('departments', 'manage')
    const parsed = createPositionSchema.parse(data)
    const db = getOrganizationDb()

    const { error } = await db.from('positions').insert({
      ...parsed,
      created_by: context.user.id,
    })

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// updatePosition
// ──────────────────────────────────────
export async function updatePosition(id: string, data: UpdatePositionInput): Promise<PositionActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const parsed = updatePositionSchema.parse(data)
    const db = getOrganizationDb()

    const { error } = await db
      .from('positions')
      .update(parsed)
      .eq('id', id)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// deletePosition
// ──────────────────────────────────────
export async function deletePosition(id: string): Promise<PositionActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const db = getOrganizationDb()

    const { count, error: countError } = await db
      .from('department_members')
      .select('id', { count: 'exact', head: true })
      .eq('position_id', id)

    if (countError) throw countError

    const assignedCount = count || 0
    if (assignedCount > 0) {
      return {
        success: false,
        error: `Нельзя удалить должность, она назначена ${assignedCount} сотрудникам`,
      }
    }

    const { error } = await db
      .from('positions')
      .delete()
      .eq('id', id)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
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
  try {
    const context = await requirePermission('departments', 'manage')
    const parsed = createDepartmentSchema.parse(data)
    const db = getOrganizationDb()

    await assertActiveHeadUser(db, parsed.head_user_id)

    const { data: createdDepartment, error } = await db
      .from('departments')
      .insert({
        ...parsed,
        created_by: context.user.id,
      })
      .select('id')
      .single()

    if (error) throw error
    if (!createdDepartment) throw new Error('Не удалось создать отдел')

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return {
      success: true,
      data: { id: (createdDepartment as { id: string }).id },
      error: null,
    }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// updateDepartment
// ──────────────────────────────────────
export async function updateDepartment(
  id: string,
  data: UpdateDepartmentInput
): Promise<DepartmentActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const parsed = updateDepartmentSchema.parse(data)
    const db = getOrganizationDb()

    if (parsed.head_user_id !== undefined) {
      await assertActiveHeadUser(db, parsed.head_user_id)
    }

    if (parsed.parent_id !== undefined) {
      const safe = await validateNoCircularDependency(id, parsed.parent_id)
      if (!safe) {
        return {
          success: false,
          error: 'Нельзя: создаётся циклическая зависимость отделов',
        }
      }
    }

    const { error } = await db
      .from('departments')
      .update(parsed)
      .eq('id', id)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// deleteDepartment
// ──────────────────────────────────────
export async function deleteDepartment(id: string): Promise<DepartmentActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const db = getOrganizationDb()

    const { count: childCount, error: childCountError } = await db
      .from('departments')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id)

    if (childCountError) throw childCountError

    const children = childCount || 0
    if (children > 0) {
      return {
        success: false,
        error: `Нельзя удалить: в отделе есть ${children} подотделов. Сначала удалите или переместите их.`,
      }
    }

    const { count: memberCount, error: memberCountError } = await db
      .from('department_members')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id)

    if (memberCountError) throw memberCountError

    const members = memberCount || 0
    if (members > 0) {
      return {
        success: false,
        error: `Нельзя удалить: в отделе есть ${members} сотрудников. Сначала уберите их из отдела.`,
      }
    }

    const { error } = await db
      .from('departments')
      .delete()
      .eq('id', id)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
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
  try {
    const context = await requirePermission('departments', 'manage')
    const parsed = addDepartmentMemberSchema.parse(data)
    const db = getOrganizationDb()

    if (parsed.reports_to_user_id === parsed.user_id) {
      return { success: false, error: 'Сотрудник не может подчиняться самому себе' }
    }

    if (parsed.is_department_head) {
      const { error: clearHeadError } = await db
        .from('department_members')
        .update({ is_department_head: false })
        .eq('department_id', parsed.department_id)
        .eq('is_department_head', true)

      if (clearHeadError) throw clearHeadError

      const { error: departmentError } = await db
        .from('departments')
        .update({ head_user_id: parsed.user_id })
        .eq('id', parsed.department_id)

      if (departmentError) throw departmentError
    }

    const { error } = await db.from('department_members').insert({
      ...parsed,
      created_by: context.user.id,
    })

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// updateMember
// ──────────────────────────────────────
export async function updateMember(
  memberId: string,
  data: UpdateDepartmentMemberInput
): Promise<DepartmentMemberActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const parsed = updateDepartmentMemberSchema.parse(data)
    const db = getOrganizationDb()

    const { data: currentMember, error: memberError } = await db
      .from('department_members')
      .select('department_id, user_id, is_department_head')
      .eq('id', memberId)
      .single()

    if (memberError) throw memberError
    if (!currentMember) throw new Error('Участник отдела не найден')

    const member = currentMember as Pick<
      DepartmentMember,
      'department_id' | 'user_id' | 'is_department_head'
    >

    if (parsed.reports_to_user_id && parsed.reports_to_user_id === member.user_id) {
      return { success: false, error: 'Сотрудник не может подчиняться самому себе' }
    }

    if (parsed.is_department_head === true && !member.is_department_head) {
      const { error: clearHeadError } = await db
        .from('department_members')
        .update({ is_department_head: false })
        .eq('department_id', member.department_id)
        .eq('is_department_head', true)

      if (clearHeadError) throw clearHeadError

      const { error: departmentError } = await db
        .from('departments')
        .update({ head_user_id: member.user_id })
        .eq('id', member.department_id)

      if (departmentError) throw departmentError
    }

    if (parsed.is_department_head === false && member.is_department_head) {
      const { error: departmentError } = await db
        .from('departments')
        .update({ head_user_id: null })
        .eq('id', member.department_id)
        .eq('head_user_id', member.user_id)

      if (departmentError) throw departmentError
    }

    const { error } = await db
      .from('department_members')
      .update(parsed)
      .eq('id', memberId)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ──────────────────────────────────────
// removeMember
// ──────────────────────────────────────
export async function removeMember(memberId: string): Promise<DepartmentMemberActionResult> {
  try {
    await requirePermission('departments', 'manage')
    const db = getOrganizationDb()

    const { data: currentMember, error: memberError } = await db
      .from('department_members')
      .select('department_id, user_id, is_department_head')
      .eq('id', memberId)
      .single()

    if (memberError) throw memberError
    if (!currentMember) throw new Error('Участник отдела не найден')

    const member = currentMember as Pick<
      DepartmentMember,
      'department_id' | 'user_id' | 'is_department_head'
    >

    if (member.is_department_head) {
      const { error: departmentError } = await db
        .from('departments')
        .update({ head_user_id: null })
        .eq('id', member.department_id)

      if (departmentError) throw departmentError
    }

    const { error: reportsToError } = await db
      .from('department_members')
      .update({ reports_to_user_id: null })
      .eq('department_id', member.department_id)
      .eq('reports_to_user_id', member.user_id)

    if (reportsToError) throw reportsToError

    const { error } = await db
      .from('department_members')
      .delete()
      .eq('id', memberId)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
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
