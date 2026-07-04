import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, getNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getNestingProxyAccess('nesting')
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(id, access.context!)
  if (deniedProject) return deniedProject

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
