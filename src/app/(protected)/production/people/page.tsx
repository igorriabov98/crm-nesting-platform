import { PeoplePlanningBoard } from '@/components/features/production/PeoplePlanningBoard'
import { getPeoplePlanningWorkspace } from '@/lib/actions/people-planning'

export const metadata = { title: 'Планирование людей — CRM LEDA' }

export default async function PeoplePlanningPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string; date?: string; month?: string; view?: string }>
}) {
  const params = await searchParams
  try {
    const data = await getPeoplePlanningWorkspace({
      factoryId: params?.factory,
      date: params?.date,
      month: params?.month,
      view: params?.view === 'week' ? 'week' : 'day',
    })
    return <PeoplePlanningBoard data={data} />
  } catch (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Не удалось открыть планирование людей: {error instanceof Error ? error.message : 'неизвестная ошибка'}
      </div>
    )
  }
}
