import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { getImpersonationContext } from '@/lib/auth/impersonation'
import { ROUTES } from '@/lib/constants/routes'

export async function GET(request: NextRequest) {
  if (!isTrustedNavigation(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const marker = await getImpersonationContext()
  const auditId = request.nextUrl.searchParams.get('audit')
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next'))

  if (!marker || marker.auditId !== auditId) {
    return NextResponse.redirect(new URL(ROUTES.LOGIN, request.url), 303)
  }

  try {
    const context = await getCurrentUserContext()
    if (context.userId !== marker.targetUserId) {
      return NextResponse.redirect(new URL(ROUTES.LOGIN, request.url), 303)
    }
  } catch {
    return NextResponse.redirect(new URL(ROUTES.LOGIN, request.url), 303)
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 303)
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
}

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return ROUTES.PROFILE
  try {
    const parsed = new URL(value, 'https://crm.local')
    if (parsed.origin !== 'https://crm.local') return ROUTES.PROFILE
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ROUTES.PROFILE
  }
}

function isTrustedNavigation(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}
