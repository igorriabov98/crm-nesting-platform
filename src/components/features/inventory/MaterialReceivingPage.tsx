'use client'

import Link from 'next/link'
import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, Factory, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import {
  previewMaterialDeliveryAllocation,
  receiveMaterialDelivery,
  type MaterialDeliveryBarAllocationPreview,
  type MaterialReceivingPageData,
  type MaterialReceivingItem,
} from '@/lib/actions/supply-orders'
import { cn } from '@/lib/utils'

type Props = {
  data: MaterialReceivingPageData
}

type ReceiptDraft = {
  quantity: string
  pieceLength: string
  pieceCount: string
}

type DraftMap = Record<string, ReceiptDraft>

type PreviewState = {
  itemKey: string
  data: MaterialDeliveryBarAllocationPreview
  pieceCounts: Record<string, string>
}

export function MaterialReceivingPage({ data }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const initialOpenDates = useMemo(
    () => new Set(data.groups.filter((group) => group.is_initially_open).map((group) => group.date)),
    [data.groups],
  )
  const [openDates, setOpenDates] = useState<Set<string>>(initialOpenDates)
  const draftKey = useMemo(() => data.groups.flatMap((group) => group.items.map((item) => (
    `${item.key}:${item.planned_quantity}:${item.piece_length_mm || ''}:${item.piece_count || ''}`
  ))).join('|'), [data.groups])
  const defaultDrafts = useMemo<DraftMap>(() => Object.fromEntries(
    data.groups.flatMap((group) => group.items.map((item) => [item.key, {
      quantity: String(item.planned_quantity),
      pieceLength: item.piece_length_mm ? String(item.piece_length_mm) : '',
      pieceCount: item.piece_count ? String(item.piece_count) : '',
    }])),
  ), [data.groups])
  const [draftState, setDraftState] = useState(() => ({ key: draftKey, drafts: defaultDrafts }))
  const drafts = draftState.key === draftKey ? draftState.drafts : defaultDrafts

  function setDraft(itemKey: string, patch: Partial<ReceiptDraft>) {
    if (previewState?.itemKey === itemKey) setPreviewState(null)
    setDraftState((current) => ({
      key: draftKey,
      drafts: {
        ...(current.key === draftKey ? current.drafts : defaultDrafts),
        [itemKey]: {
          ...(current.key === draftKey ? current.drafts[itemKey] : defaultDrafts[itemKey]),
          ...patch,
        },
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

  function barValues(item: MaterialReceivingItem) {
    const draft = drafts[item.key] || defaultDrafts[item.key]
    const pieceLength = Number((draft?.pieceLength || '').replace(',', '.'))
    const pieceCount = Number((draft?.pieceCount || '').replace(',', '.'))
    const isBar = item.category === 'knives' || item.category === 'circle'
    const receivedQuantity = isBar
      ? pieceLength * pieceCount
      : Number((draft?.quantity || '').replace(',', '.'))
    return { pieceLength, pieceCount, receivedQuantity, isBar }
  }

  function validateReceipt(item: MaterialReceivingItem) {
    const values = barValues(item)
    const { pieceLength, pieceCount, receivedQuantity, isBar } = values
    if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
      toast.error('Введите фактическое количество прихода')
      return null
    }
    if (isBar && (
      !Number.isFinite(pieceLength) || pieceLength <= 0 ||
      !Number.isInteger(pieceCount) || pieceCount <= 0
    )) {
      toast.error('Укажите длину бруска и целое количество брусков')
      return null
    }
    return values
  }

  function preview(item: MaterialReceivingItem) {
    const values = validateReceipt(item)
    if (!values) return
    setPendingKey(item.key)
    startTransition(async () => {
      const result = await previewMaterialDeliveryAllocation({
        schedule_id: item.schedule_id,
        table: item.table,
        id: item.id,
        delivery_date: item.delivery_date,
        planned_quantity: item.planned_quantity,
        received_quantity: values.receivedQuantity,
        piece_length_mm: values.pieceLength,
        piece_count: values.pieceCount,
      })
      setPendingKey(null)
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось рассчитать распределение')
        return
      }
      setPreviewState({
        itemKey: item.key,
        data: result.data,
        pieceCounts: Object.fromEntries(result.data.allocations.map((row) => [
          `${row.table}:${row.id}`,
          String(row.piece_count),
        ])),
      })
    })
  }

  function receive(item: MaterialReceivingItem) {
    const values = validateReceipt(item)
    if (!values) return
    const activePreview = previewState?.itemKey === item.key ? previewState : null

    setPendingKey(item.key)
    startTransition(async () => {
      const result = await receiveMaterialDelivery({
        schedule_id: item.schedule_id,
        table: item.table,
        id: item.id,
        delivery_date: item.delivery_date,
        planned_quantity: item.planned_quantity,
        received_quantity: values.receivedQuantity,
        piece_length_mm: values.isBar ? values.pieceLength : null,
        piece_count: values.isBar ? values.pieceCount : null,
        confirmed_bar_allocations: activePreview?.data.allocations.map((row) => ({
          table: row.table,
          id: row.id,
          piece_count: Number(activePreview.pieceCounts[`${row.table}:${row.id}`] || 0),
        })),
      })
      setPendingKey(null)

      if (!result.success) {
        toast.error(result.error || 'Не удалось принять поставку')
        return
      }

      toast.success('Материал принят на склад')
      setPreviewState(null)
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
                        const draft = drafts[item.key] || defaultDrafts[item.key]
                        const pieceLength = Number((draft?.pieceLength || '').replace(',', '.'))
                        const pieceCount = Number((draft?.pieceCount || '').replace(',', '.'))
                        const isBar = item.category === 'knives' || item.category === 'circle'
                        const actualQuantity = isBar
                          ? pieceLength * pieceCount
                          : Number((draft?.quantity || '').replace(',', '.'))
                        const variance = getVariance(item.planned_quantity, actualQuantity)
                        const actualWeight = weightForQuantity(item, actualQuantity)
                        const activePreview = previewState?.itemKey === item.key ? previewState : null
                        return (
                          <Fragment key={item.key}>
                          <tr className="align-top">
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
                              {isBar ? (
                                <div className="grid w-72 grid-cols-2 gap-2">
                                  <label className="grid gap-1 text-xs text-[#64748B]">
                                    Длина бруска, мм
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={draft?.pieceLength || ''}
                                      onChange={(event) => setDraft(item.key, { pieceLength: event.target.value })}
                                      disabled={isPending && pendingKey === item.key}
                                      className="h-10 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm tabular-nums outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                  </label>
                                  <label className="grid gap-1 text-xs text-[#64748B]">
                                    Брусков, шт
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={draft?.pieceCount || ''}
                                      onChange={(event) => setDraft(item.key, { pieceCount: event.target.value })}
                                      disabled={isPending && pendingKey === item.key}
                                      className="h-10 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm tabular-nums outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                  </label>
                                  <div className="col-span-2 rounded-md bg-[#F8F9FA] px-3 py-2 text-xs text-[#475569]">
                                    Общая длина: <strong className="tabular-nums text-[#111827]">{Number.isFinite(actualQuantity) ? formatAmount(actualQuantity) : '0'} мм</strong>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <label className="sr-only" htmlFor={`receive-${item.key}`}>Фактически пришло</label>
                                  <input
                                    id={`receive-${item.key}`}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft?.quantity || ''}
                                    onChange={(event) => setDraft(item.key, { quantity: event.target.value })}
                                    disabled={isPending && pendingKey === item.key}
                                    className="h-10 w-36 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm tabular-nums outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  />
                                </>
                              )}
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
                                onClick={() => isBar ? preview(item) : receive(item)}
                                aria-label={isBar ? `Проверить распределение ${item.item_name}` : `Принять ${item.item_name} на склад`}
                              >
                                {isBar ? <Eye className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                {pendingKey === item.key ? 'Расчёт...' : isBar ? 'Проверить' : 'Принять'}
                              </Button>
                            </td>
                          </tr>
                          {activePreview && (
                            <tr>
                              <td colSpan={7} className="bg-[#F8FAFC] px-4 py-4">
                                <BarAllocationPreview
                                  preview={activePreview.data}
                                  pieceCounts={activePreview.pieceCounts}
                                  disabled={isPending}
                                  onPieceCountChange={(key, value) => setPreviewState((current) => current?.itemKey === item.key
                                    ? { ...current, pieceCounts: { ...current.pieceCounts, [key]: value } }
                                    : current)}
                                  onCancel={() => setPreviewState(null)}
                                  onConfirm={() => receive(item)}
                                />
                              </td>
                            </tr>
                          )}
                          </Fragment>
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

function BarAllocationPreview({
  preview,
  pieceCounts,
  disabled,
  onPieceCountChange,
  onCancel,
  onConfirm,
}: {
  preview: MaterialDeliveryBarAllocationPreview
  pieceCounts: Record<string, string>
  disabled: boolean
  onPieceCountChange: (key: string, value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const selectedRows = preview.allocations.map((row) => {
    const value = Number(pieceCounts[`${row.table}:${row.id}`] || 0)
    const pieces = Number.isInteger(value) && value >= 0 ? value : Number.NaN
    const physical = Number.isFinite(pieces) ? pieces * preview.piece_length_mm : 0
    const logical = Math.min(row.outstanding_quantity, physical)
    return { ...row, pieces, physical, logical, futureScrap: Math.max(physical - logical, 0) }
  })
  const allocatedPieces = selectedRows.reduce((sum, row) => sum + (Number.isFinite(row.pieces) ? row.pieces : 0), 0)
  const invalid = selectedRows.some((row) => !Number.isInteger(row.pieces) || row.pieces < 0 || row.pieces > row.needed_piece_count)
  const freePieces = Math.max(preview.piece_count - allocatedPieces, 0)
  const canConfirm = !invalid && allocatedPieces > 0 && allocatedPieces <= preview.piece_count

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-4" aria-live="polite" aria-label="Предварительное распределение брусков">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-semibold text-[#1B3A6B]">Проверьте распределение целых брусков</h3>
          <p className="mt-1 text-xs text-[#64748B]">
            Приход: {formatAmount(preview.piece_count)} шт × {formatAmount(preview.piece_length_mm)} мм = {formatAmount(preview.received_quantity)} мм.
            Приоритет предложения: дата Заготовки, затем Мат.план.
          </p>
        </div>
        {(preview.has_shortage || preview.has_priority_tie) && (
          <Badge variant="outline" className="w-fit gap-1 border-amber-200 bg-amber-50 text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            Нужен выбор оператора
          </Badge>
        )}
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-[#E8ECF0]">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-[#F8F9FA] font-semibold uppercase text-[#64748B]">
            <tr>
              <th className="px-3 py-2">Машина и приоритет</th>
              <th className="px-3 py-2">Потребность</th>
              <th className="px-3 py-2">Брусков</th>
              <th className="px-3 py-2">Физически в бронь</th>
              <th className="px-3 py-2">Закроется</th>
              <th className="px-3 py-2">Будущий отход</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8ECF0]">
            {selectedRows.map((row) => {
              const key = `${row.table}:${row.id}`
              return (
                <tr key={key}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[#111827]">{row.machine_name}</div>
                    <div className="mt-0.5 text-[#64748B]">
                      Заготовка: {row.cutting_date ? formatDate(row.cutting_date) : 'дата не указана'} · Мат.план: {row.material_date ? formatDate(row.material_date) : 'дата не указана'}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[#374151]">{formatAmount(row.outstanding_quantity)} мм</td>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`bar-allocation-${row.id}`}>Брусков для машины {row.machine_name}</label>
                    <input
                      id={`bar-allocation-${row.id}`}
                      type="number"
                      min="0"
                      max={row.needed_piece_count}
                      step="1"
                      value={pieceCounts[key] ?? '0'}
                      disabled={disabled}
                      onChange={(event) => onPieceCountChange(key, event.target.value)}
                      className="h-9 w-24 rounded-md border border-[#CBD5E1] bg-white px-2 text-sm tabular-nums outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:opacity-50"
                    />
                    <div className="mt-0.5 text-[11px] text-[#64748B]">нужно до {row.needed_piece_count}</div>
                  </td>
                  <td className="px-3 py-2 font-medium tabular-nums text-[#111827]">{formatAmount(row.physical)} мм</td>
                  <td className="px-3 py-2 tabular-nums text-[#374151]">{formatAmount(row.logical)} мм</td>
                  <td className="px-3 py-2 tabular-nums text-[#7C3AED]">
                    {row.futureScrap > 0 ? `${formatAmount(row.futureScrap)} мм после Заготовки` : 'нет'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Свободный основной склад: <strong>{freePieces} шт / {formatAmount(freePieces * preview.piece_length_mm)} мм</strong>
        </div>
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
          Будущий деловой отход: <strong>{formatAmount(selectedRows.reduce((sum, row) => sum + row.futureScrap, 0))} мм</strong>
        </div>
      </div>
      {(invalid || allocatedPieces > preview.piece_count) && (
        <p className="mt-2 text-sm text-red-700">Проверьте целое количество брусков: распределить можно не больше {preview.piece_count} шт.</p>
      )}
      <p className="mt-2 text-xs text-[#64748B]">
        Будущий отход нельзя передать другой машине. Он станет обычным доступным деловым отходом после сохранения факта производства на этапе Заготовка исходной машины.
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={onCancel}>Отмена</Button>
        <Button type="button" disabled={disabled || !canConfirm} onClick={onConfirm}>
          <CheckCircle2 className="h-4 w-4" />
          {disabled ? 'Приём...' : 'Подтвердить приёмку'}
        </Button>
      </div>
    </section>
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
