'use client'

import { type FormEvent, type ReactNode, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleCheckBig,
  Loader2,
  PackageCheck,
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
  getSupplierPrimaryRole,
  getSupplierDirectoryHref,
  supplierMatchesDirectorySection,
  type SupplierDirectorySection,
  type SupplierPrimaryRole,
  validateSupplierRoleConfiguration,
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
  transport: 'Выберите основной тип «Перевозчик», чтобы компания появилась в этом разделе.',
  outsourcing: 'Выберите основной тип «Аутсорсинг», чтобы компания появилась в этом разделе.',
}

const PRIMARY_ROLE_OPTIONS: Array<{
  value: SupplierPrimaryRole
  title: string
  description: string
  icon: ReactNode
}> = [
  {
    value: 'supplier',
    title: 'Поставщик',
    description: 'Поставляет металл, расходники или оба направления.',
    icon: <PackageCheck className="h-5 w-5" aria-hidden="true" />,
  },
  {
    value: 'transport',
    title: 'Перевозчик',
    description: 'Только транспортные услуги, без поставки материалов.',
    icon: <Truck className="h-5 w-5" aria-hidden="true" />,
  },
  {
    value: 'outsourcing',
    title: 'Аутсорсинг',
    description: 'Только внешние производственные работы.',
    icon: <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />,
  },
]

function getInitialSupplierInput(
  supplier: SupplierWithRelations | undefined,
  directorySection: SupplierDirectorySection,
): SupplierInput {
  if (supplier) {
    return {
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      notes: supplier.notes || '',
      is_active: supplier.is_active,
      primary_role: getSupplierPrimaryRole(supplier),
      supplies_metal: supplier.categories.some((category) =>
        (METAL_SUPPLIER_CATEGORIES as readonly MaterialCategory[]).includes(category)
      ),
      supplies_consumables: supplier.categories.some((category) =>
        (CONSUMABLE_SUPPLIER_CATEGORIES as readonly MaterialCategory[]).includes(category)
      ),
      delivery_lead_days: supplier.delivery_lead_days || 0,
      categories: supplier.categories,
      deliveryDays: supplier.deliveryDays,
    }
  }

  const primaryRole: SupplierPrimaryRole = directorySection === 'transport'
    ? 'transport'
    : directorySection === 'outsourcing'
      ? 'outsourcing'
      : 'supplier'

  return {
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    notes: '',
    is_active: true,
    primary_role: primaryRole,
    supplies_metal: primaryRole === 'supplier' ? null : false,
    supplies_consumables: primaryRole === 'supplier' ? null : false,
    delivery_lead_days: 0,
    categories: [],
    deliveryDays: [],
  }
}

