import { getPeoplePlanningWorkspace } from '@/lib/actions/people-planning'
import { getPeoplePlanningPeriod } from '@/lib/people-planning/server'
import { requirePermission } from '@/lib/permissions/server'

export const dynamic = 'force-dynamic'

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return /доступ|прав/i.test(message) ? 403 : 400
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const factoryId = params.get('factory') || ''
  const date = params.get('date') || ''
  const month = params.get('month') || undefined
  const view = params.get('view') === 'week' ? 'week' : 'day'

  try {
    const context = await requirePermission('production_fact', 'view')
    const data = params.get('scope') === 'period'
      ? await getPeoplePlanningPeriod({ factoryId, date, view }, context)
      : await getPeoplePlanningWorkspace({ factoryId, date, month, view })

    return Response.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Не удалось загрузить планирование' },
      { status: errorStatus(error), headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
}
