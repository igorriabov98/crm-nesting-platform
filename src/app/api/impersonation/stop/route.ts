import { redirect } from 'next/navigation'
import { stopUserImpersonation } from '@/lib/actions/impersonation'
import { getImpersonationContext } from '@/lib/auth/impersonation'
import { ROUTES } from '@/lib/constants/routes'

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  await stopAndRedirect()
}

export async function GET(request: Request) {
  const marker = await getImpersonationContext()
  const auditId = new URL(request.url).searchParams.get('audit')

  if (!marker || auditId !== marker.auditId || !isSameOriginNavigation(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  await stopAndRedirect()
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

function isSameOriginNavigation(request: Request) {
  const referer = request.headers.get('referer')
  if (!referer) return false

  try {
    if (new URL(referer).origin !== new URL(request.url).origin) return false
  } catch {
    return false
  }

  const fetchSite = request.headers.get('sec-fetch-site')
  return !fetchSite || fetchSite === 'same-origin'
}

async function stopAndRedirect(): Promise<never> {
  const result = await stopUserImpersonation()
  redirect(result.redirectTo || ROUTES.LOGIN)
}
