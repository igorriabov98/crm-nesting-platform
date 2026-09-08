import Link from 'next/link'
import { Clock3, Factory, MapPin, PackageOpen, Truck } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import type {
  ProductionLocalShipment,
  ProductionLocalShipmentCargo,
  ProductionLocalShipmentsWorkspace,
} from '@/lib/transport/production-local-shipments'
import { formatProductionShipmentDateTime } from '@/lib/transport/production-local-shipments'

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

const statePresentation = {
  waiting: { label: 'Ожидают погрузки', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  onsite: { label: 'На площадке', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  completed: { label: 'Погрузка завершена', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  cancelled: { label: 'Рейс отменён', className: 'border-rose-200 bg-rose-50 text-rose-800' },
} as const

const kindLabel = {
  materials: 'Материалы',
  detailing: 'Деталировка',
  outsourcing: 'Аутсорсинг',
} as const

function measureLabel(value: number | null, unit: string) {
  return value === null ? null : `${numberFormatter.format(value)} ${unit}`
}

function CargoDetails({ cargo }: { cargo: ProductionLocalShipmentCargo }) {
  const snapshot = cargo.snapshot
  if (!snapshot) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        <p className="font-medium text-slate-900">{cargo.title}</p>
        {cargo.subtitle && <p className="mt-1 text-sm text-slate-600">{cargo.subtitle}</p>}
        <p className="mt-2 text-sm text-slate-700">Пункт назначения: {cargo.destinationLabel}</p>
        <p className="mt-2 text-sm font-medium text-amber-800">Подробный состав для старого рейса не сохранён</p>
      </div>
    )
  }

  const items = snapshot.itemDetails.length > 0
    ? snapshot.itemDetails
    : snapshot.itemLabels.map((title) => ({
        title,
        drawingLabel: null,
        description: null,
        quantityLabel: null,
        quantity: null,
        requiredQuantity: null,
        excessQuantity: null,
        unit: null,
        weightKg: null,
        pieceLengthMm: null,
        pieceCount: null,
        machineLabel: null,
        characteristics: [],
      }))

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const dimensions = [
          measureLabel(item.pieceLengthMm, 'мм'),
          item.pieceCount === null ? null : `${numberFormatter.format(item.pieceCount)} шт.`,
        ].filter(Boolean).join(' × ')
        return (
          <div key={`${cargo.linkId}:${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-950">{item.title}</p>
                {item.drawingLabel && <p className="mt-0.5 text-xs text-slate-500">{item.drawingLabel}</p>}
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {kindLabel[cargo.kind]}
              </span>
            </div>
            {item.machineLabel && <p className="mt-2 text-sm text-slate-700">Заказ: {item.machineLabel}</p>}
            {item.description && <p className="mt-1 text-sm text-slate-600">{item.description}</p>}
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-slate-500">Количество</dt><dd className="font-medium text-slate-900">{item.quantityLabel || (item.quantity !== null && item.unit ? `${numberFormatter.format(item.quantity)} ${item.unit}` : '—')}</dd></div>
              <div><dt className="text-slate-500">Размеры</dt><dd className="font-medium text-slate-900">{dimensions || '—'}</dd></div>
              <div><dt className="text-slate-500">Вес</dt><dd className="font-medium text-slate-900">{measureLabel(item.weightKg, 'кг') || '—'}</dd></div>
              <div><dt className="text-slate-500">Куда</dt><dd className="font-medium text-slate-900">{cargo.destinationLabel}</dd></div>
            </dl>
            {item.characteristics.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {item.characteristics.map((entry) => `${entry.label}: ${entry.value}`).join(' · ')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ShipmentCard({ shipment }: { shipment: ProductionLocalShipment }) {
  const schedule = formatProductionShipmentDateTime(shipment.scheduledAt)
  const state = statePresentation[shipment.state]
  const itemCount = shipment.cargo.reduce((sum, cargo) => (
    sum + (cargo.snapshot?.itemDetails.length || cargo.snapshot?.itemLabels.length || 1)
  ), 0)

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-4 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:p-5">
        <div className="rounded-lg bg-slate-950 px-4 py-3 text-white">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Погрузка</p>
          <p className={`mt-1 font-semibold tabular-nums ${schedule.time === 'Время не указано' ? 'text-base leading-5' : 'text-3xl'}`}>{schedule.time}</p>
          <p className="mt-1 text-sm text-slate-300">{schedule.date}</p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Машина · номер рейса</p>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{shipment.tripNumber}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {shipment.overdue && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">Просрочена</span>}
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${state.className}`}>{state.label}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
            <p className="flex min-w-0 items-start gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" /><span>{shipment.carrierName || 'Перевозчик не указан'}</span></p>
            <p className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" /><span>{shipment.route || 'Маршрут не указан'}</span></p>
          </div>
          {shipment.state === 'onsite' && shipment.arrivedAt && (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800"><Clock3 className="size-4" aria-hidden="true" />Прибыл в {formatProductionShipmentDateTime(shipment.arrivedAt).time}</p>
          )}
        </div>
      </div>
      <details className="group border-t border-slate-200 bg-slate-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium text-slate-800 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:px-5">
          <span className="flex items-center gap-2"><PackageOpen className="size-4" aria-hidden="true" />Состав груза · {itemCount} поз.</span>
          <span className="text-sm text-slate-500 group-open:hidden">Показать</span>
          <span className="hidden text-sm text-slate-500 group-open:inline">Скрыть</span>
        </summary>
        <div className="space-y-3 border-t border-slate-200 p-4 sm:p-5">
          {shipment.cargo.map((cargo) => <CargoDetails key={cargo.linkId} cargo={cargo} />)}
        </div>
      </details>
    </article>
  )
}

function ShipmentSection({ id, title, description, shipments }: {
  id: string
  title: string
  description: string
  shipments: ProductionLocalShipment[]
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">{shipments.length}</span>
      </div>
      {shipments.length > 0 ? (
        <div className="space-y-3">{shipments.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} />)}</div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">Локальных отгрузок нет</div>
      )}
    </section>
  )
}

