"use client"

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'
import { useRole } from '@/lib/hooks/useRole'
import { clearProductionStageDates, updateMachineDate, updateProductionStage, toggleStageSkip } from '@/lib/actions/production'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CalendarDays, MinusCircle, Undo2, Ban, Info, Eraser, Loader2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { getDesiredShippingInfo } from '@/lib/utils/desired-shipping'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { COATINGS } from '@/lib/constants/coatings'
import type { MachineDetails, MachineItem, ProductionStage } from '@/lib/types'
import { toast } from 'sonner'

interface ProductionTabProps {
  machine: MachineDetails
}

const stageHasWorkshop = (stageType: string) => !['cutting', 'galvanizing'].includes(stageType)

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function ProductionTab({ machine }: ProductionTabProps) {
  const router = useRouter()
  const { isProductionManager, isSalesManager, isDirector } = useRole()
  const canEdit = isProductionManager || isDirector
  const canEditSalesDates = isSalesManager || isDirector
  const canEditProductionDates = isProductionManager || isDirector
  const [clearingStageId, setClearingStageId] = useState<string | null>(null)

  const stages = useMemo(() => {
    const rawStages = machine.production_stages || []
    return [...rawStages].sort((a, b) => {
      return STAGE_ORDER.indexOf(a.stage_type) - STAGE_ORDER.indexOf(b.stage_type)
    })
  }, [machine])

  const calculateStatus = (stage: ProductionStage) => {
    if (stage.is_skipped) return { label: 'Пропущен', color: 'bg-[#E8ECF0] text-[#374151]' }
    if (stage.stage_type === 'actual_shipping' && stage.date_end) {
      return { label: 'Завершён', color: 'bg-green-600 text-white' }
    }

    if (stage.manual_overdue) {
      return { label: 'Просрочено вручную', color: 'bg-red-600 text-white' }
    }

    if (!stage.date_start && !stage.date_end) return { label: 'Не запланирован', color: 'bg-[#F8F9FA] text-[#6B7280]' }

    const today = todayDateOnly()
    if (stage.date_start && stage.date_start <= today) {
      return { label: 'По плану сейчас', color: 'bg-[#1B3A6B] text-white' }
    }
    return { label: 'Запланирован', color: 'bg-[#F8F9FA] text-[#6B7280]' }
  }

  const handleUpdate = async (stageId: string, field: string, value: string | number | boolean | null) => {
    const res = await updateProductionStage(stageId, { [field]: value })
    if (res.success) router.refresh()
    return res
  }

  const handleNightShiftCheckbox = async (stageId: string, isNightShift: boolean) => {
    return handleUpdate(stageId, 'is_night_shift', isNightShift)
  }

  const handleMachineDateUpdate = async (
    field: 'desired_shipping_date' | 'planned_material_date' | 'actual_material_date' | 'actual_shipping_date' | 'delivery_to_client_date',
    value: string | null
  ) => {
    const res = await updateMachineDate(machine.id, field, value)
    if (res.success) router.refresh()
    return res
  }

  const handleClearStageDates = async (stage: ProductionStage) => {
    setClearingStageId(stage.id)
    try {
      const res = await clearProductionStageDates(stage.id)
      if (!res.success) {
        toast.error(res.error || 'Ошибка очистки дат')
        return res
      }

      toast.success('Даты этапа очищены')
      router.refresh()
      return res
    } finally {
      setClearingStageId(null)
    }
  }

  const handleToggleStageSkip = async (stageId: string, isSkipped: boolean) => {
    const res = await toggleStageSkip(stageId, isSkipped)
    if (res.success) router.refresh()
    return res
  }

  const workshopOptions = [
    { value: '1', label: 'Цех 1' },
    { value: '2', label: 'Цех 2' },
  ]

  const itemsWithZinc = (machine.machine_items || []).filter((i) => i.coating === 'zinc')
  const itemsWithPainting = (machine.machine_items || []).filter((i) => i.coating === 'powder_coating')

  const hasZinc = itemsWithZinc.length > 0
  const hasPainting = itemsWithPainting.length > 0
  const desiredShipping = getDesiredShippingInfo(machine.desired_shipping_date)

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[#E8ECF0] bg-[#F8F9FA] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]">
          <CalendarDays className="h-4 w-4" />
          Даты машины
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1">
            <div className="text-xs text-[#6B7280]">Желаемая отгрузка</div>
            <InlineEdit
              type="date"
              value={machine.desired_shipping_date}
              editable={canEditSalesDates}
              onSave={(value) => handleMachineDateUpdate('desired_shipping_date', value)}
              dateDisplayFormat="dd.MM.yyyy"
              fallbackText="—"
              placeholder="Дата..."
            />
            {desiredShipping && (
              <div className={cn(
                "text-xs",
                desiredShipping.tone === 'overdue' && "text-[#DC2626]",
                desiredShipping.tone === 'soon' && "text-[#D97706]",
                desiredShipping.tone === 'normal' && "text-[#6B7280]"
              )}>
                {desiredShipping.tone === 'overdue' ? `⚠ ${desiredShipping.label}` : desiredShipping.label}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[#6B7280]">План. поставка мат.</div>
            <InlineEdit
              type="date"
              value={machine.planned_material_date}
              editable={canEditProductionDates}
              onSave={(value) => handleMachineDateUpdate('planned_material_date', value)}
              dateDisplayFormat="dd.MM.yyyy"
              fallbackText="—"
              placeholder="Дата..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[#6B7280]">Факт. поставка мат.</div>
            <InlineEdit
              type="date"
              value={machine.actual_material_date}
              editable={canEditProductionDates}
              onSave={(value) => handleMachineDateUpdate('actual_material_date', value)}
              dateDisplayFormat="dd.MM.yyyy"
              fallbackText="—"
              placeholder="Дата..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[#6B7280]">Факт. отгрузка</div>
            <InlineEdit
              type="date"
              value={machine.actual_shipping_date}
              editable={canEditProductionDates}
              onSave={(value) => handleMachineDateUpdate('actual_shipping_date', value)}
              dateDisplayFormat="dd.MM.yyyy"
              fallbackText="—"
              placeholder="Дата..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[#6B7280]">Доставка клиенту</div>
            <InlineEdit
              type="date"
              value={machine.delivery_to_client_date}
              editable={canEditSalesDates}
              onSave={(value) => handleMachineDateUpdate('delivery_to_client_date', value)}
              dateDisplayFormat="dd.MM.yyyy"
              fallbackText="—"
              placeholder="Дата..."
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E8ECF0] mt-4">
      <table className="w-full text-sm text-left">
        <thead className="bg-[#F8F9FA] text-[#6B7280] text-xs uppercase">
          <tr>
            <th className="px-4 py-3">Этап</th>
            <th className="px-4 py-3">Цех</th>
            <th className="px-4 py-3">Начало</th>
            <th className="px-4 py-3">Конец</th>
            <th className="px-4 py-3">Ночная</th>
            <th className="px-4 py-3">Статус</th>
            <th className="px-4 py-3">Детали</th>
            {canEdit && <th className="px-4 py-3">Действия</th>}
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const meta = STAGES[stage.stage_type as keyof typeof STAGES]
            const status = calculateStatus(stage)
            
            const isGalvanizing = stage.stage_type === 'galvanizing'
            const isPainting = stage.stage_type === 'painting'
            const cannotSkip = (isGalvanizing && hasZinc) || (isPainting && hasPainting)
            const isClearingDates = clearingStageId === stage.id
            const hasStageDates = Boolean(stage.date_start || stage.date_end)

            return (
              <tr key={stage.id} className="border-b border-[#E8ECF0] bg-white hover:bg-[#F8F9FA]">
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className={cn(stage.is_skipped && "line-through text-[#9CA3AF]")}>
                      {meta.label}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {!stageHasWorkshop(stage.stage_type) ? (
                    <span className="text-[#9CA3AF]">—</span>
                  ) : meta.fixedWorkshop !== null ? (
                    <span className="text-[#6B7280]">Цех {meta.fixedWorkshop}</span>
                  ) : (
                    <InlineEdit
                      type="select"
                      value={stage.workshop?.toString() || null}
                      options={workshopOptions}
                      editable={canEdit && !stage.is_skipped}
                      onSave={(val) => handleUpdate(stage.id, 'workshop', parseInt(val))}
                      placeholder="Выбрать..."
                    />
                  )}
                </td>
                <td className="px-4 py-3">
                  <InlineEdit
                    type="date"
                    value={stage.date_start}
                    editable={canEdit && !stage.is_skipped}
                    onSave={(val) => handleUpdate(stage.id, 'date_start', val)}
                  />
                </td>
                <td className="px-4 py-3">
                  <InlineEdit
                    type="date"
                    value={stage.date_end}
                    editable={canEdit && !stage.is_skipped}
                    onSave={(val) => handleUpdate(stage.id, 'date_end', val)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={stage.is_night_shift || false}
                      disabled={!canEdit || stage.is_skipped}
                      onCheckedChange={(c) => handleNightShiftCheckbox(stage.id, c === true)}
                    />
                    {stage.is_night_shift && (
                      <InlineEdit
                        type="date"
                        value={stage.night_shift_date}
                        editable={canEdit && !stage.is_skipped}
                        onSave={(val) => handleUpdate(stage.id, 'night_shift_date', val)}
                        placeholder="Дата..."
                        className="w-[125px]"
                      />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={status.color}>{status.label}</Badge>
                    {canEdit && !stage.is_skipped && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdate(stage.id, 'manual_overdue', !stage.manual_overdue)}
                        className={cn(
                          'h-7 px-2 text-xs',
                          stage.manual_overdue
                            ? 'border-[#DC2626] bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FEE2E2]'
                            : 'border-[#E8ECF0] text-[#6B7280] hover:text-[#DC2626]'
                        )}
                      >
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Просрочка
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {/* Попап Детально для цинка и малярки */}
                  {isGalvanizing && hasZinc && (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-[#1B3A6B] bg-[#F8F9FA] border border-[#1B3A6B]/20" />
                        }
                      >
                          <Info className="w-3 h-3 mr-1" /> Детально
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-4">
                        <h4 className="font-semibold text-[#1B3A6B] mb-2">{COATINGS.zinc.label}</h4>
                        <ul className="text-sm space-y-2 mb-3">
                          {itemsWithZinc.map((item: MachineItem) => (
                            <li key={item.id} className="text-[#374151]">
                              • {item.product_name} <span className="text-[#9CA3AF]">({item.drawing_number})</span><br />
                              <span className="text-xs text-[#6B7280] ml-3">{item.quantity} шт, {Number(item.weight).toFixed(2)} т</span>
                            </li>
                          ))}
                        </ul>
                      </PopoverContent>
                    </Popover>
                  )}
                  {isPainting && hasPainting && (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-orange-600 bg-orange-50 border border-orange-200" />
                        }
                      >
                          <Info className="w-3 h-3 mr-1" /> Детально
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-4">
                        <h4 className="font-semibold text-orange-600 mb-2">{COATINGS.powder_coating.label}</h4>
                        <ul className="text-sm space-y-2 mb-3">
                          {itemsWithPainting.map((item: MachineItem) => (
                            <li key={item.id} className="text-[#374151]">
                              • {item.product_name} <span className="text-[#9CA3AF]">({item.drawing_number})</span><br />
                              <span className="text-xs text-[#6B7280] ml-3">RAL {item.ral_number}, {item.quantity} шт, {Number(item.weight).toFixed(2)} т</span>
                            </li>
                          ))}
                        </ul>
                      </PopoverContent>
                    </Popover>
                  )}
                </td>
                {canEdit && (
                  <td className="px-4 py-3">
                    {stage.is_skipped ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStageSkip(stage.id, false)}
                        className="h-7 px-2 text-xs text-[#6B7280] hover:text-[#1B3A6B]"
                      >
                        <Undo2 className="w-3 h-3 mr-1" />
                        Вернуть
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!hasStageDates || isClearingDates}
                        title="Очистить даты этапа"
                        onClick={() => handleClearStageDates(stage)}
                        className="h-7 px-2 text-xs text-[#6B7280] hover:text-[#1B3A6B]"
                      >
                        {isClearingDates ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Eraser className="w-3 h-3 mr-1" />}
                        Очистить даты
                      </Button>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={cannotSkip}
                                onClick={() => handleToggleStageSkip(stage.id, true)}
                                className="h-7 px-2 text-xs text-[#6B7280] hover:text-[#DC2626]"
                              >
                                {cannotSkip ? <Ban className="w-3 h-3 mr-1" /> : <MinusCircle className="w-3 h-3 mr-1" />}
                                Пропустить
                              </Button>
                            }
                          />
                          {cannotSkip && (
                            <TooltipContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                              Нельзя пропустить — требуются работы с покрытием
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
