import { WorkersWorkspace } from '@/components/features/production/WorkersWorkspace'
import { getWorkersWorkspace } from '@/lib/actions/people-planning'

export const metadata = { title: 'Работники — CRM LEDA' }

export default async function WorkersPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  try {
    const data = await getWorkersWorkspace({ factoryId: params?.factory })
    return <WorkersWorkspace key={data.selectedFactoryId} data={data} />
  } catch (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
        Не удалось открыть работников: {error instanceof Error ? error.message : 'неизвестная ошибка'}
      </div>
    )
  }
}
