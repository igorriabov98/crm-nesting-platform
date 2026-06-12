import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { DIRECTOR_ROLES, ROLES } from '@/lib/constants/roles'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ClipboardList, Factory as FactoryIcon, Package, Receipt, Bell, Calendar, Hammer, Truck } from 'lucide-react'
import { NOTIFICATION_TYPES, DEFAULT_NOTIFICATION_ICON, NotificationType } from '@/lib/constants/notifications'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'

export const metadata = {
  title: 'Дашборд — CRM Завода',
}

type DashboardMeeting = {
  id: string
  title: string | null
  meeting_date: string
  meeting_time: string
  meeting_type: string | null
  agenda_items_count?: number
}

type DashboardNotification = {
  id: string
  title: string
  message: string
  type: string
  created_at: string
  related_machine_id: string | null
}

type DashboardProductionStage = {
  stage_type: string
  date_start: string | null
  date_end: string | null
  planned_date_end: string | null
  is_skipped: boolean | null
}

type DashboardTonnageMachine = {
  id: string
  name: string
  total_weight: number | null
  factory_id: string | null
  planned_material_date: string | null
  actual_material_date: string | null
  actual_shipping_date: string | null
  production_stages: DashboardProductionStage[] | null
}

type MonthlyTonnageDetail = {
  machineId: string
  machineName: string
  tons: number
  basis: string
  period: string
}

type MonthlyTonnage = {
  month: string
  materialTons: number
  weldingTons: number
  shippingTons: number
  materialDetails: MonthlyTonnageDetail[]
  weldingDetails: MonthlyTonnageDetail[]
  shippingDetails: MonthlyTonnageDetail[]
}

type FactoryFilterableQuery<T> = T & {
  is: (column: string, value: null) => T
  eq: (column: string, value: string) => T
}

const DAY_MS = 24 * 60 * 60 * 1000

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function normalizeMonthValue(value: string | null | undefined) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const month = Number(value.slice(5, 7))
    if (month >= 1 && month <= 12) return value
  }
  return currentMonthValue()
}

function monthBounds(monthValue: string) {
  const year = Number(monthValue.slice(0, 4))
  const monthIndex = Number(monthValue.slice(5, 7)) - 1
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  }
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function dateInMonth(value: string | null | undefined, monthStart: Date, monthEnd: Date) {
  const date = parseDateOnly(value)
  if (!date) return false
  return date >= monthStart && date < monthEnd
}

