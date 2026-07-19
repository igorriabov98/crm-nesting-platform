'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, Pin } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RequestStatusBadge } from '@/components/features/requests/RequestStatusBadge'
import { ROUTES } from '@/lib/constants/routes'
import { reserveAllAvailable, type SupplyRequestPayload } from '@/lib/actions/supply-request'
import { completeStockReservation } from '@/lib/actions/technologist-requests'
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
  const isStockCheckMode = request.status === 'pending_stock_check' || request.status === 'stock_checked'
  const canCompleteReservation = isStockCheckMode && data.current_role !== 'supply_manager'
  const canManageOrders = request.status === 'submitted_to_supply' || request.status === 'completed'
  const canManageDetailing = isStockCheckMode && ['technologist', 'planning_director', 'financial_director', 'commercial_director'].includes(data.current_role)
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
      const result = await reserveAllAvailable(request.id)
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
      toast.success('Бронь завершена. Заявка передана в снабжение.')
      router.replace(ROUTES.MATERIAL_REQUESTS)
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
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Заявка на материалы: {request.machine.name}</h1>
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
            <Button type="button" onClick={reserveAll} disabled={isPending} className="bg-[#1B3A6B] text-white hover:bg-[#254B87]">
              <Pin className="mr-2 h-4 w-4" />
              {isStockCheckMode ? 'Бронь делового отхода' : 'Забронировать склад'}
            </Button>
            {canCompleteReservation && (
              <Button type="button" onClick={completeReservation} disabled={isPending} className="bg-emerald-700 text-white hover:bg-emerald-800">
                Бронь завершена
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${request.machine_id}`)}>
              Открыть машину
            </Button>
          </div>
        </div>
        {isStockCheckMode && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Заявка на проверке делового отхода. Забронируйте только доступный деловой отход и нажмите &quot;Бронь завершена&quot;, чтобы передать незакрытый остаток в снабжение.
          </p>
        )}
      </section>

      {detailing && <DetailingRequestPanel workspace={detailing} canManage={canManageDetailing} />}

      <SupplyRequestSummary summary={data.summary} totalWeight={totalWeight} />

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

      {activeTab === 'sheet_metal' && <SupplySheetMetalTable rows={data.sections.sheetMetal} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'circle' && <SupplyCircleTable rows={data.sections.circles} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'pipe' && <SupplyPipeTable rows={data.sections.pipes} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'knives' && <SupplyKnivesTable rows={data.sections.knives} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'paint' && <SupplyPaintTable rows={data.sections.paint} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'components' && <SupplyComponentsTable rows={data.sections.components} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'mesh' && <SupplyMeshTable rows={data.sections.meshItems} machineId={request.machine_id} canManageOrders={canManageOrders} />}
      {activeTab === 'chain_cord' && <SupplyChainCordTable rows={data.sections.chainCords} machineId={request.machine_id} canManageOrders={canManageOrders} />}
    </div>
  )
}
