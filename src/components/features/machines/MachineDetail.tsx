"use client"

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, Archive, ArrowLeft, CheckCircle2, ClipboardList, Edit, Factory, FileText, MoreHorizontal, Package, Trash2, Truck, WalletCards } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { DocumentGenerationButtons } from '@/components/features/documents/DocumentGenerationButtons'
import { ItemsTab } from './tabs/ItemsTab'
import { ExpensesTab } from './tabs/ExpensesTab'
import { PackingListTab } from './tabs/PackingListTab'
import { ProductionTab } from './tabs/ProductionTab'
import { SupplyTab } from './tabs/SupplyTab'
import { InvoiceTab } from './tabs/InvoiceTab'
import { OutsourcingTab } from '@/components/features/outsourcing/OutsourcingTab'
import { MachineTasksPanel } from './MachineTasksPanel'
import { MachineRequestPanel } from './MachineRequestPanel'
import { MachineActivityPanel } from './MachineActivityPanel'
import { MachineProgressBadge, MachineStatusProgress } from './MachineStatusBadge'

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
import type { MachineActivityPayload } from '@/lib/actions/machine-activity'
import type { MachineOutsourcingData } from '@/lib/actions/outsourcing'
import { ROUTES } from '@/lib/constants/routes'
import { updateMachineConfirmation } from '@/app/(protected)/sales-plan/actions'
import { cn } from '@/lib/utils'

interface MachineDetailProps {
  machine: MachineDetails
  factories: FactorySummary[]
  tasks?: TaskWithRelations[]
  requestData?: TechnologistRequestPayload | null
  nestingStates?: MachineItemNestingState[]
  activity: MachineActivityPayload
  outsourcingData?: MachineOutsourcingData | null
  canManageTechnologistRequests?: boolean
  canViewSupplyRequest?: boolean
  canManageNesting?: boolean
}

