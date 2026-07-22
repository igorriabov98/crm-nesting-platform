import Link from 'next/link'
import { ArrowLeft, Plus } from 'lucide-react'
import { notFound } from 'next/navigation'
import { SupplierForm } from '@/components/features/suppliers/SupplierForm'
import { requirePermission } from '@/lib/permissions/server'
import {
  SUPPLIER_DIRECTORY_SECTIONS,
  getSupplierDirectoryHref,
  isSupplierDirectorySection,
} from '@/lib/suppliers/directory'

export default async function NewSupplierPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!isSupplierDirectorySection(section)) notFound()
  await requirePermission('suppliers', 'manage')

  const content = SUPPLIER_DIRECTORY_SECTIONS[section]
  const returnHref = getSupplierDirectoryHref(section)

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 [font-family:var(--font-industrial-sans)]">
      <Link
        href={returnHref}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Вернуться в раздел
      </Link>

      <header className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{content.title}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Новая компания</h1>
          <p className="mt-1 text-sm text-muted-foreground">Заполните карточку и укажите все направления работы организации.</p>
        </div>
      </header>

      <SupplierForm key={section} directorySection={section} />
    </div>
  )
}
