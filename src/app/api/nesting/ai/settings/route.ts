import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireNestingProxyAccess({ resourceKey: 'nesting_settings', operation: 'view' })
  if (denied) return denied

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/ai/settings`, { cache: 'no-store' })
    return forwardJsonResponse(res, 'Не удалось загрузить настройки AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось загрузить настройки AI')
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireNestingProxyAccess({ resourceKey: 'nesting_settings', operation: 'manage' })
  if (denied) return denied

  try {
    const body = await request.json().catch(() => ({}))
    const res = await fetch(`${getNestingServiceUrl()}/api/ai/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return forwardJsonResponse(res, 'Не удалось сохранить настройки AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось сохранить настройки AI')
  }
}
