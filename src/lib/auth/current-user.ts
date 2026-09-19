import { isAuthServiceUnavailable } from '@/lib/auth/service-error'
import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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
}

export const getCurrentUserContext = cache(async (): Promise<CurrentUserContext> => {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (isAuthServiceUnavailable(authError)) throw new Error('Не удалось проверить сессию')
  if (!user) throw new AuthRequiredError()

  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, role, factory_id, is_active, created_at')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('department_members')
      .select('department:departments(id, name), position:positions(id, name, level), is_department_head, is_primary')
      .eq('user_id', user.id),
  ])
  const { data: profile, error } = profileResult

  if (error) throw new Error('Не удалось прочитать профиль пользователя')
  if (!profile) throw new UserProfileMissingError()

  const baseProfile = profile as Pick<User, 'id' | 'email' | 'full_name' | 'role' | 'factory_id' | 'is_active' | 'created_at'>
  if (baseProfile.is_active !== true) {
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

  if (membershipResult.error) throw new Error('Не удалось проверить назначения пользователя')
  const { data: membershipData } = membershipResult

  const departmentMemberships = Array.isArray(membershipData)
    ? (membershipData as UserDepartmentMembershipSummary[]).sort((a,b)=>Number(b.is_primary)-Number(a.is_primary))
    : []

  const currentUser = { ...profileRow, factory, department_memberships: departmentMemberships } as unknown as CurrentUser
  return {
    supabase,
    userId: user.id,
    user: currentUser,
    role: currentUser.role,
    factoryId: currentUser.factory_id,
    factory: currentUser.factory ?? null,
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
