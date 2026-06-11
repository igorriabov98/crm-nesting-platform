'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createSheet, updateSheet, type SheetCatalogItem } from '@/lib/nesting/catalog-api'
import {
  MATERIAL_OPTIONS,
  getErrorMessage,
  parseOptionalNonNegative,
  parseRequiredPositive,
  parseStock,
} from '@/components/features/nesting/catalog/shared'

type SheetFormState = {
  material: string
  thickness: string
  width: string
  height: string
  price: string
  stock: string
}

const emptyForm: SheetFormState = {
  material: 'Сталь',
  thickness: '',
  width: '',
  height: '',
  price: '',
  stock: '0',
}

function formFromItem(item?: SheetCatalogItem): SheetFormState {
  if (!item) return emptyForm
  return {
    material: item.material,
    thickness: String(item.thickness),
    width: String(item.width),
    height: String(item.height),
    price: item.price === null ? '' : String(item.price),
    stock: String(item.stock),
  }
}

export function SheetDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: SheetCatalogItem
  onSaved: () => void
}) {
  const [form, setForm] = useState<SheetFormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const isEdit = Boolean(item)

  useEffect(() => {
    if (open) setForm(formFromItem(item))
  }, [item, open])

  function setField(field: keyof SheetFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const payload = {
        material: form.material,
        thickness: parseRequiredPositive(form.thickness, 'Толщина'),
        width: parseRequiredPositive(form.width, 'Ширина'),
        height: parseRequiredPositive(form.height, 'Высота'),
        price: parseOptionalNonNegative(form.price, 'Цена за лист'),
        stock: parseStock(form.stock || '0'),
      }

      if (item) {
        await updateSheet(item.id, payload)
        toast.success('Лист сохранён')
      } else {
        await createSheet({
          ...payload,
          price: payload.price ?? undefined,
        })
        toast.success('Лист добавлен')
      }

      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось сохранить лист'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать лист' : 'Добавить лист'}</DialogTitle>
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
            <Label htmlFor="sheet-thickness">Толщина, мм *</Label>
            <Input id="sheet-thickness" type="number" min={0.01} step="any" value={form.thickness} onChange={(event) => setField('thickness', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-stock">Кол-во на складе</Label>
            <Input id="sheet-stock" type="number" min={0} step={1} value={form.stock} onChange={(event) => setField('stock', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-width">Ширина, мм *</Label>
            <Input id="sheet-width" type="number" min={1} step="any" value={form.width} onChange={(event) => setField('width', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-height">Высота, мм *</Label>
            <Input id="sheet-height" type="number" min={1} step="any" value={form.height} onChange={(event) => setField('height', event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sheet-price">Цена за лист, ₴</Label>
            <Input id="sheet-price" type="number" min={0} step="any" value={form.price} onChange={(event) => setField('price', event.target.value)} placeholder="Необязательно" />
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
