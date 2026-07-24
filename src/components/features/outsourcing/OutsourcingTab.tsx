'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2, Plus, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'
import {
  archiveOutsourcingOperation,
  saveOutsourcingOperation,
  syncZincOutsourcingForMachine,
  upsertZincOutsourcingDefault,
  type MachineOutsourcingData,
  type MachineOutsourcingOperation,
} from '@/lib/actions/outsourcing'
import { createProductionPlanDateChangeRequest } from '@/lib/actions/production-plan'
import type { StageType } from '@/lib/types'
import { cn } from '@/lib/utils'

type Draft = {
  id?: string | null
  workTypeId: string
  customWorkTypeName: string
  useCustomWorkType: boolean
  positionAfterStageType: StageType | 'none'
  executorType: 'supplier' | 'factory'
  supplierId: string
  executorFactoryId: string
  plannedSendDate: string
  plannedReturnDate: string
  note: string
  itemIds: string[]
}

const CUSTOM_WORK_TYPE_VALUE = 'custom'

const emptyDraft = (data: MachineOutsourcingData): Draft => ({
  id: null,
  workTypeId: data.workTypes[0]?.id || '',
  customWorkTypeName: '',
  useCustomWorkType: data.workTypes.length === 0,
  positionAfterStageType: 'none',
  executorType: 'supplier',
  supplierId: data.suppliers.find((supplier) => supplier.can_outsource)?.id || data.suppliers[0]?.id || '',
  executorFactoryId: data.factories.find((factory) => factory.id !== data.machine.factory_id)?.id || data.factories[0]?.id || '',
  plannedSendDate: '',
  plannedReturnDate: '',
  note: '',
  itemIds: [],
})

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function executorLabel(operation: MachineOutsourcingOperation) {
  return operation.executor_type === 'factory'
    ? operation.executor_factory_name || 'Завод не указан'
    : operation.supplier_name || 'Поставщик не указан'
}

function needLabel(operation: MachineOutsourcingOperation, direction: 'outbound' | 'return') {
  const need = operation.needs.find((item) => item.direction === direction && item.status !== 'cancelled')
  if (!need) return 'пока нет'
  const plan = need.plan_state === 'preliminary' ? 'предварительно' : 'утверждено'
  const status = need.status === 'open' ? 'нужен транспорт' : need.status === 'linked' ? 'рейс найден' : need.status === 'completed' ? 'выполнено' : 'отменено'
  return `${plan}, ${status}`
}

function operationToDraft(data: MachineOutsourcingData, operation: MachineOutsourcingOperation): Draft {
  return {
    id: operation.id,
    workTypeId: operation.work_type_id,
    customWorkTypeName: '',
    useCustomWorkType: false,
    positionAfterStageType: operation.position_after_stage_type || 'none',
    executorType: operation.executor_type,
    supplierId: operation.supplier_id || data.suppliers[0]?.id || '',
    executorFactoryId: operation.executor_factory_id || data.factories[0]?.id || '',
    plannedSendDate: operation.planned_send_date || '',
    plannedReturnDate: operation.planned_return_date || '',
    note: operation.note || '',
    itemIds: operation.items.map((item) => item.id),
  }
}

