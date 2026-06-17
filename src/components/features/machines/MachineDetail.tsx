"use client"

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, Edit, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

import { DocumentGenerationButtons } from '@/components/features/documents/DocumentGenerationButtons'
import { ItemsTab } from './tabs/ItemsTab'
import { ExpensesTab } from './tabs/ExpensesTab'
import { PackingListTab } from './tabs/PackingListTab'
import { ProductionTab } from './tabs/ProductionTab'
import { SupplyTab } from './tabs/SupplyTab'
import { InvoiceTab } from './tabs/InvoiceTab'
import { MachineTasksPanel } from './MachineTasksPanel'
import { MachineRequestPanel } from './MachineRequestPanel'
import { MachineStatusBadge, MachineStatusProgress } from './MachineStatusBadge'

import { MachineEditDialog } from './MachineEditDialog'
import { MachineArchiveDialog } from './MachineArchiveDialog'
import { MachineDeleteDialog } from './MachineDeleteDialog'
import { AssignFactoryDialog } from '@/components/features/meetings/AssignFactoryDialog'

import { useRole } from '@/lib/hooks/useRole'
import { INVOICE_VISIBLE_ROLES } from '@/lib/constants/roles'
import { getDesiredShippingInfo } from '@/lib/utils/desired-shipping'
import { productionQueueLabel } from '@/lib/constants/factory-workshops'
import type { FactorySummary, MachineDetails, UserRole } from '@/lib/types'
import type { TaskWithRelations } from '@/lib/actions/tasks'
import type { TechnologistRequestPayload } from '@/lib/actions/technologist-requests'
import type { MachineItemNestingState } from '@/lib/actions/machine-item-nesting'
import { ROUTES } from '@/lib/constants/routes'
import { updateMachineConfirmation } from '@/app/(protected)/sales-plan/actions'

interface MachineDetailProps {
  machine: MachineDetails
  factories: FactorySummary[]
  tasks?: TaskWithRelations[]
  requestData?: TechnologistRequestPayload | null
  nestingStates?: MachineItemNestingState[]
  canManageTechnologistRequests?: boolean
  canViewSupplyRequest?: boolean
  canManageNesting?: boolean
}

