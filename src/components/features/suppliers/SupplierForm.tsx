'use client'

import { type FormEvent, type ReactNode, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Loader2,
  Save,
  Tags,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createSupplier,
  updateSupplier,
  type SupplierInput,
  type SupplierWithRelations,
} from '@/lib/actions/suppliers'
import {
  DELIVERY_DAYS,
  MATERIAL_CATEGORY_LABELS,
  WEEKDAY_LABELS,
} from '@/lib/constants/procurement'
import {
  CONSUMABLE_SUPPLIER_CATEGORIES,
  METAL_SUPPLIER_CATEGORIES,
  SUPPLIER_DIRECTORY_SECTIONS,
  getSupplierDirectoryHref,
  supplierMatchesDirectorySection,
  type SupplierDirectorySection,
} from '@/lib/suppliers/directory'
import type { MaterialCategory } from '@/lib/types'
import { cn } from '@/lib/utils'

type SupplierFormProps = {
  supplier?: SupplierWithRelations
  directorySection?: SupplierDirectorySection
}

const SECTION_VALIDATION_MESSAGES: Partial<Record<SupplierDirectorySection, string>> = {
  metal: 'Выберите хотя бы одну категорию металла, чтобы компания появилась в этом разделе.',
  consumables: 'Выберите хотя бы одну категорию расходников, чтобы компания появилась в этом разделе.',
  transport: 'Включите возможность «Транспорт», чтобы компания появилась в этом разделе.',
  outsourcing: 'Включите возможность «Аутсорсинг», чтобы компания появилась в этом разделе.',
}

