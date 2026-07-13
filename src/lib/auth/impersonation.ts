import 'server-only'

import { createServerClient, DEFAULT_COOKIE_OPTIONS, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { CRM_ADMIN_POSITION_NAME } from '@/lib/permissions/server'
import type { Database } from '@/lib/types/database'
import {
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_SECONDS,
  decodeImpersonationMarker,
  encodeImpersonationMarker,
  getImpersonationBackupCookieName,
  getSupabaseAuthCookieBaseName,
  isSupabaseAuthCookieName,
  type ImpersonationMarker,
} from './impersonation-state'

type CookieStore = Awaited<ReturnType<typeof cookies>>

type MembershipRow = {
  position?: { name: string | null } | { name: string | null }[] | null
}

const isSecureCookie = process.env.NODE_ENV === 'production'

function authCookieOptions(options: CookieOptions = {}) {
  const { sameSite, ...rest } = options
  return {
    ...rest,
    secure: options.secure ?? isSecureCookie,
    sameSite: sameSite === true ? 'strict' as const : sameSite as 'strict' | 'lax' | 'none' | undefined,
  }
}

function setExpiredCookie(cookieStore: CookieStore, name: string, httpOnly: boolean) {
  cookieStore.set(name, '', {
    path: '/',
    sameSite: 'lax',
    secure: isSecureCookie,
    httpOnly,
    maxAge: 0,
  })
}

function getAuthCookieBaseName() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  return getSupabaseAuthCookieBaseName(supabaseUrl)
}

export async function getImpersonationContext(currentUserId?: string) {
  const cookieStore = await cookies()
  const marker = decodeImpersonationMarker(
    cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value,
    getAuthCookieBaseName(),
  )
  if (!marker) return null
  if (currentUserId && marker.targetUserId !== currentUserId) return null
  return marker
}

export async function backupOriginalSession(
  marker: Omit<ImpersonationMarker, 'savedCookies'>,
): Promise<ImpersonationMarker> {
  const cookieStore = await cookies()
  const authCookieBaseName = getAuthCookieBaseName()
  const originalCookies = cookieStore.getAll()
    .filter((cookie) => isSupabaseAuthCookieName(cookie.name, authCookieBaseName))
    .sort((left, right) => left.name.localeCompare(right.name))

  if (originalCookies.length === 0) {
    throw new Error('Не удалось сохранить текущую сессию администратора')
  }

  const savedCookies = originalCookies.map((cookie, index) => {
    const backupName = getImpersonationBackupCookieName(index)
    cookieStore.set(backupName, cookie.value, {
      path: '/',
      sameSite: 'lax',
      secure: isSecureCookie,
      httpOnly: true,
      maxAge: IMPERSONATION_MAX_AGE_SECONDS,
      priority: 'high',
    })
    return { originalName: cookie.name, backupName }
  })

  const completedMarker: ImpersonationMarker = { ...marker, savedCookies }
  cookieStore.set(IMPERSONATION_COOKIE_NAME, encodeImpersonationMarker(completedMarker), {
    path: '/',
    sameSite: 'lax',
    secure: isSecureCookie,
    httpOnly: true,
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
    priority: 'high',
  })

  return completedMarker
}

export async function restoreOriginalSession(marker: ImpersonationMarker) {
  const cookieStore = await cookies()
  const authCookieBaseName = getAuthCookieBaseName()
  const memoryCookies = new Map<string, string>()

  for (const savedCookie of marker.savedCookies) {
    const value = cookieStore.get(savedCookie.backupName)?.value
    if (!value) {
      await clearImpersonationSession(marker)
      return { success: false as const, error: 'Сохранённая сессия администратора истекла' }
    }
    memoryCookies.set(savedCookie.originalName, value)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase environment is not configured')

  const originalClient = createServerClient<Database>(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return Array.from(memoryCookies, ([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          if (!value || options?.maxAge === 0) memoryCookies.delete(name)
          else memoryCookies.set(name, value)
        }
      },
    },
  })

  const { data: { user }, error } = await originalClient.auth.getUser()
  if (error || !user || user.id !== marker.adminUserId || !(await isActiveCrmAdministrator(user.id))) {
    await clearImpersonationSession(marker)
    return { success: false as const, error: 'Не удалось подтвердить сессию администратора' }
  }

  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookieName(cookie.name, authCookieBaseName)) {
      setExpiredCookie(cookieStore, cookie.name, false)
    }
  }

  for (const [name, value] of memoryCookies) {
    if (!isSupabaseAuthCookieName(name, authCookieBaseName)) continue
    cookieStore.set(name, value, authCookieOptions(DEFAULT_COOKIE_OPTIONS))
  }

  clearMarkerAndBackups(cookieStore, marker)
  return { success: true as const }
}

export async function clearImpersonationSession(marker?: ImpersonationMarker | null) {
  const cookieStore = await cookies()
  const authCookieBaseName = getAuthCookieBaseName()
  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookieName(cookie.name, authCookieBaseName)) {
      setExpiredCookie(cookieStore, cookie.name, false)
    }
  }
  clearMarkerAndBackups(cookieStore, marker)
}

function clearMarkerAndBackups(cookieStore: CookieStore, marker?: ImpersonationMarker | null) {
  setExpiredCookie(cookieStore, IMPERSONATION_COOKIE_NAME, true)
  const backupNames = marker?.savedCookies.map((cookie) => cookie.backupName)
    ?? Array.from({ length: 10 }, (_, index) => getImpersonationBackupCookieName(index))
  for (const backupName of backupNames) setExpiredCookie(cookieStore, backupName, true)
}

async function isActiveCrmAdministrator(userId: string) {
  const supabase = createAdminClient()
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('users').select('id, is_active').eq('id', userId).maybeSingle(),
    supabase
      .from('department_members')
      .select('position:positions(name)')
      .eq('user_id', userId),
  ])

  const profileRow = profile as { id: string; is_active: boolean | null } | null
  if (!profileRow || profileRow.is_active === false || !Array.isArray(memberships)) return false
  return (memberships as MembershipRow[]).some((membership) => {
    const position = Array.isArray(membership.position) ? membership.position[0] : membership.position
    return position?.name === CRM_ADMIN_POSITION_NAME
  })
}
