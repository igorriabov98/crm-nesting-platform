import { NextRequest } from 'next/server'
import { getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/apply-bom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return forwardJsonResponse(res, 'Не удалось применить предложения AI')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось применить предложения AI')
  }
}
