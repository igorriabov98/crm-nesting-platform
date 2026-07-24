"use client"

import { useMemo, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getMachineOutsourcingData, saveOutsourcingOperation, type MachineOutsourcingData } from '@/lib/actions/outsourcing'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'
import { cn } from '@/lib/utils'
import type { StageType } from '@/lib/types'

type Draft = {
  workTypeId: string
  positionAfterStageType: StageType | 'none'
  executorType: 'supplier' | 'factory'
  supplierId: string
  executorFactoryId: string
  plannedSendDate: string
  plannedReturnDate: string
  serviceCostPlanned: string
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

function createDraft(data: MachineOutsourcingData, positionAfterStageType?: StageType | null): Draft {
  return {
    workTypeId: data.workTypes[0]?.id || '',
    positionAfterStageType: positionAfterStageType || 'none',
    executorType: 'supplier',
    supplierId: data.suppliers.find((supplier) => supplier.can_outsource)?.id || data.suppliers[0]?.id || '',
    executorFactoryId: data.factories.find((factory) => factory.id !== data.machine.factory_id)?.id || data.factories[0]?.id || '',
    plannedSendDate: '',
    plannedReturnDate: '',
    serviceCostPlanned: '',
    note: '',
    itemIds: [],
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      {children}
    </Label>
  )
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
  const [data, setData] = useState<MachineOutsourcingData | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

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
      draft?.workTypeId &&
      draft.itemIds.length > 0 &&
      (draft.executorType === 'supplier' ? draft.supplierId : draft.executorFactoryId),
  )

  async function openDialog() {
    setOpen(true)
    setIsLoading(true)
    setData(null)
    setDraft(null)

    const result = await getMachineOutsourcingData(machineId)
    setIsLoading(false)

    if (result.error || !result.data) {
      toast.error(result.error || 'Не удалось загрузить данные аутсорсинга')
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
        workTypeId: draft.workTypeId,
        positionAfterStageType: draft.positionAfterStageType === 'none' ? null : draft.positionAfterStageType,
        executorType: draft.executorType,
        supplierId: draft.executorType === 'supplier' ? draft.supplierId : null,
        executorFactoryId: draft.executorType === 'factory' ? draft.executorFactoryId : null,
        plannedSendDate: draft.plannedSendDate || null,
        plannedReturnDate: draft.plannedReturnDate || null,
        serviceCostPlanned: draft.serviceCostPlanned ? Number(draft.serviceCostPlanned) : null,
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
        className={cn('min-h-10 gap-2', className)}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => !isPending && setOpen(nextOpen)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Добавить аутсорсинг</DialogTitle>
          </DialogHeader>

          {isLoading || !data || !draft ? (
            <div className="flex min-h-40 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка данных машины
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-medium uppercase text-slate-500">Машина</div>
                <div className="mt-1 truncate text-sm font-semibold text-blue-950" title={machineName}>
                  {machineName}
                </div>
              </div>

              {!data.canManage && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Недостаточно прав для управления аутсорсингом этой машины.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Тип работы">
                  <Select value={draft.workTypeId} onValueChange={(value) => value && setDraft({ ...draft, workTypeId: value })}>
                    <SelectTrigger className="h-10 w-full"><SelectValue>{selectedWorkTypeLabel}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {data.workTypes.map((workType) => (
                        <SelectItem key={workType.id} value={workType.id}>{workType.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

                <Field label="Готовы отправить">
                  <Input
                    type="date"
                    value={draft.plannedSendDate}
                    onChange={(event) => setDraft({ ...draft, plannedSendDate: event.target.value })}
                    disabled={!data.canManageDatesDirectly}
                  />
                </Field>

                <Field label="Ожидаем возврат">
                  <Input
                    type="date"
                    value={draft.plannedReturnDate}
                    onChange={(event) => setDraft({ ...draft, plannedReturnDate: event.target.value })}
                    disabled={!data.canManageDatesDirectly}
                  />
                </Field>

                <Field label="Стоимость услуги">
                  <Input
                    type="number"
                    min={0}
                    value={draft.serviceCostPlanned}
                    onChange={(event) => setDraft({ ...draft, serviceCostPlanned: event.target.value })}
                  />
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
                          draft.itemIds.includes(item.id) ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white',
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
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={isPending || !canSubmit} onClick={submit} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
