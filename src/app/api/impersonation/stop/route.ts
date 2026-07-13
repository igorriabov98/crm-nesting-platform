import { redirect } from 'next/navigation'
import { stopUserImpersonation } from '@/lib/actions/impersonation'
import { ROUTES } from '@/lib/constants/routes'

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const result = await stopUserImpersonation()
  redirect(result.redirectTo || ROUTES.LOGIN)
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
