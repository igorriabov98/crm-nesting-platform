'use client'

import { useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { createSupplier, updateSupplier, type SupplierInput, type SupplierWithRelations } from '@/lib/actions/suppliers'
import { DELIVERY_DAYS, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, WEEKDAY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import type { MaterialCategory } from '@/lib/types'

type SupplierFormProps = {
  supplier?: SupplierWithRelations
}

export function SupplierForm({ supplier }: SupplierFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<SupplierInput>({
    name: supplier?.name || '',
    contact_person: supplier?.contact_person || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    notes: supplier?.notes || '',
    is_active: supplier?.is_active ?? true,
    delivery_lead_days: supplier?.delivery_lead_days || 0,
    categories: supplier?.categories || [],
    deliveryDays: supplier?.deliveryDays || [],
  })

  const toggleCategory = (category: MaterialCategory) => {
    setForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((item) => item !== category)
        : [...prev.categories, category],
    }))
  }

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      deliveryDays: prev.deliveryDays.includes(day)
        ? prev.deliveryDays.filter((item) => item !== day)
        : [...prev.deliveryDays, day].sort((a, b) => a - b),
    }))
  }

  const submit = () => {
    startTransition(async () => {
      const result = supplier
        ? await updateSupplier(supplier.id, form)
        : await createSupplier(form)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить поставщика')
        return
      }
      toast.success('Поставщик сохранён')
      router.push(ROUTES.ADMIN_SUPPLIERS)
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl rounded-xl border border-[#E8ECF0] bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название *">
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Контактное лицо">
          <Input value={form.contact_person || ''} onChange={(event) => setForm({ ...form, contact_person: event.target.value })} />
        </Field>
        <Field label="Телефон">
          <Input value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="Email">
          <Input value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="Срок доставки, дней">
          <Input
            type="number"
            min={0}
            value={form.delivery_lead_days || 0}
            onChange={(event) => setForm({ ...form, delivery_lead_days: Number(event.target.value || 0) })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Заметки">
            <Textarea value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-[#374151]">
        <Checkbox checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked === true })} />
        Активен
      </label>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Checklist title="Категории материала *">
          {MATERIAL_CATEGORIES.map((category) => (
            <CheckRow
              key={category}
              checked={form.categories.includes(category)}
              label={MATERIAL_CATEGORY_LABELS[category]}
              onChange={() => toggleCategory(category)}
            />
          ))}
        </Checklist>
        <Checklist title="Дни отгрузки *">
          {DELIVERY_DAYS.map((day) => (
            <CheckRow
              key={day}
              checked={form.deliveryDays.includes(day)}
              label={WEEKDAY_LABELS[day]}
              onChange={() => toggleDay(day)}
            />
          ))}
        </Checklist>
      </div>

      <div className="mt-6 flex gap-3">
        <Button onClick={submit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
        <Button variant="outline" onClick={() => router.push(ROUTES.ADMIN_SUPPLIERS)} disabled={isPending}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2 text-sm font-medium text-[#374151]">
      {label}
      {children}
    </Label>
  )
}

function Checklist({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-[#1B3A6B]">{title}</h2>
      <div className="grid gap-2 rounded-lg border border-[#E8ECF0] p-3">{children}</div>
    </div>
  )
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[#374151]">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  )
}
