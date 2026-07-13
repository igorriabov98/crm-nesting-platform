'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, CheckCircle2, Clock, FileWarning, Loader2, PackageCheck, Play, Scissors } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { createNestingBatch, type NestingQueueData, type NestingQueueItem, type NestingQueueMachine } from '@/lib/actions/nesting-batches'
import { isCompletedNestingStatus } from '@/lib/nesting/status'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/components/providers/PermissionProvider'

function formatDate(value: string | null) {
  if (!value) return '—'
  try {
    return format(new Date(value), 'dd.MM.yyyy', { locale: ru })
  } catch {
    return '—'
  }
}

function itemStatus(item: NestingQueueItem) {
  if (item.quantity > 0 && item.remainingQuantity <= 0) {
    return { label: 'Вырезано заранее', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 }
  }

  if (isCompletedNestingStatus(item.run?.serviceStatus) || item.run?.status === 'calculated' || item.run?.status === 'imported') {
    return { label: 'Сделано', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCircle2 }
  }

  if (item.run?.serviceStatus === 'error' || item.run?.status === 'error') {
    return { label: 'Ошибка', className: 'border-red-200 bg-red-50 text-red-700', icon: AlertTriangle }
  }

  if (item.run?.serviceStatus === 'unavailable') {
    return { label: 'Сервис недоступен', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: AlertTriangle }
  }

  if (item.run) {
    return { label: 'В работе', className: 'border-blue-200 bg-blue-50 text-blue-700', icon: Loader2 }
  }

  if (!item.selectable) {
    return { label: 'Не готово', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: FileWarning }
  }

  return { label: 'К раскладке', className: 'border-slate-200 bg-slate-50 text-[#374151]', icon: Scissors }
}

function machineStatus(machine: NestingQueueMachine) {
  if (machine.progress.total === 0) return { label: 'Нет позиций', className: 'bg-slate-100 text-slate-600' }
  if (machine.progress.done === machine.progress.total) return { label: 'Готово', className: 'bg-emerald-50 text-emerald-700' }
  if (machine.progress.done > 0) return { label: 'Частично', className: 'bg-blue-50 text-blue-700' }
  if (machine.progress.blocked > 0 && machine.progress.selectable === 0) return { label: 'Проблемы', className: 'bg-amber-50 text-amber-700' }
  return { label: 'Ожидает', className: 'bg-slate-100 text-[#374151]' }
}

