import { isAuthServiceUnavailable } from '@/lib/auth/service-error'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { ROUTES } from '@/lib/constants/routes'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-current-pathname', pathname)

  let supabaseResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          requestHeaders.set('cookie', request.cookies.toString())
          supabaseResponse = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            const { sameSite, ...rest } = options || {}
            supabaseResponse.cookies.set(name, value, {
              ...rest,
              sameSite: sameSite as 'strict' | 'lax' | 'none' | undefined,
            })
          })
        },
      },
    }
  )

  const {
    data: { user }, error: authError,
  } = await supabase.auth.getUser()

  const allowsRouteLevelAuth =
    pathname === '/reset-password' ||
    pathname === '/api/access/snapshot' ||
    pathname.startsWith('/api/version') ||
    pathname.startsWith('/api/documents/generate') ||
    pathname.startsWith('/api/telegram/webhook') ||
    pathname.startsWith('/api/meetings/reminders') ||
    pathname.startsWith('/api/meetings/rules/evaluate') ||
    pathname.startsWith('/api/tasks/due') ||
    pathname === '/api/organization/auth-sync' ||
    pathname.startsWith('/api/mail/pubsub') ||
    pathname.startsWith('/api/mail/watch/renew')

  if ((!user && allowsRouteLevelAuth) || (isAuthServiceUnavailable(authError))) {
    return supabaseResponse
  }

  if (!user && !pathname.startsWith(ROUTES.LOGIN)) {
    const url = request.nextUrl.clone()
    url.pathname = ROUTES.LOGIN
    return NextResponse.redirect(url)
  }

  if (user && pathname.startsWith(ROUTES.LOGIN)) {
    const { data: profile } = await supabase
      .from('users')
      .select('id, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.id && profile.is_active === true) {
      const url = request.nextUrl.clone()
      url.pathname = ROUTES.DASHBOARD
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
