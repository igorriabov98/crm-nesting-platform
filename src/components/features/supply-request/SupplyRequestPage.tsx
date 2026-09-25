'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, Factory, Pin } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RequestStatusBadge } from '@/components/features/requests/RequestStatusBadge'
import { ROUTES } from '@/lib/constants/routes'
import { reserveAllAvailable, type SupplyRequestPayload } from '@/lib/actions/supply-request'
import { completeStockReservation } from '@/lib/actions/technologist-requests'
import {
  isBusinessScrapReservationStatus,
  isSupplyWarehouseReservationStatus,
} from '@/lib/supply-request-flow'
import { SupplyChainCordTable } from './SupplyChainCordTable'
import { SupplyCircleTable } from './SupplyCircleTable'
import { SupplyComponentsTable } from './SupplyComponentsTable'
import { SupplyKnivesTable } from './SupplyKnivesTable'
import { SupplyMeshTable } from './SupplyMeshTable'
import { SupplyPaintTable } from './SupplyPaintTable'
import { SupplyPipeTable } from './SupplyPipeTable'
import { SupplyRequestSummary } from './SupplyRequestSummary'
import { SupplySheetMetalTable } from './SupplySheetMetalTable'
import { DetailingRequestPanel } from './DetailingRequestPanel'
import type { DetailingRequestWorkspace } from '@/lib/actions/detailing'

type Props = {
  data: SupplyRequestPayload
  detailing: DetailingRequestWorkspace | null
}

type TabKey = 'sheet_metal' | 'circle' | 'pipe' | 'knives' | 'paint' | 'components' | 'mesh' | 'chain_cord'

