'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  AlertTriangle,
  Archive,
  ArrowDownAZ,
  Banknote,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Factory,
  Filter,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Weight,
  X,
} from 'lucide-react'

import { ROUTES } from '@/lib/constants/routes'
import { canCreateMachines } from '@/lib/utils/permissions'
import type { CoatingType, FactorySummary, Invoice, MachineListItem, UserRole } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
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
import { MACHINE_PROGRESS_STATIC_LABELS, MACHINE_PROGRESS_STATIC_ORDER } from '@/lib/machine-progress'
import type { ProductionMonthOption } from '@/lib/utils/production-months'
import { MachineProgressBadge } from './MachineStatusBadge'

const MachineEditDialog = dynamic(() => import('./MachineEditDialog').then((mod) => mod.MachineEditDialog))
const MachineArchiveDialog = dynamic(() => import('./MachineArchiveDialog').then((mod) => mod.MachineArchiveDialog))
const MachineDeleteDialog = dynamic(() => import('./MachineDeleteDialog').then((mod) => mod.MachineDeleteDialog))
const AssignFactoryDialog = dynamic(() => import('@/components/features/meetings/AssignFactoryDialog').then((mod) => mod.AssignFactoryDialog))

type MachineTableInvoice = Pick<Invoice, 'status' | 'payment_date' | 'due_date' | 'amount'>

type SalesPlanFilters = {
  search: string
  coating: string
  status: string
  material: string
  confirmation: string
  invoice: string
}

type SalesPlanSort =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'production_month_asc'
  | 'cost_desc'
  | 'weight_desc'

const initialFilters: SalesPlanFilters = {
  search: '',
  coating: 'all',
  status: 'all',
  material: 'all',
  confirmation: 'all',
  invoice: 'all',
}

