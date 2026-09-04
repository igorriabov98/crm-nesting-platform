import Link from 'next/link'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Factory,
  Gauge,
  Settings2,
  Snowflake,
} from 'lucide-react'

import { ProductionReportRefreshButton } from '@/components/features/reports/ProductionReportRefreshButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants/routes'
import {
  PRODUCTION_REPORT_STAGE_KEYS,
  loadProductionReportPageData,
  type ProductionReportFilters,
  type ProductionReportStageKey,
  type ProductionReportTab,
} from '@/lib/reports/production-analytics'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Производственная аналитика — CRM Завода' }
export const dynamic = 'force-dynamic'

type SearchParams = Partial<Record<keyof ProductionReportFilters, string>>

const TAB_LABELS: Record<ProductionReportTab, string> = {
  overview: 'Обзор',
  progress: 'Прогресс',
  load: 'Загрузка',
}
const STAGE_LABELS: Record<ProductionReportStageKey, string> = {
  assembly: 'Сборка/Сварка',
  cleaning: 'Слесарка/Зачистка',
  painting: 'Малярка',
  packaging: 'Упаковка',
}

function number(value: number, digits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value || 0)
}

function date(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
}

function generatedAt(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Uzhgorod',
  }).format(new Date(value))
}

function reportHref(filters: ProductionReportFilters, updates: Partial<ProductionReportFilters>) {
  const next = { ...filters, ...updates }
  const params = new URLSearchParams({
    month: next.month,
    factoryId: next.factoryId,
    tab: next.tab,
  })
  if (next.tab === 'load') {
    params.set('stage', next.stage)
    if (next.sectionId) params.set('sectionId', next.sectionId)
  }
  return `${ROUTES.REPORTS_PRODUCTION}?${params.toString()}`
}

function statusClass(status: string) {
  if (status === 'late' || status === 'data_error') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'ahead') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'upcoming') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

