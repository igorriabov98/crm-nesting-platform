import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireNestingProxyAccess({ resourceKey: 'nesting_settings', operation: 'view' })
  if (denied) return denied

  const limit = request.nextUrl.searchParams.get('limit') || '50'

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/ai/usage?limit=${encodeURIComponent(limit)}`, { cache: 'no-store' })
    return forwardJsonResponse(res, 'Не удалось загрузить историю AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось загрузить историю AI')
  }
}
