export const IMPERSONATION_COOKIE_NAME = 'crm-impersonation'
export const IMPERSONATION_BACKUP_COOKIE_PREFIX = 'crm-impersonation-admin-session'
export const IMPERSONATION_MAX_AGE_SECONDS = 8 * 60 * 60

export type SavedAuthCookie = {
  originalName: string
  backupName: string
}

export type ImpersonationMarker = {
  version: 1
  auditId: string
  adminUserId: string
  adminName: string
  targetUserId: string
  targetName: string
  startedAt: string
  savedCookies: SavedAuthCookie[]
}

export function getSupabaseAuthCookieBaseName(supabaseUrl: string) {
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  if (!projectRef) throw new Error('Не удалось определить cookie авторизации Supabase')
  return `sb-${projectRef}-auth-token`
}

export function isSupabaseAuthCookieName(name: string, baseName: string) {
  if (name === baseName) return true
  if (!name.startsWith(`${baseName}.`)) return false
  return /^\d+$/.test(name.slice(baseName.length + 1))
}

export function getImpersonationBackupCookieName(index: number) {
  return `${IMPERSONATION_BACKUP_COOKIE_PREFIX}-${index}`
}

export function encodeImpersonationMarker(marker: ImpersonationMarker) {
  return Buffer.from(JSON.stringify(marker), 'utf8').toString('base64url')
}

export function decodeImpersonationMarker(value: string | undefined, authCookieBaseName: string) {
  if (!value) return null

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ImpersonationMarker>
    if (parsed.version !== 1) return null
    if (!isNonEmptyString(parsed.auditId)) return null
    if (!isNonEmptyString(parsed.adminUserId) || !isNonEmptyString(parsed.adminName)) return null
    if (!isNonEmptyString(parsed.targetUserId) || !isNonEmptyString(parsed.targetName)) return null
    if (!isNonEmptyString(parsed.startedAt) || Number.isNaN(Date.parse(parsed.startedAt))) return null
    if (!Array.isArray(parsed.savedCookies) || parsed.savedCookies.length === 0 || parsed.savedCookies.length > 10) return null

    const savedCookies = parsed.savedCookies as SavedAuthCookie[]
    const originalNames = new Set<string>()
    for (const [index, cookie] of savedCookies.entries()) {
      if (!cookie || !isNonEmptyString(cookie.originalName) || !isNonEmptyString(cookie.backupName)) return null
      if (!isSupabaseAuthCookieName(cookie.originalName, authCookieBaseName)) return null
      if (cookie.backupName !== getImpersonationBackupCookieName(index)) return null
      if (originalNames.has(cookie.originalName)) return null
      originalNames.add(cookie.originalName)
    }

    return parsed as ImpersonationMarker
  } catch {
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
