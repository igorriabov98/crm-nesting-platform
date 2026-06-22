'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createUserSchema, resetPasswordSchema, type CreateUserInput, type UpdateUserInput } from '@/lib/types/schemas'
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

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined
  const trimmed = value?.trim() || ''
  return trimmed || null
}

async function syncDepartmentHead(db: LooseAdminDb, departmentId: string, userId: string, isDepartmentHead: boolean) {
  if (!isDepartmentHead) return

  const { error: clearMembersError } = await db
    .from('department_members')
    .update({ is_department_head: false })
    .eq('department_id', departmentId)
    .neq('user_id', userId)

  if (clearMembersError) throw clearMembersError

  const { error: departmentError } = await db
    .from('departments')
    .update({ head_user_id: userId })
    .eq('id', departmentId)

  if (departmentError) throw departmentError
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
  let createdAuthUserId: string | null = null

  try {
    await requireUsersManage()
    const parsed = createUserSchema.parse(data)
    const adminSupabase = createAdminClient()
    const db = adminSupabase as unknown as LooseAdminDb

    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
    })

    if (authError) throw authError
    if (!authData.user) throw new Error('Ошибка при создании пользователя (auth)')
    createdAuthUserId = authData.user.id

    const { error: dbError } = await db.from('users')
      .insert({
        id: authData.user.id,
        email: parsed.email,
        full_name: parsed.full_name,
        role: parsed.role || 'engineer',
        factory_id: null,
        telegram_chat_id: parsed.telegram_chat_id || null,
        is_active: true,
      })

    if (dbError) throw dbError

    const { error: membershipError } = await db.from('department_members')
      .insert({
        user_id: authData.user.id,
        department_id: parsed.department_id,
        position_id: parsed.position_id,
        reports_to_user_id: parsed.reports_to_user_id || null,
        is_department_head: parsed.is_department_head === true,
      })

    if (membershipError) throw membershipError

    await syncDepartmentHead(db, parsed.department_id, authData.user.id, parsed.is_department_head === true)

    revalidatePath(ROUTES.ADMIN_USERS)
    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    if (createdAuthUserId) {
      const adminSupabase = createAdminClient()
      const db = adminSupabase as unknown as LooseAdminDb
      await db.from('users').delete().eq('id', createdAuthUserId)
      await adminSupabase.auth.admin.deleteUser(createdAuthUserId)
    }
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateUser(userId: string, data: UpdateUserInput) {
  try {
    const context = await requireUsersManage()
    const adminSupabase = createAdminClient()
    const db = adminSupabase as unknown as LooseAdminDb

    const updateData: Record<string, unknown> = {}
    if (data.full_name !== undefined) updateData.full_name = data.full_name
    if (data.telegram_chat_id !== undefined) updateData.telegram_chat_id = normalizeOptionalText(data.telegram_chat_id)

    if (userId !== context.user.id && data.is_active !== undefined) {
      updateData.is_active = data.is_active
    }

    if (Object.keys(updateData).length > 0) {
      const { error: dbError } = await db.from('users')
        .update(updateData)
        .eq('id', userId)

      if (dbError) throw dbError
    }

    if (userId !== context.user.id && data.is_active !== undefined) {
      const banDuration = data.is_active ? 'none' : '876600h'
      const { error: authError } = await adminSupabase.auth.admin.updateUserById(userId, {
        ban_duration: banDuration,
      })
      if (authError) throw authError
    }

    revalidatePath(ROUTES.ADMIN_USERS)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function resetUserPassword(userId: string, newPassword: string) {
  try {
    await requireUsersManage()
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
  try {
    const context = await requireUsersManage()

    if (userId === context.user.id) {
      throw new Error('Невозможно удалить собственный аккаунт')
    }

    const adminSupabase = createAdminClient()
    const db = adminSupabase as unknown as LooseAdminDb
    const { data: profileData, error: profileError } = await adminSupabase
      .from('users')
      .select('id, email, is_active')
      .eq('id', userId)
      .maybeSingle()
    const profile = profileData as { id: string; email: string; is_active: boolean | null } | null

    if (profileError) throw profileError
    if (!profile) throw new Error('Пользователь не найден')

    const { data: authData, error: authLookupError } = await adminSupabase.auth.admin.getUserById(userId)
    if (authLookupError && authLookupError.status !== 404) throw authLookupError

    // Keep historical foreign-key references intact while removing the account
    // from authentication and releasing its email for possible reuse.
    const { error: archiveError } = await db
      .from('users')
      .update({
        email: `deleted+${userId}@deleted.local`,
        is_active: false,
      })
      .eq('id', userId)

    if (archiveError) throw archiveError

    if (authData?.user) {
      const { error: authDeleteError } = await adminSupabase.auth.admin.deleteUser(userId)
      if (authDeleteError) {
        await db
          .from('users')
          .update({ email: profile.email, is_active: profile.is_active })
          .eq('id', userId)
        throw authDeleteError
      }
    }

    revalidatePath(ROUTES.ADMIN_USERS)
    revalidatePath(ROUTES.ADMIN_DEPARTMENTS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