export function OutsourcingTab({ data }: { data: MachineOutsourcingData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(data))
  const [zincExecutorType, setZincExecutorType] = useState<'supplier' | 'factory'>(data.zincDefault?.executor_type || 'supplier')
  const [zincSupplierId, setZincSupplierId] = useState(data.zincDefault?.supplier_id || data.suppliers.find((supplier) => supplier.can_outsource)?.id || '')
  const [zincFactoryId, setZincFactoryId] = useState(data.zincDefault?.executor_factory_id || data.factories.find((factory) => factory.id !== data.machine.factory_id)?.id || '')

  const outsourceSuppliers = useMemo(
    () => data.suppliers.filter((supplier) => supplier.can_outsource || supplier.can_transport),
    [data.suppliers],
  )
  const zincItems = data.items.filter((item) => item.coating === 'zinc')
  const canSaveZincDefault = Boolean(data.machine.factory_id && (zincExecutorType === 'supplier' ? zincSupplierId : zincFactoryId))

  function openCreate() {
    setDraft(emptyDraft(data))
    setDialogOpen(true)
  }

  function openEdit(operation: MachineOutsourcingOperation) {
    setDraft(operationToDraft(data, operation))
    setDialogOpen(true)
  }

  function toggleItem(itemId: string) {
    setDraft((current) => ({
      ...current,
      itemIds: current.itemIds.includes(itemId)
        ? current.itemIds.filter((id) => id !== itemId)
        : [...current.itemIds, itemId],
    }))
  }

  function submitOperation() {
    startTransition(async () => {
      const result = await saveOutsourcingOperation({
        id: draft.id,
        machineId: data.machine.id,
        workTypeId: draft.useCustomWorkType ? null : draft.workTypeId,
        workTypeName: draft.useCustomWorkType ? draft.customWorkTypeName : null,
        positionAfterStageType: draft.positionAfterStageType === 'none' ? null : draft.positionAfterStageType,
        executorType: draft.executorType,
        supplierId: draft.executorType === 'supplier' ? draft.supplierId : null,
        executorFactoryId: draft.executorType === 'factory' ? draft.executorFactoryId : null,
        plannedSendDate: draft.plannedSendDate || null,
        plannedReturnDate: draft.plannedReturnDate || null,
        note: draft.note || null,
        itemIds: draft.itemIds,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить аутсорсинг')
        return
      }
      toast.success('Аутсорсинг сохранён')
      setDialogOpen(false)
      router.refresh()
    })
  }

  function archiveOperation(operationId: string) {
    if (!confirm('Архивировать операцию аутсорсинга?')) return
    startTransition(async () => {
      const result = await archiveOutsourcingOperation(operationId)
      if (!result.success) {
        toast.error(result.error || 'Не удалось архивировать операцию')
        return
      }
      toast.success('Операция архивирована')
      router.refresh()
    })
  }

  function requestDateChange(operation: MachineOutsourcingOperation) {
    const sendDate = window.prompt('Новая дата готовности отправить', operation.planned_send_date || '')
    if (sendDate === null) return
    const returnDate = window.prompt('Новая дата ожидаемого возврата', operation.planned_return_date || '')
    if (returnDate === null) return
    const comment = window.prompt('Комментарий к запросу', '') || null

    startTransition(async () => {
      const result = await createProductionPlanDateChangeRequest({
        machineId: data.machine.id,
        changes: [
          {
            target_type: 'outsourcing',
            outsourcing_operation_id: operation.id,
            field_name: 'planned_send_date',
            new_value: sendDate || null,
          },
          {
            target_type: 'outsourcing',
            outsourcing_operation_id: operation.id,
            field_name: 'planned_return_date',
            new_value: returnDate || null,
          },
        ],
        comment,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось отправить запрос')
        return
      }
      toast.success('Запрос на изменение дат отправлен')
      router.refresh()
    })
  }

  function saveZincDefault(syncAfterSave = false) {
    if (!data.machine.factory_id) return
    startTransition(async () => {
      const result = await upsertZincOutsourcingDefault({
        factoryId: data.machine.factory_id!,
        executorType: zincExecutorType,
        supplierId: zincExecutorType === 'supplier' ? zincSupplierId : null,
        executorFactoryId: zincExecutorType === 'factory' ? zincFactoryId : null,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить настройку цинка')
        return
      }
      if (syncAfterSave) {
        const syncResult = await syncZincOutsourcingForMachine(data.machine.id)
        if (!syncResult.success) {
          toast.error(syncResult.error || 'Настройка сохранена, но цинк не синхронизирован')
          router.refresh()
          return
        }
      }
      toast.success(syncAfterSave ? 'Цинк синхронизирован' : 'Настройка цинка сохранена')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-blue-950">Аутсорсинг машины</div>
            <div className="mt-1 text-sm text-slate-500">
              {data.planStatus === 'confirmed' ? 'План подтверждён: изменение дат идёт через согласование.' : 'Операции можно ставить между этапами плана.'}
            </div>
          </div>
          <Button onClick={openCreate} disabled={!data.canManage || isPending} className="min-h-10 gap-2 bg-blue-900 text-white hover:bg-blue-800">
            <Plus className="h-4 w-4" />
            Добавить
          </Button>
        </div>
      </section>

      {zincItems.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-900">Цинк</Badge>
                <span className="text-sm font-semibold text-slate-900">{zincItems.length} позиций</span>
              </div>
              <div className="mt-1 text-sm text-slate-500">Исполнитель по умолчанию для цинка на заводе отправителя.</div>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-[140px_minmax(160px,1fr)_auto] lg:max-w-2xl">
              <Select value={zincExecutorType} onValueChange={(value) => value && setZincExecutorType(value as 'supplier' | 'factory')}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">Компания</SelectItem>
                  <SelectItem value="factory">Завод</SelectItem>
                </SelectContent>
              </Select>
              {zincExecutorType === 'supplier' ? (
                <Select value={zincSupplierId} onValueChange={(value) => setZincSupplierId(value || '')}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Поставщик" /></SelectTrigger>
                  <SelectContent>
                    {outsourceSuppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={zincFactoryId} onValueChange={(value) => setZincFactoryId(value || '')}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Завод" /></SelectTrigger>
                  <SelectContent>
                    {data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button disabled={!data.canManage || !canSaveZincDefault || isPending} onClick={() => saveZincDefault(true)} className="min-h-10 gap-2">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Сохранить и синхр.
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-3">
        {data.operations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Операции аутсорсинга пока не добавлены.
          </div>
        ) : data.operations.map((operation) => (
          <section key={operation.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={operation.is_zinc_operation ? 'default' : 'secondary'}>{operation.work_type_name}</Badge>
                  <span className="font-semibold text-blue-950">{executorLabel(operation)}</span>
                  {operation.position_after_stage_type && (
                    <span className="text-sm text-slate-500">после этапа {STAGES[operation.position_after_stage_type]?.label || operation.position_after_stage_type}</span>
                  )}
                </div>
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                  <span>Отправка: <b>{formatDate(operation.planned_send_date)}</b></span>
                  <span>Возврат: <b>{formatDate(operation.planned_return_date)}</b></span>
                  <span>Туда: <b>{needLabel(operation, 'outbound')}</b></span>
                  <span>Обратно: <b>{needLabel(operation, 'return')}</b></span>
                </div>
                {operation.executor_type === 'supplier' && (
                  <div className="text-sm text-slate-600">
                    Снабжение: <b>{operation.supply_terms_confirmed_at ? 'условия подтверждены' : 'ожидается подтверждение даты и стоимости'}</b>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {operation.items.map((item) => (
                    <Badge key={item.id} variant="outline" className="bg-slate-50">
                      {item.product_name} · {item.quantity} шт.
                    </Badge>
                  ))}
                </div>
                {operation.note && <div className="text-sm text-slate-500">{operation.note}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                {data.planStatus === 'confirmed' && data.canManage && (
                  <Button variant="outline" disabled={isPending} onClick={() => requestDateChange(operation)}>
                    Запросить даты
                  </Button>
                )}
                <Button variant="outline" disabled={!data.canManage || isPending} onClick={() => openEdit(operation)}>
                  Редактировать
                </Button>
                <Button variant="outline" disabled={!data.canManage || operation.is_zinc_operation || isPending} onClick={() => archiveOperation(operation.id)} className="text-red-700 hover:text-red-800">
                  <Archive className="mr-2 h-4 w-4" />
                  Архив
                </Button>
              </div>
            </div>
          </section>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Редактировать аутсорсинг' : 'Добавить аутсорсинг'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Тип работы">
              <Select
                value={draft.useCustomWorkType ? CUSTOM_WORK_TYPE_VALUE : draft.workTypeId}
                onValueChange={(value) => value && setDraft({
                  ...draft,
                  useCustomWorkType: value === CUSTOM_WORK_TYPE_VALUE,
                  workTypeId: value === CUSTOM_WORK_TYPE_VALUE ? '' : value,
                })}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue>
                    {draft.useCustomWorkType
                      ? 'Другой тип работы'
                      : data.workTypes.find((workType) => workType.id === draft.workTypeId)?.name || 'Выберите тип работы'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {data.workTypes.map((workType) => <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>)}
                  <SelectItem value={CUSTOM_WORK_TYPE_VALUE}>Другой тип работы…</SelectItem>
                </SelectContent>
              </Select>
              {draft.useCustomWorkType && (
                <Input
                  value={draft.customWorkTypeName}
                  onChange={(event) => setDraft({ ...draft, customWorkTypeName: event.target.value })}
                  placeholder="Напишите тип работы"
                  aria-label="Свой тип работы"
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Место в плане">
              <Select value={draft.positionAfterStageType} onValueChange={(value) => value && setDraft({ ...draft, positionAfterStageType: value as StageType | 'none' })}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не привязано</SelectItem>
                  {STAGE_ORDER.map((stage) => <SelectItem key={stage} value={stage}>После: {STAGES[stage]?.label || stage}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Исполнитель">
              <Select value={draft.executorType} onValueChange={(value) => value && setDraft({ ...draft, executorType: value as 'supplier' | 'factory' })}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">Компания</SelectItem>
                  <SelectItem value="factory">Завод</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={draft.executorType === 'supplier' ? 'Компания' : 'Завод'}>
              {draft.executorType === 'supplier' ? (
                <Select value={draft.supplierId} onValueChange={(value) => value && setDraft({ ...draft, supplierId: value })}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Выберите компанию" /></SelectTrigger>
                  <SelectContent>
                    {outsourceSuppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={draft.executorFactoryId} onValueChange={(value) => value && setDraft({ ...draft, executorFactoryId: value })}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Выберите завод" /></SelectTrigger>
                  <SelectContent>
                    {data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Готовы отправить">
              <Input type="date" value={draft.plannedSendDate} onChange={(event) => setDraft({ ...draft, plannedSendDate: event.target.value })} disabled={Boolean(draft.id) && !data.canManageDatesDirectly} />
            </Field>
            <Field label="Ожидаем возврат">
              <Input type="date" value={draft.plannedReturnDate} onChange={(event) => setDraft({ ...draft, plannedReturnDate: event.target.value })} disabled={Boolean(draft.id) && !data.canManageDatesDirectly} />
              <span className="text-xs font-normal text-slate-500">
                Снабжение подтвердит эту дату или скорректирует её.
              </span>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Заметка">
                <Textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-blue-950">Товары</div>
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
              {data.items.map((item) => (
                <label key={item.id} className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm', draft.itemIds.includes(item.id) ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white')}>
                  <Checkbox checked={draft.itemIds.includes(item.id)} onCheckedChange={() => toggleItem(item.id)} />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{item.product_name}</span>
                    <span className="text-slate-500">{item.drawing_number} · {item.quantity} шт. · {Number(item.weight || 0).toFixed(2)} т</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isPending}>Отмена</Button>
            <Button onClick={submitOperation} disabled={isPending || !(draft.useCustomWorkType ? draft.customWorkTypeName.trim() : draft.workTypeId) || draft.itemIds.length === 0 || (draft.executorType === 'supplier' ? !draft.supplierId : !draft.executorFactoryId)} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      {children}
    </Label>
  )
}
