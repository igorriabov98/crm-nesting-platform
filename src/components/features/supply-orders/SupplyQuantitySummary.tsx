import type { SupplyOrderDateSlice, SupplyOrderQuantitySummary } from './supply-order-view'

const amount = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)

export function SupplyQuantitySummary({ summary, unit, dateSlice, productionDate, weight, itemCount, isBar = false }: {
  summary: SupplyOrderQuantitySummary
  unit: string
  dateSlice?: SupplyOrderDateSlice
  productionDate?: string | null
  weight: string | null
  itemCount: number
  isBar?: boolean
}) {
  const unscheduled = dateSlice?.kind === 'unscheduled'
  const mixed = Boolean(dateSlice?.plannedQuantity && dateSlice?.deliveredQuantity)
  const title = unscheduled ? 'Не заказано'
    : dateSlice?.plannedScheduleCount ? mixed ? 'Поставка на эту дату' : 'Ожидается по этой поставке'
      : dateSlice?.deliveredScheduleCount ? 'Принято по этой поставке' : 'Потребность в закупке'
  const primary = unscheduled ? dateSlice.unscheduledQuantity
    : dateSlice ? dateSlice.quantity : summary.demandQuantity
  const rows: Array<[string, number]> = [
    [isBar ? 'Потребность в отрезках' : 'Общая потребность', summary.requestedQuantity],
    ['Покрыто складской бронью', summary.stockQuantity],
    [isBar ? 'К закупке в хлыстах' : 'Потребность в закупке', summary.demandQuantity],
    ['Принято физически', summary.physicalReceivedQuantity],
    ['Выделено заявкам', summary.allocatedQuantity],
    ['Осталось получить для заявок', summary.outstandingQuantity],
    ['Ожидается по графику', summary.plannedQuantity],
    ['Ещё не заказано', summary.remainingToOrder],
  ]
  if (summary.deliveryExcess > 0) rows.push(['Запланировано сверх потребности', summary.deliveryExcess])
  return <div className="border-t border-border bg-muted/20 p-4 lg:border-l lg:border-t-0 lg:p-5">
    <p className="text-sm text-muted-foreground">{title}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums">{amount(primary)} {unit}</p>
    {mixed && <p className="mt-1 text-xs text-muted-foreground">Принято {amount(dateSlice!.deliveredQuantity)} · ожидается {amount(dateSlice!.plannedQuantity)} {unit}</p>}
    {productionDate && <p className="mt-1 text-xs text-muted-foreground">Требуется к {productionDate.split('-').reverse().join('.')}</p>}
    <section className="mt-4 border-t border-border pt-3" aria-label="По всем поставкам этой потребности">
      <p className="text-sm font-medium">По всем поставкам этой потребности</p>
      <dl className="mt-2 space-y-2 text-xs">
        {rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">{amount(value)} {unit}</dd>
        </div>)}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Складская бронь уже учтена. Итоги по всем датам, а не дополнительная потребность.</p>
    </section>
    <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
      <div className="flex justify-between gap-3"><dt>Вес этого объёма</dt><dd>{weight || 'Не рассчитан'}</dd></div>
      <div className="flex justify-between gap-3"><dt>Позиций заявок</dt><dd>{itemCount}</dd></div>
    </dl>
  </div>
}