export function SupplierForm({ supplier, directorySection = 'all' }: SupplierFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<SupplierInput>({
    name: supplier?.name || '',
    contact_person: supplier?.contact_person || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    notes: supplier?.notes || '',
    is_active: supplier?.is_active ?? true,
    can_outsource: supplier?.can_outsource ?? (directorySection === 'outsourcing'),
    can_transport: supplier?.can_transport ?? (directorySection === 'transport'),
    delivery_lead_days: supplier?.delivery_lead_days || 0,
    categories: supplier?.categories || [],
    deliveryDays: supplier?.deliveryDays || [],
  })
  const returnHref = getSupplierDirectoryHref(directorySection)
  const sectionContent = SUPPLIER_DIRECTORY_SECTIONS[directorySection]

  function toggleCategory(category: MaterialCategory) {
    setForm((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category],
    }))
  }

  function toggleDay(day: number) {
    setForm((current) => ({
      ...current,
      deliveryDays: current.deliveryDays.includes(day)
        ? current.deliveryDays.filter((item) => item !== day)
        : [...current.deliveryDays, day].sort((a, b) => a - b),
    }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supplier && directorySection !== 'all' && !supplierMatchesDirectorySection(form, directorySection)) {
      toast.error(SECTION_VALIDATION_MESSAGES[directorySection] || 'Укажите направление работы компании')
      return
    }

    startTransition(async () => {
      const result = supplier
        ? await updateSupplier(supplier.id, form)
        : await createSupplier(form)

      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить компанию')
        return
      }

      toast.success(supplier ? 'Данные компании обновлены' : 'Компания добавлена в базу')
      router.push(returnHref)
      router.refresh()
    })
  }

  const categoryGroups = directorySection === 'consumables'
    ? [
        { title: 'Расходники и комплектующие', categories: CONSUMABLE_SUPPLIER_CATEGORIES },
        { title: 'Металл', categories: METAL_SUPPLIER_CATEGORIES },
      ]
    : [
        { title: 'Металл', categories: METAL_SUPPLIER_CATEGORIES },
        { title: 'Расходники и комплектующие', categories: CONSUMABLE_SUPPLIER_CATEGORIES },
      ]

  return (
    <form onSubmit={submit} className="space-y-5 [font-family:var(--font-industrial-sans)]">
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Карточка организации</h2>
              <Badge variant="secondary">{sectionContent.shortTitle}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Одна карточка используется во всех выбранных каталогах и связанных процессах CRM.
            </p>
          </div>

          <label
            htmlFor="supplier-active"
            className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground sm:justify-start"
          >
            <span>
              Активная компания
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Доступна для новых операций</span>
            </span>
            <Checkbox
              id="supplier-active"
              checked={form.is_active}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, is_active: checked === true }))}
            />
          </label>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <SectionTitle
            icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            title="Основные данные"
            description="Реквизиты для связи и внутренние заметки."
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <FormField id="supplier-name" label="Название компании" required className="sm:col-span-2">
              <Input
                id="supplier-name"
                value={form.name}
                required
                autoComplete="organization"
                placeholder="Например, Металл Сервис"
                className="h-11 bg-background"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </FormField>

            <FormField id="supplier-contact" label="Контактное лицо">
              <Input
                id="supplier-contact"
                value={form.contact_person || ''}
                autoComplete="name"
                placeholder="Имя и должность"
                className="h-11 bg-background"
                onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))}
              />
            </FormField>

            <FormField id="supplier-phone" label="Телефон">
              <Input
                id="supplier-phone"
                type="tel"
                value={form.phone || ''}
                autoComplete="tel"
                placeholder="+380 ..."
                className="h-11 bg-background"
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </FormField>

            <FormField id="supplier-email" label="Email" className="sm:col-span-2">
              <Input
                id="supplier-email"
                type="email"
                value={form.email || ''}
                autoComplete="email"
                placeholder="sales@company.com"
                className="h-11 bg-background"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </FormField>

            <FormField id="supplier-notes" label="Заметки" className="sm:col-span-2">
              <Textarea
                id="supplier-notes"
                value={form.notes || ''}
                placeholder="Условия оплаты, особенности работы, договорённости"
                className="min-h-32 bg-background"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </FormField>
          </div>
        </section>

        <div className="space-y-5">
          <fieldset className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <legend className="sr-only">Сервисные возможности</legend>
            <SectionTitle
              icon={<Truck className="h-5 w-5" aria-hidden="true" />}
              title="Сервисные возможности"
              description="Включите все роли, в которых компания может участвовать."
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <CapabilityCard
                id="supplier-transport"
                checked={Boolean(form.can_transport)}
                icon={<Truck className="h-5 w-5" aria-hidden="true" />}
                title="Транспорт"
                description="Компания доступна как перевозчик."
                onChange={() => setForm((current) => ({ ...current, can_transport: !current.can_transport }))}
              />
              <CapabilityCard
                id="supplier-outsourcing"
                checked={Boolean(form.can_outsource)}
                icon={<BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />}
                title="Аутсорсинг"
                description="Компания доступна как внешний подрядчик."
                onChange={() => setForm((current) => ({ ...current, can_outsource: !current.can_outsource }))}
              />
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <legend className="sr-only">Категории материалов</legend>
            <SectionTitle
              icon={<Tags className="h-5 w-5" aria-hidden="true" />}
              title="Категории материалов"
              description="Категории определяют, в каких каталогах материалов появится компания."
            />

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {categoryGroups.map((group) => (
                <CategoryGroup
                  key={group.title}
                  title={group.title}
                  categories={group.categories}
                  selected={form.categories}
                  onToggle={toggleCategory}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <legend className="sr-only">Планирование отгрузки</legend>
            <SectionTitle
              icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
              title="Планирование отгрузки"
              description="Срок и регулярные дни отгрузки используются в текущей логике снабжения."
            />

            <div className="mt-5 grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
              <FormField id="supplier-lead-days" label="Срок доставки, дней">
                <Input
                  id="supplier-lead-days"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.delivery_lead_days || 0}
                  className="h-11 bg-background"
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    delivery_lead_days: Number(event.target.value || 0),
                  }))}
                />
              </FormField>

              <div>
                <p className="text-sm font-medium text-foreground">Дни отгрузки</p>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {DELIVERY_DAYS.map((day) => {
                    const checked = form.deliveryDays.includes(day)
                    return (
                      <label
                        key={day}
                        htmlFor={`delivery-day-${day}`}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 text-sm font-medium transition-colors focus-within:ring-3 focus-within:ring-ring/40',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Checkbox
                          id={`delivery-day-${day}`}
                          checked={checked}
                          onCheckedChange={() => toggleDay(day)}
                          className={checked ? 'border-white/60 data-checked:border-white data-checked:bg-white data-checked:text-primary' : undefined}
                        />
                        {WEEKDAY_LABELS[day]}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Для транспортных и аутсорсинговых компаний график можно не указывать.
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-11 px-5"
          onClick={() => router.push(returnHref)}
          disabled={isPending}
        >
          Отмена
        </Button>
        <Button type="submit" size="lg" className="min-h-11 px-5" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {isPending ? 'Сохранение…' : 'Сохранить компанию'}
        </Button>
      </div>
    </form>
  )
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function FormField({
  id,
  label,
  required = false,
  className,
  children,
}: {
  id: string
  label: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <>
            <span className="text-destructive" aria-hidden="true">*</span>
            <span className="sr-only">обязательное поле</span>
          </>
        )}
      </Label>
      {children}
    </div>
  )
}

function CapabilityCard({
  id,
  checked,
  icon,
  title,
  description,
  onChange,
}: {
  id: string
  checked: boolean
  icon: ReactNode
  title: string
  description: string
  onChange: () => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-3 focus-within:ring-ring/40',
        checked ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/30'
      )}
    >
      <span className={cn('mt-0.5 text-muted-foreground', checked && 'text-primary')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function CategoryGroup({
  title,
  categories,
  selected,
  onToggle,
}: {
  title: string
  categories: readonly MaterialCategory[]
  selected: MaterialCategory[]
  onToggle: (category: MaterialCategory) => void
}) {
  const selectedCount = categories.filter((category) => selected.includes(category)).length

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge variant="secondary">{selectedCount}</Badge>
      </div>
      <div className="grid gap-1.5">
        {categories.map((category) => {
          const checked = selected.includes(category)
          return (
            <label
              key={category}
              htmlFor={`material-category-${category}`}
              className={cn(
                'flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/40',
                checked ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Checkbox
                id={`material-category-${category}`}
                checked={checked}
                onCheckedChange={() => onToggle(category)}
              />
              <span>{MATERIAL_CATEGORY_LABELS[category]}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
