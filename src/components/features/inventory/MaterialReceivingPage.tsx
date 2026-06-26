'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Factory, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import { receiveMaterialDelivery, type MaterialReceivingPageData, type MaterialReceivingItem } from '@/lib/actions/supply-orders'
import { cn } from '@/lib/utils'

type Props = {
  data: MaterialReceivingPageData
}

type DraftMap = Record<string, string>

export function MaterialReceivingPage({ data }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const initialOpenDates = useMemo(
    () => new Set(data.groups.filter((group) => group.is_initially_open).map((group) => group.date)),
    [data.groups],
  )
  const [openDates, setOpenDates] = useState<Set<string>>(initialOpenDates)
  const draftKey = useMemo(() => data.groups.flatMap((group) => group.items.map((item) => `${item.key}:${item.planned_quantity}`)).join('|'), [data.groups])
  const defaultDrafts = useMemo<DraftMap>(() => Object.fromEntries(
    data.groups.flatMap((group) => group.items.map((item) => [item.key, String(item.planned_quantity)])),
  ), [data.groups])
  const [draftState, setDraftState] = useState(() => ({ key: draftKey, drafts: defaultDrafts }))
  const drafts = draftState.key === draftKey ? draftState.drafts : defaultDrafts

  function setDraft(itemKey: string, value: string) {
    setDraftState((current) => ({
      key: draftKey,
      drafts: {
        ...(current.key === draftKey ? current.drafts : defaultDrafts),
        [itemKey]: value,
      },
    }))
  }

  function toggleDate(date: string) {
    setOpenDates((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function receive(item: MaterialReceivingItem) {
    const receivedQuantity = Number((drafts[item.key] || '').replace(',', '.'))
    if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
      toast.error('Введите фактическое количество прихода')
      return
    }

    setPendingKey(item.key)
    startTransition(async () => {
      const result = await receiveMaterialDelivery({
        schedule_id: item.schedule_id,
        table: item.table,
        id: item.id,
        delivery_date: item.delivery_date,
        planned_quantity: item.planned_quantity,
        received_quantity: receivedQuantity,
      })
      setPendingKey(null)

      if (!result.success) {
        toast.error(result.error || 'Не удалось принять поставку')
        return
      }

      toast.success('Материал принят на склад')
      router.refresh()
    })
  }

  const totalItems = data.groups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-[#E8ECF0] bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Прием материала</h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Плановые поставки снабжения по датам и заводу. Факт прихода сразу попадает на склад.
          </p>
        </div>

        <div className="flex w-full overflow-x-auto rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-1 lg:w-auto">
          {data.factories.map((factory) => (
            <Link
              key={factory.id}
              href={`${ROUTES.INVENTORY_RECEIVING}?factory=${factory.id}`}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30',
                data.activeFactoryId === factory.id
                  ? 'bg-[#1B3A6B] text-white'
                  : 'text-[#1B3A6B] hover:bg-white',
              )}
              aria-current={data.activeFactoryId === factory.id ? 'page' : undefined}
            >
              <Factory className="h-4 w-4" />
              {factory.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Дат снабжения" value={data.groups.length} />
        <Metric label="Позиций к приемке" value={totalItems} />
        <Metric label="Завод" value={data.factories.find((factory) => factory.id === data.activeFactoryId)?.name || '-'} />
      </div>

      {data.groups.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#6B7280]">
          Нет поставок к приемке по выбранному заводу.
        </div>
      ) : (
        data.groups.map((group) => {
          const isOpen = openDates.has(group.date)
          return (
            <section key={group.date} className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
              <button
                type="button"
                onClick={() => toggleDate(group.date)}
                className="flex w-full items-center justify-between gap-3 border-b border-[#E8ECF0] bg-[#F8F9FA] px-4 py-3 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PackageCheck className="h-5 w-5 shrink-0 text-[#1B3A6B]" />
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1B3A6B]">{formatDate(group.date)}</div>
                    <div className="text-sm text-[#6B7280]">{group.items.length} позиций</div>
                  </div>
                </div>
                <ChevronDown className={cn('h-5 w-5 shrink-0 text-[#6B7280] transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1120px] text-left text-sm">
                    <thead className="border-b border-[#E8ECF0] text-xs font-semibold uppercase text-[#64748B]">
                      <tr>
                        <th className="px-4 py-3">Материал</th>
                        <th className="px-4 py-3">Машина</th>
                        <th className="px-4 py-3">Поставщик</th>
                        <th className="px-4 py-3">План</th>
                        <th className="px-4 py-3">Факт</th>
                        <th className="px-4 py-3">Контроль</th>
                        <th className="px-4 py-3 text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8ECF0]">
                      {group.items.map((item) => {
                        const draft = drafts[item.key] || ''
                        const actualQuantity = Number(draft.replace(',', '.'))
                        const variance = getVariance(item.planned_quantity, actualQuantity)
                        const actualWeight = weightForQuantity(item, actualQuantity)
                        return (
                          <tr key={item.key} className="align-top">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-[#111827]">{item.item_name}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <Badge variant="outline" className="border-[#E8ECF0] bg-white text-[#475569]">
                                  {MATERIAL_CATEGORY_LABELS[item.category]}
                                </Badge>
                                {item.is_virtual_schedule && (
                                  <Badge variant="secondary" className="bg-[#EFF6FF] text-[#1E40AF]">
                                    Дата без графика
                                  </Badge>
                                )}
                              </div>
                              {item.characteristics.length > 0 && (
                                <div className="mt-1 flex max-w-md flex-wrap gap-x-3 gap-y-1 text-xs text-[#64748B]">
                                  {item.characteristics.map((part) => (
                                    <span key={`${item.key}:${part.label}:${part.value}`}>
                                      <span className="font-medium text-[#475569]">{part.label}:</span> {part.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-medium text-[#1B3A6B] hover:underline">
                                {item.machine_name}
                              </Link>
                              <div className="mt-1 text-xs text-[#64748B]">{item.factory_name}</div>
                            </td>
                            <td className="px-4 py-3 text-[#374151]">{item.supplier_name || 'Не назначен'}</td>
                            <td className="px-4 py-3 font-medium text-[#111827] tabular-nums">
                              {formatAmount(item.planned_quantity)} {item.unit}
                              {item.weight_kg !== null && <div className="text-xs font-normal text-[#64748B]">Вес план: {formatAmount(item.weight_kg)} кг</div>}
                            </td>
                            <td className="px-4 py-3">
                              <label className="sr-only" htmlFor={`receive-${item.key}`}>Фактически пришло</label>
                              <input
                                id={`receive-${item.key}`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft}
                                onChange={(event) => setDraft(item.key, event.target.value)}
                                disabled={isPending && pendingKey === item.key}
                                className="h-10 w-36 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm tabular-nums outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              {actualWeight !== null && (
                                <div className="mt-1 text-xs text-[#64748B]">Вес факт: {formatAmount(actualWeight)} кг</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <VarianceBadge variance={variance} unit={item.unit} planned={item.planned_quantity} actual={actualQuantity} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                type="button"
                                disabled={isPending || pendingKey === item.key}
                                onClick={() => receive(item)}
                                aria-label={`Принять ${item.item_name} на склад`}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                {pendingKey === item.key ? 'Прием...' : 'Принять'}
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[#E8ECF0] bg-white px-4 py-3">
      <div className="text-sm font-medium text-[#64748B]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#1B3A6B] tabular-nums">{value}</div>
    </div>
  )
}

type Variance = 'exact' | 'shortage' | 'over_limit' | 'over_ok' | 'invalid'

function getVariance(planned: number, actual: number): Variance {
  if (!Number.isFinite(actual) || actual <= 0) return 'invalid'
  if (actual < planned) return 'shortage'
  if (actual >= planned * 1.3) return 'over_limit'
  if (actual > planned) return 'over_ok'
  return 'exact'
}

function weightForQuantity(item: MaterialReceivingItem, quantity: number) {
  if (item.weight_kg === null) return null
  if (!Number.isFinite(item.planned_quantity) || item.planned_quantity <= 0) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return (item.weight_kg * quantity) / item.planned_quantity
}

function VarianceBadge({ variance, unit, planned, actual }: { variance: Variance; unit: string; planned: number; actual: number }) {
  if (variance === 'invalid') {
    return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Нужен факт</Badge>
  }
  if (variance === 'shortage') {
    return (
      <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        Недовес {formatAmount(planned - actual)} {unit}
      </Badge>
    )
  }
  if (variance === 'over_limit') {
    return (
      <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" />
        +30% и больше
      </Badge>
    )
  }
  if (variance === 'over_ok') {
    return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Больше плана без эскалации</Badge>
  }
  return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Ровно по плану</Badge>
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}
