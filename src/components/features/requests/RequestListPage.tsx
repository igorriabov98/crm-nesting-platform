'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createRequest, type RequestLifecycleStatus, type TechnologistRequestListItem } from '@/lib/actions/technologist-requests'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'

type Props = {
  machine: {
    id: string
    name: string
  }
  requests: TechnologistRequestListItem[]
  canCreate: boolean
}

const lifecycleClasses: Record<RequestLifecycleStatus, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  stock_check: 'border-amber-200 bg-amber-50 text-amber-700',
  submitted_to_supply: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  delivery: 'border-blue-200 bg-blue-50 text-blue-700',
  received: 'border-green-300 bg-green-100 text-green-800',
}

function formatDate(value: string | null) {
  if (!value) return 'Дата не указана'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function RequestListPage({ machine, requests, canCreate }: Props) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const result = await createRequest(machine.id)
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось создать заявку')
      toast.success('Заявка создана')
      router.push(`${ROUTES.SALES_PLAN}/${machine.id}/request/${result.data.id}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать заявку')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <Button variant="ghost" className="-ml-2 text-slate-600" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${machine.id}`)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Назад к машине
      </Button>

      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-800">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-[#1B3A6B]">Заявки на материалы</h1>
                <p className="mt-1 text-sm text-slate-500">{machine.name}</p>
              </div>
            </div>
          </div>
          {canCreate && (
            <Button type="button" onClick={handleCreate} disabled={isCreating} className="min-h-11 bg-blue-900 text-white hover:bg-blue-800">
              <Plus className="mr-2 h-4 w-4" />
              Добавить заявку
            </Button>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white shadow-sm">
        {requests.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-950">Заявок пока нет</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
              Добавьте первую заявку, чтобы заполнить материалы и передать их дальше по текущему процессу.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((request, index) => (
              <div key={request.id} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-950">Заявка #{requests.length - index}</h2>
                    <Badge variant="outline" className={cn('w-fit', lifecycleClasses[request.lifecycle_status])}>
                      {request.lifecycle_label}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    Создана: <time dateTime={request.created_at}>{formatDate(request.created_at)}</time>
                  </div>
                </div>
                <div className="text-sm text-slate-500 sm:text-right">
                  Обновлена: <time dateTime={request.updated_at}>{formatDate(request.updated_at)}</time>
                </div>
                <Button type="button" variant="outline" className="min-h-11 border-slate-200" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${machine.id}/request/${request.id}`)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Открыть
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
