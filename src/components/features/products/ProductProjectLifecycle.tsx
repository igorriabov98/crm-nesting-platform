import { Archive, Check, FileCheck2, PackageCheck, UserRoundCheck, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProductProject } from '@/lib/types'

type ProjectStatus = ProductProject['status']

export const productProjectStatusLabels: Record<ProjectStatus, string> = {
  new_project: 'Ожидает инженера',
  draft: 'Ожидает инженера',
  engineering: 'В работе',
  client_review: 'Предварительно готов',
  approved: 'Готов к заказу',
  added_to_products: 'Закрыт',
  cancelled: 'Отменён',
}

const steps = [
  { status: 'new_project', label: 'Ожидает инженера', hint: 'Инженеру создана задача', icon: UserRoundCheck },
  { status: 'engineering', label: 'В работе', hint: 'Инженер взял задачу', icon: Wrench },
  { status: 'client_review', label: 'Предварительно готов', hint: 'Описание и PDF загружены', icon: FileCheck2 },
  { status: 'approved', label: 'Готов к заказу', hint: 'Изделие можно добавить в заказ', icon: PackageCheck },
  { status: 'added_to_products', label: 'Закрыт', hint: 'Отгружено и перенесено в продукцию', icon: Archive },
] as const

const statusIndex: Record<ProjectStatus, number> = {
  new_project: 0,
  draft: 0,
  engineering: 1,
  client_review: 2,
  approved: 3,
  added_to_products: 4,
  cancelled: -1,
}

export function ProductProjectLifecycle({ status, compact = false }: { status: ProjectStatus; compact?: boolean }) {
  const currentIndex = statusIndex[status]

  if (status === 'cancelled') {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
        Проект отменён
      </div>
    )
  }

  return (
    <ol className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-5' : 'grid-cols-1 lg:grid-cols-5')} aria-label="Этапы проекта изделия">
      {steps.map((step, index) => {
        const Icon = step.icon
        const complete = index < currentIndex
        const current = index === currentIndex
        return (
          <li
            key={step.status}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'relative flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 transition-colors',
              complete && 'border-emerald-200 bg-emerald-50 text-emerald-900',
              current && 'border-primary/30 bg-primary/5 text-foreground shadow-sm',
              !complete && !current && 'border-border bg-muted/25 text-muted-foreground',
            )}
          >
            <span className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border',
              complete && 'border-emerald-600 bg-emerald-600 text-white',
              current && 'border-primary bg-primary text-primary-foreground',
              !complete && !current && 'border-border bg-background',
            )}>
              {complete ? <Check className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-4">{step.label}</span>
              {!compact && <span className="mt-0.5 block text-[11px] leading-4 opacity-75">{step.hint}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
