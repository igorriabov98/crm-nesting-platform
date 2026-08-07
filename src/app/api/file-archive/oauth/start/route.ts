import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions/server'
import { fileArchiveBaseUrl, requireDriveOAuthSettings } from '@/lib/file-archive/config'

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file']

export async function GET(request: NextRequest) {
  try {
    await requirePermission('file_archive_settings', 'manage')
    const settings = await requireDriveOAuthSettings()
    const state = randomBytes(32).toString('base64url')
    const cookieStore = await cookies()
    cookieStore.set('file_archive_oauth_state', state, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/file-archive/oauth',
      maxAge: 10 * 60,
    })
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', settings.clientId)
    url.searchParams.set('redirect_uri', `${fileArchiveBaseUrl(request.url)}/api/file-archive/oauth/callback`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent select_account')
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('state', state)
    return NextResponse.redirect(url)
  } catch (error) {
    const destination = new URL('/admin/settings/file-archive', request.url)
    destination.searchParams.set('error', error instanceof Error ? error.message : 'Не удалось начать OAuth')
    return NextResponse.redirect(destination)
  }
}
