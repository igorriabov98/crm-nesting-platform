import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, getNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getNestingProxyAccess({ resourceKey: 'nesting', operation: 'view' })
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(id, access.context!)
  if (deniedProject) return deniedProject

  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/specification`, { cache: 'no-store' })
    return forwardJsonResponse(res, 'Не удалось загрузить PDF-спецификацию')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось загрузить PDF-спецификацию')
  }
}
