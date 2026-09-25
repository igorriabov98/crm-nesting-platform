'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Lock, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChainCordSection } from './ChainCordSection'
import { CircleSection } from './CircleSection'
import { ComponentsSection } from './ComponentsSection'
import { KnivesSection } from './KnivesSection'
import { MeshSection } from './MeshSection'
import { PaintSection } from './PaintSection'
import { calculatePipeWeight, PipeSection } from './PipeSection'
import { RequestStatusBadge } from './RequestStatusBadge'
import { SheetMetalSection } from './SheetMetalSection'
import { submitRequest, type TechnologistRequestPayload } from '@/lib/actions/technologist-requests'
import { submitStockMaterialRequest } from '@/lib/actions/stock-material-requests'
import { ROUTES } from '@/lib/constants/routes'
import { isTechnologistRequestEditable } from '@/lib/technologist-request-editability'
import type { Machine, RequestStatus, Supplier } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'

type SupplierGroups = {
  sheetMetal: Supplier[]
}

type Props = {
  machine: Pick<Machine, 'id' | 'name'>
  data: TechnologistRequestPayload
  suppliers: SupplierGroups
  canManage: boolean
  steelTypes: SteelType[]
  backHref?: string
  backLabel?: string
  readOnlyMessage?: string
  revisionNumber?: number | null
  requestNumber?: number
  approvalState?: string | null
  stockMode?: boolean
  canSubmit?: boolean
}

type PaintRows = TechnologistRequestPayload['paint']
type ComponentRows = TechnologistRequestPayload['components']
type MeshRows = TechnologistRequestPayload['meshItems']
type ChainCordRows = TechnologistRequestPayload['chainCords']
type PipeRows = TechnologistRequestPayload['pipes']

