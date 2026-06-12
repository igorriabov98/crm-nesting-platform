'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send } from 'lucide-react'
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
import { ROUTES } from '@/lib/constants/routes'
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
}

type PaintRows = TechnologistRequestPayload['paint']
type ComponentRows = TechnologistRequestPayload['components']
type MeshRows = TechnologistRequestPayload['meshItems']
type ChainCordRows = TechnologistRequestPayload['chainCords']
type PipeRows = TechnologistRequestPayload['pipes']

export function TechnologistRequestPage({ machine, data, suppliers, canManage, steelTypes }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<RequestStatus>(data.request.status)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paintRows, setPaintRows] = useState(data.paint)
  const [componentRows, setComponentRows] = useState(data.components)
  const [meshRows, setMeshRows] = useState(data.meshItems)
  const [chainCordRows, setChainCordRows] = useState(data.chainCords)
  const [pipeRows, setPipeRows] = useState(data.pipes)
  const canEdit = canManage
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
    setPipeRows(rows)
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
    if (status === 'pending_stock_check' || status === 'stock_checked') {
      openStockCheck()
      return
    }

    setIsSubmitting(true)
    try {
      const result = await submitRequest(data.request.id)
      if (!result.success) throw new Error(result.error || 'Не удалось оформить заявку')
      toast.success('Заявка оформлена. Проверьте склад и завершите бронь.')
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
      <Button variant="ghost" className="-ml-2 text-slate-600" onClick={() => router.push(`${ROUTES.SALES_PLAN}/${machine.id}`)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Назад к машине
      </Button>

      <div className="rounded-xl border border-[#E8ECF0] bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Заявка на материалы: {machine.name}</h1>
            <p className="mt-1 text-sm text-slate-500">Состав материалов, остатки склада и позиции к заказу.</p>
          </div>
          <RequestStatusBadge status={status} />
        </div>
      </div>

      <Tabs defaultValue="sheet" className="w-full">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
          <TabsTrigger value="sheet">Листовой металл</TabsTrigger>
          <TabsTrigger value="circle">Круг</TabsTrigger>
          <TabsTrigger value="pipe">Труба</TabsTrigger>
          <TabsTrigger value="knives">Ножи</TabsTrigger>
          <TabsTrigger value="paint">Краска</TabsTrigger>
          <TabsTrigger value="components">Комплектация</TabsTrigger>
          <TabsTrigger value="mesh">Сетка</TabsTrigger>
          <TabsTrigger value="chain_cord">Цепь / Шнур</TabsTrigger>
        </TabsList>
        <div className="mt-4 rounded-xl border border-[#E8ECF0] bg-white p-4">
          <TabsContent value="sheet" className="outline-none">
            <SheetMetalSection requestId={data.request.id} items={data.sheetMetal} suppliers={suppliers.sheetMetal} canEdit={canEdit} steelTypes={steelTypes} />
          </TabsContent>
          <TabsContent value="circle" className="outline-none">
            <CircleSection requestId={data.request.id} items={data.circles} isEditable={canEdit} steelTypes={steelTypes} />
          </TabsContent>
          <TabsContent value="pipe" className="outline-none">
            <PipeSection requestId={data.request.id} items={data.pipes} isEditable={canEdit} steelTypes={steelTypes} onRowsChange={handlePipeRowsChange} />
          </TabsContent>
          <TabsContent value="knives" className="outline-none">
            <KnivesSection requestId={data.request.id} items={data.knives} canEdit={canEdit} canEditStock={false} steelTypes={steelTypes} />
          </TabsContent>
          <TabsContent value="paint" className="outline-none">
            <PaintSection requestId={data.request.id} items={data.paint} canEdit={canEdit} canEditStock={false} onRowsChange={handlePaintRowsChange} />
          </TabsContent>
          <TabsContent value="components" className="outline-none">
            <ComponentsSection requestId={data.request.id} items={data.components} canEdit={canEdit} canEditStock={false} onRowsChange={handleComponentRowsChange} />
          </TabsContent>
          <TabsContent value="mesh" className="outline-none">
            <MeshSection requestId={data.request.id} items={data.meshItems} isEditable={canEdit} onRowsChange={handleMeshRowsChange} />
          </TabsContent>
          <TabsContent value="chain_cord" className="outline-none">
            <ChainCordSection requestId={data.request.id} items={data.chainCords} isEditable={canEdit} onRowsChange={handleChainCordRowsChange} />
          </TabsContent>
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

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.refresh()}>
          Сохранить черновик
        </Button>
        {(status === 'draft' || status === 'pending_stock_check' || status === 'stock_checked') && canEdit && (
          <Button type="button" onClick={handleSubmitRequest} disabled={isSubmitting}>
            <Send className="mr-2 h-4 w-4" />
            {status === 'draft' ? 'Заявка оформлена' : 'Перейти к проверке склада'}
          </Button>
        )}
      </div>
    </div>
  )
}
