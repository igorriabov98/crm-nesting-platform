'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  MATERIAL_OPTIONS,
  getErrorMessage,
  parseRequiredNonNegative,
  parseRequiredPositive,
} from '@/components/features/nesting/catalog/shared'

type RangeRuleItem = {
  id: string
  material: string
  thicknessMin: number
  thicknessMax: number
}

type FormState = {
  material: string
  thicknessMin: string
  thicknessMax: string
  value: string
}

const emptyForm: FormState = {
  material: 'Сталь',
  thicknessMin: '',
  thicknessMax: '',
  value: '',
}

export function RangeRuleDialog<TItem extends RangeRuleItem>({
  open,
  onOpenChange,
  item,
  title,
  valueLabel,
  value,
  validateValue,
  create,
  update,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: TItem
  title: { create: string; edit: string }
  valueLabel: string
  value: {
    get: (item: TItem) => number
    field: string
    successCreate: string
    successUpdate: string
  }
  validateValue: (value: number) => void
  create: (data: Record<string, string | number>) => Promise<unknown>
  update: (id: string, data: Record<string, string | number>) => Promise<void>
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const isEdit = Boolean(item)

  useEffect(() => {
    if (!open) return
    setForm(item ? {
      material: item.material,
      thicknessMin: String(item.thicknessMin),
      thicknessMax: String(item.thicknessMax),
      value: String(value.get(item)),
    } : emptyForm)
  }, [item, open, value])

  function setField(field: keyof FormState, nextValue: string) {
    setForm((current) => ({ ...current, [field]: nextValue }))
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const thicknessMin = parseRequiredNonNegative(form.thicknessMin, 'Толщина от')
      const thicknessMax = parseRequiredNonNegative(form.thicknessMax, 'Толщина до')
      const ruleValue = parseRequiredPositive(form.value, valueLabel)

      if (thicknessMin > thicknessMax) {
        throw new Error('Толщина от должна быть меньше или равна толщине до')
      }
      validateValue(ruleValue)

      const payload = {
        material: form.material,
        thicknessMin,
        thicknessMax,
        [value.field]: ruleValue,
      }

      if (item) {
        await update(item.id, payload)
        toast.success(value.successUpdate)
      } else {
        await create(payload)
        toast.success(value.successCreate)
      }

      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось сохранить правило'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? title.edit : title.create}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Материал *</Label>
            <Select value={form.material} onValueChange={(nextValue) => nextValue && setField('material', nextValue)}>
              <SelectTrigger className="w-full">
                <SelectValue>{form.material}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_OPTIONS.map((material) => (
                  <SelectItem key={material} value={material}>{material}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="range-min">Толщина от, мм *</Label>
            <Input id="range-min" type="number" min={0} step="any" value={form.thicknessMin} onChange={(event) => setField('thicknessMin', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="range-max">Толщина до, мм *</Label>
            <Input id="range-max" type="number" min={0} step="any" value={form.thicknessMax} onChange={(event) => setField('thicknessMax', event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="range-value">{valueLabel} *</Label>
            <Input id="range-value" type="number" min={0.01} step="any" value={form.value} onChange={(event) => setField('value', event.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
