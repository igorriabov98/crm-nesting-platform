"use client"

import React, { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineEdit } from '@/components/features/shared/InlineEdit'
import { useRole } from '@/lib/hooks/useRole'
import { differenceInDays, isPast, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Loader2, PackagePlus, Plus, Trash2, Truck } from 'lucide-react'
import { CHAIN_CORD_SUBTYPE_LABELS, ORDER_STATUS_LABELS, PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import {
  createSupplyItem,
  updateSupplyItem,
  deleteSupplyItem
} from '@/lib/actions/supply'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { MachineDetails, OrderItemStatus, RequestStatus, SupplyItem } from '@/lib/types'
import type { TechnologistRequestPayload } from '@/lib/actions/technologist-requests'

interface SupplyTabProps {
  machine: MachineDetails
  requestData?: TechnologistRequestPayload | null
}

type RequestMaterialRow = {
  id: string
  section: string
  name: string
  details: string
  quantity: string
  secondaryQuantity?: string
  orderStatus: OrderItemStatus
  orderedAt: string | null
  deliveredAt: string | null
  customDeliveryDate: string | null
}

const orderStatusBadgeClassName: Record<OrderItemStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  ordered: 'border-blue-200 bg-blue-50 text-blue-700',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

function formatAmountValue(value: number | string | null | undefined, maximumFractionDigits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(number)
}

function formatQuantity(value: number | string | null | undefined, unit: string) {
  return `${formatAmountValue(value)} ${unit}`
}

function compactDetails(parts: Array<string | number | null | undefined | false>) {
  return parts.filter((part) => part !== null && part !== undefined && part !== false && String(part).trim()).join(' · ')
}

function materialName(row: { materials?: { name?: string | null } | null }, fallback: string | null | undefined, defaultName: string) {
  return row.materials?.name || fallback || defaultName
}

function stageNote(row: RequestMaterialRow, requestStatus: RequestStatus) {
  if (row.orderStatus === 'delivered') return row.deliveredAt ? `Доставлено ${formatDate(row.deliveredAt)}` : 'Поставка закрыта'
  if (row.orderStatus === 'ordered') return row.orderedAt ? `Заказано ${formatDate(row.orderedAt)}` : 'Заказ размещён'
  if (row.customDeliveryDate) return `План: ${formatDate(row.customDeliveryDate)}`
  if (requestStatus === 'submitted_to_supply') return 'В работе у снабжения'
  if (requestStatus === 'completed') return 'Заявка завершена'
  return 'Заявка ещё не передана в снабжение'
}

function formatDate(dateString: string | null) {
  if (!dateString) return '—'
  return format(new Date(dateString), 'dd.MM.yyyy', { locale: ru })
}

function buildRequestMaterialRows(requestData?: TechnologistRequestPayload | null): RequestMaterialRow[] {
  if (!requestData) return []

  return [
    ...requestData.sheetMetal.map((row) => ({
      id: row.id,
      section: 'Листовой',
      name: materialName(row, row.material_name, 'Листовой металл'),
      details: compactDetails([
        row.material_grade,
        row.sheet_size,
        row.thickness_mm ? `${formatAmountValue(row.thickness_mm)} мм` : null,
      ]),
      quantity: formatQuantity(row.remainder_qty ?? row.quantity_sheets, 'шт'),
      secondaryQuantity: formatQuantity(row.weight_order_kg, 'кг'),
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.roundTube.map((row) => ({
      id: row.id,
      section: 'Круг / труба',
      name: materialName(row, row.material_name, 'Круг / труба'),
      details: row.piece_count || '—',
      quantity: formatQuantity(row.order_kg, 'кг'),
      secondaryQuantity: formatQuantity(row.order_meters, 'м'),
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.circles.map((row) => ({
      id: row.id,
      section: 'Круг',
      name: materialName(row, row.steel_grade, 'Круг'),
      details: compactDetails([
        row.diameter_mm ? `Ø ${formatAmountValue(row.diameter_mm)} мм` : null,
        row.is_calibrated ? 'Калиброванный' : null,
      ]),
      quantity: formatQuantity(row.remainder_mm, 'мм'),
      secondaryQuantity: row.calculated_weight_kg ? formatQuantity(row.calculated_weight_kg, 'кг') : undefined,
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.pipes.map((row) => ({
      id: row.id,
      section: 'Труба',
      name: materialName(row, PIPE_SUBTYPE_LABELS[row.pipe_type] || row.pipe_type, 'Труба'),
      details: compactDetails([
        row.size,
        row.wall_thickness_mm ? `стенка ${formatAmountValue(row.wall_thickness_mm)} мм` : null,
        row.diameter_mm ? `Ø ${formatAmountValue(row.diameter_mm)} мм` : null,
      ]),
      quantity: row.pipe_type === 'wire'
        ? formatQuantity(row.remainder_kg, 'кг')
        : formatQuantity(row.remainder_length_mm, 'мм'),
      secondaryQuantity: row.remainder_qty ? formatQuantity(row.remainder_qty, 'шт') : undefined,
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.knives.map((row) => ({
      id: row.id,
      section: 'Ножи',
      name: materialName(row, row.knife_type, 'Нож'),
      details: compactDetails([
        row.steel_grade,
        row.length_mm ? `${formatAmountValue(row.length_mm)} мм` : null,
        row.width_mm ? `${formatAmountValue(row.width_mm)} мм` : null,
        row.height_mm ? `${formatAmountValue(row.height_mm)} мм` : null,
      ]),
      quantity: row.remainder_meters > 0
        ? formatQuantity(row.remainder_meters, 'м')
        : formatQuantity(row.to_order_mm, 'мм'),
      secondaryQuantity: row.remainder_qty ? formatQuantity(row.remainder_qty, 'шт') : undefined,
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.components.map((row) => ({
      id: row.id,
      section: 'Комплектация',
      name: materialName(row, row.component_name, 'Комплектующая'),
      details: compactDetails([
        row.specification,
        row.diameter_mm ? `Ø ${formatAmountValue(row.diameter_mm)} мм` : null,
      ]),
      quantity: formatQuantity(row.to_order ?? Math.max(Number(row.quantity_needed || 0) - Number(row.stock_remainder || 0), 0), row.unit || 'шт'),
      secondaryQuantity: `Потребность: ${formatQuantity(row.quantity_needed, row.unit || 'шт')}`,
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.paint.map((row) => ({
      id: row.id,
      section: 'Краска',
      name: materialName(row, row.paint_type, 'Краска'),
      details: compactDetails([
        row.ral_code,
        row.finish,
      ]),
      quantity: formatQuantity(row.remainder_kg ?? row.to_order_kg, 'кг'),
      secondaryQuantity: formatQuantity(row.area_m2, 'м²'),
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.meshItems.map((row) => ({
      id: row.id,
      section: 'Сетка',
      name: materialName(row, row.description, 'Сетка'),
      details: compactDetails([
        row.length_mm ? `${formatAmountValue(row.length_mm)} мм` : null,
        row.width_mm ? `${formatAmountValue(row.width_mm)} мм` : null,
      ]),
      quantity: formatQuantity(row.remainder_qty, 'шт'),
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
    ...requestData.chainCords.map((row) => ({
      id: row.id,
      section: 'Цепь / шнур',
      name: materialName(row, CHAIN_CORD_SUBTYPE_LABELS[row.item_type] || row.item_type, 'Цепь / шнур'),
      details: row.parameters || '—',
      quantity: formatQuantity(row.remainder_meters, 'м'),
      orderStatus: row.order_status,
      orderedAt: row.ordered_at,
      deliveredAt: row.delivered_at,
      customDeliveryDate: row.custom_delivery_date,
    })),
  ]
}

export function SupplyTab({ machine, requestData = null }: SupplyTabProps) {
  const { isDirector, isEngineer, isTechnologist, isSupplyManager } = useRole()
  const [isCreating, setIsCreating] = useState(false)

  const items = machine.supply_items || []
  const requestMaterialRows = useMemo(() => buildRequestMaterialRows(requestData), [requestData])
  const receivedCount = items.filter((i) => i.status === 'received').length
    + requestMaterialRows.filter((item) => item.orderStatus === 'delivered').length
  const totalCount = items.length + requestMaterialRows.length
  const percent = totalCount > 0 ? Math.round((receivedCount / totalCount) * 100) : 0
  const showManualItems = items.length > 0 || requestMaterialRows.length === 0

  const canCreate = isDirector || isTechnologist || isSupplyManager

  const handleUpdate = async (itemId: string, field: string, value: string | number | boolean | null) => {
    return updateSupplyItem(itemId, { [field]: value }, machine.id)
  }

  const handleDelete = async (itemId: string) => {
    return deleteSupplyItem(itemId, machine.id)
  }

  const handleAdd = async () => {
    setIsCreating(true)
    await createSupplyItem(machine.id, { nomenclature: 'Новая позиция' })
    setIsCreating(false)
  }

  const statusOptions = [
    { value: 'not_ordered', label: 'Не заказано' },
    { value: 'ordered', label: 'Заказано' },
    { value: 'received', label: 'Получено' },
  ]

  const getStatusBadge = (status: string) => {
    if (status === 'received') return <Badge className="bg-green-600">Получено</Badge>
    if (status === 'ordered') return <Badge className="bg-yellow-600">Заказано</Badge>
    return <Badge className="bg-red-600">Не заказано</Badge>
  }

  // Helper to color deadline texts if past
  const renderDeadline = (dateString: string | null) => {
    if (!dateString) return <span className="text-[#9CA3AF]">—</span>
    const date = new Date(dateString)
    const overdue = isPast(date) && differenceInDays(new Date(), date) > 0
    return (
      <span className={cn(overdue && "text-[#DC2626] font-medium")}>
        {format(date, 'dd.MM.yyyy', { locale: ru })}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">Снабжение</h2>
            <p className="mt-1 text-sm text-slate-500">Контроль заказа, сроков и подтверждения поставки.</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={handleAdd} disabled={isCreating} className="min-h-11 bg-blue-950 text-white hover:bg-blue-900">
            {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Добавить позицию
          </Button>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">
            Получено <span className="font-bold tabular-nums text-blue-950">{receivedCount}</span> из <span className="font-bold tabular-nums text-blue-950">{totalCount}</span> материалов
          </p>
          <Progress value={percent} className="mt-3 h-2.5 bg-slate-100" indicatorClassName="bg-blue-950" />
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-left sm:text-right">
          <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-700">Готовность</span>
          <span className="mt-0.5 block text-xl font-bold tabular-nums text-emerald-800">{percent}%</span>
        </div>
      </div>

      {requestMaterialRows.length > 0 && requestData && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-950">Материалы из заявки</h3>
            </div>
            <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50 text-blue-800">
              {requestMaterialRows.length} поз.
            </Badge>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-3">#</th>
                  <th className="min-w-[120px] px-3 py-3">Раздел</th>
                  <th className="min-w-[260px] px-3 py-3">Материал</th>
                  <th className="min-w-[150px] px-3 py-3">Количество</th>
                  <th className="min-w-[170px] px-3 py-3">Этап</th>
                  <th className="min-w-[170px] px-3 py-3">Дата / план</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requestMaterialRows.map((item, index) => (
                  <tr key={item.id} className="bg-white hover:bg-slate-50">
                    <td className="px-3 py-3 text-slate-400">{index + 1}</td>
                    <td className="px-3 py-3 text-slate-600">{item.section}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-blue-950">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.details || '—'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium tabular-nums text-slate-900">{item.quantity}</div>
                      {item.secondaryQuantity && <div className="mt-1 text-xs tabular-nums text-slate-500">{item.secondaryQuantity}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={orderStatusBadgeClassName[item.orderStatus]}>
                        {ORDER_STATUS_LABELS[item.orderStatus]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{stageNote(item, requestData.request.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-3 lg:hidden">
            {requestMaterialRows.map((item, index) => (
              <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.section} · {index + 1}</div>
                    <div className="mt-1 break-words font-semibold text-blue-950">{item.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.details || '—'}</div>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0', orderStatusBadgeClassName[item.orderStatus])}>
                    {ORDER_STATUS_LABELS[item.orderStatus]}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="block text-xs text-slate-500">Количество</span>
                    <span className="mt-1 block font-semibold tabular-nums text-slate-900">{item.quantity}</span>
                    {item.secondaryQuantity && <span className="mt-0.5 block text-xs tabular-nums text-slate-500">{item.secondaryQuantity}</span>}
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="block text-xs text-slate-500">Этап</span>
                    <span className="mt-1 block font-medium text-slate-900">{stageNote(item, requestData.request.status)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {showManualItems && (
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3 w-8">#</th>
              <th className="px-3 py-3 min-w-[200px]">Номенклатура</th>
              <th className="px-3 py-3 w-20">Кол-во</th>
              <th className="px-3 py-3 w-16">Ед.</th>
              <th className="px-3 py-3 min-w-[150px]">Поставщик</th>
              <th className="px-3 py-3 min-w-[100px]">Цена</th>
              <th className="px-3 py-3 min-w-[120px]">Статус</th>
              <th className="px-3 py-3 w-24 text-center">План. дата</th>
              <th className="px-3 py-3 w-24 text-center">Дедлайн (Т)</th>
              <th className="px-3 py-3 w-24 text-center">Дедлайн (И)</th>
              <th className="px-3 py-3 min-w-[150px]">Комментарий</th>
              <th className="px-3 py-3 text-center">Подтверждено</th>
              <th className="px-3 py-3">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: SupplyItem, idx: number) => {
              // Права редактирования для полей
              const canEditTech = isDirector || isTechnologist
              const canEditSupply = isDirector || isSupplyManager
              const canEditEng = isDirector || isEngineer

              return (
                <tr key={item.id} className="border-b border-[#E8ECF0] bg-white hover:bg-[#F8F9FA]">
                  <td className="px-3 py-3 text-[#9CA3AF]">{idx + 1}</td>
                  
                  {/* Номенклатура */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.nomenclature}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'nomenclature', val)}
                    />
                  </td>
                  
                  {/* Количество */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="number"
                      value={item.quantity}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'quantity', val)}
                      className="w-16"
                    />
                  </td>

                  {/* Ед. изм. */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.unit}
                      editable={canEditTech}
                      onSave={(val) => handleUpdate(item.id, 'unit', val)}
                      className="w-12"
                    />
                  </td>

                  {/* Поставщик */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.supplier}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'supplier', val)}
                    />
                  </td>

                  {/* Цена */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="number"
                      value={item.price_per_unit}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'price_per_unit', val)}
                      className="w-20"
                    />
                  </td>

                  {/* Статус */}
                  <td className="px-3 py-3">
                    {!canEditSupply ? getStatusBadge(item.status) : (
                      <InlineEdit
                        type="select"
                        value={item.status}
                        options={statusOptions}
                        editable={true}
                        onSave={(val) => handleUpdate(item.id, 'status', val)}
                      />
                    )}
                  </td>

                  {/* Плановая дата поставки (редактируется Supply) */}
                  <td className="px-3 py-3 text-center">
                    <InlineEdit
                      type="date"
                      value={item.planned_delivery_date}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'planned_delivery_date', val)}
                      className="w-[125px]"
                    />
                  </td>

                  {/* Дедлайн технолога (Read-only) */}
                  <td className="px-3 py-3 text-center">
                    {renderDeadline(item.technologist_deadline)}
                  </td>

                  {/* Дедлайн инженера (Read-only) */}
                  <td className="px-3 py-3 text-center">
                    {renderDeadline(item.engineer_deadline)}
                  </td>

                  {/* Комментарий */}
                  <td className="px-3 py-3">
                    <InlineEdit
                      type="text"
                      value={item.comment}
                      editable={canEditSupply}
                      onSave={(val) => handleUpdate(item.id, 'comment', val)}
                    />
                  </td>

                  {/* Инженер подтверждение */}
                  <td className="px-3 py-3 text-center">
                    <Checkbox
                      checked={item.engineer_confirmation}
                      disabled={!canEditEng}
                      onCheckedChange={(c) => handleUpdate(item.id, 'engineer_confirmation', c === true)}
                    />
                  </td>

                  {/* Действия (Удаление) — бэкенд проверяет владельца/директора */}
                  <td className="px-3 py-3 text-center">
                    <AlertDialog>
                      <AlertDialogTrigger
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:text-[#DC2626] hover:bg-[#F8F9FA] transition-colors"
                        aria-label="Удалить позицию"
                      >
                        <Trash2 className="w-4 h-4" />
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B]">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить позицию?</AlertDialogTitle>
                          <AlertDialogDescription className="text-[#6B7280]">
                            Это действие необратимо. Позиция снабжения будет удалена из системы.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] hover:bg-[#E8ECF0]">Отмена</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => handleDelete(item.id)}
                          >
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>

                </tr>
              )
            })}
            
            {items.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-[#6B7280] border-b border-[#E8ECF0]">
                  Позиции снабжения пока не добавлены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {showManualItems && (
      <div className="space-y-3 lg:hidden">
        {items.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
              <PackagePlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 className="mt-3 font-semibold text-slate-950">Позиции снабжения не добавлены</h3>
            <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Добавьте первую позицию, чтобы контролировать заказ и сроки поставки.</p>
          </div>
        ) : (
          items.map((item: SupplyItem, idx: number) => {
            const canEditTech = isDirector || isTechnologist
            const canEditSupply = isDirector || isSupplyManager
            const canEditEng = isDirector || isEngineer

            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Позиция {idx + 1}</span>
                    <div className="mt-1 break-words text-base font-semibold text-slate-950">
                      <InlineEdit
                        type="text"
                        value={item.nomenclature}
                        editable={canEditTech}
                        onSave={(value) => handleUpdate(item.id, 'nomenclature', value)}
                      />
                    </div>
                  </div>
                  <div className="shrink-0">
                    {!canEditSupply ? getStatusBadge(item.status) : (
                      <InlineEdit
                        type="select"
                        value={item.status}
                        options={statusOptions}
                        editable
                        onSave={(value) => handleUpdate(item.id, 'status', value)}
                      />
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="block text-xs font-medium text-slate-500">Количество</span>
                    <div className="mt-1 font-semibold text-slate-900">
                      <InlineEdit type="number" value={item.quantity} editable={canEditTech} onSave={(value) => handleUpdate(item.id, 'quantity', value)} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <InlineEdit type="text" value={item.unit} editable={canEditTech} onSave={(value) => handleUpdate(item.id, 'unit', value)} />
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="block text-xs font-medium text-slate-500">Цена за единицу</span>
                    <div className="mt-1 font-semibold tabular-nums text-slate-900">
                      €<InlineEdit type="number" value={item.price_per_unit} editable={canEditSupply} onSave={(value) => handleUpdate(item.id, 'price_per_unit', value)} />
                    </div>
                  </div>
                </div>

                <dl className="mt-4 space-y-3 text-sm">
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3">
                    <dt className="text-slate-500">Поставщик</dt>
                    <dd className="min-w-0 font-medium text-slate-900"><InlineEdit type="text" value={item.supplier} editable={canEditSupply} onSave={(value) => handleUpdate(item.id, 'supplier', value)} /></dd>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3">
                    <dt className="text-slate-500">План поставки</dt>
                    <dd className="font-medium text-slate-900"><InlineEdit type="date" value={item.planned_delivery_date} editable={canEditSupply} onSave={(value) => handleUpdate(item.id, 'planned_delivery_date', value)} /></dd>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3">
                    <dt className="text-slate-500">Дедлайн Т</dt>
                    <dd className="font-medium text-slate-900">{renderDeadline(item.technologist_deadline)}</dd>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3">
                    <dt className="text-slate-500">Дедлайн И</dt>
                    <dd className="font-medium text-slate-900">{renderDeadline(item.engineer_deadline)}</dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <span className="block text-xs font-medium text-slate-500">Комментарий</span>
                  <div className="mt-1 text-sm text-slate-700"><InlineEdit type="text" value={item.comment} editable={canEditSupply} onSave={(value) => handleUpdate(item.id, 'comment', value)} /></div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Checkbox checked={item.engineer_confirmation} disabled={!canEditEng} onCheckedChange={(checked) => handleUpdate(item.id, 'engineer_confirmation', checked === true)} />
                    Подтверждено инженером
                  </label>
                  <AlertDialog>
                    <AlertDialogTrigger className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 transition-colors hover:bg-red-100" aria-label="Удалить позицию">
                      <Trash2 className="h-4 w-4" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить позицию?</AlertDialogTitle>
                        <AlertDialogDescription>Позиция снабжения будет безвозвратно удалена из машины.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => handleDelete(item.id)}>Удалить</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </article>
            )
          })
        )}
      </div>
      )}
    </div>
  )
}
