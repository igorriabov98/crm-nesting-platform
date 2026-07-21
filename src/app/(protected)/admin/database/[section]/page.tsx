import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Database,
  Layers3,
  PackageOpen,
  Plus,
  Truck,
} from 'lucide-react'
import { SupplierTable } from '@/components/features/suppliers/SupplierTable'
import { buttonVariants } from '@/components/ui/button'
import { getSuppliers } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import {
  SUPPLIER_DIRECTORY_SECTIONS,
  filterSuppliersByDirectorySection,
  getSupplierCreateHref,
  isSupplierDirectorySection,
  type SupplierDirectorySection,
} from '@/lib/suppliers/directory'
import { cn } from '@/lib/utils'

const SECTION_ICONS: Record<SupplierDirectorySection, React.ElementType> = {
  all: Database,
  metal: Layers3,
  consumables: PackageOpen,
  transport: Truck,
  outsourcing: BriefcaseBusiness,
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!isSupplierDirectorySection(section)) return { title: 'База данных — CRM Завода' }
  return { title: `${SUPPLIER_DIRECTORY_SECTIONS[section].title} — CRM Завода` }
}

export default async function SupplierDirectorySectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!isSupplierDirectorySection(section)) notFound()

  await requirePermission('suppliers', 'view')
  const { data, error } = await getSuppliers()
  const suppliers = filterSuppliersByDirectorySection(data || [], section)
  const activeCount = suppliers.filter((supplier) => supplier.is_active).length
  const inactiveCount = suppliers.length - activeCount
  const content = SUPPLIER_DIRECTORY_SECTIONS[section]
  const Icon = SECTION_ICONS[section]

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 [font-family:var(--font-industrial-sans)]">
      <Link
        href={ROUTES.ADMIN_DATABASE}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Вернуться к базе данных
      </Link>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">База данных</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{content.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{content.description}</p>
            </div>
          </div>

          <Link href={getSupplierCreateHref(section)} className={cn(buttonVariants({ size: 'lg' }), 'min-h-11 px-4')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить компанию
          </Link>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-5 sm:max-w-md sm:gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">Всего</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{suppliers.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Активных</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">{activeCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Неактивных</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">{inactiveCount}</dd>
          </div>
        </dl>
      </section>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          Не удалось загрузить компании: {error}
        </div>
      ) : (
        <SupplierTable suppliers={suppliers} section={section} />
      )}
    </div>
  )
}