export function TechnologistRequestPage({ machine, data, suppliers, canManage, steelTypes, backHref, backLabel, readOnlyMessage, revisionNumber, requestNumber, approvalState, stockMode = false, canSubmit = true }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<RequestStatus>(data.request.status)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paintRows, setPaintRows] = useState(data.paint)
  const [componentRows, setComponentRows] = useState(data.components)
  const [meshRows, setMeshRows] = useState(data.meshItems)
  const [chainCordRows, setChainCordRows] = useState(data.chainCords)
  const [pipeRows, setPipeRows] = useState(data.pipes)
  const revision = data.positionRevision || null
  const isWireRevision = revision?.category === 'pipe' && data.pipes.some((item) =>
    item.id === revision.replacement_request_item_id && item.pipe_type === 'wire')
  const revisionTab = revision?.category === 'sheet_metal' ? 'sheet' : isWireRevision ? 'circle' : revision?.category || 'sheet'
  const canEdit = canManage && isTechnologistRequestEditable(status)
  const resolvedReadOnlyMessage = readOnlyMessage || (
    isTechnologistRequestEditable(status)
      ? 'У вас есть доступ к составу заявки, но нет права изменять её позиции.'
      : 'Заявка уже передана в снабжение и доступна только для просмотра.'
  )
  const handlePaintRowsChange = useCallback((rows: PaintRows) => {
    setPaintRows(rows)
  }, [])
  const handleComponentRowsChange = useCallback((rows: ComponentRows) => {
    setComponentRows(rows)
  }, [])
  const handleMeshRowsChange = useCallback((rows: MeshRows) => {
    setMeshRows(rows)
  }, [])
  const handleChainCordRowsChange = useCallback((rows: ChainCordRows) => {
    setChainCordRows(rows)
  }, [])
  const handlePipeRowsChange = useCallback((rows: PipeRows) => {
    setPipeRows((current) => [...current.filter((item) => item.pipe_type === 'wire'), ...rows])
  }, [])
  const handleWireRowsChange = useCallback((rows: PipeRows) => {
    setPipeRows((current) => [...current.filter((item) => item.pipe_type !== 'wire'), ...rows])
  }, [])
  const totalWeight = [
    ...data.sheetMetal,
    ...data.circles,
    ...data.knives,
  ].reduce((sum, item) => sum + (item.calculated_weight_kg ?? 0), 0)
    + pipeRows.reduce((sum, item) => sum + (calculatePipeWeight(item, steelTypes) ?? item.calculated_weight_kg ?? 0), 0)
    + paintRows.reduce((sum, item) => sum + Number(item.remainder_kg || 0), 0)
  const componentTotal = componentRows.reduce((sum, item) => sum + Number(item.quantity_needed || 0), 0)
  const meshTotal = meshRows.reduce((sum, item) => sum + Number(item.remainder_qty || 0), 0)
  const chainCordTotalMm = chainCordRows.reduce((sum, item) => sum + Number(item.remainder_meters || 0) * 1000, 0)

  const openStockCheck = () => {
    router.push(`${ROUTES.SUPPLY_REQUEST}/${data.request.id}`)
  }

  const handleSubmitRequest = async () => {
    if (stockMode) {
      setIsSubmitting(true)
      try {
        const result = await submitStockMaterialRequest(data.request.id)
        if (!result.success) throw new Error(result.error || 'Не удалось отправить заявку')
        toast.success('Заявка отправлена на финансовое согласование')
        router.push(ROUTES.TECHNOLOGIST_REQUEST_RESULTS)
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось отправить заявку') }
      finally { setIsSubmitting(false) }
      return
    }
    if (status === 'pending_stock_check' || status === 'stock_checked') {
      openStockCheck()
      return
    }

    setIsSubmitting(true)
    try {
      const result = await submitRequest(data.request.id)
      if (!result.success) throw new Error(result.error || 'Не удалось оформить заявку')
      toast.success(revision
        ? 'Исправление сохранено. Проверьте склад и передайте позицию снабжению.'
        : 'Заявка оформлена. Начните с брони делового остатка.')
      setStatus('pending_stock_check')
      openStockCheck()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось оформить заявку')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <Button variant="ghost" className="-ml-2 text-slate-600" onClick={() => router.push(backHref || `${ROUTES.SALES_PLAN}/${machine.id}`)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {backLabel || 'Назад к машине'}
      </Button>

      <div className="rounded-xl border border-[#E8ECF0] bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">
              {stockMode ? 'Заявка на склад' : revision ? 'Исправленная позиция' : 'Заявка на материалы'}: {machine.name}
            </h1>
            {revisionNumber && <p className="mt-1 font-semibold text-amber-800">Черновик заявки №{requestNumber || '—'}.{revisionNumber}</p>}
            <p className="mt-1 text-sm text-slate-500">
              {stockMode ? 'Позиции закупаются в полном объёме и поступают в свободный остаток завода.' : revision
                ? 'Измените материал, характеристики или количество. Можно добавить позиции той же категории. Все позиции проходят согласование вместе.'
                : 'Состав материалов, деловой отход и позиции к заказу.'}
            </p>
          </div>
          <RequestStatusBadge status={status} approvalState={approvalState} />
        </div>
      </div>

      {!canEdit && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">Только просмотр</p>
            <p className="mt-0.5 text-blue-800">{resolvedReadOnlyMessage}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue={revisionTab} className="w-full">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
          {(!revision || revision.category === 'sheet_metal') && <TabsTrigger value="sheet">Листовой металл</TabsTrigger>}
          {(!revision || revision.category === 'circle' || isWireRevision) && <TabsTrigger value="circle">Круг</TabsTrigger>}
          {(!revision || (revision.category === 'pipe' && !isWireRevision)) && <TabsTrigger value="pipe">Труба</TabsTrigger>}
          {(!revision || revision.category === 'knives') && <TabsTrigger value="knives">Ножи</TabsTrigger>}
          {(!revision || revision.category === 'paint') && <TabsTrigger value="paint">Краска</TabsTrigger>}
          {(!revision || revision.category === 'components') && <TabsTrigger value="components">Комплектация</TabsTrigger>}
          {(!revision || revision.category === 'mesh') && <TabsTrigger value="mesh">Сетка</TabsTrigger>}
          {(!revision || revision.category === 'chain_cord') && <TabsTrigger value="chain_cord">Цепь / Шнур</TabsTrigger>}
        </TabsList>
        <div className="mt-4 rounded-xl border border-[#E8ECF0] bg-white p-4">
          {/* Sections own optimistic row state; keep hidden panels mounted so tab changes cannot reset it to stale server props. */}
          {(!revision || revision.category === 'sheet_metal') && <TabsContent value="sheet" keepMounted className="outline-none">
            <SheetMetalSection requestId={data.request.id} items={data.sheetMetal} suppliers={suppliers.sheetMetal} canEdit={canEdit} steelTypes={steelTypes} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'circle' || isWireRevision) && <TabsContent value="circle" keepMounted className="outline-none">
            <CircleSection requestId={data.request.id} items={data.circles} isEditable={canEdit} steelTypes={steelTypes} allowStructureChanges={canEdit} />
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="mb-3 text-base font-semibold text-[#1B3A6B]">Проволока · учёт в кг</h3>
              <PipeSection requestId={data.request.id} items={data.pipes.filter((item) => item.pipe_type === 'wire')} isEditable={canEdit} steelTypes={steelTypes} onRowsChange={handleWireRowsChange} allowStructureChanges={canEdit} wireOnly />
            </div>
          </TabsContent>}
          {(!revision || (revision.category === 'pipe' && !isWireRevision)) && <TabsContent value="pipe" keepMounted className="outline-none">
            <PipeSection requestId={data.request.id} items={data.pipes.filter((item) => item.pipe_type !== 'wire')} isEditable={canEdit} steelTypes={steelTypes} onRowsChange={handlePipeRowsChange} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'knives') && <TabsContent value="knives" keepMounted className="outline-none">
            <KnivesSection requestId={data.request.id} items={data.knives} canEdit={canEdit} canEditStock={false} steelTypes={steelTypes} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'paint') && <TabsContent value="paint" keepMounted className="outline-none">
            <PaintSection requestId={data.request.id} items={data.paint} canEdit={canEdit} canEditStock={false} onRowsChange={handlePaintRowsChange} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'components') && <TabsContent value="components" keepMounted className="outline-none">
            <ComponentsSection requestId={data.request.id} items={data.components} canEdit={canEdit} canEditStock={false} onRowsChange={handleComponentRowsChange} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'mesh') && <TabsContent value="mesh" keepMounted className="outline-none">
            <MeshSection requestId={data.request.id} items={data.meshItems} isEditable={canEdit} onRowsChange={handleMeshRowsChange} allowStructureChanges={canEdit} />
          </TabsContent>}
          {(!revision || revision.category === 'chain_cord') && <TabsContent value="chain_cord" keepMounted className="outline-none">
            <ChainCordSection requestId={data.request.id} items={data.chainCords} isEditable={canEdit} onRowsChange={handleChainCordRowsChange} allowStructureChanges={canEdit} />
          </TabsContent>}
        </div>
      </Tabs>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#1B3A6B]">
        <div>Общий вес заявки: {totalWeight.toFixed(2)} кг</div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
          <span>Комплектация: {componentTotal.toFixed(0)} шт</span>
          <span>Сетка: {meshTotal.toFixed(0)} шт</span>
          <span>Цепь / Шнур: {chainCordTotalMm.toFixed(0)} мм</span>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.refresh()}>
            Сохранить черновик
          </Button>
          {(stockMode ? status === 'draft' : (status === 'draft' || status === 'pending_stock_check' || status === 'stock_checked')) && (
            <Button type="button" onClick={handleSubmitRequest} disabled={isSubmitting || !canSubmit}>
              <Send className="mr-2 h-4 w-4" />
              {stockMode ? 'Отправить на согласование' : status === 'draft'
                ? revision ? 'Проверить склад' : 'Заявка оформлена'
                : status === 'stock_checked'
                  ? 'Перейти к брони основного склада'
                  : revision ? 'Вернуться к проверке склада' : 'Перейти к брони делового остатка'}
            </Button>
          )}
          {stockMode && !canSubmit && <span className="self-center text-sm text-amber-700">Сохраните название и дату перед отправкой.</span>}
        </div>
      )}
    </div>
  )
}
