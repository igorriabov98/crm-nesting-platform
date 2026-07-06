import { NextRequest } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, getNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'
import { getSteelTypes } from '@/lib/actions/steel-types'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getNestingProxyAccess('nesting')
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(id, access.context!)
  if (deniedProject) return deniedProject

  try {
    const steelTypes = await getSteelTypes()
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/analyze-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appliedBy: access.context!.userId,
        steelTypes: steelTypes.map((steelType) => ({
          id: steelType.id,
          name: steelType.name,
          densityKgMm3: steelType.density_kg_mm3,
        })),
      }),
    })
    return forwardJsonResponse(res, 'Не удалось выполнить AI-анализ PDF')
  } catch (error) {
    return serviceUnavailable(error, 'Не удалось выполнить AI-анализ PDF')
  }
}
