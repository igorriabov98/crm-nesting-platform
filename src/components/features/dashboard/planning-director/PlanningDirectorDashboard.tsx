import Link from 'next/link'
import { Suspense } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ClipboardCheck,
  Factory,
  PackageX,
} from 'lucide-react'
import type { PlanningDashboardFactory } from '@/lib/dashboard/planning-director/types'
import { createPlanningDashboardPromises } from '@/lib/dashboard/planning-director/data'
import { ROUTES } from '@/lib/constants/routes'
import { PlanningDashboardControls } from './PlanningDashboardControls'
import { SupplyRiskTabs } from './SupplyRiskTabs'

type DashboardPromises = ReturnType<typeof createPlanningDashboardPromises>

const formatDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Uzhgorod',
})
const formatTons = (value: number) => `${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} т`
const formatKg = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} кг`

function Panel({
  title,
  description,
  icon: Icon,
  children,
  className = '',
}: {
  title: string
  description: string
  icon: typeof ClipboardCheck
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse divide-y divide-slate-100" aria-label="Загрузка данных">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2 px-4 py-4">
          <div className="h-3 w-2/3 rounded bg-slate-200" />
          <div className="h-3 w-1/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

async function PersonalItems({ promise, today }: { promise: DashboardPromises['personalItems']; today: string }) {
  const { items, count } = await promise
  return (
    <>
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span>Активная очередь</span>
        <span className="font-semibold tabular-nums text-slate-900">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Активных задач и запросов нет.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => {
            const overdue = Boolean(item.deadline && item.deadline < today)
            return (
              <Link
                key={`${item.kind}-${item.id}`}
                href={item.href}
                prefetch
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${overdue ? 'bg-red-600' : item.deadline ? 'bg-blue-600' : 'bg-amber-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                      {item.kind === 'request' ? 'Запрос' : 'Задача'}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {item.machineName || 'Без привязки к заказу'}
                  </span>
                </span>
                <span className={`shrink-0 text-xs font-medium ${overdue ? 'text-red-700' : item.deadline ? 'text-slate-600' : 'text-amber-700'}`}>
                  {item.deadline ? formatDate(item.deadline) : 'Без срока'}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

function MetricCard({ label, plan, fact, percent, deviation }: {
  label: string
  plan: number
  fact: number
  percent: number | null
  deviation: number
}) {
  const complete = percent !== null && percent >= 100
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500">План</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{formatTons(plan)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Факт</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${complete ? 'text-emerald-700' : 'text-blue-700'}`}>{formatTons(fact)}</div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${complete ? 'bg-emerald-600' : 'bg-blue-600'}`}
          style={{ width: `${Math.min(Math.max(percent || 0, 0), 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-700">{percent === null ? 'План не задан' : `${percent.toFixed(0)}%`}</span>
        <span className={deviation >= 0 ? 'text-emerald-700' : 'text-red-700'}>
          {deviation >= 0 ? '+' : ''}{formatTons(deviation)}
        </span>
      </div>
    </div>
  )
}

async function Tonnage({ promise }: { promise: DashboardPromises['assemblyTonnage'] }) {
  const data = await promise
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      <MetricCard label="За месяц" {...data.monthMetric} />
      <MetricCard label="Сегодня" {...data.todayMetric} />
    </div>
  )
}

async function OverdueShipments({ promise }: { promise: DashboardPromises['overdueShipments'] }) {
  const { items, count } = await promise
  return (
    <>
      <div className="flex items-center justify-between bg-red-50 px-4 py-2 text-xs text-red-800">
        <span>Не отгружено в срок</span>
        <span className="font-semibold tabular-nums">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Просроченных отгрузок нет.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <Link key={item.id} href={item.href} prefetch className="grid gap-2 px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:grid-cols-[minmax(0,1fr)_100px_110px]">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {[item.specification && `Спец. ${item.specification}`, item.clientName].filter(Boolean).join(' · ') || 'Без спецификации и клиента'}
                </div>
              </div>
              <div className="text-sm font-medium tabular-nums text-slate-700 sm:text-right">{formatTons(item.weightTons)}</div>
              <div className="sm:text-right">
                <div className="text-sm font-semibold text-red-700">{item.overdueDays} дн.</div>
                <div className="text-xs text-slate-500">{formatDate(item.desiredShippingDate)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

async function TodaySections({ promise }: { promise: DashboardPromises['todaySections'] }) {
  const sections = await promise
  return (
    <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
      {sections.map((section) => (
        <div key={section.id} className="min-w-0 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{section.name}</div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{section.parentName}</div>
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">{section.orders.length}</span>
          </div>
          {section.orders.length === 0 ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              План участка на сегодня не заполнен.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {section.orders.map((order) => (
                <Link key={order.id} href={order.href} prefetch className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                  <span className="truncate font-medium text-slate-800">{order.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-600">{formatKg(order.plannedKg)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

async function SupplyRisks({ promise }: { promise: DashboardPromises['supplyRisks'] }) {
  return <SupplyRiskTabs risks={await promise} />
}

export function PlanningDirectorDashboard({
  fullName,
  factories,
  selectedFactoryId,
  month,
  today,
  promises,
}: {
  fullName: string
  factories: PlanningDashboardFactory[]
  selectedFactoryId: string
  month: string
  today: string
  promises: DashboardPromises
}) {
  const selectedFactory = factories.find((factory) => factory.id === selectedFactoryId)
  return (
    <div className="min-w-0 space-y-5 bg-slate-50/60">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
            <Factory className="h-4 w-4" aria-hidden="true" />
            Операционный центр
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Планирование производства
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {fullName} · {formatDate(today)} · завод {selectedFactory?.name}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Обновлено {new Date(promises.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Uzhgorod' })}
          </p>
        </div>
        <PlanningDashboardControls factories={factories} selectedFactoryId={selectedFactoryId} month={month} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-12">
        <Panel title="Мои задачи и запросы" description="Личная очередь не зависит от выбранного завода" icon={ClipboardCheck} className="xl:col-span-7">
          <Suspense fallback={<PanelSkeleton rows={5} />}><PersonalItems promise={promises.personalItems} today={today} /></Suspense>
        </Panel>
        <Panel title="Сборка/Сварка — план и факт" description="Только сборка и сварка, без других этапов" icon={Factory} className="xl:col-span-5">
          <Suspense fallback={<PanelSkeleton rows={3} />}><Tonnage promise={promises.assemblyTonnage} /></Suspense>
        </Panel>
        <Panel title="Просроченная отгрузка" description="Подтверждённые заказы без фактической отгрузки" icon={AlertTriangle} className="xl:col-span-5">
          <Suspense fallback={<PanelSkeleton rows={4} />}><OverdueShipments promise={promises.overdueShipments} /></Suspense>
        </Panel>
        <Panel title="Производство сегодня" description="План по всем активным участкам, включая пустые" icon={CalendarClock} className="xl:col-span-7">
          <Suspense fallback={<PanelSkeleton rows={5} />}><TodaySections promise={promises.todaySections} /></Suspense>
        </Panel>
        <Panel title="Риски снабжения" description="Неполученный остаток, просрочка и обязательства без даты" icon={PackageX} className="xl:col-span-12">
          <Suspense fallback={<PanelSkeleton rows={6} />}><SupplyRisks promise={promises.supplyRisks} /></Suspense>
        </Panel>
      </div>

      <Link href={ROUTES.PRODUCTION_PEOPLE} prefetch className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
        Открыть планирование людей <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  )
}
