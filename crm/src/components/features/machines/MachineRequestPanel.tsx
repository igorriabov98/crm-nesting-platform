'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RequestStatusBadge, getRequestStatusLabel } from '@/components/features/requests/RequestStatusBadge'
import { createRequest, type TechnologistRequestPayload } from '@/lib/actions/technologist-requests'
import { ROUTES } from '@/lib/constants/routes'

type Props = {
  machineId: string
  requestData: TechnologistRequestPayload | null
  canManageTechnologistRequests: boolean
  canViewSupplyRequest: boolean
}

export function MachineRequestPanel({ machineId, requestData, canManageTechnologistRequests, canViewSupplyRequest }: Props) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const canCreate = canManageTechnologistRequests
  const canOpenSupplyRequest = requestData?.request.status === 'submitted_to_supply' && canViewSupplyRequest

  const create = async () => {
    setIsCreating(true)
    try {
      const result = await createRequest(machineId)
      if (!result.success) throw new Error(result.error || 'Не удалось создать заявку')
      toast.success('Заявка создана')
      router.push(`${ROUTES.SALES_PLAN}/${machineId}/request`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать заявку')
    } finally {
      setIsCreating(false)
    }
  }

  const summary = requestData ? [
    `Листовой: ${requestData.sheetMetal.length} поз., ${requestData.sheetMetal.reduce((sum, item) => sum + Number(item.weight_order_kg || 0), 0).toFixed(0)} кг`,
    `Круг/Труба: ${requestData.roundTube.length} поз.`,
    `Ножи: ${requestData.knives.length} поз.`,
    `Комплектация: ${requestData.components.length} поз.`,
    `Краска: ${requestData.paint.length} поз.`,
  ].join(' · ') : null

  return (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#1B3A6B]" />
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Заявка на материалы</h2>
          </div>
          {requestData ? (
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div>{summary}</div>
              <div>{getRequestStatusLabel(requestData.request.status)}</div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Заявка технолога для этой машины ещё не создана.</p>
          )}
        </div>

        {requestData ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RequestStatusBadge status={requestData.request.status} />
            <Button variant="outline" size="sm" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${machineId}/request`)}>
              Открыть заявку
            </Button>
            {canOpenSupplyRequest && (
              <Button variant="outline" size="sm" onClick={() => router.push(`${ROUTES.SUPPLY_REQUEST}/${requestData.request.id}`)}>
                Открыть для снабжения
              </Button>
            )}
          </div>
        ) : canCreate ? (
          <Button type="button" size="sm" onClick={create} disabled={isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            Создать заявку на материалы
          </Button>
        ) : null}
      </div>
    </section>
  )
}
