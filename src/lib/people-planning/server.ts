import 'server-only'

import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import type { UserRole } from '@/lib/types'
import type { PeoplePlanningPeriod, PeoplePlanningView } from '@/lib/people-planning/types'
import { planningDateRange } from '@/lib/people-planning/slots'

const DIRECTORS: UserRole[] = ['financial_director', 'commercial_director', 'planning_director']
const ALLOWED_ROLES: UserRole[] = [...DIRECTORS, 'production_manager']
const uuid = z.string().uuid()
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

type PeriodRpc = {
  rpc: (fn: 'fn_people_planning_period', args: {
    p_factory_id: string
    p_start_date: string
    p_end_date: string
  }) => Promise<{ data: unknown; error: { message?: string } | null }>
}

export async function getPeoplePlanningPeriod(input: {
  factoryId: string
  date: string
  view: PeoplePlanningView
}, permissionContext?: Awaited<ReturnType<typeof requirePermission>>): Promise<PeoplePlanningPeriod> {
  const context = permissionContext || await requirePermission('production_fact', 'view')
  if (!ALLOWED_ROLES.includes(context.role)) throw new Error('Нет доступа к планированию людей')

  const factoryId = uuid.parse(input.factoryId)
  const selectedDate = dateOnly.parse(input.date)
  const view: PeoplePlanningView = input.view === 'week' ? 'week' : 'day'
  if (context.role === 'production_manager') {
    if (!context.factoryId) throw new Error('Для начальника производства не указан завод')
    if (context.factoryId !== factoryId) throw new Error('Недостаточно прав для выбранного завода')
  }

  const dates = planningDateRange(selectedDate, view)
  const { data, error } = await (context.supabase as unknown as PeriodRpc).rpc('fn_people_planning_period', {
    p_factory_id: factoryId,
    p_start_date: selectedDate,
    p_end_date: dates.at(-1)!,
  })
  if (error) throw new Error(error.message || 'Не удалось загрузить назначения')

  return {
    selectedDate,
    view,
    dates,
    assignments: (data || []) as PeoplePlanningPeriod['assignments'],
  }
}
