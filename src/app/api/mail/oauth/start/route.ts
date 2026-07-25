import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { mailBaseUrl, requireMailSettings } from '@/lib/mail/config'

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
]

export async function GET(request: NextRequest) {
  const context = await getCurrentUserContext()
  if (!context) return NextResponse.redirect(new URL('/login', request.url))
  const settings = await requireMailSettings()
  const state = randomBytes(32).toString('base64url')
  const cookieStore = await cookies()
  cookieStore.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/mail/oauth',
    maxAge: 10 * 60,
  })
  const callbackUrl = `${mailBaseUrl(request.url)}/api/mail/oauth/callback`
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', settings.clientId)
  url.searchParams.set('redirect_uri', callbackUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url)
}