export default async function ProductionReportPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams
  const data = await loadProductionReportPageData({
    month: params?.month,
    factoryId: params?.factoryId,
    tab: params?.tab as ProductionReportTab,
    stage: params?.stage as ProductionReportStageKey,
    sectionId: params?.sectionId,
  })
  const { filters } = data

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-[#12315F]">
            <BarChart3 className="size-6 text-[#1E40AF]" aria-hidden="true" />
            Производственная аналитика
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Точный факт по номенклатуре, план по рабочим дням и мощности участков.
          </p>
          <p className="mt-1 text-xs text-[#94A3B8]">Сформировано: {generatedAt(data.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProductionReportRefreshButton />
          {data.canManage ? (
            <Button render={<Link href={`${ROUTES.REPORTS_PRODUCTION_SETTINGS}?factory=${filters.factoryId === 'all' ? data.factories[0]?.id || '' : filters.factoryId}`} />} variant="outline" className="min-h-9">
              <Settings2 /> Настройки
            </Button>
          ) : null}
        </div>
      </header>

      <form action={ROUTES.REPORTS_PRODUCTION} method="get" className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <input type="hidden" name="tab" value={filters.tab} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1.5 text-sm font-medium text-[#334155]">
            Месяц
            <input type="month" name="month" defaultValue={filters.month} required className="h-10 rounded-md border border-input bg-white px-3 text-[#12315F] outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]/30" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[#334155]">
            Завод
            <select name="factoryId" defaultValue={filters.factoryId} className="h-10 rounded-md border border-input bg-white px-3 text-[#12315F] outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]/30">
              {data.canSelectAllFactories ? <option value="all">Все заводы</option> : null}
              {data.factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}
            </select>
          </label>
          {filters.tab === 'load' ? (
            <>
              <label className="grid gap-1.5 text-sm font-medium text-[#334155]">
                Этап
                <select name="stage" defaultValue={filters.stage} className="h-10 rounded-md border border-input bg-white px-3 text-[#12315F] outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]/30">
                  {PRODUCTION_REPORT_STAGE_KEYS.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-[#334155]">
                Участок
                <select name="sectionId" defaultValue={data.load.selectedSectionId} className="h-10 rounded-md border border-input bg-white px-3 text-[#12315F] outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]/30">
                  {data.load.sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
                </select>
              </label>
            </>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" className="min-h-9 bg-[#12315F] px-4 text-white hover:bg-[#1B3A6B]">Показать</Button>
        </div>
      </form>

      <nav aria-label="Разделы производственного отчёта" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1">
        {(Object.keys(TAB_LABELS) as ProductionReportTab[]).map((tab) => (
          <Link
            key={tab}
            href={reportHref(filters, { tab, sectionId: tab === 'load' ? filters.sectionId : '' })}
            aria-current={filters.tab === tab ? 'page' : undefined}
            className={cn(
              'min-w-28 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]',
              filters.tab === tab ? 'bg-white text-[#12315F] shadow-sm' : 'text-[#64748B] hover:text-[#12315F]',
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        ))}
      </nav>

      {data.warnings.length > 0 ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <summary className="cursor-pointer text-sm font-semibold">Предупреждения качества данных: {data.warnings.length}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      ) : null}

      {filters.tab === 'overview' ? <Overview data={data} /> : null}
      {filters.tab === 'progress' ? <Progress data={data} /> : null}
      {filters.tab === 'load' ? <Load data={data} /> : null}
    </div>
  )
}

function Overview({ data }: { data: Awaited<ReturnType<typeof loadProductionReportPageData>> }) {
  const cards = [
    { icon: Snowflake, label: 'Заморозка металла — на сегодня', value: `${number(data.overview.freeze.tons)} т`, note: `${data.overview.freeze.orders} заказов` },
    { icon: Factory, label: 'Сборка за месяц', value: `${number(data.overview.assemblyMonth.fact)} / ${number(data.overview.assemblyMonth.plan)} т`, note: 'факт / план' },
    { icon: CalendarDays, label: 'Сборка сегодня', value: `${number(data.overview.assemblyToday.fact)} / ${number(data.overview.assemblyToday.plan)} т`, note: 'факт / план' },
    { icon: Gauge, label: 'Накопленное отклонение', value: `${data.overview.accumulatedLagTons >= 0 ? '+' : ''}${number(data.overview.accumulatedLagTons)} т`, note: 'на текущую дату месяца' },
  ]
  const weeklyMax = Math.max(1, ...data.overview.weekly.flatMap((row) => [row.plan, row.fact]))
  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ icon: Icon, label, value, note }) => (
          <div key={label} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2 text-sm text-[#64748B]"><span>{label}</span><Icon className="size-4 text-[#1E40AF]" /></div>
            <div className="mt-3 text-xl font-semibold text-[#12315F]">{value}</div>
            <div className="mt-1 text-xs text-[#94A3B8]">{note}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-[#12315F]">Недельная динамика сборки</h2>
        {data.overview.weekly.length === 0 ? <p className="mt-4 text-sm text-[#64748B]">В выбранном месяце данных нет.</p> : (
          <div className="mt-4 space-y-4">
            {data.overview.weekly.map((row) => (
              <div key={row.week} className="grid gap-2 md:grid-cols-[90px_minmax(0,1fr)_190px] md:items-center">
                <div className="text-sm font-medium text-[#334155]">{row.week}</div>
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-[#E2E8F0]"><div className="h-2 rounded-full bg-[#93C5FD]" style={{ width: `${Math.min(100, row.plan / weeklyMax * 100)}%` }} /></div>
                  <div className="h-2 rounded-full bg-[#E2E8F0]"><div className="h-2 rounded-full bg-[#1E40AF]" style={{ width: `${Math.min(100, row.fact / weeklyMax * 100)}%` }} /></div>
                </div>
                <div className="text-xs tabular-nums text-[#64748B]">План {number(row.plan)} т · факт {number(row.fact)} т</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3"><h2 className="font-semibold text-[#12315F]">План, факт и мощность участков</h2></div>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Участок</th><th className="px-4 py-2">Этап</th><th className="px-4 py-2 text-right">План, т</th><th className="px-4 py-2 text-right">Факт, т</th><th className="px-4 py-2 text-right">Мощность, т</th><th className="px-4 py-2 text-right">Загрузка</th></tr></thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.overview.sections.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium text-[#12315F]">{row.label}</td><td className="px-4 py-3 text-[#64748B]">{STAGE_LABELS[row.stage]}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.plan)}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.fact)}</td><td className="px-4 py-3 text-right tabular-nums">{row.capacity === null ? 'Не настроена' : number(row.capacity)}</td><td className="px-4 py-3 text-right">{row.utilizationPercent === null ? '—' : <Badge className={row.overloaded ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}>{number(row.utilizationPercent, 1)}%</Badge>}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Progress({ data }: { data: Awaited<ReturnType<typeof loadProductionReportPageData>> }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3"><h2 className="font-semibold text-[#12315F]">Прогресс заказов выбранного производственного месяца</h2></div>
      {data.progress.length === 0 ? <div className="px-4 py-12 text-center text-sm text-[#64748B]">Заказов выбранного месяца нет.</div> : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Заказ</th>{PRODUCTION_REPORT_STAGE_KEYS.map((stage) => <th key={stage} className="px-3 py-2">{STAGE_LABELS[stage]}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {data.progress.map((machine) => (
                <tr key={machine.id} className="align-top">
                  <td className="px-4 py-3"><Link href={machine.href} className="font-semibold text-[#1E40AF] hover:underline">{machine.label}</Link><div className="mt-1 text-xs text-[#64748B]">{machine.factoryName}</div></td>
                  {machine.stages.map((stage) => <td key={stage.stage} className="px-3 py-3"><div className="min-w-40"><div className="flex justify-between gap-2 font-medium text-[#12315F]"><span>{stage.percent === null ? '—' : `${number(stage.percent, 1)}%`}</span><span className="text-xs text-[#64748B]">{number(stage.completedKg, 1)} / {number(stage.applicableKg, 1)} кг</span></div><div className="mt-2 h-2 rounded-full bg-[#E2E8F0]"><div className="h-2 rounded-full bg-[#1E40AF]" style={{ width: `${Math.min(100, Math.max(0, stage.percent || 0))}%` }} /></div><Badge variant="outline" className={cn('mt-2', statusClass(stage.status))}>{stage.statusLabel}</Badge></div></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Load({ data }: { data: Awaited<ReturnType<typeof loadProductionReportPageData>> }) {
  return (
    <div className="space-y-5">
      {data.load.days.some((day) => day.nonWorkingFact) ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Есть факт в нерабочий день. План на такие даты равен нулю.</span></div>
      ) : null}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3"><h2 className="font-semibold text-[#12315F]">Загрузка по дням</h2></div>
        <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Дата</th><th className="px-4 py-2">Неделя</th><th className="px-4 py-2 text-right">План, т</th><th className="px-4 py-2 text-right">Факт, т</th><th className="px-4 py-2 text-right">Мощность, т</th><th className="px-4 py-2 text-right">Заказы</th><th className="px-4 py-2 text-right">Отклонение</th></tr></thead><tbody className="divide-y divide-[#E2E8F0]">{data.load.days.map((day) => <tr key={day.date} className={day.nonWorkingFact ? 'bg-amber-50' : !day.isWorking ? 'bg-slate-50 text-slate-500' : ''}><td className="px-4 py-2 font-medium">{date(day.date)} {!day.isWorking ? <span className="text-xs">· нерабочий</span> : null}</td><td className="px-4 py-2">{day.week}</td><td className="px-4 py-2 text-right tabular-nums">{number(day.plan)}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{number(day.fact)}</td><td className="px-4 py-2 text-right tabular-nums">{day.capacity === null ? '—' : number(day.capacity)}</td><td className="px-4 py-2 text-right">{day.activeOrders}</td><td className="px-4 py-2 text-right">{day.deviationPercent === null ? '—' : `${day.deviationPercent >= 0 ? '+' : ''}${number(day.deviationPercent, 1)}%`}{day.overloaded ? <Badge className="ml-2 bg-red-100 text-red-700">Перегрузка</Badge> : null}</td></tr>)}</tbody></table></div>
      </section>
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3"><h2 className="font-semibold text-[#12315F]">Итоги по ISO-неделям</h2></div>
        <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Неделя</th><th className="px-4 py-2 text-right">План, т</th><th className="px-4 py-2 text-right">Факт, т</th><th className="px-4 py-2 text-right">Мощность, т</th><th className="px-4 py-2 text-right">Активных заказов</th><th className="px-4 py-2 text-right">Статус</th></tr></thead><tbody className="divide-y divide-[#E2E8F0]">{data.load.weeks.map((week) => <tr key={week.week}><td className="px-4 py-3 font-medium text-[#12315F]">{week.week}</td><td className="px-4 py-3 text-right tabular-nums">{number(week.plan)}</td><td className="px-4 py-3 text-right tabular-nums">{number(week.fact)}</td><td className="px-4 py-3 text-right tabular-nums">{week.capacity === null ? 'Не настроена' : number(week.capacity)}</td><td className="px-4 py-3 text-right">{week.activeOrders}</td><td className="px-4 py-3 text-right">{week.overloaded === null ? '—' : week.overloaded ? <Badge className="bg-red-100 text-red-700">Перегрузка</Badge> : <Badge className="bg-emerald-100 text-emerald-700">В норме</Badge>}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  )
}
