import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { id } = await params

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/specification`, { cache: 'no-store' })
    return forwardJsonResponse(res, 'Не удалось загрузить PDF-спецификацию')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось загрузить PDF-спецификацию')
  }
}
