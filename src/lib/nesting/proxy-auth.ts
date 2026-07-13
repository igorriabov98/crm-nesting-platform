import { NextResponse } from 'next/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import {
  AuthRequiredError,
  UserInactiveError,
  UserProfileMissingError,
} from '@/lib/auth/current-user'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { PermissionOperation, ResourceKey } from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

export type NestingProxyAccessRequirement = {
  resourceKey: Extract<ResourceKey, 'nesting' | 'nesting_settings'>
  operation: PermissionOperation
}

export type NestingProxyContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  userId: string
  role: UserRole
  isDirector: boolean
}

export async function getNestingProxyAccess(requirement: NestingProxyAccessRequirement): Promise<{
  context: NestingProxyContext | null
  response: NextResponse | null
}> {
  try {
    const permissionContext = await requirePermission(requirement.resourceKey, requirement.operation)
    const role = permissionContext.role as UserRole
    return {
      context: {
        supabase: permissionContext.supabase,
        userId: permissionContext.userId,
        role,
        isDirector: DIRECTOR_ROLES.includes(role),
      },
      response: null,
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return { context: null, response: NextResponse.json({ error: error.message }, { status: 401 }) }
    }
    if (error instanceof PermissionDeniedError || error instanceof UserProfileMissingError || error instanceof UserInactiveError) {
      return { context: null, response: NextResponse.json({ error: error.message }, { status: 403 }) }
    }
    return {
      context: null,
      response: NextResponse.json(
        { error: `Не удалось проверить доступ: ${error instanceof Error ? error.message : 'неизвестная ошибка'}` },
        { status: 503 },
      ),
    }
  }
}

export async function requireNestingProxyAccess(requirement: NestingProxyAccessRequirement): Promise<NextResponse | null> {
  const access = await getNestingProxyAccess(requirement)
  return access.response
}

export async function forwardJsonResponse(res: Response, fallbackMessage: string) {
  const data = await res.json().catch(async () => {
    const text = await res.text().catch(() => '')
    return { error: text || fallbackMessage }
  })

  return NextResponse.json(data, { status: res.status })
}

export function serviceUnavailable(error: unknown, action: string) {
  return NextResponse.json(
    {
      error: `${action}: сервис раскладки недоступен (${error instanceof Error ? error.message : 'неизвестная ошибка'})`,
    },
    { status: 503 }
  )
}