export function SupplierForm({ supplier, directorySection = 'all' }: SupplierFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<SupplierInput>(() =>
    getInitialSupplierInput(supplier, directorySection)
  )
  const [formError, setFormError] = useState<string | null>(null)
  const returnHref = getSupplierDirectoryHref(directorySection)
  const sectionContent = SUPPLIER_DIRECTORY_SECTIONS[directorySection]

  function selectPrimaryRole(primaryRole: SupplierPrimaryRole) {
    setFormError(null)
    setForm((current) => {
      if (current.primary_role === primaryRole) return current
      if (primaryRole !== 'supplier') {
        return {
          ...current,
          primary_role: primaryRole,
          supplies_metal: false,
          supplies_consumables: false,
          categories: [],
          delivery_lead_days: 0,
          deliveryDays: [],
        }
      }

      return {
        ...current,
        primary_role: primaryRole,
        supplies_metal: null,
        supplies_consumables: null,
        categories: [],
      }
    })
  }

  function setSupplyCapability(
    capability: 'supplies_metal' | 'supplies_consumables',
    value: boolean,
  ) {
    const categories: readonly MaterialCategory[] = capability === 'supplies_metal'
      ? METAL_SUPPLIER_CATEGORIES
      : CONSUMABLE_SUPPLIER_CATEGORIES

    setFormError(null)
    setForm((current) => ({
      ...current,
      [capability]: value,
      categories: value
        ? current.categories
        : current.categories.filter((category) => !categories.includes(category)),
    }))
  }

  function toggleCategory(category: MaterialCategory) {
    setFormError(null)
    setForm((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category],
    }))
  }

  function toggleDay(day: number) {
    setFormError(null)
    setForm((current) => ({
      ...current,
      deliveryDays: current.deliveryDays.includes(day)
        ? current.deliveryDays.filter((item) => item !== day)
        : [...current.deliveryDays, day].sort((a, b) => a - b),
    }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const roleConfiguration = validateSupplierRoleConfiguration(form)
    if (!roleConfiguration.success) {
      setFormError(roleConfiguration.error)
      toast.error(roleConfiguration.error)
      return
    }

    if (form.primary_role === 'supplier' && form.deliveryDays.length === 0) {
      const error = 'Выберите хотя бы один день отгрузки для поставщика.'
      setFormError(error)
      toast.error(error)
      return
    }

    if (
      !supplier
      && directorySection !== 'all'
      && !supplierMatchesDirectorySection(roleConfiguration.data, directorySection)
    ) {
      toast.error(SECTION_VALIDATION_MESSAGES[directorySection] || 'Укажите направление работы компании')
      return
    }

    startTransition(async () => {
      const result = supplier
        ? await updateSupplier(supplier.id, form)
        : await createSupplier(form)

      if (!result.success) {
        const error = result.error || 'Не удалось сохранить компанию'
        setFormError(error)
        toast.error(error)
        return
      }

      toast.success(supplier ? 'Данные компании обновлены' : 'Компания добавлена в базу')
      router.push(returnHref)
      router.refresh()
    })
  }

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
              Основной тип выбирается один. Поставщик может одновременно работать с металлом и расходниками.
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
          {formError && (
            <p
              id="supplier-form-error"
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {formError}
            </p>
          )}

          <fieldset
            className="rounded-2xl border border-border bg-card p-4 sm:p-5"
            aria-describedby="supplier-role-help"
          >
            <legend className="sr-only">Основной тип контрагента</legend>
            <SectionTitle
              icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
              title="Основной тип контрагента"
              description="Выберите только один тип. Поставщик, перевозчик и аутсорсинг не совмещаются."
            />

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {PRIMARY_ROLE_OPTIONS.map((option) => (
                <RoleOptionCard
                  key={option.value}
                  {...option}
                  checked={form.primary_role === option.value}
                  onChange={() => selectPrimaryRole(option.value)}
                />
              ))}
            </div>
            <p id="supplier-role-help" className="mt-3 text-xs leading-5 text-muted-foreground">
              Если выбрано «Поставщик», ниже нужно отдельно ответить про металл и расходники.
            </p>
          </fieldset>

          {form.primary_role === 'supplier' ? (
            <fieldset className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <legend className="sr-only">Направления поставки</legend>
              <SectionTitle
                icon={<Tags className="h-5 w-5" aria-hidden="true" />}
                title="Что поставляет компания"
                description="Для каждого направления обязательно выберите «Да» или «Нет». Можно включить оба."
              />

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <SupplierCapabilityPanel
                  id="supplier-metal-capability"
                  title="Поставляет металл?"
                  description="Доступен в заявках и заказах на металл."
                  value={form.supplies_metal}
                  categories={METAL_SUPPLIER_CATEGORIES}
                  categoryTitle="Категории металла"
                  selected={form.categories}
                  onDecision={(value) => setSupplyCapability('supplies_metal', value)}
                  onToggle={toggleCategory}
                />
                <SupplierCapabilityPanel
                  id="supplier-consumables-capability"
                  title="Поставляет расходники?"
                  description="Может закрывать позиции расходников, которые формирует производство."
                  value={form.supplies_consumables}
                  categories={CONSUMABLE_SUPPLIER_CATEGORIES}
                  categoryTitle="Категории расходников"
                  selected={form.categories}
                  onDecision={(value) => setSupplyCapability('supplies_consumables', value)}
                  onToggle={toggleCategory}
                />
              </div>
            </fieldset>
          ) : form.primary_role ? (
            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CircleCheckBig className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Материалы не назначаются
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {form.primary_role === 'transport'
                      ? 'Перевозчик будет отображаться только в разделе транспорта.'
                      : 'Аутсорсинговая компания будет отображаться только в разделе внешних работ.'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {form.primary_role === 'supplier' && (
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
                    Выберите хотя бы один регулярный день отгрузки.
                  </p>
                </div>
              </div>
            </fieldset>
          )}
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

function RoleOptionCard({
  value,
  checked,
  icon,
  title,
  description,
  onChange,
}: {
  value: SupplierPrimaryRole
  checked: boolean
  icon: ReactNode
  title: string
  description: string
  onChange: () => void
}) {
  const id = `supplier-primary-role-${value}`

  return (
    <label
      htmlFor={id}
      className={cn(
        'relative flex min-h-28 cursor-pointer flex-col rounded-xl border p-3 transition-colors focus-within:ring-3 focus-within:ring-ring/40',
        checked
          ? 'border-primary bg-primary/5'
          : 'border-border bg-background hover:border-primary/30'
      )}
    >
      <input
        id={id}
        type="radio"
        name="supplier-primary-role"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="flex items-start justify-between gap-3">
        <span className={cn('text-muted-foreground', checked && 'text-primary')}>{icon}</span>
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border',
            checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
          aria-hidden="true"
        >
          {checked && <CircleCheckBig className="h-3.5 w-3.5" />}
        </span>
      </span>
      <span className="mt-3 block text-sm font-semibold text-foreground">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
    </label>
  )
}

function SupplierCapabilityPanel({
  id,
  title,
  description,
  value,
  categories,
  categoryTitle,
  selected,
  onDecision,
  onToggle,
}: {
  id: string
  title: string
  description: string
  value: boolean | null
  categories: readonly MaterialCategory[]
  categoryTitle: string
  selected: MaterialCategory[]
  onDecision: (value: boolean) => void
  onToggle: (category: MaterialCategory) => void
}) {
  return (
    <fieldset
      className={cn(
        'rounded-xl border p-3',
        value === null ? 'border-amber-500/50 bg-amber-500/5' : 'border-border bg-background'
      )}
    >
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <DecisionOption
          id={`${id}-yes`}
          name={id}
          label="Да"
          checked={value === true}
          onChange={() => onDecision(true)}
        />
        <DecisionOption
          id={`${id}-no`}
          name={id}
          label="Нет"
          checked={value === false}
          onChange={() => onDecision(false)}
        />
      </div>

      {value === true ? (
        <div className="mt-3 border-t border-border pt-3">
          <CategoryGroup
            title={categoryTitle}
            categories={categories}
            selected={selected}
            onToggle={onToggle}
            nested
          />
        </div>
      ) : value === false ? (
        <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-xs leading-5 text-muted-foreground">
          Компания не будет отображаться в этом каталоге поставщиков.
        </p>
      ) : (
        <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          Выберите обязательный ответ «Да» или «Нет».
        </p>
      )}
    </fieldset>
  )
}

function DecisionOption({
  id,
  name,
  label,
  checked,
  onChange,
}: {
  id: string
  name: string
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors focus-within:ring-3 focus-within:ring-ring/40',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  )
}

function CategoryGroup({
  title,
  categories,
  selected,
  onToggle,
  nested = false,
}: {
  title: string
  categories: readonly MaterialCategory[]
  selected: MaterialCategory[]
  onToggle: (category: MaterialCategory) => void
  nested?: boolean
}) {
  const selectedCount = categories.filter((category) => selected.includes(category)).length

  return (
    <div className={cn(!nested && 'rounded-xl border border-border bg-background p-3')}>
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
