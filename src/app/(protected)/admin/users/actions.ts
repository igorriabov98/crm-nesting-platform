'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createUserSchema, resetPasswordSchema, type CreateUserInput, type UpdateUserInput } from '@/lib/types/schemas'
import type { CurrentUser, FactorySummary } from '@/lib/types'

type DbResult = { data?: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseAdminDb = { from: (table: string) => LooseQuery }

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }

  return 'Неизвестная ошибка'
}

async function requireAdmin() {
  const context = await requirePermission('admin_users', 'manage')
  return { id: context.user.id, role: context.role } satisfies Pick<CurrentUser, 'id' | 'role'>
}

async function getUsersForAdmin() {
  const adminSupabase = createAdminClient()

  const { data, error } = await adminSupabase
    .from('users')
    .select('id, email, full_name, role, factory_id, telegram_chat_id, is_active, created_at, factory:factories(name)')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []) as CurrentUser[]
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

function normalizeUserFactory(role: string | undefined, factoryId: string | null | undefined) {
  if (role === 'production_manager') {
    if (!factoryId) throw new Error('Для начальника производства нужно выбрать завод')
    return factoryId
  }

  return null
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined
  const trimmed = value?.trim() || ''
  return trimmed || null
}

async function getFirstActiveProductionManager(db: LooseAdminDb, factoryId: string, excludeUserId: string) {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('role', 'production_manager')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .neq('id', excludeUserId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  return ((data || []) as { id: string }[])[0]?.id || null
}

async function reassignProductionManagerTasks(db: LooseAdminDb, userId: string, nextFactoryId: string | null) {
  const { data, error } = await db
    .from('tasks')
    .select('id, machine:machines(id, factory_id)')
    .eq('assigned_to', userId)
    .in('status', ['pending', 'in_progress'])

  if (error) throw error

  const tasks = (data || []) as {
    id: string
    machine: { id: string; factory_id: string | null } | null
  }[]

  const replacementByFactory = new Map<string, string>()

  for (const task of tasks) {
    const machineFactoryId = task.machine?.factory_id || null
    if (!machineFactoryId || machineFactoryId === nextFactoryId) continue

    let replacementId: string | null | undefined = replacementByFactory.get(machineFactoryId)
    if (!replacementId) {
      replacementId = await getFirstActiveProductionManager(db, machineFactoryId, userId)
      if (!replacementId) {
        throw new Error('Не найден активный начальник производства для переназначения задач')
      }
      replacementByFactory.set(machineFactoryId, replacementId)
    }

    const { error: updateError } = await db
      .from('tasks')
      .update({ assigned_to: replacementId, updated_at: new Date().toISOString() })
      .eq('id', task.id)

    if (updateError) throw updateError
  }
}

export async function getFactories() {
  try {
    await requireAdmin()
    const data = await getFactoriesForAdmin()

    return { data, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// === ПОЛУЧЕНИЕ ===
export async function getUsers() {
  try {
    await requireAdmin()
    const data = await getUsersForAdmin()

    return { data, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUsersPageData() {
  try {
    const currentUser = await requireAdmin()
    const [users, factories] = await Promise.all([
      getUsersForAdmin(),
      getFactoriesForAdmin(),
    ])

    return {
      data: { currentUser: { id: currentUser.id }, users, factories },
      error: null,
    }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getUserCreatePageData() {
  try {
    await requireAdmin()
    const factories = await getFactoriesForAdmin()

    return { data: { factories }, error: null }
  } catch (error: unknown) {
    return { data: null, error: getErrorMessage(error) }
  }
}

// === СОЗДАНИЕ ===
export async function createUser(data: CreateUserInput) {
  try {
    await requireAdmin()
    const parsed = createUserSchema.parse(data)
    const adminSupabase = createAdminClient()
    const db = adminSupabase as unknown as LooseAdminDb
    const factoryId = normalizeUserFactory(parsed.role, parsed.factory_id)

    // 1. Создаем auth.users рекорд
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
    })

    if (authError) throw authError
    if (!authData.user) throw new Error('Ошибка при создании пользователя (auth)')

    // 2. Создаем users рекорд
    const { error: dbError } = await db.from('users')
      .insert({
        id: authData.user.id,
        email: parsed.email,
        full_name: parsed.full_name,
        role: parsed.role,
        factory_id: factoryId,
        telegram_chat_id: parsed.telegram_chat_id || null,
        is_active: true,
      })

    // 3. Откат в случае ошибки
    if (dbError) {
      await adminSupabase.auth.admin.deleteUser(authData.user.id)
      throw dbError
    }

    revalidatePath(ROUTES.ADMIN_USERS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// === ОБНОВЛЕНИЕ ===
export async function updateUser(userId: string, data: UpdateUserInput) {
  try {
    const currentUser = await requireAdmin()
    const adminSupabase = createAdminClient()
    const db = adminSupabase as unknown as LooseAdminDb

    const { data: existingUserData, error: existingUserError } = await db
      .from('users')
      .select('id, role, factory_id, full_name, telegram_chat_id, is_active')
      .eq('id', userId)
      .single()

    if (existingUserError || !existingUserData) throw existingUserError || new Error('Пользователь не найден')
    const existingUser = existingUserData as {
      id: string
      role: string
      factory_id: string | null
      full_name: string
      telegram_chat_id: string | null
      is_active: boolean
    }
    const nextRole = data.role || existingUser.role
    const roleOrFactoryChanged = data.role !== undefined || data.factory_id !== undefined
    const nextFactoryId = roleOrFactoryChanged
      ? normalizeUserFactory(nextRole, nextRole === 'production_manager' ? data.factory_id ?? existingUser.factory_id : null)
      : existingUser.factory_id

    const updateData: Record<string, unknown> = {}
    if (data.full_name !== undefined) updateData.full_name = data.full_name
    if (data.telegram_chat_id !== undefined) updateData.telegram_chat_id = normalizeOptionalText(data.telegram_chat_id)

    if (userId !== currentUser.id) {
      if (data.role !== undefined) updateData.role = data.role
      if (roleOrFactoryChanged) updateData.factory_id = nextFactoryId
      if (data.is_active !== undefined) updateData.is_active = data.is_active
    }

    if (userId !== currentUser.id && existingUser.role === 'production_manager' && existingUser.factory_id !== nextFactoryId) {
      await reassignProductionManagerTasks(db, userId, nextFactoryId)
    }

    if (Object.keys(updateData).length > 0) {
      const { error: dbError } = await db.from('users')
        .update(updateData)
        .eq('id', userId)

      if (dbError) throw dbError
    }

    // 2. Синхронизация статуса блокировки (is_active) с auth.users
    if (userId !== currentUser.id && data.is_active !== undefined) {
      const banDuration = data.is_active ? 'none' : '876600h' // 100 лет (≈ навсегда)
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

// === СБРОС ПАРОЛЯ ===
export async function resetUserPassword(userId: string, newPassword: string) {
  try {
    await requireAdmin()
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

// === УДАЛЕНИЕ ===
export async function deleteUser(userId: string) {
  try {
    const currentUser = await requireAdmin()

    if (userId === currentUser.id) {
      throw new Error('Невозможно удалить собственный аккаунт')
    }

    const adminSupabase = createAdminClient()

    // 1. Удаляем из таблицы (хотя RLS и cascading могут сделать это за нас, 
    // надежнее сначала удалить auth юзера, каскад автоматически снесет record в users)
    const { error } = await adminSupabase.auth.admin.deleteUser(userId)

    if (error) throw error

    revalidatePath(ROUTES.ADMIN_USERS)
    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