const machineTabTriggerClassName = 'min-h-11 w-full min-w-0 gap-1.5 whitespace-normal rounded-xl px-2 text-center text-xs font-medium leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-600 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm sm:text-sm'

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
  activity,
  outsourcingData = null,
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
    !machine.delivery_basis_type && 'Выберите базис доставки в настройках машины',
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
    <div className="w-full space-y-5">
      <Button
        variant="ghost"
        className="-ml-2 min-h-10 px-2 text-slate-500 hover:bg-white hover:text-blue-950"
        onClick={() => router.push(ROUTES.SALES_PLAN)}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Назад к списку
      </Button>

      {!machine.is_confirmed && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
              className="min-h-11 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Подтвердить
            </Button>
          )}
        </div>
      )}

      {isArchived && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-700 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Archive className="h-5 w-5" />
            Машина архивирована
          </div>
          <div className="text-sm">
            Активные действия с этой машиной остановлены. Данные сохранены для аналитики и истории.
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-blue-900/10 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-5 py-6 text-white sm:px-6">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border border-white/10 bg-white/5" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Карточка машины</div>
              <h1 className="mt-2 max-w-3xl break-words text-3xl font-bold tracking-tight sm:text-4xl">
                {machine.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MachineProgressBadge progress={machine.progress} className="border-white/20 bg-white/10 text-white" />
                {machine.is_confirmed ? (
                  <Badge variant="outline" className="border-emerald-300/40 bg-emerald-400/15 text-emerald-100">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Подтверждена
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-300/40 bg-amber-300/15 text-amber-100">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Предварительная
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:max-w-[560px] lg:justify-end">
              <DocumentReadinessIndicator missingFields={documentMissingFields} />
              <DocumentGenerationButtons
                machineId={machine.id}
                specificationNumber={machine.specification_number}
                specificationDate={machine.specification_date}
                deliveryBasisType={machine.delivery_basis_type}
              />
              {!machine.factory_id && isDirector && (
                <Button
                  className="min-h-10 bg-white text-blue-950 hover:bg-blue-50"
                  onClick={() => setIsAssignOpen(true)}
                >
                  <Factory className="mr-2 h-4 w-4" />
                  Назначить завод
                </Button>
              )}
              {canEdit && (
                <Button
                  className="min-h-10 bg-blue-600 text-white hover:bg-blue-500"
                  onClick={() => setIsEditOpen(true)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Редактировать
                </Button>
              )}
              {(canEditConfirmation || canDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Дополнительные действия"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-60 border-slate-200 bg-white">
                    <DropdownMenuLabel className="text-xs uppercase tracking-wide text-slate-400">Дополнительно</DropdownMenuLabel>
                    {canEditConfirmation && machine.is_confirmed && (
                      <DropdownMenuItem onClick={handleConfirmationToggle} disabled={isConfirming} className="cursor-pointer text-amber-700">
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Снять подтверждение
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setIsArchiveOpen(true)} disabled={isArchived} className="cursor-pointer">
                          <Archive className="mr-2 h-4 w-4" />
                          Архивировать
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsDeleteOpen(true)} className="cursor-pointer text-red-600">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Удалить
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 xl:grid-cols-6">
          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Клиент</span>
            <span className="mt-1 block font-semibold text-slate-900">
              {machine.client?.name || 'Не указан'}
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Месяц производства</span>
            <span className={cn('mt-1 block font-semibold capitalize', productionMonth ? 'text-slate-900' : 'text-slate-400')}>
              {productionMonth || 'Не указан'}
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Завод и очередь</span>
            {machine.factory?.name ? (
              <div className="mt-1">
                <span className="block font-semibold text-slate-900">{machine.factory.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{queueLabel}</span>
              </div>
            ) : (
              <span className="mt-1 block font-semibold text-red-700">Не назначен</span>
            )}
          </div>

          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Материал</span>
            <div className="mt-2">{
              machine.material_type === 'standard' ? <Badge variant="outline" className="bg-slate-100 text-slate-700">Стандарт</Badge> :
              machine.material_type === 'non_standard' ? <Badge variant="outline" className="bg-orange-100 text-orange-700">Нестандарт</Badge> :
              <span className="text-sm font-medium text-slate-400">Не определён</span>
            }</div>
          </div>

          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Вес и товары</span>
            <span className="mt-1 block font-bold tabular-nums text-slate-900">{Number(machine.total_weight || 0).toFixed(2)} т</span>
            <span className="mt-0.5 block text-xs text-slate-500">{machine.item_count || 0} позиций</span>
          </div>

          <div className="bg-white p-4 sm:p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Стоимость</span>
            <span className="mt-1 block text-lg font-bold tabular-nums text-emerald-700">€{Number(machine.total_cost || 0).toLocaleString()}</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {machine.created_by_user?.full_name || 'Неизвестно'} · {createdDate}
            </span>
            {desiredShipping && (
              <span className={cn(
                'mt-2 block text-xs font-medium',
                desiredShipping.tone === 'overdue' ? 'text-red-700' : desiredShipping.tone === 'soon' ? 'text-amber-700' : 'text-slate-500'
              )}>
                Отгрузка: {desiredShipping.date} · {desiredShipping.label}
              </span>
            )}
            </div>
          </div>
      </div>

      <MachineStatusProgress progress={machine.progress} />

      <MachineRequestPanel
        machineId={machine.id}
        requestData={requestData}
        canManageTechnologistRequests={canManageTechnologistRequests}
        canViewSupplyRequest={canViewSupplyRequest}
      />

      <MachineTasksPanel tasks={tasks} />

      <MachineActivityPanel machineId={machine.id} activity={activity} />

      <Tabs defaultValue="items" className="mt-6 w-full">
        <TabsList className={cn(
          'grid h-auto w-full grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm sm:grid-cols-3',
          showInvoiceTab ? 'lg:grid-cols-7' : 'lg:grid-cols-6'
        )}>
          <TabsTrigger 
            value="items" 
            className={machineTabTriggerClassName}
          >
            <Package className="h-4 w-4" aria-hidden="true" />
            Товары
          </TabsTrigger>
          <TabsTrigger 
            value="production" 
            className={machineTabTriggerClassName}
          >
            <Factory className="h-4 w-4" aria-hidden="true" />
            Производство
          </TabsTrigger>
          <TabsTrigger
            value="outsourcing"
            className={machineTabTriggerClassName}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
            Аутсорсинг
          </TabsTrigger>
          <TabsTrigger 
            value="supply" 
            className={machineTabTriggerClassName}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
            Снабжение
          </TabsTrigger>
          <TabsTrigger 
            value="expenses" 
            className={machineTabTriggerClassName}
          >
            <WalletCards className="h-4 w-4" aria-hidden="true" />
            Расходы
          </TabsTrigger>
          <TabsTrigger 
            value="packing" 
            className={machineTabTriggerClassName}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Настройки машины
          </TabsTrigger>
          {showInvoiceTab && (
            <TabsTrigger 
              value="invoice" 
              className={machineTabTriggerClassName}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Инвойс
            </TabsTrigger>
          )}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="items" className="outline-none">
            <ItemsTab machine={machine} tasks={tasks} nestingStates={nestingStates} canManageNesting={canManageNesting} />
          </TabsContent>
          <TabsContent value="production" className="outline-none">
            <ProductionTab machine={machine} />
          </TabsContent>
          <TabsContent value="outsourcing" className="outline-none">
            {outsourcingData ? (
              <OutsourcingTab data={outsourcingData} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
                Аутсорсинг недоступен для этой машины.
              </div>
            )}
          </TabsContent>
          <TabsContent value="supply" className="outline-none">
            <SupplyTab machine={machine} requestData={requestData} />
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
