import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { NestingProjectFilters } from '@/components/features/nesting/NestingProjectFilters'
import { NestingProjectsTable } from '@/components/features/nesting/NestingProjectsTable'
import { NestingQueueClient } from '@/components/features/nesting/NestingQueueClient'
import { getNestingQueue } from '@/lib/actions/nesting-batches'
import { getProjects, type NestingStatus } from '@/lib/nesting/api'
import { nestingStatuses } from '@/lib/nesting/status'
import { cn } from '@/lib/utils'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = { title: 'Раскладка металла - CRM Завода' }

const statuses: NestingStatus[] = [...nestingStatuses]

export default async function NestingProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; status?: string; search?: string; view?: string; scope?: string }>
}) {
  await requirePermission('nesting', 'view')
  const params = await searchParams
  const view = params?.view === 'history' ? 'history' : 'queue'
  const scope = params?.scope === 'tasks' ? 'tasks' : 'all'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link
          href="/nesting"
          className={cn(buttonVariants({ variant: view === 'queue' ? 'default' : 'outline', size: 'sm' }), 'min-w-32')}
        >
          Очередь
        </Link>
        <Link
          href="/nesting?view=history"
          className={cn(buttonVariants({ variant: view === 'history' ? 'default' : 'outline', size: 'sm' }), 'min-w-32')}
        >
          История проектов
        </Link>
      </div>

      {view === 'history' ? (
        <HistoryView params={params} />
      ) : (
        <QueueView scope={scope} />
      )}
    </div>
  )
}

async function QueueView({ scope }: { scope: 'tasks' | 'all' }) {
  const result = await getNestingQueue(scope)

  if (!result.success || !result.data) {
    return (
      <Card className="bg-white">
        <CardContent>
          <p className="text-sm font-medium text-red-600">
            {result.error || 'Не удалось загрузить очередь раскладки'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return <NestingQueueClient queue={result.data} />
}

async function HistoryView({
  params,
}: {
  params?: { page?: string; status?: string; search?: string; view?: string; scope?: string }
}) {
  const page = Math.max(1, Number(params?.page || 1))
  const search = params?.search?.trim() || ''
  const status = statuses.includes(params?.status as NestingStatus) ? params?.status : undefined

  try {
    const result = await getProjects({ page, limit: 20, status, search })

    return (
      <div className="space-y-4">
        <NestingProjectFilters search={search} status={status || 'all'} />
        <NestingProjectsTable projects={result.data} page={result.page || page} totalPages={result.totalPages} />
      </div>
    )
  } catch (error) {
    return (
      <Card className="bg-white">
        <CardContent>
          <p className="text-sm font-medium text-red-600">
            {error instanceof Error ? error.message : 'Не удалось загрузить проекты раскладки'}
          </p>
        </CardContent>
      </Card>
    )
  }
}
