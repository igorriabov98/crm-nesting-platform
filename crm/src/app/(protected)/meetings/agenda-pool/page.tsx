import { ListChecks } from 'lucide-react'

import { AccessDenied } from '@/components/ui/AccessDenied'
import { AgendaPoolManager } from '@/components/features/meetings/AgendaPoolManager'
import { getAgendaPool, getAgendaPoolMeetingOptions, getMeetingTypes } from '@/app/(protected)/meetings/actions'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'Пул повесток | CRM Завода',
}

export default async function AgendaPoolPage() {
  const allowed = await requirePermission('meetings_agenda_pool', 'view')
    .then(() => true)
    .catch(() => false)
  if (!allowed) return <AccessDenied />

  const [{ data: poolItems, error: poolError }, { data: meetings, error: meetingsError }, { data: meetingTypes }] = await Promise.all([
    getAgendaPool(),
    getAgendaPoolMeetingOptions(),
    getMeetingTypes(),
  ])

  const error = poolError || meetingsError

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1B3A6B]">
            <ListChecks className="h-6 w-6" />
            Пул повесток
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Распределение автоматически найденных пунктов к запланированным собраниям.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки пула повесток: {error}
        </div>
      ) : (
        <AgendaPoolManager items={poolItems || []} meetings={meetings || []} meetingTypes={meetingTypes || []} />
      )}
    </div>
  )
}
