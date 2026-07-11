'use client'

import { useEffect, useMemo, useState, type DragEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowRightLeft, ArrowUp, Factory, GripVertical, LoaderCircle, PackageOpen } from 'lucide-react'
import { toast } from 'sonner'

import { moveMachineInProductionQueue } from '@/app/(protected)/sales-plan/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROUTES } from '@/lib/constants/routes'
import type { FactorySummary, MachineListItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatProductionMonth } from '@/lib/utils/production-months'
import { MachineProgressBadge } from './MachineStatusBadge'

type KanbanColumn = {
  id: 'berehovo-1' | 'berehovo-2' | 'uzhhorod-1'
  title: string
  subtitle: string
  factoryId: string | null
  factoryName: string
  workshop: number
  accent: string
  header: string
}

type MachineKanbanProps = {
  machines: MachineListItem[]
  visibleMachineIds: string[]
  factories: FactorySummary[]
  canManage: boolean
}

function normalizedFactoryName(value: string) {
  return value.trim().toLowerCase()
}

function buildColumns(factories: FactorySummary[]): KanbanColumn[] {
  const berehovo = factories.find((factory) => {
    const name = normalizedFactoryName(factory.name)
    return name.includes('берегов') || name.includes('berehov') || name.includes('bergov')
  })
  const uzhhorod = factories.find((factory) => {
    const name = normalizedFactoryName(factory.name)
    return name.includes('ужгород') || name.includes('uzhhorod') || name.includes('uzhgorod')
  })

  return [
    {
      id: 'berehovo-1',
      title: 'Берегово 1 цех',
      subtitle: 'Основная очередь производства',
      factoryId: berehovo?.id || null,
      factoryName: berehovo?.name || 'Берегово',
      workshop: 1,
      accent: 'border-blue-200 bg-blue-50/70',
      header: 'text-blue-950',
    },
    {
      id: 'berehovo-2',
      title: 'Берегово 2 цех',
      subtitle: 'Вторая производственная очередь',
      factoryId: berehovo?.id || null,
      factoryName: berehovo?.name || 'Берегово',
      workshop: 2,
      accent: 'border-violet-200 bg-violet-50/70',
      header: 'text-violet-950',
    },
    {
      id: 'uzhhorod-1',
      title: 'Ужгород',
      subtitle: 'Очередь производства Ужгорода',
      factoryId: uzhhorod?.id || null,
      factoryName: uzhhorod?.name || 'Ужгород',
      workshop: 1,
      accent: 'border-emerald-200 bg-emerald-50/70',
      header: 'text-emerald-950',
    },
  ]
}

function machineMatchesColumn(machine: MachineListItem, column: KanbanColumn) {
  return Boolean(column.factoryId)
    && machine.factory_id === column.factoryId
    && machine.production_workshop === column.workshop
}

function machineOrder(left: MachineListItem, right: MachineListItem) {
  const leftQueue = left.production_queue_number ?? Number.MAX_SAFE_INTEGER
  const rightQueue = right.production_queue_number ?? Number.MAX_SAFE_INTEGER
  if (leftQueue !== rightQueue) return leftQueue - rightQueue
  return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
}

