import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { INVOICE_VISIBLE_ROLES } from '@/lib/constants/roles'
import { ROUTES } from '@/lib/constants/routes'
import type { CurrentUser, Factory, User, UserDepartmentMembershipSummary } from '@/lib/types'

export class AuthRequiredError extends Error {
  constructor() {
    super('Необходима авторизация')
    this.name = 'AuthRequiredError'
  }
}

export class UserProfileMissingError extends Error {
  constructor(causeMessage?: string) {
    super(causeMessage ? `Профиль пользователя не найден: ${causeMessage}` : 'Профиль пользователя не найден')
    this.name = 'UserProfileMissingError'
  }
}

export class UserInactiveError extends Error {
  constructor() {
    super('Пользователь заблокирован')
    this.name = 'UserInactiveError'
  }
}

export type CurrentUserContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  userId: string
  user: CurrentUser
  role: CurrentUser['role']
  factoryId: string | null
  factory: CurrentUser['factory'] | null
  canViewInvoices: boolean
}

export const getCurrentUserContext = cache(async (): Promise<CurrentUserContext> => {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new AuthRequiredError()

  const { data: profile, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, factory_id, is_active, created_at')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !profile) throw new UserProfileMissingError(error?.message)

  const baseProfile = profile as Pick<User, 'id' | 'email' | 'full_name' | 'role' | 'factory_id' | 'is_active' | 'created_at'>
  if (baseProfile.is_active === false) {
    throw new UserInactiveError()
  }

  const profileRow = {
    ...baseProfile,
    telegram_chat_id: null,
    updated_at: baseProfile.created_at,
  } as User
  let factory: Factory | null = null
  if (profileRow.factory_id) {
    const { data: factoryData } = await supabase
      .from('factories')
      .select('id, name, created_at')
      .eq('id', profileRow.factory_id)
      .maybeSingle()
    factory = (factoryData as Factory | null) || null
  }

  const { data: membershipData } = await supabase
    .from('department_members')
    .select('department:departments(id, name), position:positions(id, name, level), is_department_head')
    .eq('user_id', user.id)

  const departmentMemberships = Array.isArray(membershipData)
    ? (membershipData as UserDepartmentMembershipSummary[])
    : []

  const currentUser = { ...profileRow, factory, department_memberships: departmentMemberships } as unknown as CurrentUser
  return {
    supabase,
    userId: user.id,
    user: currentUser,
    role: currentUser.role,
    factoryId: currentUser.factory_id,
    factory: currentUser.factory ?? null,
    canViewInvoices: INVOICE_VISIBLE_ROLES.includes(currentUser.role),
  }
})

export async function getCurrentUserContextOrRedirect() {
  try {
    return await getCurrentUserContext()
  } catch (error) {
    if (error instanceof AuthRequiredError || error instanceof UserProfileMissingError || error instanceof UserInactiveError) {
      redirect(ROUTES.LOGIN)
    }
    throw error
  }
}