export function ProductionLocalShipmentsPage({ workspace }: { workspace: ProductionLocalShipmentsWorkspace }) {
  const selectedFactory = workspace.factories.find((factory) => factory.id === workspace.selectedFactoryId)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-blue-700"><Factory className="size-4" aria-hidden="true" />Производство</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Локальные отгрузки</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Что нужно погрузить с завода, в какой рейс и к какому времени. Данные берутся из сформированных транспортных рейсов.</p>
          </div>
          {selectedFactory && <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">{selectedFactory.name}</span>}
        </div>
        {workspace.canViewAllFactories && workspace.factories.length > 1 && (
          <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Выбор завода">
            {workspace.factories.map((factory) => {
              const active = factory.id === workspace.selectedFactoryId
              return (
                <Link
                  key={factory.id}
                  href={`${ROUTES.PRODUCTION_LOCAL_SHIPMENTS}?factory=${factory.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-11 shrink-0 items-center rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${active ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {factory.name}
                </Link>
              )
            })}
          </nav>
        )}
      </header>

      {!workspace.selectedFactoryId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-semibold">Завод не назначен</h2>
          <p className="mt-1 text-sm">Обратитесь к администратору CRM, чтобы назначить завод вашему профилю.</p>
        </div>
      ) : (
        <>
          <ShipmentSection id="active-local-shipments" title="Текущие погрузки" description="Ожидают прибытия транспорта или уже находятся на площадке." shipments={workspace.active} />
          <ShipmentSection id="local-shipments-history" title="История" description="Последние 50 завершённых или отменённых погрузок, от новых к старым." shipments={workspace.history} />
        </>
      )}
    </div>
  )
}
