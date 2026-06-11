import { NextResponse } from 'next/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canViewNesting } from '@/lib/utils/permissions'
import type { UserRole } from '@/lib/types'

type AccessMode = 'nesting' | 'director'

export async function requireNestingProxyAccess(mode: AccessMode): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 })
  }

  const { data: profile, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Профиль пользователя не найден' }, { status: 403 })
  }

  const role = (profile as unknown as { role: UserRole }).role
  const allowed = mode === 'director' ? DIRECTOR_ROLES.includes(role) : canViewNesting(role)

  if (!allowed) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  return null
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
