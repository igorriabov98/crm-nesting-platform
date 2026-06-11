import { getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/ai/status`, { cache: 'no-store' })
    return forwardJsonResponse(res, 'Не удалось проверить статус AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось проверить статус AI')
  }
}