export function NestingQueueClient({ queue }: { queue: NestingQueueData }) {
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can('nesting', 'manage')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [isPending, startTransition] = useTransition()
  const selectableIds = useMemo(
    () => queue.machines.flatMap((machine) => machine.items.filter((item) => item.selectable).map((item) => item.id)),
    [queue.machines]
  )
  const selectedIds = Array.from(selected).filter((id) => selectableIds.includes(id))

  function toggleItem(item: NestingQueueItem, checked: boolean) {
    if (!item.selectable) return
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(item.id)
      else next.delete(item.id)
      return next
    })
  }

  function toggleMachine(machine: NestingQueueMachine, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const item of machine.items) {
        if (!item.selectable) continue
        if (checked) next.add(item.id)
        else next.delete(item.id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function createBatch() {
    if (selectedIds.length === 0) {
      toast.error('Выберите хотя бы одну позицию для пакетной раскладки')
      return
    }

    startTransition(() => {
      void (async () => {
        const result = await createNestingBatch({ machineItemIds: selectedIds })
        if (!result.success || !result.data) {
          toast.error(result.error || 'Не удалось создать пакетную раскладку')
          return
        }
        toast.success('Пакетная раскладка создана')
        router.push(`/nesting/${result.data.nestingProjectId}/parts`)
        router.refresh()
      })()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1B3A6B]">Очередь раскладки</h2>
          <p className="text-sm text-[#6B7280]">
            Машин: {queue.totals.machines}, позиций: {queue.totals.items}, доступно: {queue.totals.selectable}, сделано: {queue.totals.done}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/nesting">
            <Button variant={queue.scope === 'all' ? 'default' : 'outline'} size="sm">Все активные</Button>
          </Link>
          <Link href="/nesting?scope=tasks">
            <Button variant={queue.scope === 'tasks' ? 'default' : 'outline'} size="sm">По задачам</Button>
          </Link>
          <Button variant="outline" size="sm" disabled={!canManage || selectedIds.length === 0 || isPending} onClick={clearSelection}>
            Сбросить
          </Button>
          <Button disabled={!canManage || selectedIds.length === 0 || isPending} onClick={createBatch}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Запустить пакет ({selectedIds.length})
          </Button>
        </div>
      </div>

      {queue.machines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-8 text-center">
          <p className="text-sm font-medium text-[#1B3A6B]">Нет машин в очереди раскладки</p>
          <p className="mt-1 text-sm text-[#6B7280]">Проверьте активные машины, товарные позиции и подтверждение чертежей инженером.</p>
        </div>
      ) : (
        queue.machines.map((machine) => (
          <MachineQueueCard
            key={machine.id}
            machine={machine}
            selected={selected}
            onToggleMachine={toggleMachine}
            onToggleItem={toggleItem}
            canManage={canManage}
          />
        ))
      )}
    </div>
  )
}

function MachineQueueCard({
  machine,
  selected,
  onToggleMachine,
  onToggleItem,
  canManage,
}: {
  machine: NestingQueueMachine
  selected: Set<string>
  onToggleMachine: (machine: NestingQueueMachine, checked: boolean) => void
  onToggleItem: (item: NestingQueueItem, checked: boolean) => void
  canManage: boolean
}) {
  const status = machineStatus(machine)
  const selectableItems = machine.items.filter((item) => item.selectable)
  const selectedCount = selectableItems.filter((item) => selected.has(item.id)).length
  const allSelected = selectableItems.length > 0 && selectedCount === selectableItems.length

  return (
    <section className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
      <div className="flex flex-col gap-3 border-b border-[#E8ECF0] bg-[#F8F9FA] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox
            checked={allSelected}
            disabled={!canManage || selectableItems.length === 0}
            onCheckedChange={(checked) => onToggleMachine(machine, checked === true)}
            className="mt-1"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/sales-plan/${machine.id}`} className="font-semibold text-[#1B3A6B] hover:underline">
                {machine.name}
              </Link>
              <Badge variant="outline" className={cn('border-transparent', status.className)}>{status.label}</Badge>
              {machine.hasTechnologistTask ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#DC2626]">
                  <Clock className="h-3.5 w-3.5" />
                  до {formatDate(machine.taskDeadline)}
                </span>
              ) : (
                <span className="text-xs text-[#9CA3AF]">Без активной задачи технолога</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
              <span>Клиент: {machine.clientName || '—'}</span>
              <span>Отгрузка: {formatDate(machine.desiredShippingDate)}</span>
              <span>Производство: {formatDate(machine.productionMonth)}</span>
              <span>Инженер: {machine.drawingsConfirmed ? 'подтверждено' : 'нет подтверждения'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-white px-2 py-1 text-[#374151]">Всего: {machine.progress.total}</span>
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">Сделано: {machine.progress.done}</span>
          <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">Доступно: {machine.progress.selectable}</span>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">Проблемы: {machine.progress.blocked}</span>
        </div>
      </div>

      <div className="divide-y divide-[#E8ECF0]">
        {machine.items.length === 0 ? (
          <div className="p-4 text-sm text-[#9CA3AF]">Нет товарных позиций для раскладки</div>
        ) : (
          machine.items.map((item) => (
            <ItemRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={onToggleItem} canManage={canManage} />
          ))
        )}
      </div>
    </section>
  )
}

function ItemRow({
  item,
  checked,
  onToggle,
  canManage,
}: {
  item: NestingQueueItem
  checked: boolean
  onToggle: (item: NestingQueueItem, checked: boolean) => void
  canManage: boolean
}) {
  const status = itemStatus(item)
  const Icon = status.icon

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[32px_minmax(220px,1fr)_130px_140px_180px] lg:items-center">
      <Checkbox
        checked={checked}
        disabled={!canManage || !item.selectable}
        onCheckedChange={(value) => onToggle(item, value === true)}
      />
      <div className="min-w-0">
        <div className="font-medium text-[#374151]">{item.productName}</div>
        <div className="mt-1 text-xs text-[#6B7280]">Чертеж: {item.drawingNumber || '—'} · Кол-во: {item.quantity}</div>
      </div>
      <div className="flex items-center gap-1 text-sm text-[#6B7280]">
        <PackageCheck className="h-4 w-4" />
        STEP {item.stepFileCount} / PDF {item.drawingPdfFileCount}
      </div>
      <Badge variant="outline" className={cn('w-fit gap-1', status.className)}>
        <Icon className={cn('h-3.5 w-3.5', item.run && status.label === 'В работе' && 'animate-spin')} />
        {status.label}
      </Badge>
      <div className="text-sm text-[#6B7280]">
        {item.disabledReason ? item.disabledReason : item.run ? `Проект ${item.run.nestingProjectId}` : 'Можно выбрать'}
      </div>
    </div>
  )
}
