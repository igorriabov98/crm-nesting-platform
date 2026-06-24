"use client"

import React, { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Edit, ExternalLink, Plus, RefreshCw, Scissors } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRole } from '@/lib/hooks/useRole'
import { COATINGS } from '@/lib/constants/coatings'
import { MachineEditDialog } from '../MachineEditDialog'
import { startMachineItemNesting, type MachineItemNestingState } from '@/lib/actions/machine-item-nesting'
import type { CoatingType, MachineDetails, MachineItem } from '@/lib/types'
import type { TaskWithRelations } from '@/lib/actions/tasks'

interface ItemsTabProps {
  machine: MachineDetails
  tasks?: TaskWithRelations[]
  nestingStates?: MachineItemNestingState[]
  canManageNesting?: boolean
}

export function ItemsTab({ machine, tasks = [], nestingStates = [], canManageNesting = false }: ItemsTabProps) {
  const { role, isDirector } = useRole()
  const canEdit = isDirector || role === 'sales_manager'
  const canNest = canManageNesting
  const [isEditOpen, setIsEditOpen] = useState(false)

  const goods = (machine.machine_items || []).filter((item) => !item.is_sample)
  const samples = (machine.machine_items || []).filter((item) => item.is_sample)
  const nestingStateByItemId = useMemo(
    () => new Map(nestingStates.map((state) => [state.machineItemId, state])),
    [nestingStates]
  )
  const drawingsConfirmed = tasks.some((task) => task.task_type === 'engineer_confirm' && task.status === 'completed')

  const getCoatingBadge = (c: CoatingType, ral?: string | null) => {
    if (c === 'zinc') return <Badge variant="secondary" className="bg-[#E8ECF0] text-[#1B3A6B]">{COATINGS.zinc.label}</Badge>
    if (c === 'powder_coating') return (
      <Badge variant="outline" className="text-orange-400 border-orange-400/20 bg-orange-400/10">
        {COATINGS.powder_coating.label} {ral ? `(RAL ${ral})` : ''}
      </Badge>
    )
    return <span className="text-[#9CA3AF] text-xs">{COATINGS.none.label}</span>
  }

  const renderTable = (items: MachineItem[], emptyLabel: string) => {
    const totalWeight = items.reduce((sum, item) => sum + Number(item.weight) * Number(item.quantity), 0)
    const totalCost = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0)
    const showActions = canEdit || canNest

    return (
      <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow className="border-[#E8ECF0]">
              <TableHead className="w-12 text-center text-[#6B7280]">#</TableHead>
              <TableHead className="text-[#6B7280]">Чертёж</TableHead>
              <TableHead className="text-[#6B7280]">Товар</TableHead>
              <TableHead className="text-[#6B7280] text-right">Вес ед.</TableHead>
              <TableHead className="text-[#6B7280] text-right">Цена ед.</TableHead>
              <TableHead className="text-[#6B7280] text-center">Кол-во</TableHead>
              <TableHead className="text-[#6B7280] text-right">Стоимость</TableHead>
              <TableHead className="text-[#6B7280]">Покрытие</TableHead>
              {showActions && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showActions ? 9 : 8} className="text-center h-24 text-[#9CA3AF]">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, idx) => {
                const itemCost = Number(item.price) * Number(item.quantity)
                return (
                  <TableRow key={item.id || idx} className="border-[#E8ECF0] hover:bg-[#F8F9FA]">
                    <TableCell className="text-center text-[#9CA3AF]">{idx + 1}</TableCell>
                    <TableCell className="font-medium text-[#374151]">{item.drawing_number}</TableCell>
                    <TableCell className="text-[#374151]">{item.product_name}</TableCell>
                    <TableCell className="text-right text-[#374151]">{Number(item.weight).toFixed(2)} т</TableCell>
                    <TableCell className="text-right text-[#374151]">€{Number(item.price).toLocaleString()}</TableCell>
                    <TableCell className="text-center text-[#374151]">{item.quantity} шт</TableCell>
                    <TableCell className="text-right font-medium text-[#1B3A6B]">€{itemCost.toLocaleString()}</TableCell>
                    <TableCell>{getCoatingBadge(item.coating, item.ral_number)}</TableCell>
                    {showActions && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canNest && (
                            <NestingActionButtons
                              machineId={machine.id}
                              item={item}
                              state={nestingStateByItemId.get(item.id)}
                              disabledReason={getNestingDisabledReason(machine, item, nestingStateByItemId.get(item.id), drawingsConfirmed)}
                            />
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="icon" onClick={() => setIsEditOpen(true)} className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-transparent">
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap justify-end gap-4 border-t border-[#E8ECF0] bg-[#F8F9FA] px-4 py-2 text-sm text-[#374151]">
          <span>{items.length} поз.</span>
          <span>{(totalWeight / 1000).toFixed(2)} т</span>
          <span className="font-medium text-[#1B3A6B]">€{totalCost.toLocaleString()}</span>
        </div>
      </div>
      <div className="grid gap-3 md:hidden">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {emptyLabel}
          </div>
        ) : items.map((item, idx) => {
          const itemCost = Number(item.price) * Number(item.quantity)
          return (
            <article key={item.id || idx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Позиция {idx + 1}</div>
                  <div className="mt-1 break-words font-semibold text-slate-900">{item.product_name}</div>
                  <div className="mt-1 text-sm text-slate-500">Чертёж: {item.drawing_number}</div>
                </div>
                {showActions && (
                  <div className="flex shrink-0 gap-1">
                    {canNest && (
                      <NestingActionButtons
                        machineId={machine.id}
                        item={item}
                        state={nestingStateByItemId.get(item.id)}
                        disabledReason={getNestingDisabledReason(machine, item, nestingStateByItemId.get(item.id), drawingsConfirmed)}
                      />
                    )}
                    {canEdit && (
                      <Button variant="outline" size="icon-lg" onClick={() => setIsEditOpen(true)} aria-label="Редактировать позицию">
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Вес единицы</div>
                  <div className="mt-1 font-semibold tabular-nums text-slate-800">{Number(item.weight).toFixed(2)} кг</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Количество</div>
                  <div className="mt-1 font-semibold tabular-nums text-slate-800">{item.quantity} шт</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Цена единицы</div>
                  <div className="mt-1 font-semibold tabular-nums text-slate-800">€{Number(item.price).toLocaleString()}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-600">Стоимость</div>
                  <div className="mt-1 font-bold tabular-nums text-emerald-700">€{itemCost.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-3">{getCoatingBadge(item.coating, item.ral_number)}</div>
            </article>
          )
        })}
        <div className="flex flex-wrap justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <span>{items.length} поз.</span>
          <span>{(totalWeight / 1000).toFixed(2)} т</span>
          <span className="font-semibold text-blue-950">€{totalCost.toLocaleString()}</span>
        </div>
      </div>
      </>
    )
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Товары машины</h2>
          <p className="mt-1 text-sm text-slate-500">Продукция и образцы, входящие в состав машины</p>
        </div>
        {canEdit && (
          <Button onClick={() => setIsEditOpen(true)} className="min-h-11 bg-blue-900 text-white hover:bg-blue-800">
            <Plus className="w-4 h-4 mr-2" />
            Добавить / Редактировать
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-[#1B3A6B]">Товары ({goods.length})</h3>
        {renderTable(goods, 'Нет добавленных товаров')}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-[#1B3A6B]">Образцы ({samples.length})</h3>
        {renderTable(samples, 'Нет добавленных образцов')}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
        <div className="text-sm text-[#374151]">
          <span className="text-[#6B7280]">Всего позиций:</span> <span className="font-medium">{goods.length + samples.length}</span>
        </div>
        <div className="text-sm text-[#374151]">
          <span className="text-[#6B7280]">Общий вес:</span> <span className="font-medium">{Number(machine.total_weight || 0).toFixed(2)} т</span>
        </div>
        <div className="text-sm text-[#1B3A6B] font-medium text-lg">
          <span className="text-[#6B7280] text-sm pr-2">Итого стоимость товаров:</span>
          €{Number(machine.total_items_cost || 0).toLocaleString()}
        </div>
      </div>

      {isEditOpen && (
        <MachineEditDialog
          machine={machine}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  )
}

function getNestingDisabledReason(
  machine: MachineDetails,
  item: MachineItem,
  state: MachineItemNestingState | undefined,
  drawingsConfirmed: boolean,
) {
  if (machine.is_archived) return 'Машина архивирована'
  if (!item.product_id) return 'Строка не привязана к товару из базы'
  if (!drawingsConfirmed) return 'Инженер еще не подтвердил чертежи'
  if (state?.productStatus && state.productStatus !== 'active') return 'Товар не активен'
  if (state?.fileIssue) return state.fileIssue
  return null
}

function NestingActionButtons({
  machineId,
  item,
  state,
  disabledReason,
}: {
  machineId: string
  item: MachineItem
  state?: MachineItemNestingState
  disabledReason: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const run = state?.run || null

  const launch = () => {
    startTransition(() => {
      void (async () => {
        const result = await startMachineItemNesting(machineId, item.id)
        if (!result.success || !result.data) {
          toast.error(result.error || 'Не удалось запустить раскладку')
          return
        }
        toast.success('Раскладка создана')
        router.refresh()
        router.push(`/nesting/${result.data.nesting_project_id}/parts`)
      })()
    })
  }

  const disabled = Boolean(disabledReason) || isPending
  const startTitle = disabledReason || 'Запустить раскладку из STEP и PDF товара'
  const restartTitle = disabledReason || 'Перезапустить раскладку и заменить импортированные строки этого товара в черновике заявки'

  return (
    <TooltipProvider>
      <div className="flex gap-1">
        {run ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => router.push(`/nesting/${run.nesting_project_id}/parts`)}
                    className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-transparent"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </span>
              }
            />
            <TooltipContent>{disabledReason || 'Открыть раскладку товара'}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={launch}
                    className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-transparent"
                  >
                    <Scissors className="h-4 w-4" />
                  </Button>
                </span>
              }
            />
            <TooltipContent>{startTitle}</TooltipContent>
          </Tooltip>
        )}

        {run && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={launch}
                    className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-transparent"
                  >
                    <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
                  </Button>
                </span>
              }
            />
            <TooltipContent>{restartTitle}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
