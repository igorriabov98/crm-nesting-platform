'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, Archive, CheckCircle2, Plus, MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { canCreateMachines } from '@/lib/utils/permissions'
import type { CoatingType, FactorySummary, Invoice, MachineListItem, UserRole } from '@/lib/types'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { productionQueueLabel } from '@/lib/constants/factory-workshops'
import type { ProductionMonthOption } from '@/lib/utils/production-months'

import { MACHINE_STATUS_LABELS, MachineStatusBadge } from './MachineStatusBadge'

const MachineEditDialog = dynamic(() => import('./MachineEditDialog').then((mod) => mod.MachineEditDialog))
const MachineArchiveDialog = dynamic(() => import('./MachineArchiveDialog').then((mod) => mod.MachineArchiveDialog))
const MachineDeleteDialog = dynamic(() => import('./MachineDeleteDialog').then((mod) => mod.MachineDeleteDialog))
const AssignFactoryDialog = dynamic(() => import('@/components/features/meetings/AssignFactoryDialog').then((mod) => mod.AssignFactoryDialog))

type MachineTableInvoice = Pick<Invoice, 'status' | 'payment_date' | 'amount'>

const coatingFilterLabels: Record<string, string> = {
  all: 'Все покрытия',
  zinc: 'Цинк',
  powder_coating: 'Порошковая покраска',
  none: 'Без покрытия',
}

const machineStatusFilterLabels: Record<string, string> = {
  all: 'Все статусы',
  ...MACHINE_STATUS_LABELS,
}

const materialFilterLabels: Record<string, string> = {
  all: 'Все материалы',
  standard: 'Стандартный',
  non_standard: 'Нестандартный',
  undefined: 'Не определён',
}

const confirmationFilterLabels: Record<string, string> = {
  all: 'Все подтверждения',
  confirmed: 'Подтверждённые',
  unconfirmed: 'Не подтверждённые',
}

const invoiceFilterLabels: Record<string, string> = {
  all: 'Любой инвойс',
  paid: 'Оплачено',
  not_paid: 'Ожидает оплаты',
  overdue: 'Просрочено',
  none: 'Нет инвойса',
}

function getMaterialBadge(type: string) {
  switch (type) {
    case 'standard':
      return <Badge variant="outline" className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200">Стандарт</Badge>
    case 'non_standard':
      return <Badge variant="outline" className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200">Нестандарт</Badge>
    default:
      return <span className="text-gray-400 text-xs text-center inline-block w-full">—</span>
  }
}

interface MachineTableProps {
  machines: MachineListItem[]
  userRole: UserRole
  canViewInvoice: boolean
  isDirector: boolean
  factories: FactorySummary[]
  resultLimit?: number
  productionMonthFilter?: string | null
  productionMonthOptions: ProductionMonthOption[]
}

