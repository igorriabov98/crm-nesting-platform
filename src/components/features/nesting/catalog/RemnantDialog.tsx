'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createRemnant } from '@/lib/nesting/catalog-api'
import {
  MATERIAL_OPTIONS,
  getErrorMessage,
  parseRequiredPositive,
} from '@/components/features/nesting/catalog/shared'

type FormState = {
  material: string
  thickness: string
  width: string
  height: string
  sourceOrder: string
}

const emptyForm: FormState = {
  material: 'Сталь',
  thickness: '',
  width: '',
  height: '',
  sourceOrder: '',
}

export function RemnantDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setForm(emptyForm)
  }, [open])

  function setField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      await createRemnant({
        material: form.material,
        thickness: parseRequiredPositive(form.thickness, 'Толщина'),
        width: parseRequiredPositive(form.width, 'Ширина'),
        height: parseRequiredPositive(form.height, 'Высота'),
        sourceOrder: form.sourceOrder.trim() || undefined,
      })

      toast.success('Остаток добавлен')
      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось добавить остаток'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить остаток вручную</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Материал *</Label>
            <Select value={form.material} onValueChange={(value) => value && setField('material', value)}>
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
            <Label htmlFor="remnant-thickness">Толщина, мм *</Label>
            <Input id="remnant-thickness" type="number" min={0.01} step="any" value={form.thickness} onChange={(event) => setField('thickness', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remnant-width">Ширина, мм *</Label>
            <Input id="remnant-width" type="number" min={1} step="any" value={form.width} onChange={(event) => setField('width', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remnant-height">Высота, мм *</Label>
            <Input id="remnant-height" type="number" min={1} step="any" value={form.height} onChange={(event) => setField('height', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remnant-source">Источник (заказ)</Label>
            <Input id="remnant-source" value={form.sourceOrder} onChange={(event) => setField('sourceOrder', event.target.value)} placeholder="Необязательно" />
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
