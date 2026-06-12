import { NextRequest } from 'next/server'
import { getNestingServiceUrl } from '@/lib/nesting/api'
import { forwardJsonResponse, requireNestingProxyAccess, serviceUnavailable } from '@/lib/nesting/proxy-auth'
import { getSteelTypes } from '@/lib/actions/steel-types'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { id } = await params

  try {
    const steelTypes = await getSteelTypes()
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/analyze-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
