import { getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const denied = await requireNestingProxyAccess('director')
  if (denied) return denied

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/ai/test-connection`, { method: 'POST' })
    return forwardJsonResponse(res, 'Не удалось проверить подключение AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось проверить подключение AI')
  }
}
