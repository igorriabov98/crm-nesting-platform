"use client"

import { useMemo, useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, CalendarDays, ClipboardList, Loader2, PackageCheck, Plus, Save, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  getMachineOutsourcingCreateData,
  saveOutsourcingOperation,
  type MachineOutsourcingCreateData,
} from '@/lib/actions/outsourcing'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import type { StageType } from '@/lib/types'

type Draft = {
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

type ProductionOutsourcingQuickAddProps = {
  machineId: string
  machineName: string
  suggestedPositionAfterStageType?: StageType | null
  label?: string
  disabled?: boolean
  className?: string
}

const CUSTOM_WORK_TYPE_VALUE = 'custom'

function createDraft(data: MachineOutsourcingCreateData, positionAfterStageType?: StageType | null): Draft {
  return {
    workTypeId: data.workTypes[0]?.id || '',
    customWorkTypeName: '',
    useCustomWorkType: data.workTypes.length === 0,
    positionAfterStageType: positionAfterStageType || 'none',
    executorType: 'supplier',
    supplierId: data.suppliers.find((supplier) => supplier.can_outsource)?.id || data.suppliers[0]?.id || '',
    executorFactoryId: data.factories.find((factory) => factory.id !== data.machine.factory_id)?.id || data.factories[0]?.id || '',
    plannedSendDate: '',
    plannedReturnDate: '',
    note: '',
    itemIds: [],
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2 text-sm font-medium text-slate-800">
      {label}
      {children}
    </Label>
  )
}

const createDataCache = new Map<string, {
  data?: MachineOutsourcingCreateData
  promise?: ReturnType<typeof getMachineOutsourcingCreateData>
  loadedAt?: number
}>()
const CREATE_DATA_CACHE_MS = 60_000

function loadCreateData(machineId: string) {
  const cached = createDataCache.get(machineId)
  if (cached?.data && cached.loadedAt && Date.now() - cached.loadedAt < CREATE_DATA_CACHE_MS) {
    return Promise.resolve({ data: cached.data, error: null })
  }
  if (cached?.promise) return cached.promise

  const promise = getMachineOutsourcingCreateData(machineId).then((result) => {
    if (result.data) {
      createDataCache.set(machineId, { data: result.data, loadedAt: Date.now() })
    } else {
      createDataCache.delete(machineId)
    }
    return result
  })
  createDataCache.set(machineId, { ...cached, promise })
  return promise
}

export function ProductionOutsourcingQuickAdd({
  machineId,
  machineName,
  suggestedPositionAfterStageType = null,
  label = 'Аутсорсинг',
  disabled = false,
  className,
}: ProductionOutsourcingQuickAddProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [data, setData] = useState<MachineOutsourcingCreateData | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const openRequestRef = useRef(0)

  const outsourceSuppliers = useMemo(
    () => data?.suppliers.filter((supplier) => supplier.can_outsource || supplier.can_transport) || [],
    [data?.suppliers],
  )
  const selectedWorkTypeLabel = data?.workTypes.find((workType) => workType.id === draft?.workTypeId)?.name
    || 'Выберите тип работы'
  const selectedPlanPositionLabel = draft?.positionAfterStageType && draft.positionAfterStageType !== 'none'
    ? `После: ${STAGES[draft.positionAfterStageType].label}`
    : 'Не привязано'
  const selectedExecutorTypeLabel = draft?.executorType === 'factory' ? 'Завод' : 'Компания'
  const selectedExecutorLabel = draft?.executorType === 'factory'
    ? data?.factories.find((factory) => factory.id === draft.executorFactoryId)?.name || 'Выберите завод'
    : outsourceSuppliers.find((supplier) => supplier.id === draft?.supplierId)?.name || 'Выберите компанию'
  const canSubmit = Boolean(
    data?.canManage &&
      draft &&
      (draft.useCustomWorkType ? draft.customWorkTypeName.trim() : draft.workTypeId) &&
      draft.itemIds.length > 0 &&
      (draft.executorType === 'supplier' ? draft.supplierId : draft.executorFactoryId),
  )

  function prefetchDialog() {
    void loadCreateData(machineId)
  }

  async function openDialog() {
    const requestId = ++openRequestRef.current
    setOpen(true)
    setIsLoading(true)

    const result = await loadCreateData(machineId)
    if (requestId !== openRequestRef.current) return
    setIsLoading(false)

    if (result.error || !result.data) {
      toast.error(result.error || 'Не удалось загрузить данные аутсорсинга')
      setOpen(false)
      return
    }

    setData(result.data)
    setDraft(createDraft(result.data, suggestedPositionAfterStageType))
  }

  function toggleItem(itemId: string) {
    setDraft((current) => current
      ? {
          ...current,
          itemIds: current.itemIds.includes(itemId)
            ? current.itemIds.filter((id) => id !== itemId)
            : [...current.itemIds, itemId],
        }
      : current)
  }

  function submit() {
    if (!data || !draft) return

    startTransition(async () => {
      const result = await saveOutsourcingOperation({
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

      toast.success('Аутсорсинг добавлен')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || isLoading}
        onClick={openDialog}
        onPointerEnter={prefetchDialog}
        onFocus={prefetchDialog}
        className={cn('min-h-10 gap-2', className)}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!isPending) {
          if (!nextOpen) {
            openRequestRef.current += 1
            setIsLoading(false)
          }
          setOpen(nextOpen)
        }
      }}>
        <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 pr-14 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Settings2 className="size-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg text-slate-950">Новая работа на аутсорсинге</DialogTitle>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  <span>Машина</span>
                  <ArrowRight className="size-3.5" />
                  <span className="truncate font-semibold text-slate-800" title={machineName}>{machineName}</span>
                </div>
              </div>
            </div>
          </DialogHeader>

          {isLoading || !data || !draft ? (
            <div className="flex min-h-72 flex-1 items-center justify-center bg-slate-50/70 px-6">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
                <Loader2 className="size-5 animate-spin text-blue-600" />
                Подготавливаем форму
              </div>
            </div>
          ) : (
            <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
              {!data.canManage && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Недостаточно прав для управления аутсорсингом этой машины.
                </div>
              )}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <ClipboardList className="size-4 text-blue-600" />
                  Работа и место в плане
                </div>
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
                      <SelectValue>{draft.useCustomWorkType ? 'Другой тип работы' : selectedWorkTypeLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {data.workTypes.map((workType) => (
                        <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                      ))}
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
                  <Select
                    value={draft.positionAfterStageType}
                    onValueChange={(value) => value && setDraft({ ...draft, positionAfterStageType: value as StageType | 'none' })}
                  >
                    <SelectTrigger className="h-10 w-full"><SelectValue>{selectedPlanPositionLabel}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не привязано</SelectItem>
                      {STAGE_ORDER.map((stage) => (
                        <SelectItem key={stage} value={stage}>После: {STAGES[stage].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Building2 className="size-4 text-blue-600" />
                  Исполнитель
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Исполнитель">
                  <Select
                    value={draft.executorType}
                    onValueChange={(value) => value && setDraft({ ...draft, executorType: value as 'supplier' | 'factory' })}
                  >
                    <SelectTrigger className="h-10 w-full"><SelectValue>{selectedExecutorTypeLabel}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier">Компания</SelectItem>
                      <SelectItem value="factory">Завод</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label={draft.executorType === 'supplier' ? 'Компания' : 'Завод'}>
                  {draft.executorType === 'supplier' ? (
                    <Select value={draft.supplierId} onValueChange={(value) => value && setDraft({ ...draft, supplierId: value })}>
                      <SelectTrigger className="h-10 w-full"><SelectValue>{selectedExecutorLabel}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {outsourceSuppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={draft.executorFactoryId} onValueChange={(value) => value && setDraft({ ...draft, executorFactoryId: value })}>
                      <SelectTrigger className="h-10 w-full"><SelectValue>{selectedExecutorLabel}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {data.factories.map((factory) => (
                          <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <CalendarDays className="size-4 text-blue-600" />
                  Сроки и примечание
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Готовы отправить">
                  <Input
                    type="date"
                    value={draft.plannedSendDate}
                    onChange={(event) => setDraft({ ...draft, plannedSendDate: event.target.value })}
                  />
                </Field>

                <Field label="Ожидаем возврат">
                  <Input
                    type="date"
                    value={draft.plannedReturnDate}
                    onChange={(event) => setDraft({ ...draft, plannedReturnDate: event.target.value })}
                  />
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
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <PackageCheck className="size-4 text-blue-600" />
                    Товары
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    Выбрано: {draft.itemIds.length}
                  </span>
                </div>
                <div className="grid max-h-64 gap-2 overflow-y-auto">
                  {data.items.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      У машины нет товарных строк для аутсорсинга.
                    </div>
                  ) : (
                    data.items.map((item) => (
                      <label
                        key={item.id}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-sm',
                          draft.itemIds.includes(item.id)
                            ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-100'
                            : 'border-slate-200 bg-white hover:border-slate-300',
                        )}
                      >
                        <Checkbox checked={draft.itemIds.includes(item.id)} onCheckedChange={() => toggleItem(item.id)} />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">{item.product_name}</span>
                          <span className="text-slate-500">
                            {item.drawing_number} · {item.quantity} шт. · {Number(item.weight || 0).toFixed(2)} т
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={isPending || !canSubmit} onClick={submit} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isPending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
