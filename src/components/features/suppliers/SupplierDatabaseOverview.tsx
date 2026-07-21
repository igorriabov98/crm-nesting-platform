import Link from 'next/link'
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Database,
  Layers3,
  PackageOpen,
  Truck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'
import {
  PRIMARY_SUPPLIER_DIRECTORY_SECTIONS,
  SUPPLIER_DIRECTORY_SECTIONS,
  filterSuppliersByDirectorySection,
  getSupplierDirectoryHref,
  type SupplierDirectorySection,
} from '@/lib/suppliers/directory'

const CARD_DESIGN: Record<Exclude<SupplierDirectorySection, 'all'>, {
  icon: React.ElementType
  iconClassName: string
  accentClassName: string
}> = {
  transport: {
    icon: Truck,
    iconClassName: 'bg-sky-100 text-sky-700',
    accentClassName: 'group-hover:border-sky-300',
  },
  metal: {
    icon: Layers3,
    iconClassName: 'bg-slate-200 text-slate-700',
    accentClassName: 'group-hover:border-slate-400',
  },
  outsourcing: {
    icon: BriefcaseBusiness,
    iconClassName: 'bg-violet-100 text-violet-700',
    accentClassName: 'group-hover:border-violet-300',
  },
  consumables: {
    icon: PackageOpen,
    iconClassName: 'bg-amber-100 text-amber-800',
    accentClassName: 'group-hover:border-amber-300',
  },
}

export function SupplierDatabaseOverview({
  suppliers,
  error,
}: {
  suppliers: SupplierWithRelations[]
  error?: string | null
}) {
  const activeCount = suppliers.filter((supplier) => supplier.is_active).length

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 [font-family:var(--font-industrial-sans)]">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-primary/5" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-sky-100/60" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Database className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Единый реестр контрагентов
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              База данных
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Выберите нужный каталог. Данные компании хранятся один раз, а организация может одновременно
              быть поставщиком материалов, перевозчиком и аутсорсинговым подрядчиком.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-border bg-background/80 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Всего записей</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{suppliers.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/80 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Активных</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{activeCount}</p>
            </div>
            <Link
              href={ROUTES.ADMIN_DATABASE_ALL}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Все записи
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          Не удалось загрузить базу данных: {error}
        </div>
      )}

      <section aria-labelledby="database-categories-title" className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="database-categories-title" className="text-lg font-semibold text-foreground">
              Категории
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Каждый каталог показывает только относящиеся к нему компании.</p>
          </div>
          <Badge variant="secondary" className="hidden sm:inline-flex">4 раздела</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PRIMARY_SUPPLIER_DIRECTORY_SECTIONS.map((section) => {
            const content = SUPPLIER_DIRECTORY_SECTIONS[section]
            const design = CARD_DESIGN[section]
            const Icon = design.icon
            const sectionSuppliers = filterSuppliersByDirectorySection(suppliers, section)
            const sectionActiveCount = sectionSuppliers.filter((supplier) => supplier.is_active).length

            return (
              <Link
                key={section}
                href={getSupplierDirectoryHref(section)}
                className={`group flex min-h-[220px] flex-col rounded-2xl border border-border bg-card p-5 transition-colors ${design.accentClassName} hover:bg-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${design.iconClassName}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
                </div>

                <div className="mt-6 flex-1">
                  <h3 className="text-base font-semibold text-foreground">{content.title}</h3>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{content.description}</p>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs">
                  <span className="font-medium text-muted-foreground">Организаций</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {sectionSuppliers.length}
                    <span className="ml-1 font-normal text-muted-foreground">· {sectionActiveCount} активных</span>
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