function formatDateValue(value: string | null | undefined) {
  const date = parseDateOnly(value)
  if (!date) return 'дата не указана'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

function formatDateRange(startValue: string | null | undefined, endValue: string | null | undefined) {
  return `${formatDateValue(startValue)} - ${formatDateValue(endValue || startValue)}`
}

function rangeTonsInMonthDetail(weight: number, startValue: string | null | undefined, endValue: string | null | undefined, monthStart: Date, monthEnd: Date) {
  const start = parseDateOnly(startValue)
  const end = parseDateOnly(endValue) || start
  if (!start || !end || weight <= 0) return null

  const rangeStart = start <= end ? start : end
  const rangeEnd = start <= end ? end : start
  const monthEndInclusive = new Date(monthEnd.getTime() - DAY_MS)
  const overlapStart = new Date(Math.max(rangeStart.getTime(), monthStart.getTime()))
  const overlapEnd = new Date(Math.min(rangeEnd.getTime(), monthEndInclusive.getTime()))
  if (overlapEnd < overlapStart) return null

  const totalDays = Math.max(1, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1)
  const overlapDays = Math.max(0, Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1)
  const tons = weight * (overlapDays / totalDays)
  if (tons <= 0) return null

  return {
    tons,
    totalDays,
    overlapDays,
    period: formatDateRange(startValue, endValue || startValue),
  }
}

function formatTons(value: number) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} т`
}

function formatMonthLabel(monthValue: string) {
  const { start } = monthBounds(monthValue)
  return start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function applyMonthlyFactoryFilter<T>(query: T, factoryFilter: string | null, role: string): T {
  const scopedQuery = query as FactoryFilterableQuery<T>
  if (role === 'production_manager') return query
  if (factoryFilter === 'no_factory') return scopedQuery.is('factory_id', null)
  if (factoryFilter && factoryFilter !== 'all') return scopedQuery.eq('factory_id', factoryFilter)
  return query
}

function TonnageDetails({ items }: { items: MonthlyTonnageDetail[] }) {
  return (
    <details className="mt-4 border-t border-[#E8ECF0] pt-3">
      <summary className="inline-flex h-8 cursor-pointer select-none items-center rounded-md border border-[#D7DEE8] px-3 text-xs font-medium text-[#1B3A6B] transition-colors hover:bg-[#F4F6F9]">
        Подробнее
      </summary>
      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {items.length > 0 ? items.map((item) => (
          <div key={`${item.machineId}-${item.basis}-${item.period}`} className="rounded-md border border-[#EEF2F6] bg-[#FAFBFC] p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[#1B3A6B]" title={item.machineName}>{item.machineName}</div>
                <div className="mt-0.5 text-xs text-[#6B7280]">{item.basis}</div>
                <div className="mt-0.5 text-xs text-[#9CA3AF]">{item.period}</div>
              </div>
              <div className="shrink-0 text-sm font-semibold text-[#1B3A6B]">{formatTons(item.tons)}</div>
            </div>
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-[#D7DEE8] px-3 py-4 text-center text-xs text-[#9CA3AF]">
            Нет позиций за выбранный месяц
          </div>
        )}
      </div>
    </details>
  )
}

async function getMonthlyDirectorTonnage(factoryFilter: string | null, role: string, monthValue: string): Promise<MonthlyTonnage> {
  const supabase = await createServerSupabaseClient()
  const { start: monthStart, end: monthEnd } = monthBounds(monthValue)
  const query = applyMonthlyFactoryFilter(
    supabase
      .from('machines_with_totals')
      .select(`
        id, name, total_weight, factory_id, planned_material_date, actual_material_date, actual_shipping_date,
        production_stages(stage_type, date_start, date_end, planned_date_end, is_skipped)
      `)
      .eq('is_archived', false),
    factoryFilter,
    role
  )

  const { data, error } = await query
  if (error) throw new Error(error.message || 'Не удалось загрузить месячный тоннаж')

  const machines = (data || []) as DashboardTonnageMachine[]
  let materialTons = 0
  let weldingTons = 0
  let shippingTons = 0
  const materialDetails: MonthlyTonnageDetail[] = []
  const weldingDetails: MonthlyTonnageDetail[] = []
  const shippingDetails: MonthlyTonnageDetail[] = []

  for (const machine of machines) {
    const weight = Number(machine.total_weight || 0)
    if (weight <= 0) continue

    const materialDate = machine.actual_material_date || machine.planned_material_date
    if (dateInMonth(materialDate, monthStart, monthEnd)) {
      materialTons += weight
      materialDetails.push({
        machineId: machine.id,
        machineName: machine.name,
        tons: weight,
        basis: machine.actual_material_date ? 'Факт прихода материала' : 'План прихода материала',
        period: formatDateValue(materialDate),
      })
    }

    if (machine.actual_shipping_date) {
      if (dateInMonth(machine.actual_shipping_date, monthStart, monthEnd)) {
        shippingTons += weight
        shippingDetails.push({
          machineId: machine.id,
          machineName: machine.name,
          tons: weight,
          basis: 'Факт отгрузки',
          period: formatDateValue(machine.actual_shipping_date),
        })
      }
    }

    for (const stage of machine.production_stages || []) {
      if (stage.is_skipped) continue
      if (stage.stage_type === 'assembly') {
        const detail = rangeTonsInMonthDetail(weight, stage.date_start, stage.planned_date_end || stage.date_end, monthStart, monthEnd)
        if (detail) {
          weldingTons += detail.tons
          weldingDetails.push({
            machineId: machine.id,
            machineName: machine.name,
            tons: detail.tons,
            basis: `План сварки: ${detail.overlapDays} из ${detail.totalDays} дн.`,
            period: detail.period,
          })
        }
      }
      if (!machine.actual_shipping_date && stage.stage_type === 'shipping') {
        const detail = rangeTonsInMonthDetail(weight, stage.date_start, stage.planned_date_end || stage.date_end, monthStart, monthEnd)
        if (detail) {
          shippingTons += detail.tons
          shippingDetails.push({
            machineId: machine.id,
            machineName: machine.name,
            tons: detail.tons,
            basis: `План отгрузки: ${detail.overlapDays} из ${detail.totalDays} дн.`,
            period: detail.period,
          })
        }
      }
    }
  }

  const byTonsDesc = (a: MonthlyTonnageDetail, b: MonthlyTonnageDetail) => b.tons - a.tons
  return {
    month: monthValue,
    materialTons,
    weldingTons,
    shippingTons,
    materialDetails: materialDetails.sort(byTonsDesc),
    weldingDetails: weldingDetails.sort(byTonsDesc),
    shippingDetails: shippingDetails.sort(byTonsDesc),
  }
}

async function getDashboardData(factoryFilter: string | null, role: string, userId: string, showInvoices: boolean) {
  const supabase = await createServerSupabaseClient()

  // Supabase query builders carry table-specific generic constraints that are not useful here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFactoryFilter = (query: any, isMachineTable = false) => {
    const colBase = isMachineTable ? '' : 'machines.'
    if (role === 'production_manager') {
      // RLS limits production managers to their factory plus unassigned machines.
      return query
    } else if (factoryFilter === 'no_factory') {
      return query.is(`${colBase}factory_id`, null)
    } else if (factoryFilter && factoryFilter !== 'all') {
      return query.eq(`${colBase}factory_id`, factoryFilter)
    }
    return query
  }

  const today = new Date().toISOString()
  const [
    salesPlanRes,
    overdueProductionRes,
    pendingSupplyRes,
    overdueInvoicesRes,
    noFactoryRes,
    upcomingMeetingsRes,
    notificationsRes,
  ] = await Promise.all([
    applyFactoryFilter(
      supabase.from('machines').select('id', { count: 'exact', head: true }).eq('is_archived', false),
      true
    ),
    applyFactoryFilter(
      supabase.from('production_stages').select('id, machines!inner(id)', { count: 'exact', head: true })
        .eq('machines.is_archived', false)
        .lt('planned_date_end', today)
        .is('date_end', null)
        .eq('is_skipped', false)
    ),
    applyFactoryFilter(
      supabase.from('supply_items').select('id, machines!inner(id)', { count: 'exact', head: true })
        .eq('machines.is_archived', false)
        .in('status', ['not_ordered', 'ordered'])
    ),
    showInvoices
      ? applyFactoryFilter(
          supabase.from('invoices').select('id, machines!inner(id)', { count: 'exact', head: true })
            .eq('machines.is_archived', false)
            .neq('status', 'paid')
            .lt('payment_date', today)
        )
      : Promise.resolve({ count: 0 }),
    supabase.from('machines').select('id', { count: 'exact', head: true }).eq('is_archived', false).is('factory_id', null),
    supabase
      .from('meetings')
      .select('id, title, meeting_date, meeting_time, meeting_type')
      .eq('status', 'planned')
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(1),
    supabase
      .from('notifications')
      .select('id, title, message, type, created_at, related_machine_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  let nearestMeeting = (upcomingMeetingsRes.data?.[0] as DashboardMeeting | undefined) || null
  if (nearestMeeting) {
    const { count } = await supabase
      .from('meeting_agenda_items')
      .select('id', { count: 'exact', head: true })
      .eq('meeting_id', nearestMeeting.id)
    nearestMeeting = { ...nearestMeeting, agenda_items_count: count || 0 }
  }

  return {
    salesPlan: salesPlanRes.count || 0,
    production: overdueProductionRes.count || 0,
    supply: pendingSupplyRes.count || 0,
    invoices: overdueInvoicesRes.count || 0,
    noFactoryCount: noFactoryRes.count === null ? null : noFactoryRes.count || 0,
    nearestMeeting,
    notifications: (notificationsRes.data || []) as DashboardNotification[]
  }
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string; month?: string }>
}) {
  const { user: currentUser, canViewInvoices: showInvoices } = await getCurrentUserContextOrRedirect()
  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  const monthFilter = normalizeMonthValue(resolvedSearchParams?.month)
  const isDirector = DIRECTOR_ROLES.includes(currentUser.role)

  const [stats, monthlyTonnage] = await Promise.all([
    getDashboardData(factoryFilter, currentUser.role, currentUser.id, showInvoices),
    isDirector ? getMonthlyDirectorTonnage(factoryFilter, currentUser.role, monthFilter) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold tracking-tight text-[#1B3A6B]">
          Добро пожаловать, {currentUser.full_name}!
        </h1>
        <div className="flex items-center gap-2 text-[#6B7280]">
          <span className="font-medium text-[#374151]">Роль:</span> 
          {ROLES[currentUser.role]?.label}
          <span className="mx-2 text-[#E8ECF0]">|</span>
          <span className="font-medium text-[#374151]">Завод:</span> 
          {currentUser.factory?.name ?? '—'}
        </div>
      </div>

      <div className={`grid gap-4 md:grid-cols-2 ${stats.noFactoryCount !== null ? (showInvoices ? 'lg:grid-cols-5' : 'lg:grid-cols-4') : (showInvoices ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}`}>
        <Link href={ROUTES.SALES_PLAN}>
          <Card className="border-[#E8ECF0] bg-white transition-colors hover:shadow-md h-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#6B7280]">Машины</CardTitle>
              <ClipboardList className="h-4 w-4 text-[#9CA3AF]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#1B3A6B]">{stats.salesPlan}</div>
              <p className="text-xs text-[#9CA3AF]">всего</p>
            </CardContent>
          </Card>
        </Link>
        
        {stats.noFactoryCount !== null && (
        <Link href={`${ROUTES.SALES_PLAN}?factory=no_factory`}>
          <Card className="border-[#DC2626]/20 bg-white transition-colors hover:shadow-md h-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#DC2626]">Без завода</CardTitle>
              <FactoryIcon className="h-4 w-4 text-[#DC2626]/70" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#DC2626]">{stats.noFactoryCount}</div>
              <p className="text-xs font-medium text-[#DC2626] flex items-center mt-1">
                 ⚠️ требуют назнач.
              </p>
            </CardContent>
          </Card>
        </Link>
        )}

        <Link href={ROUTES.PRODUCTION}>
          <Card className="border-[#E8ECF0] bg-white transition-colors hover:shadow-md h-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#6B7280]">Производ.</CardTitle>
              <FactoryIcon className="h-4 w-4 text-[#9CA3AF]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#1B3A6B] flex items-baseline gap-2">
                {stats.production}
              </div>
              <p className="text-xs font-medium text-[#DC2626] flex items-center mt-1">
                 просрч. ⚠️
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href={ROUTES.SUPPLY}>
          <Card className="border-[#E8ECF0] bg-white transition-colors hover:shadow-md h-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-[#6B7280]">Снабжение</CardTitle>
              <Package className="h-4 w-4 text-[#9CA3AF]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#1B3A6B]">{stats.supply}</div>
              <p className="text-xs font-medium text-[#D97706] flex items-center mt-1">
                 ожид. 🟡
              </p>
            </CardContent>
          </Card>
        </Link>

        {showInvoices && (
          <Link href={ROUTES.INVOICES}>
            <Card className="border-[#E8ECF0] bg-white transition-colors hover:shadow-md h-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[#6B7280]">Инвойсы</CardTitle>
                <Receipt className="h-4 w-4 text-[#9CA3AF]" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[#1B3A6B]">{stats.invoices}</div>
                <p className="text-xs font-medium text-[#DC2626] flex items-center mt-1">
                  просрч. 🔴
                </p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {monthlyTonnage && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#1B3A6B]">Тоннаж за месяц</h2>
              <p className="text-sm text-[#6B7280]">
                Материал, сварка и отгрузка за {formatMonthLabel(monthlyTonnage.month)}
              </p>
            </div>
            <form action={ROUTES.DASHBOARD} className="flex flex-wrap items-center gap-2">
              {factoryFilter && factoryFilter !== 'all' && <input type="hidden" name="factory" value={factoryFilter} />}
              <label className="text-sm font-medium text-[#374151]" htmlFor="dashboard-month-filter">Месяц</label>
              <input
                id="dashboard-month-filter"
                type="month"
                name="month"
                defaultValue={monthlyTonnage.month}
                className="h-9 rounded-md border border-[#E8ECF0] bg-[#F4F6F9] px-3 text-sm text-[#1B3A6B] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
              <button
                type="submit"
                className="h-9 rounded-md bg-[#1B3A6B] px-3 text-sm font-medium text-white transition-colors hover:bg-[#2C5282]"
              >
                Показать
              </button>
            </form>
          </div>

          <div className="grid items-start gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-[#E8ECF0] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-[#6B7280]">Материал</div>
                <Package className="h-4 w-4 text-[#9CA3AF]" />
              </div>
              <div className="mt-3 text-2xl font-bold text-[#1B3A6B]">{formatTons(monthlyTonnage.materialTons)}</div>
              <p className="mt-1 text-xs text-[#9CA3AF]">факт прихода, иначе план</p>
              <TonnageDetails items={monthlyTonnage.materialDetails} />
            </div>

            <div className="rounded-lg border border-[#E8ECF0] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-[#6B7280]">Сварка</div>
                <Hammer className="h-4 w-4 text-[#9CA3AF]" />
              </div>
              <div className="mt-3 text-2xl font-bold text-[#1B3A6B]">{formatTons(monthlyTonnage.weldingTons)}</div>
              <p className="mt-1 text-xs text-[#9CA3AF]">по плану сборки, пропорционально дням</p>
              <TonnageDetails items={monthlyTonnage.weldingDetails} />
            </div>

            <div className="rounded-lg border border-[#E8ECF0] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-[#6B7280]">Отгрузка</div>
                <Truck className="h-4 w-4 text-[#9CA3AF]" />
              </div>
              <div className="mt-3 text-2xl font-bold text-[#1B3A6B]">{formatTons(monthlyTonnage.shippingTons)}</div>
              <p className="mt-1 text-xs text-[#9CA3AF]">факт отгрузки, иначе план</p>
              <TonnageDetails items={monthlyTonnage.shippingDetails} />
            </div>
          </div>
        </section>
      )}

      {stats.nearestMeeting && (
        <div className="max-w-2xl bg-white border border-[#E8ECF0] rounded-xl overflow-hidden shadow-sm mt-8">
          <div className="px-5 py-4 border-b border-[#E8ECF0] flex items-center justify-between bg-blue-50/50">
            <h3 className="font-semibold text-[#1B3A6B] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#1B3A6B]" />
              Ближайшее собрание
            </h3>
            <span className="text-xs font-medium text-[#6B7280]">
              {new Date(stats.nearestMeeting.meeting_date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}
            </span>
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-[#374151] text-sm">
                {stats.nearestMeeting.meeting_time.substring(0, 5)} — {stats.nearestMeeting.title || 'Собрание'}
              </p>
              <p className="text-xs text-[#6B7280] mt-1">
                В повестке пунктов: {stats.nearestMeeting.agenda_items_count}
              </p>
            </div>
            <Link href={`${ROUTES.MEETINGS}/${stats.nearestMeeting.id}`} className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors">
              Открыть &rarr;
            </Link>
          </div>
        </div>
      )}

      {stats.notifications.length > 0 && (
        <div className="max-w-2xl bg-white border border-[#E8ECF0] rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] mt-8">
          <div className="px-5 py-4 border-b border-[#E8ECF0] flex items-center justify-between">
            <h3 className="font-semibold text-[#1B3A6B] flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#9CA3AF]" />
              Последние уведомления
            </h3>
            <Link href={ROUTES.NOTIFICATIONS} className="text-sm text-[#2563EB] hover:text-[#1B3A6B]">
              Показать все →
            </Link>
          </div>
          <div className="divide-y divide-[#E8ECF0]">
            {stats.notifications.map((notif) => {
              const config = NOTIFICATION_TYPES[notif.type as NotificationType] || DEFAULT_NOTIFICATION_ICON
              const Icon = config.icon
              return (
                <div key={notif.id} className="p-4 flex items-start gap-4 bg-white hover:bg-[#FAFBFC] transition-colors">
                  <div className={`mt-0.5 p-2 rounded-full flex-shrink-0 ${config.bg} ${config.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-medium text-[#374151] text-sm">{notif.title}</h5>
                    <p className="text-[#6B7280] text-xs mt-0.5">{notif.message}</p>
                    <p className="text-[10px] text-[#9CA3AF] mt-2">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ru })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
