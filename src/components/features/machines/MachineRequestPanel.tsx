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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-800">
              <FileText className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-semibold text-slate-950">Заявка на материалы</h2>
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
            <Button variant="outline" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${machineId}/request`)} className="min-h-11 border-slate-200">
              Открыть заявку
            </Button>
            {canOpenSupplyRequest && (
              <Button variant="outline" onClick={() => router.push(`${ROUTES.SUPPLY_REQUEST}/${requestData.request.id}`)} className="min-h-11 border-blue-200 text-blue-800">
                Открыть для снабжения
              </Button>
            )}
          </div>
        ) : canCreate ? (
          <Button type="button" onClick={create} disabled={isCreating} className="min-h-11 bg-blue-900 text-white hover:bg-blue-800">
            <Plus className="mr-2 h-4 w-4" />
            Создать заявку на материалы
          </Button>
        ) : null}
      </div>
    </section>
  )
}