export function SupplyRequestPage({ data, detailing }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<TabKey>('sheet_metal')
  const { request } = data
  const defaultFactoryId = data.factories.find((factory) => factory.is_destination)?.id || data.factories[0]?.id || ''
  const [selectedFactoryId, setSelectedFactoryId] = useState(defaultFactoryId)
  const selectedFactory = data.factories.find((factory) => factory.id === selectedFactoryId)
  const filteredSections = useMemo(() => {
    const filterRows = <T extends { stock_items: SupplyRequestPayload['sections']['sheetMetal'][number]['stock_items']; available_stock: number | null }>(rows: T[]) => rows.map((row) => {
      const stockItems = row.stock_items.filter((item) => item.factory_id === selectedFactoryId)
      return { ...row, stock_items: stockItems, available_stock: stockItems.reduce((sum, item) => sum + Number(item.available_quantity || 0), 0) }
    })
    return {
      sheetMetal: filterRows(data.sections.sheetMetal), circles: filterRows(data.sections.circles),
      pipes: filterRows(data.sections.pipes), knives: filterRows(data.sections.knives),
      paint: filterRows(data.sections.paint), components: filterRows(data.sections.components),
      meshItems: filterRows(data.sections.meshItems), chainCords: filterRows(data.sections.chainCords),
    }
  }, [data.sections, selectedFactoryId])
  const isStockCheckMode = isBusinessScrapReservationStatus(request.status)
  const isWarehouseReservationMode = isSupplyWarehouseReservationStatus(request.status)
  const canReserveByRole = data.can_reserve
  const canReserve = (isStockCheckMode || isWarehouseReservationMode) && canReserveByRole
  const canUnreserve = (isStockCheckMode || isWarehouseReservationMode) && data.can_unreserve
  const canCompleteReservation = (isStockCheckMode || isWarehouseReservationMode) && data.can_complete_reservation
  const canManageDetailing = (isStockCheckMode || isWarehouseReservationMode) && data.can_manage_detailing
  const totalWeight = [
    ...data.sections.sheetMetal,
    ...data.sections.circles,
    ...data.sections.pipes,
    ...data.sections.knives,
  ].reduce((sum, item) => sum + (item.calculated_weight_kg ?? 0), 0)
    + data.sections.paint.reduce((sum, item) => sum + Number(item.remainder_kg || 0), 0)

  const sections: Array<{ key: TabKey; label: string; count: number }> = [
    { key: 'sheet_metal', label: 'Листовой металл', count: data.sections.sheetMetal.length },
    { key: 'circle', label: 'Круг', count: data.sections.circles.length },
    { key: 'pipe', label: 'Труба', count: data.sections.pipes.length },
    { key: 'knives', label: 'Ножи', count: data.sections.knives.length },
    { key: 'paint', label: 'Краска', count: data.sections.paint.length },
    { key: 'components', label: 'Комплектация', count: data.sections.components.length },
    { key: 'mesh', label: 'Сетка', count: data.sections.meshItems.length },
    { key: 'chain_cord', label: 'Цепь / Шнур', count: data.sections.chainCords.length },
  ]

  const reserveAll = () => {
    startTransition(async () => {
      const result = await reserveAllAvailable(request.id, selectedFactoryId)
      if (!result.success) {
        toast.error(result.error || 'Не удалось забронировать остатки')
        return
      }
      toast.success(`Забронировано ${result.reserved_count} поз.; пропущено ${result.skipped_count} поз.`)
      router.refresh()
    })
  }

  const completeReservation = () => {
    startTransition(async () => {
      const result = await completeStockReservation(request.id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось завершить бронь')
        return
      }
      if (result.data?.submittedRevision) {
        toast.success('Исправленная позиция передана снабжению')
        router.push(result.data.href)
        router.refresh()
        return
      }
      if (result.data?.advancedToWarehouse) {
        toast.success('Этап делового остатка завершён. Открыта бронь основного склада')
        router.push(result.data.href)
        router.refresh()
        return
      }
      router.push(result.data?.href || `/technologist/requests/${request.id}/complete`)
    })
  }

  return (
    <div className="space-y-6">
      <Link href={ROUTES.SUPPLY} className="inline-flex items-center gap-2 text-sm font-medium text-[#6B7280] hover:text-[#1B3A6B]">
        <ArrowLeft className="h-4 w-4" />
        Вернуться в снабжение
      </Link>

      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">
              {isWarehouseReservationMode
                ? 'Бронь основного склада'
                : data.positionRevision ? 'Проверка исправленной позиции' : 'Заявка на материалы'}: {request.machine.name}
            </h1>
            {data.positionRevision && (
              <p className="mt-2 text-sm text-amber-800">
                После проверки склада и финансового согласования исправленные позиции заменят возвращённую позицию и станут доступны снабжению.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#6B7280]">
              <RequestStatusBadge status={request.status} />
              <span>Технолог: <span className="font-medium text-[#374151]">{request.technologist_name || '—'}</span></span>
              <span>Дата: <span className="font-medium text-[#374151]">{format(new Date(request.created_at), 'dd.MM.yyyy', { locale: ru })}</span></span>
              {request.machine.planned_material_date && (
                <Badge variant="outline">Материал: {format(new Date(`${request.machine.planned_material_date}T00:00:00`), 'dd.MM.yyyy')}</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReserve && (
              <Button type="button" onClick={reserveAll} disabled={isPending} className="bg-[#1B3A6B] text-white hover:bg-[#254B87]">
                <Pin className="mr-2 h-4 w-4" />
                {isStockCheckMode ? 'Забронировать деловой остаток' : 'Забронировать доступное со склада'}
              </Button>
            )}
            {(isStockCheckMode || isWarehouseReservationMode) && (
              <Button type="button" onClick={completeReservation} disabled={isPending || !canCompleteReservation} className="bg-emerald-700 text-white hover:bg-emerald-800">
                {isStockCheckMode
                  ? 'Перейти к основному складу'
                  : 'Завершить бронь склада и продолжить'}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${request.machine_id}`)}>
              Открыть заказ
            </Button>
          </div>
        </div>
        {isStockCheckMode && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Забронируйте доступный деловой остаток и завершите этап, чтобы перейти к проверке основного склада.
          </p>
        )}
        {(isStockCheckMode || isWarehouseReservationMode) && data.reservation_block_reason && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            Бронирование недоступно: {data.reservation_block_reason}
          </p>
        )}
        {(isStockCheckMode || isWarehouseReservationMode) && !canCompleteReservation && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
            Завершение этапа недоступно: {data.completion_block_reason || 'требуется право управления заявками технолога.'}
          </p>
        )}
        {isWarehouseReservationMode && (
          <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            Проверьте основной склад. Незакрытый объём автоматически останется в колонке «К заказу» для снабжения.
          </p>
        )}
      </section>

      {(isStockCheckMode || isWarehouseReservationMode) && detailing && <DetailingRequestPanel key={`${detailing.requestId}:${detailing.decision}`} workspace={detailing} canManage={canManageDetailing} />}

      <section className="rounded-xl border border-[#E8ECF0] bg-white p-4" aria-labelledby="factory-switch-title">
        <div className="mb-3 flex items-center gap-2">
          <Factory className="h-5 w-5 text-[#1B3A6B]" />
          <div>
            <h2 id="factory-switch-title" className="font-semibold text-[#1B3A6B]">Склад завода</h2>
            <p className="text-xs text-[#6B7280]">Остатки загружены. Переключение не выполняет новый запрос.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Выберите завод бронирования">
          {data.factories.map((factory) => (
            <button
              key={factory.id}
              type="button"
              role="radio"
              aria-checked={factory.id === selectedFactoryId}
              onClick={() => setSelectedFactoryId(factory.id)}
              className={`min-h-11 rounded-lg border px-4 py-2 text-left text-sm transition ${factory.id === selectedFactoryId ? 'border-[#1B3A6B] bg-[#1B3A6B] text-white shadow-sm' : 'border-[#DDE3EA] bg-white text-[#374151] hover:border-[#8CA2C4] hover:bg-[#F8FAFC]'}`}
            >
              <span className="font-medium">{factory.name}</span>
              {factory.is_destination && <span className="ml-2 text-xs opacity-75">завод машины</span>}
              <span className={`ml-3 rounded-full px-2 py-0.5 text-xs ${factory.id === selectedFactoryId ? 'bg-white/20' : 'bg-[#EEF2F7] text-[#526075]'}`}>
                {factory.available_position_count}
              </span>
            </button>
          ))}
        </div>
        {canReserve && selectedFactory && !selectedFactory.is_destination && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Бронь со склада «{selectedFactory.name}» автоматически создаст межзаводское перемещение на завод машины.
          </p>
        )}
      </section>

      <SupplyRequestSummary summary={data.summary} totalWeight={totalWeight}
        sheetBusinessScrapReserved={isStockCheckMode
          ? data.sections.sheetMetal.reduce((sum, row) => sum + Number(row.reserved_quantity || 0), 0)
          : null} />

      <div className="rounded-xl border border-[#E8ECF0] bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setActiveTab(section.key)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                activeTab === section.key
                  ? 'bg-[#1B3A6B] text-white'
                  : 'bg-white text-[#374151] hover:bg-[#F8F9FA]'
              }`}
            >
              {section.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === section.key ? 'bg-white/20 text-white' : 'bg-[#EEF2F7] text-[#6B7280]'}`}>
                {section.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'sheet_metal' && <SupplySheetMetalTable key={selectedFactoryId} rows={isStockCheckMode ? data.sections.sheetMetal : filteredSections.sheetMetal} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} businessScrapMode={isStockCheckMode} />}
      {activeTab === 'circle' && <SupplyCircleTable key={selectedFactoryId} rows={filteredSections.circles} requestId={request.id} />}
      {activeTab === 'pipe' && <SupplyPipeTable key={selectedFactoryId} rows={filteredSections.pipes} requestId={request.id} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} />}
      {activeTab === 'knives' && <SupplyKnivesTable key={selectedFactoryId} rows={filteredSections.knives} requestId={request.id} />}
      {activeTab === 'paint' && <SupplyPaintTable key={selectedFactoryId} rows={filteredSections.paint} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} />}
      {activeTab === 'components' && <SupplyComponentsTable key={selectedFactoryId} rows={filteredSections.components} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} />}
      {activeTab === 'mesh' && <SupplyMeshTable key={selectedFactoryId} rows={filteredSections.meshItems} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} />}
      {activeTab === 'chain_cord' && <SupplyChainCordTable key={selectedFactoryId} rows={filteredSections.chainCords} machineId={request.machine_id!} canReserve={canReserve} canUnreserve={canUnreserve} />}
    </div>
  )
}