function DocumentReadinessIndicator({ missingFields }: { missingFields: string[] }) {
  const isReady = missingFields.length === 0

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex h-8 cursor-help items-center gap-2 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] px-2.5 text-sm font-medium text-[#374151]">
              <span
                className={`h-2 w-2 rounded-full ${isReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">
                {isReady ? 'Готово к генерации' : 'Заполните данные документов'}
              </span>
            </span>
          }
        />
        <TooltipContent
          side="bottom"
          align="end"
          className="max-w-72 flex-col items-start gap-1 bg-[#111827] text-left text-white"
        >
          {isReady ? (
            <span>Все данные для генерации заполнены</span>
          ) : (
            missingFields.map((field) => <span key={field}>{field}</span>)
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function MachineDetail({
  machine,
  factories,
  tasks = [],
  requestData = null,
  nestingStates = [],
  canManageTechnologistRequests = false,
  canViewSupplyRequest = false,
  canManageNesting = false,
}: MachineDetailProps) {
  const router = useRouter()
  const { role, isDirector } = useRole()
  
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isAssignOpen, setIsAssignOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const isArchived = machine.is_archived
  const canEdit = !isArchived && (isDirector || role === 'sales_manager')
  const canEditConfirmation = canEdit
  const canDelete = isDirector
  const showInvoiceTab = role && INVOICE_VISIBLE_ROLES.includes(role as UserRole)

  const createdDate = format(new Date(machine.created_at), 'dd.MM.yyyy', { locale: ru })
  const desiredShipping = getDesiredShippingInfo(machine.desired_shipping_date)
  const productionMonth = machine.production_month
    ? format(new Date(machine.production_month), 'LLLL yyyy', { locale: ru })
    : null
  const queueLabel = productionQueueLabel(machine.production_workshop, machine.production_queue_number)
  const documentGoodsCount = (machine.machine_items || []).filter((item) => !item.is_sample).length
  const documentMissingFields = [
    !machine.specification_number?.trim() && 'Укажите номер инвойса / спецификации',
    !machine.specification_date && 'Укажите дату документов',
    documentGoodsCount === 0 && 'Добавьте товарные позиции',
  ].filter((field): field is string => Boolean(field))

  const handleConfirmationToggle = async () => {
    setIsConfirming(true)
    try {
      const res = await updateMachineConfirmation(machine.id, !machine.is_confirmed)
      if (!res.success) throw new Error(res.error || 'Не удалось изменить подтверждение')
      toast.success(!machine.is_confirmed ? 'Машина подтверждена' : 'Подтверждение снято')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <Button
        variant="ghost"
        className="text-[#6B7280] hover:text-[#1B3A6B] hover:bg-[#F8F9FA] -ml-2 px-2"
        onClick={() => router.push(ROUTES.SALES_PLAN)}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Назад к списку
      </Button>

      {!machine.is_confirmed && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-800">Машина не подтверждена</div>
              <div className="text-sm text-amber-700">Планирование и производство видят эту машину как предварительную.</div>
            </div>
          </div>
          {canEditConfirmation && (
            <Button
              onClick={handleConfirmationToggle}
              disabled={isConfirming}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Подтвердить
            </Button>
          )}
        </div>
      )}

      {isArchived && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-700">
          <div className="flex items-center gap-2 font-semibold">
            <Archive className="h-5 w-5" />
            Машина архивирована
          </div>
          <div className="text-sm">
            Активные действия с этой машиной остановлены. Данные сохранены для аналитики и истории.
          </div>
        </div>
      )}

      {/* Верхняя часть (Шапка карточки) */}
      <div className="bg-white border border-[#E8ECF0] rounded-xl p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <h1 className="text-3xl font-bold text-[#1B3A6B] tracking-tight break-words max-w-3xl">
            {machine.name}
          </h1>
          
          <div className="flex flex-wrap items-center gap-2 mt-4 md:mt-0">
            <DocumentReadinessIndicator missingFields={documentMissingFields} />
            <DocumentGenerationButtons
              machineId={machine.id}
              clientId={machine.client_id}
              contractId={machine.contract_id}
              specificationNumber={machine.specification_number}
              specificationDate={machine.specification_date}
            />
            {canEditConfirmation && machine.is_confirmed && (
              <Button
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                onClick={handleConfirmationToggle}
                disabled={isConfirming}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Снять подтверждение
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                className="bg-white border-[#E8ECF0] text-[#374151] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
                onClick={() => setIsEditOpen(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                Редактировать
              </Button>
            )}
            
            {canDelete && (
              <Button
                variant="outline"
                className="border-[#1B3A6B]/30 text-[#1B3A6B] hover:bg-blue-50"
                onClick={() => setIsArchiveOpen(true)}
                disabled={isArchived}
              >
                <Archive className="w-4 h-4 mr-2" />
                Архивировать
              </Button>
            )}

            {canDelete && (
              <Button
                variant="destructive"
                className="bg-red-600/10 text-[#DC2626] hover:bg-red-600/20 border border-red-500/20 hover:border-red-500/30"
                onClick={() => setIsDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Удалить
              </Button>
            )}
            {!machine.factory_id && isDirector && (
              <Button
                variant="outline"
                className="border-[#DC2626]/30 text-[#DC2626] hover:bg-red-50"
                onClick={() => setIsAssignOpen(true)}
              >
                Назначить завод
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4 text-sm text-[#374151]">
          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Статус</span>
            <div className="mt-0.5">
              <MachineStatusBadge status={machine.status} />
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Клиент</span>
            <span className="font-medium text-base text-[#1B3A6B]">
              {machine.client?.name || 'Не указан'}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Месяц производства</span>
            <span className={`font-medium text-base ${productionMonth ? 'text-[#1B3A6B]' : 'text-[#9CA3AF]'}`}>
              {productionMonth || 'Не указан'}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Завод</span>
            {machine.factory?.name ? (
              <div className="flex flex-col">
                <span className="font-medium text-base text-[#1B3A6B]">{machine.factory.name}</span>
                <span className="text-sm text-[#6B7280]">{queueLabel}</span>
              </div>
            ) : (
              <span className="font-medium text-base text-[#DC2626]">Не назначен</span>
            )}
          </div>

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Материал</span>
            <div className="mt-0.5">{
              machine.material_type === 'standard' ? <Badge variant="outline" className="bg-slate-100 text-slate-700">Стандарт</Badge> :
              machine.material_type === 'non_standard' ? <Badge variant="outline" className="bg-orange-100 text-orange-700">Нестандарт</Badge> :
              <span className="text-[#9CA3AF] text-sm font-medium">—</span>
            }</div>
          </div>

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Общий вес</span>
            <span className="text-[#1B3A6B] font-medium text-base">{Number(machine.total_weight || 0).toFixed(2)} т</span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Товаров</span>
            <span className="text-[#1B3A6B] font-medium text-base">{machine.item_count || 0} шт</span>
          </div>

          {desiredShipping && (
            <div className="flex flex-col">
              <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Желаемая отгрузка</span>
              <span className={`font-medium text-base ${desiredShipping.tone === 'overdue' ? 'text-[#DC2626]' : desiredShipping.tone === 'soon' ? 'text-[#D97706]' : 'text-[#1B3A6B]'}`}>
                {desiredShipping.date} ({desiredShipping.tone === 'overdue' ? `⚠ ${desiredShipping.label}` : desiredShipping.label})
              </span>
            </div>
          )}

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Стоимость</span>
            <span className="text-[#16A34A] font-semibold text-base">€{Number(machine.total_cost || 0).toLocaleString()}</span>
          </div>

          <div className="hidden md:block w-px bg-[#F8F9FA] mx-2" />

          <div className="flex flex-col">
            <span className="text-[#9CA3AF] text-xs uppercase font-medium mb-1">Добавлен</span>
            <div className="text-[#1B3A6B] flex items-center h-full">
              <span>{machine.created_by_user?.full_name || 'Неизвестно'}</span>
              <span className="text-[#9CA3AF] mx-2">•</span>
              <span className="text-[#6B7280]">{createdDate}</span>
            </div>
          </div>
        </div>
      </div>

      <MachineStatusProgress status={machine.status} />

      <MachineRequestPanel
        machineId={machine.id}
        requestData={requestData}
        canManageTechnologistRequests={canManageTechnologistRequests}
        canViewSupplyRequest={canViewSupplyRequest}
      />

      <MachineTasksPanel tasks={tasks} />

      {/* Tabs Layout */}
      <Tabs defaultValue="items" className="w-full mt-8">
        <TabsList className="bg-white border-b border-[#E8ECF0] w-full justify-start rounded-none h-12 p-0 overflow-x-auto">
          <TabsTrigger 
            value="items" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
          >
            Товары
          </TabsTrigger>
          <TabsTrigger 
            value="production" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
          >
            Производство
          </TabsTrigger>
          <TabsTrigger 
            value="supply" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
          >
            Снабжение
          </TabsTrigger>
          <TabsTrigger 
            value="expenses" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
          >
            Расходы
          </TabsTrigger>
          <TabsTrigger 
            value="packing" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
          >
            Packing list
          </TabsTrigger>
          {showInvoiceTab && (
            <TabsTrigger 
              value="invoice" 
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-[#1B3A6B] rounded-none px-6 text-[#6B7280] h-full text-base font-medium"
            >
              Инвойс
            </TabsTrigger>
          )}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="items" className="outline-none">
            <ItemsTab machine={machine} tasks={tasks} nestingStates={nestingStates} canManageNesting={canManageNesting} />
          </TabsContent>
          <TabsContent value="production" className="outline-none">
            <ProductionTab machine={machine} />
          </TabsContent>
          <TabsContent value="supply" className="outline-none">
            <SupplyTab machine={machine} />
          </TabsContent>
          <TabsContent value="expenses" className="outline-none">
            <ExpensesTab machine={machine} />
          </TabsContent>
          <TabsContent value="packing" className="outline-none">
            <PackingListTab machine={machine} canEdit={canEdit} />
          </TabsContent>
          {showInvoiceTab && (
            <TabsContent value="invoice" className="outline-none">
              <InvoiceTab machine={machine} />
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* Модалки */}
      {isEditOpen && (
        <MachineEditDialog
          machine={machine}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          isDirector={isDirector}
          factories={factories}
        />
      )}
      {isDeleteOpen && (
        <MachineDeleteDialog
          machine={machine}
          isOpen={isDeleteOpen}
          onClose={() => setIsDeleteOpen(false)}
        />
      )}
      {isArchiveOpen && (
        <MachineArchiveDialog
          machine={machine}
          isOpen={isArchiveOpen}
          onClose={() => setIsArchiveOpen(false)}
        />
      )}
      {isAssignOpen && (
        <AssignFactoryDialog
          machine={machine}
          factories={factories}
          open={isAssignOpen}
          onOpenChange={setIsAssignOpen}
        />
      )}
    </div>
  )
}
