'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2,
  CalendarDays,
  Mail,
  Pencil,
  Phone,
  Power,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { deleteSupplier, type SupplierWithRelations } from '@/lib/actions/suppliers'
import { MATERIAL_CATEGORY_LABELS, WEEKDAY_LABELS } from '@/lib/constants/procurement'
import {
  SUPPLIER_DIRECTORY_SECTIONS,
  getSupplierDirectorySections,
  getSupplierEditHref,
  type SupplierDirectorySection,
} from '@/lib/suppliers/directory'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'active' | 'inactive'

export function SupplierTable({
  suppliers,
  section,
}: {
  suppliers: SupplierWithRelations[]
  section: SupplierDirectorySection
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [supplierToDeactivate, setSupplierToDeactivate] = useState<SupplierWithRelations | null>(null)
  const [isPending, startTransition] = useTransition()
  const content = SUPPLIER_DIRECTORY_SECTIONS[section]

  const filteredSuppliers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru')

    return suppliers.filter((supplier) => {
      if (statusFilter === 'active' && !supplier.is_active) return false
      if (statusFilter === 'inactive' && supplier.is_active) return false
      if (!normalizedQuery) return true

      const searchableText = [
        supplier.name,
        supplier.contact_person,
        supplier.phone,
        supplier.email,
        supplier.notes,
        ...supplier.categories.map((category) => MATERIAL_CATEGORY_LABELS[category]),
        supplier.can_transport ? 'транспорт' : '',
        supplier.can_outsource ? 'аутсорсинг' : '',
      ].filter(Boolean).join(' ').toLocaleLowerCase('ru')

      return searchableText.includes(normalizedQuery)
    })
  }, [query, statusFilter, suppliers])

  function deactivate() {
    if (!supplierToDeactivate) return

    startTransition(async () => {
      const result = await deleteSupplier(supplierToDeactivate.id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось деактивировать компанию')
        return
      }

      toast.success('Компания деактивирована')
      setSupplierToDeactivate(null)
      router.refresh()
    })
  }

  return (
    <section aria-label={`Каталог: ${content.title}`} className="space-y-4 [font-family:var(--font-industrial-sans)]">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="supplier-search" className="sr-only">Поиск компаний</label>
            <Input
              id="supplier-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, контакт, телефон или категория"
              className="h-11 bg-background pl-9"
            />
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" aria-label="Фильтр по статусу">
            {([
              ['all', 'Все'],
              ['active', 'Активные'],
              ['inactive', 'Неактивные'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'min-h-10 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:min-h-9 sm:text-sm',
                  statusFilter === value
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Найдено: <strong className="font-semibold text-foreground">{filteredSuppliers.length}</strong></span>
          {(query || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setStatusFilter('all')
              }}
              className="min-h-9 rounded-lg px-2 font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {filteredSuppliers.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            {query || statusFilter !== 'all'
              ? <Search className="h-5 w-5" aria-hidden="true" />
              : <Building2 className="h-5 w-5" aria-hidden="true" />}
          </span>
          <h2 className="mt-4 text-base font-semibold text-foreground">
            {query || statusFilter !== 'all' ? 'По заданным условиям ничего не найдено' : content.emptyTitle}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            {query || statusFilter !== 'all'
              ? 'Измените поисковый запрос, выберите другой статус или сбросьте фильтры.'
              : content.emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-border bg-muted/70 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-[24%] px-4 py-3">Компания</th>
                  <th scope="col" className="w-[18%] px-4 py-3">Контакты</th>
                  <th scope="col" className="w-[27%] px-4 py-3">Направления</th>
                  <th scope="col" className="w-[14%] px-4 py-3">Отгрузка</th>
                  <th scope="col" className="w-[9%] px-4 py-3">Статус</th>
                  <th scope="col" className="w-[8%] px-4 py-3 text-right"><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id} className={cn('align-top transition-colors hover:bg-muted/40', !supplier.is_active && 'bg-muted/20')}>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-foreground">{supplier.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{supplier.notes || 'Без заметок'}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-medium text-foreground">{supplier.contact_person || 'Контакт не указан'}</p>
                      <ContactLinks supplier={supplier} compact />
                    </td>
                    <td className="px-4 py-4">
                      <SupplierDirections supplier={supplier} />
                    </td>
                    <td className="px-4 py-4">
                      <DeliverySummary supplier={supplier} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge active={supplier.is_active} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-1">
                        <Link
                          href={getSupplierEditHref(section, supplier.id)}
                          aria-label={`Редактировать ${supplier.name}`}
                          title="Редактировать"
                          className={cn(buttonVariants({ variant: 'outline', size: 'icon-lg' }), 'h-9 w-9')}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Link>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          aria-label={`Деактивировать ${supplier.name}`}
                          title="Деактивировать"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          disabled={isPending || !supplier.is_active}
                          onClick={() => setSupplierToDeactivate(supplier)}
                        >
                          <Power className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {filteredSuppliers.map((supplier) => (
              <article key={supplier.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-foreground">{supplier.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{supplier.contact_person || 'Контактное лицо не указано'}</p>
                  </div>
                  <StatusBadge active={supplier.is_active} />
                </div>

                <ContactLinks supplier={supplier} />

                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Направления</p>
                  <SupplierDirections supplier={supplier} />
                </div>

                <div className="mt-4 rounded-xl bg-muted/60 p-3">
                  <DeliverySummary supplier={supplier} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link
                    href={getSupplierEditHref(section, supplier.id)}
                    className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'min-h-11')}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Редактировать
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="min-h-11 text-muted-foreground hover:text-destructive"
                    disabled={isPending || !supplier.is_active}
                    onClick={() => setSupplierToDeactivate(supplier)}
                  >
                    <Power className="h-4 w-4" aria-hidden="true" />
                    Деактивировать
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <AlertDialog
        open={Boolean(supplierToDeactivate)}
        onOpenChange={(open) => {
          if (!open && !isPending) setSupplierToDeactivate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Деактивировать компанию?</AlertDialogTitle>
            <AlertDialogDescription>
              {supplierToDeactivate?.name} останется в базе и во всех связанных документах, но больше не будет доступна для новых операций.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isPending}
              onClick={deactivate}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isPending ? 'Деактивация…' : 'Деактивировать'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ContactLinks({ supplier, compact = false }: { supplier: SupplierWithRelations; compact?: boolean }) {
  if (!supplier.phone && !supplier.email) {
    return <p className="mt-1 text-xs text-muted-foreground">Телефон и email не указаны</p>
  }

  return (
    <div className={cn('mt-2 flex gap-2', compact ? 'flex-col items-start' : 'flex-wrap')}>
      {supplier.phone && (
        <a
          href={`tel:${supplier.phone}`}
          className="inline-flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          {supplier.phone}
        </a>
      )}
      {supplier.email && (
        <a
          href={`mailto:${supplier.email}`}
          className="inline-flex min-h-8 max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{supplier.email}</span>
        </a>
      )}
    </div>
  )
}

function SupplierDirections({ supplier }: { supplier: SupplierWithRelations }) {
  const directorySections = getSupplierDirectorySections(supplier)
  const hasDirections = directorySections.length > 0 || supplier.categories.length > 0

  if (!hasDirections) return <span className="text-xs text-muted-foreground">Не распределена</span>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {directorySections.map((direction) => (
          <Badge key={direction} variant="outline" className="bg-background">
            {SUPPLIER_DIRECTORY_SECTIONS[direction].shortTitle}
          </Badge>
        ))}
      </div>
      {supplier.categories.length > 0 && (
        <p className="text-xs leading-5 text-muted-foreground">
          {supplier.categories.map((category) => MATERIAL_CATEGORY_LABELS[category]).join(' · ')}
        </p>
      )}
    </div>
  )
}

function DeliverySummary({ supplier }: { supplier: SupplierWithRelations }) {
  const days = supplier.deliveryDays.map((day) => WEEKDAY_LABELS[day]).join(', ')

  return (
    <div className="text-xs text-muted-foreground">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        {days || 'Без графика'}
      </p>
      <p className="mt-1">Срок: {supplier.delivery_lead_days || 0} дн.</p>
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">Активна</Badge>
  ) : (
    <Badge variant="secondary" className="text-muted-foreground">Неактивна</Badge>
  )
}
