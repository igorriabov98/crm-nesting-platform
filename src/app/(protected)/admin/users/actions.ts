'use server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { resetPasswordSchema, type CreateUserInput, type UpdateUserInput } from '@/lib/types/schemas'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { CurrentUser, FactorySummary, UserDepartmentMembershipSummary } from '@/lib/types'

type DbResult = { data?: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseAdminDb = { from: (table: string) => LooseQuery }

type DepartmentMembershipRow = UserDepartmentMembershipSummary & {
  user_id: string
}

export type UserCreateOption = {
  id: string
  name: string
}

export type UserSupervisorOption = {
  id: string
  full_name: string | null
  email: string
}

async function requireUsersView() {
  const context = await requirePermission('admin_users', 'view')
  return context
}

async function requireUsersManage() {
  const context = await requirePermission('admin_users', 'manage')
  return context
}

async function getUsersForAdmin() {
  const adminSupabase = createAdminClient()

  const { data, error } = await adminSupabase
    .from('users')
    .select('id, email, full_name, role, factory_id, telegram_chat_id, is_active, created_at, factory:factories(name)')
    .order('created_at', { ascending: false })

  if (error) throw error

  const authUserIds = new Set<string>()
  const perPage = 1000
  let page = 1

  while (true) {
    const { data: authData, error: authError } = await adminSupabase.auth.admin.listUsers({ page, perPage })
    if (authError) throw authError

    for (const authUser of authData.users) {
      authUserIds.add(authUser.id)
    }

    if (authData.users.length < perPage) break
    page += 1
  }

  return ((data || []) as CurrentUser[]).filter((user) => authUserIds.has(user.id))
}

async function getFactoriesForAdmin(supabase = createServerSupabaseClient()) {
  const client = await supabase

  const { data, error } = await client
    .from('factories')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) throw error

  return (data || []) as FactorySummary[]
}

async function getDepartmentsForAdmin() {
  const db = createAdminClient() as unknown as LooseAdminDb
  const { data, error } = await db
    .from('departments')
    .select('id, name, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return (data || []) as UserCreateOption[]
}

async function getPositionsForAdmin() {
  const db = createAdminClient() as unknown as LooseAdminDb
  const { data, error } = await db
    .from('positions')
    .select('id, name, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return (data || []) as UserCreateOption[]
}

async function getActiveUsersForAdmin() {
  const db = createAdminClient() as unknown as LooseAdminDb
  const { data, error } = await db
    .from('users')
    .select('id, full_name, email')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) throw error
  return (data || []) as UserSupervisorOption[]
}

function isMissingDepartmentMembershipsTable(error: { message?: string; code?: string }) {
  return error.code === 'PGRST205'
    || (
      /department_members/i.test(error.message || '')
      && /schema cache|could not find/i.test(error.message || '')
    )
}

async function getDepartmentMembershipsForAdmin() {
  const db = createAdminClient() as unknown as LooseAdminDb
  const { data, error } = await db
    .from('department_members')
    .select(`
      user_id,
      department:departments(id, name),
      position:positions(id, name, level),
      is_department_head
    `)

  if (error) {
    if (isMissingDepartmentMembershipsTable(error)) return []
    throw error
  }

  return (data || []) as DepartmentMembershipRow[]
}

export async function getFactories() {
  try {
    await requireUsersView()
    const data = await getFactoriesForAdmin()

    return { data, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUsers() {
  try {
    await requireUsersView()
    const data = await getUsersForAdmin()

    return { data, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUsersPageData() {
  try {
    const context = await requireUsersView()
    const [users, factories, memberships] = await Promise.all([
      getUsersForAdmin(),
      getFactoriesForAdmin(),
      getDepartmentMembershipsForAdmin(),
    ])

    const membershipsByUser = new Map<string, UserDepartmentMembershipSummary[]>()

    for (const { user_id: userId, ...membership } of memberships) {
      const userMemberships = membershipsByUser.get(userId) || []
      userMemberships.push(membership)
      membershipsByUser.set(userId, userMemberships)
    }

    const usersWithMemberships = users.map((user) => ({
      ...user,
      department_memberships: membershipsByUser.get(user.id) || [],
    }))

    return {
      data: {
        currentUser: { id: context.user.id },
        users: usersWithMemberships,
        factories,
        canManage: context.permissions.admin_users?.canManage === true,
      },
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUserCreatePageData() {
  try {
    await requireUsersManage()
    const [factories, departments, positions, users] = await Promise.all([
      getFactoriesForAdmin(),
      getDepartmentsForAdmin(),
      getPositionsForAdmin(),
      getActiveUsersForAdmin(),
    ])

    return { data: { factories, departments, positions, users }, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createUser(data: CreateUserInput) {
  void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

export async function updateUser(userId: string, data: UpdateUserInput) {
  void userId; void data
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}

export async function resetUserPassword(userId: string, newPassword: string) {
  try {
    const context=await requireUsersManage()
    const target=await createAdminClient().from('user_system_roles' as never).select('user_id').eq('user_id',userId).maybeSingle()
    if(target.error)throw new Error('Не удалось проверить статус пользователя')
    if(target.data&&!context.permissionDetails.isAdminPosition)throw new Error('Пароль администратора меняет администратор CRM')
    const parsed = resetPasswordSchema.parse({ password: newPassword, confirmPassword: newPassword })
    const adminSupabase = createAdminClient()

    const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
      password: parsed.password,
    })

    if (error) throw error

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteUser(userId: string) {
  void userId
  return {success:false,error:'Откройте раздел «Пользователи и структура» и повторите изменение с актуальными данными'}
}
