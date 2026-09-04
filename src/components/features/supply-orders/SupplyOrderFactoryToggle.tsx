import Link from 'next/link'
import { Factory } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import type { MaterialReceivingFactory } from '@/lib/actions/supply-orders'

type SupplyOrderFactoryToggleProps = {
  factories: MaterialReceivingFactory[]
  activeFactoryId: string | null
  view: 'details' | 'summary'
}

export function SupplyOrderFactoryToggle({
  factories,
  activeFactoryId,
  view,
}: SupplyOrderFactoryToggleProps) {
  if (factories.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground shadow-sm">
        В справочнике нет заводов для переключателя Берегово / Ужгород.
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm" aria-label="Выбор завода">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Factory className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Завод поставки</div>
          <div className="text-xs text-muted-foreground">
            {view === 'summary'
              ? 'Сводка рассчитывается отдельно для каждого завода'
              : 'Показаны заявки только выбранного завода'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {factories.map((factory) => {
          const active = factory.id === activeFactoryId
          const params = new URLSearchParams({ view, factory: factory.id })
          return (
            <Link
              key={factory.id}
              href={`${ROUTES.SUPPLY_ORDERS}?${params.toString()}`}
              aria-current={active ? 'page' : undefined}
              className={[
                'inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-primary hover:bg-muted',
              ].join(' ')}
            >
              {factory.name}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