export function MachineTable({
  machines,
  userRole,
  canViewInvoice,
  isDirector,
  factories,
  resultLimit,
  productionMonthFilter,
  productionMonthOptions,
}: MachineTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [coatingFilter, setCoatingFilter] = useState<string>('all')
  const [invoiceFilter, setInvoiceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [materialFilter, setMaterialFilter] = useState<string>('all')
  const [confirmationFilter, setConfirmationFilter] = useState<string>('all')

  const [editMachine, setEditMachine] = useState<MachineListItem | null>(null)
  const [archiveMachine, setArchiveMachine] = useState<MachineListItem | null>(null)
  const [deleteMachine, setDeleteMachine] = useState<MachineListItem | null>(null)
  const [assignMachine, setAssignMachine] = useState<MachineListItem | null>(null)

  const canCreate = canCreateMachines(userRole)
  const canEdit = canCreateMachines(userRole) // те же роли
  const canDelete = isDirector

  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const selectedProductionMonth = productionMonthFilter || 'all'
  const selectedProductionMonthLabel = productionMonthFilter
    ? productionMonthOptions.find((option) => option.value === productionMonthFilter)?.label || productionMonthFilter
    : 'Все месяцы'

  const setProductionMonthFilter = useCallback((value: string) => {
    const params = new URLSearchParams(searchParams.toString())

    if (!value || value === 'all') {
      params.delete('productionMonth')
    } else {
      params.set('productionMonth', value)
    }

    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])

  const filteredMachines = useMemo(() => machines.filter((m) => {
    const matchesSearch = !normalizedSearch || m.name?.toLowerCase().includes(normalizedSearch)
    
    // m.uniqueCoatings - это ["zinc", "powder_coating"] и так далее
    const matchesCoating = coatingFilter === 'all' || (m.uniqueCoatings && m.uniqueCoatings.includes(coatingFilter as CoatingType))
    const matchesProductionMonth = !productionMonthFilter || m.production_month === productionMonthFilter
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter
    const matchesMaterial = materialFilter === 'all' || m.material_type === materialFilter
    const matchesConfirmation = confirmationFilter === 'all'
      || (confirmationFilter === 'confirmed' && m.is_confirmed)
      || (confirmationFilter === 'unconfirmed' && !m.is_confirmed)
    
    let matchesInvoice = true
    if (canViewInvoice && invoiceFilter !== 'all') {
      const invoices: MachineTableInvoice[] = Array.isArray(m.invoice) ? m.invoice : m.invoice ? [m.invoice] : []
      const status: MachineTableInvoice['status'] | 'none' = invoices.length > 0 ? invoices[0].status : 'none'
      const selectedInvoice = invoiceFilter as MachineTableInvoice['status'] | 'none'
      if (selectedInvoice === 'none' && status !== 'none') matchesInvoice = false
      if (selectedInvoice !== 'none' && status !== selectedInvoice) matchesInvoice = false
    }

    return matchesSearch && matchesCoating && matchesProductionMonth && matchesStatus && matchesMaterial && matchesConfirmation && matchesInvoice
  }), [canViewInvoice, coatingFilter, confirmationFilter, invoiceFilter, machines, materialFilter, normalizedSearch, productionMonthFilter, statusFilter])

  // Вспомогательные функции рендеринга Badge
  const getCoatingBadge = (c: CoatingType) => {
    if (c === 'zinc') return <Badge key="zinc" variant="secondary" className="bg-[#E8ECF0] hover:bg-[#E8ECF0] text-[#1B3A6B]">Цинк</Badge>
    if (c === 'powder_coating') return <Badge key="pc" variant="outline" className="text-orange-400 border-orange-400/20 bg-orange-400/10">Порошковая</Badge>
    if (c === 'none') return <Badge key="none" variant="outline" className="text-slate-400 border-slate-400/20 bg-slate-100">Без покрытия</Badge>
    return null
  }

  const getInvoiceBadge = (invoiceData: MachineTableInvoice | MachineTableInvoice[] | null | undefined) => {
    const invoices: MachineTableInvoice[] = Array.isArray(invoiceData) ? invoiceData : invoiceData ? [invoiceData] : []
    if (invoices.length === 0) return <span className="text-[#9CA3AF]">—</span>
    const inv = invoices[0]
    switch (inv.status) {
      case 'paid': return <Badge variant="outline" className="text-[#16A34A] border-emerald-400/20 bg-emerald-400/10 hidden sm:inline-flex">Оплачено</Badge>
      case 'not_paid': return <Badge variant="outline" className="text-[#D97706] border-yellow-400/20 bg-yellow-400/10 hidden sm:inline-flex">Ожидает</Badge>
      case 'overdue': return <Badge variant="outline" className="text-[#DC2626] border-red-400/20 bg-red-400/10 hidden sm:inline-flex">Просрочено</Badge>
      default: return <span className="text-[#9CA3AF]">—</span>
    }
  }

  const renderProgressBar = (progress: { completed: number; total: number }, isProd: boolean) => {
    if (!progress || progress.total === 0) return <span className="text-[#9CA3AF] text-xs">—</span>
    const percent = Math.round((progress.completed / progress.total) * 100)
    let colorClass = "bg-blue-500" // В процессе
    if (percent === 100) colorClass = "bg-emerald-500" // Завершено
    
    // В идеале мы бы проверяли просрочки (красный цвет), но данных пока нет в объекте.
    
    return (
      <div className="flex flex-col gap-1 w-full max-w-[120px]">
        <div className="flex justify-between text-xs text-[#6B7280]">
          <span>{progress.completed}/{progress.total} {isProd ? 'этапов' : 'готово'}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} className="h-1.5 bg-[#F8F9FA]" indicatorClassName={colorClass} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 flex-1 sm:flex-row sm:flex-wrap">
          <Input
            placeholder="Поиск по имени..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:max-w-[200px] bg-white border-[#E8ECF0] text-[#1B3A6B] placeholder:text-[#9CA3AF]"
          />
          <Select value={coatingFilter} onValueChange={(val) => setCoatingFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[160px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{coatingFilterLabels[coatingFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все покрытия</SelectItem>
              <SelectItem value="zinc">Цинк</SelectItem>
              <SelectItem value="powder_coating">Порошковая покраска</SelectItem>
              <SelectItem value="none">Без покрытия</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedProductionMonth} onValueChange={(val) => setProductionMonthFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[190px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{selectedProductionMonthLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все месяцы</SelectItem>
              {productionMonthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{machineStatusFilterLabels[statusFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="created">Создана</SelectItem>
              <SelectItem value="under_review">На рассмотрении</SelectItem>
              <SelectItem value="factory_assigned">Назначен завод</SelectItem>
              <SelectItem value="in_production">В производстве</SelectItem>
              <SelectItem value="shipped">Отгружена</SelectItem>
              <SelectItem value="confirmed">Подтверждена</SelectItem>
              <SelectItem value="planned">Запланирована</SelectItem>
              <SelectItem value="request_ready">Заявка готова</SelectItem>
              <SelectItem value="purchasing">В закупке</SelectItem>
              <SelectItem value="material_received">Материал получен</SelectItem>
            </SelectContent>
          </Select>

          <Select value={materialFilter} onValueChange={(val) => setMaterialFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[170px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{materialFilterLabels[materialFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все материалы</SelectItem>
              <SelectItem value="standard">Стандартный</SelectItem>
              <SelectItem value="non_standard">Нестандартный</SelectItem>
              <SelectItem value="undefined">Не определён</SelectItem>
            </SelectContent>
          </Select>

          <Select value={confirmationFilter} onValueChange={(val) => setConfirmationFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{confirmationFilterLabels[confirmationFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="confirmed">Подтверждённые</SelectItem>
              <SelectItem value="unconfirmed">Не подтверждённые</SelectItem>
            </SelectContent>
          </Select>

          {canViewInvoice && (
            <Select value={invoiceFilter} onValueChange={(val) => setInvoiceFilter(val || 'all')}>
              <SelectTrigger className="w-full sm:w-[160px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
                <SelectValue>{invoiceFilterLabels[invoiceFilter]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                <SelectItem value="all">Любой инвойс</SelectItem>
                <SelectItem value="paid">Оплачено</SelectItem>
                <SelectItem value="not_paid">Ожидает оплаты</SelectItem>
                <SelectItem value="overdue">Просрочено</SelectItem>
                <SelectItem value="none">Нет инвойса</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {canCreate && (
          <Link href={ROUTES.SALES_PLAN_NEW}>
            <Button className="bg-[#1B3A6B] hover:bg-[#152D54] text-white w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Новая машина
            </Button>
          </Link>
        )}
      </div>

      {resultLimit && machines.length >= resultLimit && (
        <div className="rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#6B7280]">
          Показаны последние {resultLimit} машин. Используйте фильтры или поиск, чтобы быстрее найти нужную машину.
        </div>
      )}

      <div className="rounded-md border border-[#E8ECF0] bg-white overflow-x-auto">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow className="border-[#E8ECF0] hover:bg-transparent">
              <TableHead className="text-[#6B7280] min-w-[150px]">Название</TableHead>
              <TableHead className="text-[#6B7280]">Статус</TableHead>
              <TableHead className="text-[#6B7280]">Завод</TableHead>
              <TableHead className="text-[#6B7280]">Материал</TableHead>
              <TableHead className="text-[#6B7280]">Товаров</TableHead>
              <TableHead className="text-[#6B7280]">Общий вес</TableHead>
              <TableHead className="text-[#6B7280]">Покрытия</TableHead>
              <TableHead className="text-[#6B7280]">Стоимость</TableHead>
              <TableHead className="text-[#6B7280]">Произв.</TableHead>
              <TableHead className="text-[#6B7280]">Снабж.</TableHead>
              {canViewInvoice && <TableHead className="text-[#6B7280] hidden sm:table-cell">Инвойс</TableHead>}
              <TableHead className="text-[#6B7280] hidden md:table-cell">Создал / Дата</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMachines.length === 0 ? (
              <TableRow className="border-[#E8ECF0]">
                <TableCell colSpan={canViewInvoice ? 11 : 10} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="w-14 h-14 bg-[#F8F9FA] rounded-full flex items-center justify-center mb-1">
                      <span className="text-2xl">📋</span>
                    </div>
                    <p className="text-[#374151] font-medium">Машин не найдено</p>
                    {canCreate ? (
                      <p className="text-sm text-[#9CA3AF] max-w-sm">Создайте свою первую машину для начала производства.</p>
                    ) : (
                      <p className="text-sm text-[#9CA3AF] max-w-sm">Ожидайте, пока директор или менеджер создадут машину.</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredMachines.map((m) => (
                <TableRow
                  key={m.id}
                  className={cn(
                    "border-[#E8ECF0] hover:bg-[#F8F9FA]",
                    !m.is_confirmed && "bg-amber-50/45 text-slate-500"
                  )}
                >
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Link href={`${ROUTES.SALES_PLAN}/${m.id}`} className="font-semibold text-[#1B3A6B] hover:text-[#2563EB] transition-colors">
                        {m.name}
                      </Link>
                      {m.product && <span className="text-xs text-[#6B7280] truncate max-w-[200px]">{m.product}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      {m.is_confirmed ? (
                        <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Подтверждена
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Не подтверждена
                        </Badge>
                      )}
                      <MachineStatusBadge status={m.status} />
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.factory?.name ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-[#1B3A6B] font-medium">{m.factory.name}</span>
                        <span className="text-xs text-[#6B7280]">{productionQueueLabel(m.production_workshop, m.production_queue_number)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#DC2626] border border-[#DC2626] rounded-md px-1 py-0.5">Не назначен</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {getMaterialBadge(m.material_type)}
                  </TableCell>
                  <TableCell className="text-[#374151] font-medium whitespace-nowrap">
                    {(() => {
                      const items = m.machine_items || []
                      const goodsCount = items.length > 0 ? items.filter((item) => !item.is_sample).length : m.item_count || 0
                      const samplesCount = items.filter((item) => item.is_sample).length
                      return samplesCount > 0 ? `${goodsCount} + ${samplesCount} обр.` : `${goodsCount} шт`
                    })()}
                  </TableCell>
                  <TableCell className="text-[#374151] font-medium whitespace-nowrap">
                    {Number(m.total_weight || 0).toFixed(2)} т
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {m.uniqueCoatings && m.uniqueCoatings.length > 0 
                        ? m.uniqueCoatings.map((c) => getCoatingBadge(c))
                        : <span className="text-[#9CA3AF] text-xs">Нет данных</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#374151] font-medium whitespace-nowrap">
                    ${Number(m.total_cost || 0).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {renderProgressBar(m.production_progress, true)}
                  </TableCell>
                  <TableCell>
                    {renderProgressBar(m.supply_progress, false)}
                  </TableCell>
                  {canViewInvoice && (
                    <TableCell className="hidden sm:table-cell">
                      {getInvoiceBadge(m.invoice)}
                    </TableCell>
                  )}
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col text-xs space-y-1">
                      <span className="text-[#374151]">{m.created_by_user?.full_name || 'Неизвестно'}</span>
                      <span className="text-[#9CA3AF]">{format(new Date(m.created_at), 'dd.MM.yyyy', { locale: ru })}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:text-[#1B3A6B] hover:bg-[#F8F9FA] focus:outline-none">
                        <span className="sr-only">Действия</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-[#F8F9FA] border-[#E8ECF0] text-[#374151]">
                        <DropdownMenuLabel>Действия</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#E8ECF0]" />
                        <DropdownMenuItem className="hover:bg-[#E8ECF0] focus:bg-[#E8ECF0] cursor-pointer p-0">
                          <Link href={`${ROUTES.SALES_PLAN}/${m.id}`} className="flex items-center w-full px-2 py-1.5">
                            <Eye className="mr-2 h-4 w-4" />
                            Просмотр детализации
                          </Link>
                        </DropdownMenuItem>
                        {canEdit && (
                          <DropdownMenuItem onClick={() => setEditMachine(m)} className="hover:bg-[#E8ECF0] focus:bg-[#E8ECF0] cursor-pointer">
                            <Pencil className="mr-2 h-4 w-4" />
                            Редактировать параметры
                          </DropdownMenuItem>
                        )}
                        {isDirector && !m.factory_id && (
                          <DropdownMenuItem onClick={() => setAssignMachine(m)} className="hover:bg-[#E8ECF0] focus:bg-[#E8ECF0] cursor-pointer">
                            Назначить завод
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator className="bg-[#E8ECF0]" />
                            <DropdownMenuItem
                              onClick={() => setArchiveMachine(m)}
                              className="text-[#1B3A6B] focus:text-[#1B3A6B] focus:bg-blue-50 cursor-pointer"
                            >
                              <Archive className="mr-2 h-4 w-4" />
                              Архивировать машину
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => setDeleteMachine(m)}
                              className="text-[#DC2626] focus:text-[#DC2626] focus:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Удалить машину
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editMachine && (
        <MachineEditDialog 
          machine={editMachine} 
          isOpen={!!editMachine} 
          onClose={() => setEditMachine(null)} 
          isDirector={isDirector}
          factories={factories}
        />
      )}

      {deleteMachine && (
        <MachineDeleteDialog 
          machine={deleteMachine} 
          isOpen={!!deleteMachine} 
          onClose={() => setDeleteMachine(null)} 
        />
      )}

      {archiveMachine && (
        <MachineArchiveDialog
          machine={archiveMachine}
          isOpen={!!archiveMachine}
          onClose={() => setArchiveMachine(null)}
        />
      )}

      {assignMachine && (
        <AssignFactoryDialog
          machine={assignMachine}
          factories={factories}
          open={!!assignMachine}
          onOpenChange={(open) => {
            if (!open) setAssignMachine(null)
          }}
        />
      )}
    </div>
  )
}
