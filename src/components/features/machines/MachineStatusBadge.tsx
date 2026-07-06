import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MachineProgress, MachineProgressKey, MachineProgressStep, MachineStatus } from '@/lib/types'

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

const progressClasses = {
  created: 'border-gray-200 bg-gray-100 text-gray-700',
  decoded: 'border-sky-200 bg-sky-50 text-sky-800',
  planned: 'border-blue-200 bg-blue-50 text-blue-800',
  waiting_request: 'border-purple-200 bg-purple-50 text-purple-800',
  purchasing: 'border-orange-200 bg-orange-50 text-orange-800',
  material_received: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  shipped: 'border-green-300 bg-green-100 text-green-800',
} satisfies Record<Exclude<MachineProgressKey, `production:${string}`>, string>

function progressBadgeClass(key: MachineProgressKey, blockers: string[]) {
  if (blockers.length > 0 && (key === 'decoded' || key === 'planned')) {
    return 'border-amber-200 bg-amber-50 text-amber-800'
  }
  if (key.startsWith('production:')) {
    return 'border-[#1B3A6B]/20 bg-[#1B3A6B]/10 text-[#1B3A6B]'
  }
  return (progressClasses as Partial<Record<MachineProgressKey, string>>)[key] || 'border-slate-200 bg-slate-100 text-slate-700'
}

export function MachineProgressBadge({
  progress,
  className,
}: {
  progress: MachineProgress
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(progressBadgeClass(progress.currentKey, progress.blockers), className)}>
      {progress.currentLabel}
    </Badge>
  )
}

function stepDotClasses(state: MachineProgressStep['state']) {
  if (state === 'done') return 'border-emerald-500 bg-emerald-500 text-white'
  if (state === 'active') return 'border-blue-800 bg-blue-800 text-white ring-4 ring-blue-100'
  if (state === 'blocked') return 'border-amber-400 bg-amber-50 text-amber-700'
  return 'border-slate-300 bg-white text-slate-400'
}

function stepTextClasses(state: MachineProgressStep['state']) {
  if (state === 'done') return 'font-medium text-emerald-700'
  if (state === 'active') return 'font-semibold text-blue-950'
  if (state === 'blocked') return 'font-semibold text-amber-800'
  return 'text-slate-400'
}

function StepDot({ step, index }: { step: MachineProgressStep; index: number }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
        stepDotClasses(step.state)
      )}
    >
      {index + 1}
    </div>
  )
}

function MobileProgress({ steps }: { steps: MachineProgressStep[] }) {
  return (
    <div className="mt-5 space-y-0 sm:hidden">
      {steps.map((step, index) => (
        <div key={step.key} className="grid grid-cols-[36px_1fr] gap-3">
          <div className="flex flex-col items-center">
            <StepDot step={step} index={index} />
            {index < steps.length - 1 && (
              <div className={cn('min-h-7 w-0.5 flex-1', step.state === 'done' ? 'bg-emerald-500' : 'bg-slate-200')} />
            )}
          </div>
          <div className="pb-5 pt-1">
            <div className={cn('text-sm', stepTextClasses(step.state))}>{step.label}</div>
            {step.state === 'active' && <div className="mt-1 text-xs text-slate-500">Текущий статус машины</div>}
            {step.blocker && <div className="mt-1 text-xs text-amber-700">{step.blocker}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function DesktopStep({ step, index }: { step: MachineProgressStep; index: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <StepDot step={step} index={index} />
      <span className={cn('max-w-[120px] text-xs leading-tight', stepTextClasses(step.state))}>
        {step.label}
      </span>
    </div>
  )
}

function DesktopProgress({ steps }: { steps: MachineProgressStep[] }) {
  const created = steps.find((step) => step.key === 'created')
  const readiness = steps.filter((step) => step.kind === 'check')
  const rest = steps.filter((step) => step.key !== 'created' && step.kind !== 'check')
  const readinessDone = readiness.every((step) => step.state === 'done')
  const restMinWidth = Math.max(520, rest.length * 124)
  if (!created) return null

  return (
    <div className="hidden overflow-x-auto pb-1 sm:block">
      <div className="flex min-w-[900px] items-start px-1">
        <div className="flex w-[110px] shrink-0 flex-col items-center gap-2 text-center">
          <StepDot step={created} index={0} />
          <span className={cn('max-w-[110px] text-xs leading-tight', stepTextClasses(created.state))}>
            {created.label}
          </span>
        </div>
        <div className={cn('mt-4 h-0.5 w-16 shrink-0', readinessDone ? 'bg-emerald-500' : 'bg-slate-200')} />
        <div className="grid w-[260px] shrink-0 grid-cols-2 gap-3">
          {readiness.map((step, index) => (
            <div key={step.key} className="flex flex-col items-center gap-2 text-center">
              <StepDot step={step} index={index + 1} />
              <span className={cn('max-w-[120px] text-xs leading-tight', stepTextClasses(step.state))}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
        <div className={cn('mt-4 h-0.5 w-16 shrink-0', readinessDone ? 'bg-emerald-500' : 'bg-slate-200')} />
        <div className="flex flex-1 items-start" style={{ minWidth: restMinWidth }}>
          {rest.map((step, index) => (
            <div key={step.key} className="flex flex-1 items-start">
              <DesktopStep step={step} index={index + 3} />
              {index < rest.length - 1 && (
                <div className={cn('mt-4 h-0.5 flex-1', step.state === 'done' ? 'bg-emerald-500' : 'bg-slate-200')} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MachineStatusProgress({ progress }: { progress: MachineProgress }) {
  if (!progress.steps.length) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Прогресс машины</div>
          <div className="mt-0.5 text-xs text-slate-500">Текущий этап коммерческого и производственного цикла</div>
        </div>
        <MachineProgressBadge progress={progress} />
      </div>

      <MobileProgress steps={progress.steps} />
      <DesktopProgress steps={progress.steps} />

      {progress.blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {progress.blockers.join(' · ')}
        </div>
      )}
    </div>
  )
}
