import { NextResponse } from 'next/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canViewNesting } from '@/lib/utils/permissions'
import type { UserRole } from '@/lib/types'

type AccessMode = 'nesting' | 'director'

export type NestingProxyContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  userId: string
  role: UserRole
  isDirector: boolean
}

export async function getNestingProxyAccess(mode: AccessMode): Promise<{
  context: NestingProxyContext | null
  response: NextResponse | null
}> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { context: null, response: NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 }) }
  }

  const { data: profile, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return { context: null, response: NextResponse.json({ error: 'Профиль пользователя не найден' }, { status: 403 }) }
  }

  const role = (profile as unknown as { role: UserRole }).role
  const isDirector = DIRECTOR_ROLES.includes(role)
  const allowed = mode === 'director' ? isDirector : canViewNesting(role)

  if (!allowed) {
    return { context: null, response: NextResponse.json({ error: 'Нет доступа' }, { status: 403 }) }
  }

  return {
    context: {
      supabase,
      userId: user.id,
      role,
      isDirector,
    },
    response: null,
  }
}

export async function requireNestingProxyAccess(mode: AccessMode): Promise<NextResponse | null> {
  const access = await getNestingProxyAccess(mode)
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