const coatingFilterLabels: Record<string, string> = {
  all: 'Все покрытия',
  zinc: 'Цинк',
  powder_coating: 'Порошковая покраска',
  none: 'Без покрытия',
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

const sortLabels: Record<SalesPlanSort, string> = {
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  name_asc: 'По названию',
  production_month_asc: 'По месяцу производства',
  cost_desc: 'По стоимости',
  weight_desc: 'По весу',
}

function invoiceRows(invoice: MachineListItem['invoice']): MachineTableInvoice[] {
  return Array.isArray(invoice) ? invoice : invoice ? [invoice] : []
}

function getGoodsAndSamples(machine: MachineListItem) {
  const items = machine.machine_items || []
  const goods = items.length > 0 ? items.filter((item) => !item.is_sample).length : machine.item_count || 0
  const samples = items.filter((item) => item.is_sample).length
  return { goods, samples }
}

function formatMoney(value: number | null | undefined) {
  return `€${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}`
}

function formatWeight(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} т`
}

function getMaterialBadge(type: string) {
  if (type === 'standard') {
    return <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-700">Стандарт</Badge>
  }
  if (type === 'non_standard') {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Нестандарт</Badge>
  }
  return <span className="text-xs text-slate-400">Не определён</span>
}

function getCoatingBadge(coating: CoatingType) {
  if (coating === 'zinc') {
    return <Badge key={coating} variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Цинк</Badge>
  }
  if (coating === 'powder_coating') {
    return <Badge key={coating} variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">Порошковая</Badge>
  }
  if (coating === 'none') {
    return <Badge key={coating} variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">Без покрытия</Badge>
  }
  return null
}

function InvoiceBadge({ invoice }: { invoice: MachineListItem['invoice'] }) {
  const invoices = invoiceRows(invoice)
  if (invoices.length === 0) return <span className="text-sm text-slate-400">Нет</span>
  const item = invoices[0]
  if (item.status === 'paid') {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Оплачено</Badge>
  }
  if (item.status === 'overdue') {
    return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Просрочено</Badge>
  }
  return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Ожидает</Badge>
}

function ProgressMetric({
  label,
  progress,
}: {
  label: string
  progress: { completed: number; total: number }
}) {
  if (!progress.total) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-xs text-slate-400">Нет этапов</div>
      </div>
    )
  }

  const percent = Math.round((progress.completed / progress.total) * 100)
  return (
    <div className="min-w-[116px] space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="tabular-nums text-slate-500">{percent}%</span>
      </div>
      <Progress
        value={percent}
        className="h-1.5 bg-slate-100"
        indicatorClassName={percent === 100 ? 'bg-emerald-500' : 'bg-blue-600'}
      />
      <div className="text-[11px] tabular-nums text-slate-400">
        {progress.completed} из {progress.total}
      </div>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'blue',
}: {
  icon: typeof Factory
  label: string
  value: string
  note: string
  tone?: 'blue' | 'emerald' | 'amber' | 'slate'
}) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50/70 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-950">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{note}</div>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

interface MachineActionsProps {
  machine: MachineListItem
  canEdit: boolean
  canDelete: boolean
  isDirector: boolean
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onAssign: () => void
}

function MachineActions({
  machine,
  canEdit,
  canDelete,
  isDirector,
  onEdit,
  onArchive,
  onDelete,
  onAssign,
}: MachineActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Действия с машиной ${machine.name}`}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 border-slate-200 bg-white text-slate-700 shadow-xl">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-slate-400">Действия</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="p-0">
          <Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} className="flex w-full items-center px-2 py-2">
            <Eye className="mr-2 h-4 w-4" />
            Открыть карточку
          </Link>
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer py-2">
            <Pencil className="mr-2 h-4 w-4" />
            Редактировать
          </DropdownMenuItem>
        )}
        {isDirector && !machine.factory_id && (
          <DropdownMenuItem onClick={onAssign} className="cursor-pointer py-2 text-blue-700 focus:text-blue-800">
            <Factory className="mr-2 h-4 w-4" />
            Назначить завод
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onArchive} className="cursor-pointer py-2 text-slate-700">
              <Archive className="mr-2 h-4 w-4" />
              Архивировать
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="cursor-pointer py-2 text-red-600 focus:text-red-700">
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MachineTableProps {
  machines: MachineListItem[]
  userRole: UserRole
  canViewInvoice: boolean
  isDirector: boolean
  factories: FactorySummary[]
  factoryFilter: string
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
  factoryFilter,
  resultLimit,
  productionMonthFilter,
  productionMonthOptions,
}: MachineTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<SalesPlanFilters>(initialFilters)
  const [sort, setSort] = useState<SalesPlanSort>('newest')
  const [editMachine, setEditMachine] = useState<MachineListItem | null>(null)
  const [archiveMachine, setArchiveMachine] = useState<MachineListItem | null>(null)
  const [deleteMachine, setDeleteMachine] = useState<MachineListItem | null>(null)
  const [assignMachine, setAssignMachine] = useState<MachineListItem | null>(null)

  const canCreate = canCreateMachines(userRole)
  const canEdit = canCreateMachines(userRole)
  const canDelete = isDirector

  const updateUrlFilter = useCallback((key: 'factory' | 'productionMonth', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') params.delete(key)
    else params.set(key, value)
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])

  const updateFilter = <K extends keyof SalesPlanFilters>(key: K, value: SalesPlanFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const normalizedSearch = filters.search.trim().toLowerCase()
  const progressOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const key of MACHINE_PROGRESS_STATIC_ORDER) {
      options.set(key, MACHINE_PROGRESS_STATIC_LABELS[key])
    }
    for (const machine of machines) {
      options.set(machine.progress.currentKey, machine.progress.currentLabel)
    }
    return Array.from(options.entries()).map(([value, label]) => ({ value, label }))
  }, [machines])
  const progressLabelMap = useMemo(
    () => new Map(progressOptions.map((option) => [option.value, option.label])),
    [progressOptions]
  )

  const filteredMachines = useMemo(() => machines.filter((machine) => {
    const searchable = [
      machine.name,
      machine.product,
      machine.client?.name,
      machine.client?.primary_contact_name,
      machine.factory?.name,
      machine.created_by_user?.full_name,
      ...(machine.machine_items || []).flatMap((item) => [
        item.product_name,
        item.product_name_uk,
        item.product_name_en,
        item.drawing_number,
      ]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch)
    const matchesCoating = filters.coating === 'all'
      || machine.uniqueCoatings?.includes(filters.coating as CoatingType)
    const matchesStatus = filters.status === 'all' || machine.progress.currentKey === filters.status
    const matchesMaterial = filters.material === 'all'
      || (filters.material === 'undefined'
        ? !machine.material_type
        : machine.material_type === filters.material)
    const matchesConfirmation = filters.confirmation === 'all'
      || (filters.confirmation === 'confirmed' && machine.is_confirmed)
      || (filters.confirmation === 'unconfirmed' && !machine.is_confirmed)

    let matchesInvoice = true
    if (canViewInvoice && filters.invoice !== 'all') {
      const invoices = invoiceRows(machine.invoice)
      const invoiceStatus = invoices[0]?.status || 'none'
      matchesInvoice = invoiceStatus === filters.invoice
    }

    return matchesSearch
      && matchesCoating
      && matchesStatus
      && matchesMaterial
      && matchesConfirmation
      && matchesInvoice
  }), [canViewInvoice, filters, machines, normalizedSearch])

  const sortedMachines = useMemo(() => [...filteredMachines].sort((left, right) => {
    if (sort === 'oldest') return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    if (sort === 'name_asc') return left.name.localeCompare(right.name, 'ru')
    if (sort === 'production_month_asc') {
      return (left.production_month || '9999-12').localeCompare(right.production_month || '9999-12')
    }
    if (sort === 'cost_desc') return Number(right.total_cost || 0) - Number(left.total_cost || 0)
    if (sort === 'weight_desc') return Number(right.total_weight || 0) - Number(left.total_weight || 0)
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  }), [filteredMachines, sort])

  const stats = useMemo(() => ({
    total: sortedMachines.length,
    confirmed: sortedMachines.filter((machine) => machine.is_confirmed).length,
    weight: sortedMachines.reduce((sum, machine) => sum + Number(machine.total_weight || 0), 0),
    cost: sortedMachines.reduce((sum, machine) => sum + Number(machine.total_cost || 0), 0),
  }), [sortedMachines])

  const activeClientFilters = useMemo(() => {
    const items: Array<{ key: keyof SalesPlanFilters; label: string }> = []
    if (filters.search) items.push({ key: 'search', label: `Поиск: ${filters.search}` })
    if (filters.coating !== 'all') items.push({ key: 'coating', label: coatingFilterLabels[filters.coating] })
    if (filters.status !== 'all') items.push({ key: 'status', label: progressLabelMap.get(filters.status) || filters.status })
    if (filters.material !== 'all') items.push({ key: 'material', label: materialFilterLabels[filters.material] })
    if (filters.confirmation !== 'all') items.push({ key: 'confirmation', label: confirmationFilterLabels[filters.confirmation] })
    if (canViewInvoice && filters.invoice !== 'all') items.push({ key: 'invoice', label: invoiceFilterLabels[filters.invoice] })
    return items
  }, [canViewInvoice, filters, progressLabelMap])

  const hasAnyFilters = activeClientFilters.length > 0 || factoryFilter !== 'all' || Boolean(productionMonthFilter)

  const resetAllFilters = () => {
    setFilters(initialFilters)
    setSort('newest')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('factory')
    params.delete('productionMonth')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  const removeClientFilter = (key: keyof SalesPlanFilters) => {
    updateFilter(key, initialFilters[key])
  }

  const selectedFactoryLabel = factoryFilter === 'no_factory'
    ? 'Без завода'
    : factories.find((factory) => factory.id === factoryFilter)?.name || 'Все заводы'
  const selectedMonthLabel = productionMonthFilter
    ? productionMonthOptions.find((option) => option.value === productionMonthFilter)?.label || productionMonthFilter
    : 'Все месяцы'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={PackageCheck} label="Машины" value={String(stats.total)} note="в текущей выборке" tone="blue" />
        <KpiCard
          icon={CheckCircle2}
          label="Подтверждено"
          value={String(stats.confirmed)}
          note={stats.total ? `${Math.round((stats.confirmed / stats.total) * 100)}% выборки` : 'нет данных'}
          tone="emerald"
        />
        <KpiCard icon={Weight} label="Общий вес" value={formatWeight(stats.weight)} note="по выбранным машинам" tone="slate" />
        <KpiCard icon={CircleDollarSign} label="Стоимость" value={formatMoney(stats.cost)} note="товары и расходы" tone="amber" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-blue-50/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <SlidersHorizontal className="h-4 w-4 text-blue-700" />
                Управление выборкой
              </div>
              <p className="mt-1 text-xs text-slate-500">Поиск, производственный контекст и операционные статусы</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {hasAnyFilters && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetAllFilters}
                  className="min-h-11 border-slate-200 bg-white px-4 text-slate-600 sm:min-h-10"
                >
                  <X className="mr-2 h-4 w-4" />
                  Сбросить всё
                </Button>
              )}
              {canCreate && (
                <Button
                  render={<Link href={ROUTES.SALES_PLAN_NEW} />}
                  className="min-h-11 bg-blue-900 px-4 text-white shadow-sm hover:bg-blue-800 sm:min-h-10"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Новая машина
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="relative md:col-span-2">
              <span className="sr-only">Поиск машин</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="Машина, клиент, товар, чертёж, завод или автор..."
                className="h-11 border-slate-200 bg-white pl-10 text-base text-slate-900 placeholder:text-slate-400 sm:text-sm"
              />
            </label>

            <Select value={factoryFilter} onValueChange={(value) => updateUrlFilter('factory', value || 'all')}>
              <SelectTrigger className="h-11 border-slate-200 bg-white text-slate-700">
                <SelectValue>{selectedFactoryLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все заводы</SelectItem>
                <SelectItem value="no_factory">Без завода</SelectItem>
                {factories.map((factory) => (
                  <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={productionMonthFilter || 'all'}
              onValueChange={(value) => updateUrlFilter('productionMonth', value || 'all')}
            >
              <SelectTrigger className="h-11 border-slate-200 bg-white text-slate-700">
                <SelectValue>{selectedMonthLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все месяцы</SelectItem>
                {productionMonthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Select value={filters.status} onValueChange={(value) => updateFilter('status', value || 'all')}>
              <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                <SelectValue>{filters.status === 'all' ? 'Все статусы' : progressLabelMap.get(filters.status) || filters.status}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {progressOptions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.material} onValueChange={(value) => updateFilter('material', value || 'all')}>
              <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                <SelectValue>{materialFilterLabels[filters.material]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(materialFilterLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.coating} onValueChange={(value) => updateFilter('coating', value || 'all')}>
              <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                <SelectValue>{coatingFilterLabels[filters.coating]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(coatingFilterLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.confirmation} onValueChange={(value) => updateFilter('confirmation', value || 'all')}>
              <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                <SelectValue>{confirmationFilterLabels[filters.confirmation]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(confirmationFilterLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {canViewInvoice && (
              <Select value={filters.invoice} onValueChange={(value) => updateFilter('invoice', value || 'all')}>
                <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                  <SelectValue>{invoiceFilterLabels[filters.invoice]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(invoiceFilterLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={sort} onValueChange={(value) => setSort((value || 'newest') as SalesPlanSort)}>
              <SelectTrigger className="h-10 border-slate-200 bg-white text-slate-700">
                <ArrowDownAZ className="mr-2 h-4 w-4 text-slate-400" />
                <SelectValue>{sortLabels[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(sortLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(hasAnyFilters || sort !== 'newest') && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                <Filter className="h-3.5 w-3.5" />
                Активно:
              </span>
              {factoryFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => updateUrlFilter('factory', 'all')}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100"
                >
                  {selectedFactoryLabel}<X className="h-3 w-3" />
                </button>
              )}
              {productionMonthFilter && (
                <button
                  type="button"
                  onClick={() => updateUrlFilter('productionMonth', 'all')}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100"
                >
                  {selectedMonthLabel}<X className="h-3 w-3" />
                </button>
              )}
              {activeClientFilters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => removeClientFilter(item.key)}
                  className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="truncate">{item.label}</span><X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              {sort !== 'newest' && (
                <button
                  type="button"
                  onClick={() => setSort('newest')}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                >
                  {sortLabels[sort]}<X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {resultLimit && machines.length >= resultLimit && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:px-5">
            Показаны последние {resultLimit} машин. Серверные фильтры по заводу и месяцу помогают сузить выборку.
          </div>
        )}

        {sortedMachines.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500">
              <Search className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Машины не найдены</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Измените поисковый запрос или сбросьте фильтры. Данные в системе не изменены.
            </p>
            {hasAnyFilters && (
              <Button type="button" variant="outline" onClick={resetAllFilters} className="mt-5 min-h-11">
                Сбросить фильтры
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <div className="max-h-[calc(100vh-280px)] min-h-[360px] overflow-auto">
                <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur">
                    <tr>
                      <th className="sticky left-0 z-40 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Машина
                      </th>
                      <th className="w-[200px] min-w-[200px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Состояние</th>
                      <th className="min-w-[155px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Производство</th>
                      <th className="min-w-[145px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Состав</th>
                      <th className="min-w-[125px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Параметры</th>
                      <th className="min-w-[150px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Прогресс</th>
                      <th className="min-w-[120px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Финансы</th>
                      <th className="min-w-[140px] border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Добавлено</th>
                      <th className="sticky right-0 z-40 w-[70px] border-b border-l border-slate-200 bg-slate-50 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMachines.map((machine) => {
                      const counts = getGoodsAndSamples(machine)
                      return (
                        <tr key={machine.id} className="group">
                          <td className={cn(
                            'sticky left-0 z-20 border-b border-r border-slate-100 bg-white px-4 py-4 align-top shadow-[8px_0_18px_-18px_rgba(15,23,42,0.7)] group-hover:bg-blue-50/40',
                            !machine.is_confirmed && 'bg-amber-50/70 group-hover:bg-amber-50'
                          )}>
                            <Link
                              href={`${ROUTES.SALES_PLAN}/${machine.id}`}
                              className="inline-flex max-w-[190px] items-center gap-1 font-semibold text-blue-950 hover:text-blue-700"
                            >
                              <span className="truncate">{machine.name}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                            <div className="mt-1 line-clamp-2 max-w-[190px] text-xs leading-5 text-slate-500">
                              {machine.product || machine.client?.name || 'Без описания продукции'}
                            </div>
                            {machine.client?.name && (
                              <div className="mt-2 text-xs font-medium text-slate-600">{machine.client.name}</div>
                            )}
                          </td>
                          <td className="w-[200px] min-w-[200px] border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            <div className="flex flex-col items-start gap-2">
                              {machine.is_confirmed ? (
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                  <CheckCircle2 className="mr-1 h-3 w-3" />Подтверждена
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                  <AlertTriangle className="mr-1 h-3 w-3" />Черновик
                                </Badge>
                              )}
                              <MachineProgressBadge progress={machine.progress} />
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            {machine.factory?.name ? (
                              <>
                                <div className="font-medium text-slate-800">{machine.factory.name}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {productionQueueLabel(machine.production_workshop, machine.production_queue_number)}
                                </div>
                                <div className="mt-2 text-xs capitalize text-slate-500">
                                  {machine.production_month
                                    ? format(new Date(machine.production_month), 'LLLL yyyy', { locale: ru })
                                    : 'Месяц не указан'}
                                </div>
                              </>
                            ) : (
                              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Без завода</Badge>
                            )}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            <div>{getMaterialBadge(machine.material_type)}</div>
                            <div className="mt-2 text-sm font-medium tabular-nums text-slate-800">
                              {counts.goods} тов.
                              {counts.samples > 0 && <span className="text-amber-700"> + {counts.samples} обр.</span>}
                            </div>
                            <div className="mt-2 flex max-w-[135px] flex-wrap gap-1">
                              {machine.uniqueCoatings?.length
                                ? machine.uniqueCoatings.map(getCoatingBadge)
                                : <span className="text-xs text-slate-400">Нет покрытий</span>}
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            <div className="font-semibold tabular-nums text-slate-900">{formatWeight(machine.total_weight)}</div>
                            <div className="mt-2 font-semibold tabular-nums text-emerald-700">{formatMoney(machine.total_cost)}</div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            <div className="space-y-3">
                              <ProgressMetric label="Производство" progress={machine.production_progress} />
                              <ProgressMetric label="Снабжение" progress={machine.supply_progress} />
                            </div>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            {canViewInvoice ? <InvoiceBadge invoice={machine.invoice} /> : <span className="text-xs text-slate-400">Скрыто ролью</span>}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-4 align-top group-hover:bg-slate-50/70">
                            <div className="font-medium text-slate-700">{machine.created_by_user?.full_name || 'Неизвестно'}</div>
                            <div className="mt-1 text-xs tabular-nums text-slate-400">
                              {format(new Date(machine.created_at), 'dd.MM.yyyy', { locale: ru })}
                            </div>
                          </td>
                          <td className="sticky right-0 z-20 border-b border-l border-slate-100 bg-white px-3 py-4 align-top group-hover:bg-slate-50">
                            <MachineActions
                              machine={machine}
                              canEdit={canEdit}
                              canDelete={canDelete}
                              isDirector={isDirector}
                              onEdit={() => setEditMachine(machine)}
                              onArchive={() => setArchiveMachine(machine)}
                              onDelete={() => setDeleteMachine(machine)}
                              onAssign={() => setAssignMachine(machine)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 bg-slate-50/70 p-3 lg:hidden">
              {sortedMachines.map((machine) => {
                const counts = getGoodsAndSamples(machine)
                return (
                  <article key={machine.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className={cn(
                      'border-b border-slate-100 p-4',
                      machine.is_confirmed ? 'bg-gradient-to-br from-white to-blue-50/60' : 'bg-gradient-to-br from-white to-amber-50'
                    )}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} className="inline-flex items-center gap-1 text-lg font-bold text-blue-950">
                            <span className="truncate">{machine.name}</span>
                            <ChevronRight className="h-4 w-4 shrink-0" />
                          </Link>
                          <div className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">
                            {machine.product || machine.client?.name || 'Без описания продукции'}
                          </div>
                        </div>
                        <MachineActions
                          machine={machine}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          isDirector={isDirector}
                          onEdit={() => setEditMachine(machine)}
                          onArchive={() => setArchiveMachine(machine)}
                          onDelete={() => setDeleteMachine(machine)}
                          onAssign={() => setAssignMachine(machine)}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {machine.is_confirmed ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />Подтверждена
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            <AlertTriangle className="mr-1 h-3 w-3" />Черновик
                          </Badge>
                        )}
                        <MachineProgressBadge progress={machine.progress} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-px bg-slate-100">
                      <div className="bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Завод</div>
                        <div className={cn('mt-1 text-sm font-semibold', machine.factory?.name ? 'text-slate-800' : 'text-red-700')}>
                          {machine.factory?.name || 'Не назначен'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {machine.factory?.name
                            ? productionQueueLabel(machine.production_workshop, machine.production_queue_number)
                            : 'Требует назначения'}
                        </div>
                      </div>
                      <div className="bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Месяц</div>
                        <div className="mt-1 text-sm font-semibold capitalize text-slate-800">
                          {machine.production_month
                            ? format(new Date(machine.production_month), 'LLLL yyyy', { locale: ru })
                            : 'Не указан'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{machine.client?.name || 'Клиент не указан'}</div>
                      </div>
                      <div className="bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Вес и состав</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums text-slate-800">{formatWeight(machine.total_weight)}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{counts.goods} товаров{counts.samples ? ` + ${counts.samples} образцов` : ''}</div>
                      </div>
                      <div className="bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Стоимость</div>
                        <div className="mt-1 text-sm font-bold tabular-nums text-emerald-700">{formatMoney(machine.total_cost)}</div>
                        <div className="mt-0.5">{getMaterialBadge(machine.material_type)}</div>
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ProgressMetric label="Производство" progress={machine.production_progress} />
                        <ProgressMetric label="Снабжение" progress={machine.supply_progress} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <div className="flex flex-wrap gap-1">
                          {machine.uniqueCoatings?.length
                            ? machine.uniqueCoatings.map(getCoatingBadge)
                            : <span className="text-xs text-slate-400">Покрытие не указано</span>}
                        </div>
                        <Button
                          render={<Link href={`${ROUTES.SALES_PLAN}/${machine.id}`} />}
                          variant="outline"
                          className="min-h-11 border-blue-200 text-blue-800"
                        >
                          Открыть
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>Показано {sortedMachines.length} из {machines.length} загруженных машин</span>
          <span className="inline-flex items-center gap-1">
            <Banknote className="h-3.5 w-3.5" />
            Суммы рассчитаны по текущей выборке
          </span>
        </div>
      </section>

      {editMachine && (
        <MachineEditDialog
          machine={editMachine}
          isOpen={Boolean(editMachine)}
          onClose={() => setEditMachine(null)}
          isDirector={isDirector}
          factories={factories}
        />
      )}
      {deleteMachine && (
        <MachineDeleteDialog
          machine={deleteMachine}
          isOpen={Boolean(deleteMachine)}
          onClose={() => setDeleteMachine(null)}
        />
      )}
      {archiveMachine && (
        <MachineArchiveDialog
          machine={archiveMachine}
          isOpen={Boolean(archiveMachine)}
          onClose={() => setArchiveMachine(null)}
        />
      )}
      {assignMachine && (
        <AssignFactoryDialog
          machine={assignMachine}
          factories={factories}
          open={Boolean(assignMachine)}
          onOpenChange={(open) => {
            if (!open) setAssignMachine(null)
          }}
        />
      )}
    </div>
  )
}
