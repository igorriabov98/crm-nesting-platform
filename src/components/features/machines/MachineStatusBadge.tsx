import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MachineStatus } from '@/lib/types'

export const MACHINE_STATUS_LABELS: Record<MachineStatus, string> = {
  created: 'Создана',
  under_review: 'На рассмотрении',
  factory_assigned: 'Назначен завод',
  confirmed: 'Подтверждена',
  planned: 'Запланирована',
  request_ready: 'Заявка готова',
  purchasing: 'В закупке',
  material_received: 'Материал получен',
  in_production: 'План производства',
  shipped: 'Отгружена',
}

export const MACHINE_STATUS_ORDER: MachineStatus[] = [
  'created',
  'confirmed',
  'planned',
  'request_ready',
  'purchasing',
  'material_received',
  'shipped',
]

const statusClasses: Record<MachineStatus, string> = {
  created: 'border-gray-200 bg-gray-100 text-gray-700',
  under_review: 'border-purple-200 bg-purple-100 text-purple-700',
  factory_assigned: 'border-blue-200 bg-blue-100 text-blue-700',
  confirmed: 'border-sky-200 bg-sky-100 text-sky-700',
  planned: 'border-blue-200 bg-blue-100 text-blue-700',
  request_ready: 'border-purple-200 bg-purple-100 text-purple-700',
  purchasing: 'border-orange-200 bg-orange-100 text-orange-700',
  material_received: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  in_production: 'border-[#1B3A6B]/20 bg-[#1B3A6B]/10 text-[#1B3A6B]',
  shipped: 'border-green-300 bg-green-100 text-green-800',
}

export function MachineStatusBadge({
  status,
  className,
}: {
  status: MachineStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(statusClasses[status], className)}>
      {MACHINE_STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function MachineStatusProgress({ status }: { status: MachineStatus }) {
  const currentIndex = MACHINE_STATUS_ORDER.indexOf(status)
  if (currentIndex < 0) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Прогресс машины</div>
          <div className="mt-0.5 text-xs text-slate-500">Текущий этап коммерческого и производственного цикла</div>
        </div>
        <MachineStatusBadge status={status} />
      </div>

      <div className="mt-5 space-y-0 sm:hidden">
        {MACHINE_STATUS_ORDER.map((item, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <div key={item} className="grid grid-cols-[36px_1fr] gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold',
                    done && 'border-emerald-500 bg-emerald-500 text-white',
                    active && 'border-blue-800 bg-blue-800 text-white ring-4 ring-blue-100',
                    !done && !active && 'border-slate-300 bg-white text-slate-400'
                  )}
                >
                  {index + 1}
                </div>
                {index < MACHINE_STATUS_ORDER.length - 1 && (
                  <div className={cn('min-h-7 w-0.5 flex-1', index < currentIndex ? 'bg-emerald-500' : 'bg-slate-200')} />
                )}
              </div>
              <div className="pb-5 pt-1">
                <div className={cn(
                  'text-sm',
                  done && 'font-medium text-emerald-700',
                  active && 'font-semibold text-blue-950',
                  !done && !active && 'text-slate-400'
                )}>
                  {MACHINE_STATUS_LABELS[item]}
                </div>
                {active && <div className="mt-1 text-xs text-slate-500">Текущий статус машины</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto pb-1 sm:block">
        <div className="flex min-w-[760px] items-start px-1">
          {MACHINE_STATUS_ORDER.map((item, index) => {
            const done = index < currentIndex
            const active = index === currentIndex
            return (
              <div key={item} className="flex flex-1 items-start">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold',
                      done && 'border-emerald-500 bg-emerald-500 text-white',
                      active && 'border-blue-800 bg-blue-800 text-white ring-4 ring-blue-100',
                      !done && !active && 'border-slate-300 bg-white text-slate-400'
                    )}
                  >
                    {index + 1}
                  </div>
                  <span
                    className={cn(
                      'max-w-[110px] text-xs leading-tight',
                      done && 'text-emerald-700',
                      active && 'font-semibold text-blue-950',
                      !done && !active && 'text-slate-400'
                    )}
                  >
                    {MACHINE_STATUS_LABELS[item]}
                  </span>
                </div>
                {index < MACHINE_STATUS_ORDER.length - 1 && (
                  <div
                    className={cn(
                      'mt-4 h-0.5 flex-1',
                      index < currentIndex ? 'bg-emerald-500' : 'bg-slate-200'
                    )}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