function compactMoney(value: number | null) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function compactWeight(value: number | null) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(value || 0))} т`
}

export function MachineKanban({ machines, visibleMachineIds, factories, canManage }: MachineKanbanProps) {
  const router = useRouter()
  const [boardMachines, setBoardMachines] = useState(machines)
  const [draggedMachineId, setDraggedMachineId] = useState<string | null>(null)
  const [savingMachineId, setSavingMachineId] = useState<string | null>(null)

  useEffect(() => {
    setBoardMachines(machines)
  }, [machines])

  const columns = useMemo(() => buildColumns(factories), [factories])
  const visibleIds = useMemo(() => new Set(visibleMachineIds), [visibleMachineIds])
  const machinesByColumn = useMemo(() => new Map(columns.map((column) => [
    column.id,
    boardMachines.filter((machine) => machineMatchesColumn(machine, column)).sort(machineOrder),
  ])), [boardMachines, columns])
  const assignedIds = useMemo(() => new Set(Array.from(machinesByColumn.values()).flat().map((machine) => machine.id)), [machinesByColumn])
  const unassignedMachines = useMemo(
    () => boardMachines.filter((machine) => !assignedIds.has(machine.id) && visibleIds.has(machine.id)).sort(machineOrder),
    [assignedIds, boardMachines, visibleIds],
  )

  const moveMachine = async (machineId: string, targetColumn: KanbanColumn, targetQueueNumber: number) => {
    if (!canManage || savingMachineId || !targetColumn.factoryId) return
    const previousMachines = boardMachines
    const movingMachine = boardMachines.find((machine) => machine.id === machineId)
    if (!movingMachine) return

    const sourceColumn = columns.find((column) => machineMatchesColumn(movingMachine, column))
    const sourceMachines = sourceColumn ? [...(machinesByColumn.get(sourceColumn.id) || [])] : []
    const targetMachines = sourceColumn?.id === targetColumn.id
      ? sourceMachines.filter((machine) => machine.id !== machineId)
      : [...(machinesByColumn.get(targetColumn.id) || [])].filter((machine) => machine.id !== machineId)
    const insertionIndex = Math.max(0, Math.min(targetQueueNumber - 1, targetMachines.length))
    targetMachines.splice(insertionIndex, 0, movingMachine)

    if (
      sourceColumn?.id === targetColumn.id
      && sourceMachines.every((machine, index) => machine.id === targetMachines[index]?.id)
    ) {
      setDraggedMachineId(null)
      return
    }

    const updates = new Map<string, Partial<MachineListItem>>()
    if (sourceColumn && sourceColumn.id !== targetColumn.id) {
      sourceMachines
        .filter((machine) => machine.id !== machineId)
        .forEach((machine, index) => updates.set(machine.id, { production_queue_number: index + 1 }))
    }
    targetMachines.forEach((machine, index) => updates.set(machine.id, {
      factory_id: targetColumn.factoryId,
      factory: { name: targetColumn.factoryName },
      production_workshop: targetColumn.workshop,
      production_queue_number: index + 1,
    }))

    setBoardMachines((current) => current.map((machine) => ({ ...machine, ...(updates.get(machine.id) || {}) })))
    setSavingMachineId(machineId)
    setDraggedMachineId(null)

    const result = await moveMachineInProductionQueue({
      machineId,
      targetFactoryId: targetColumn.factoryId,
      targetWorkshop: targetColumn.workshop,
      targetQueueNumber: insertionIndex + 1,
    })

    if (!result.success) {
      setBoardMachines(previousMachines)
      setSavingMachineId(null)
      toast.error(result.error || 'Не удалось изменить очередь производства')
      return
    }

    setSavingMachineId(null)
    toast.success('Очередь производства сохранена', { description: result.data.message })
    router.refresh()
  }

  const handleCardDrop = (event: DragEvent<HTMLElement>, column: KanbanColumn, queueNumber: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (draggedMachineId) void moveMachine(draggedMachineId, column, queueNumber)
  }

  const renderMoveMenu = (machine: MachineListItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canManage || Boolean(savingMachineId)}
            className="min-h-11 flex-1 justify-center border-slate-200 bg-white text-slate-700"
            aria-label={`Переместить машину ${machine.name}`}
          >
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Переместить
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>Выберите завод и цех</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuItem
            key={column.id}
            disabled={!column.factoryId || machineMatchesColumn(machine, column)}
            onClick={() => void moveMachine(machine.id, column, (machinesByColumn.get(column.id)?.length || 0) + 1)}
            className="min-h-11"
          >
            <Factory className="mr-2 h-4 w-4" />
            {column.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const renderCard = (machine: MachineListItem, column: KanbanColumn, index: number, total: number) => {
    const isSaving = savingMachineId === machine.id
    return (
      <article
        key={machine.id}
        draggable={canManage && !savingMachineId}
        onDragStart={(event) => {
          setDraggedMachineId(machine.id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', machine.id)
        }}
        onDragEnd={() => setDraggedMachineId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleCardDrop(event, column, index + 1)}
        className={cn(
          'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none',
          canManage && 'cursor-grab hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md active:cursor-grabbing motion-reduce:hover:translate-y-0',
          draggedMachineId === machine.id && 'opacity-50',
          isSaving && 'border-blue-300 ring-2 ring-blue-100',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500" aria-hidden="true">
            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <GripVertical className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} className="truncate font-bold text-blue-950 hover:text-blue-700 hover:underline">
                {machine.name}
              </Link>
              <Badge variant="outline" className="shrink-0 border-slate-200 bg-slate-50 tabular-nums text-slate-700">
                № {index + 1}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              {machine.product || machine.client?.name || 'Без описания продукции'}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <MachineProgressBadge progress={machine.progress} />
          <Badge variant="outline" className={machine.is_confirmed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'}>
            {machine.is_confirmed ? 'Подтверждена' : 'Предварительная'}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
          <div>
            <div className="text-slate-400">Вес</div>
            <div className="mt-1 font-semibold tabular-nums text-slate-800">{compactWeight(machine.total_weight)}</div>
          </div>
          <div>
            <div className="text-slate-400">Стоимость</div>
            <div className="mt-1 font-semibold tabular-nums text-emerald-700">{compactMoney(machine.total_cost)}</div>
          </div>
        </div>

        {canManage && (
          <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={Boolean(savingMachineId) || index === 0}
              onClick={() => void moveMachine(machine.id, column, index)}
              className="min-h-11 min-w-11 border-slate-200"
              aria-label={`Поднять ${machine.name} в очереди`}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={Boolean(savingMachineId) || index === total - 1}
              onClick={() => void moveMachine(machine.id, column, index + 2)}
              className="min-h-11 min-w-11 border-slate-200"
              aria-label={`Опустить ${machine.name} в очереди`}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            {renderMoveMenu(machine)}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="border-t border-slate-200 bg-slate-100/60 p-3 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold">Очередь за {boardMachines[0]?.production_month ? formatProductionMonth(boardMachines[0].production_month) : 'выбранный месяц'}</div>
          <div className="mt-0.5 text-xs text-blue-700">
            Перетащите карточку или используйте кнопки. Каждое изменение сохраняется и фиксируется в уведомлениях.
          </div>
        </div>
        {!canManage && <Badge variant="outline" className="w-fit border-blue-200 bg-white text-blue-800">Только просмотр</Badge>}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1040px] grid-cols-3 gap-4">
          {columns.map((column) => {
            const allColumnMachines = machinesByColumn.get(column.id) || []
            const shownMachines = allColumnMachines.filter((machine) => visibleIds.has(machine.id))
            return (
              <section
                key={column.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggedMachineId) void moveMachine(draggedMachineId, column, allColumnMachines.length + 1)
                }}
                className={cn('min-h-[420px] rounded-3xl border p-3', column.accent)}
                aria-label={column.title}
              >
                <header className="mb-3 flex items-start justify-between gap-3 px-1 py-2">
                  <div>
                    <h2 className={cn('font-bold', column.header)}>{column.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">{column.subtitle}</p>
                  </div>
                  <Badge variant="outline" className="border-white/80 bg-white tabular-nums text-slate-700">
                    {shownMachines.length}{shownMachines.length !== allColumnMachines.length ? ` / ${allColumnMachines.length}` : ''}
                  </Badge>
                </header>

                {!column.factoryId ? (
                  <div className="rounded-2xl border border-dashed border-red-300 bg-white/80 px-4 py-8 text-center text-sm text-red-700">
                    Завод не найден в справочнике
                  </div>
                ) : shownMachines.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 text-center">
                    <PackageOpen className="h-7 w-7 text-slate-400" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">В текущей выборке машин нет</p>
                    <p className="mt-1 text-xs text-slate-500">Перетащите сюда карточку из другого цеха</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {shownMachines.map((machine) => renderCard(
                      machine,
                      column,
                      allColumnMachines.findIndex((item) => item.id === machine.id),
                      allColumnMachines.length,
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>

      {unassignedMachines.length > 0 && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-amber-950">Не распределено: {unassignedMachines.length}</h2>
              <p className="mt-1 text-xs text-amber-800">У этих машин нет одного из трёх Kanban-направлений.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {unassignedMachines.map((machine) => (
              <article key={machine.id} className="rounded-xl border border-amber-200 bg-white p-3">
                <Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} className="font-semibold text-blue-950 hover:underline">{machine.name}</Link>
                <div className="mt-1 text-xs text-slate-500">{machine.factory?.name || 'Без завода'} · {machine.production_workshop ? `Цех ${machine.production_workshop}` : 'Без цеха'}</div>
                {canManage && <div className="mt-3 flex">{renderMoveMenu(machine)}</div>}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
