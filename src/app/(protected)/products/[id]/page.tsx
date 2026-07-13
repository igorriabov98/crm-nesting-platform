import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Barcode,
  CheckCircle2,
  CircleAlert,
  Euro,
  FileText,
  Package2,
  Scale,
} from 'lucide-react'
import { ProductFileManager } from '@/components/features/products/ProductFileManager'
import { ProductForm } from '@/components/features/products/ProductForm'
import { ProductVersionHistory } from '@/components/features/products/ProductVersionHistory'
import { getProduct } from '@/lib/actions/products'
import { getProductVersions } from '@/lib/actions/product-versions'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { versionDocumentState } from '@/lib/products/product-file-upload'

export const metadata = {
  title: 'Изделие — CRM Завода',
}

const statusLabels = {
  draft: 'Черновик',
  active: 'Активен',
  archived: 'Архив',
} as const

const statusClasses = {
  draft: 'border-amber-200 bg-amber-50 text-amber-800',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  archived: 'border-slate-200 bg-slate-100 text-slate-700',
} as const

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
const moneyFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function SummaryMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className="text-blue-700">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  )
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await getProduct(id)
  if (!data && !error) notFound()

  if (error || !data) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        {error || 'Изделие не найдено'}
      </div>
    )
  }

  const [{ data: versionsData, error: versionsError }, currentUserContext] = await Promise.all([
    getProductVersions(id),
    getCurrentUserContextOrRedirect(),
  ])
  const { supabase } = currentUserContext
  const versions = versionsData || []
  const currentVersion = versions.find((version) => version.status === 'current') || null
  const documentState = versionDocumentState(currentVersion?.product_files || [])
  const authorIds = Array.from(new Set(
    versions.map((version) => version.created_by).filter((value): value is string => Boolean(value))
  ))
  const authorsById: Record<string, { id: string; full_name: string | null }> = {}

  if (authorIds.length > 0) {
    const { data: authors } = await supabase.from('users').select('id, full_name').in('id', authorIds)
    for (const author of (authors || []) as Array<{ id: string; full_name: string | null }>) {
      authorsById[author.id] = author
    }
  }

  const supplementaryFiles = (data.product_files || []).filter((file) => !file.product_version_id)

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-8">
      <Link
        href={ROUTES.PRODUCTS}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-10 -ml-2 gap-2 text-slate-600 hover:text-slate-950')}
      >
        <ArrowLeft className="h-4 w-4" />
        Все изделия
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm sm:p-7">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-blue-700" />
        <div className="relative">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 max-w-4xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusClasses[data.status]}>{statusLabels[data.status]}</Badge>
                {currentVersion && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">Версия {currentVersion.version_number}</Badge>}
                <Badge variant="outline" className={documentState.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                  {documentState.complete ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <CircleAlert className="mr-1 h-3.5 w-3.5" />}
                  {documentState.complete ? 'Документы готовы' : 'Документы не полные'}
                </Badge>
              </div>
              <div className="mt-4 flex items-start gap-3">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-sm">
                  <Package2 className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Карточка изделия</p>
                  <h1 className="mt-1 break-words text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">{data.name_uk}</h1>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-600 sm:text-base">{data.name_en}</p>
                </div>
              </div>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[500px]">
              <SummaryMetric icon={<FileText className="h-4 w-4" />} label="Чертёж" value={data.drawing_number} />
              <SummaryMetric icon={<Barcode className="h-4 w-4" />} label="УКТЗЕД" value={data.uktzed} />
              <SummaryMetric icon={<Scale className="h-4 w-4" />} label="Вес" value={`${numberFormatter.format(Number(data.unit_weight_kg || 0))} кг`} />
              <SummaryMetric icon={<Euro className="h-4 w-4" />} label="Базовая цена" value={`${moneyFormatter.format(Number(data.base_price_eur || 0))} EUR`} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="order-2 space-y-5 xl:order-1">
          {versionsError ? (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {versionsError}
            </div>
          ) : (
            <ProductVersionHistory productId={data.id} versions={versions} authorsById={authorsById} />
          )}
        </div>
        <aside className="order-1 xl:sticky xl:top-5 xl:order-2">
          <ProductForm product={data} />
        </aside>
      </div>

      <ProductFileManager productId={data.id} files={supplementaryFiles} />
    </div>
  )
}
