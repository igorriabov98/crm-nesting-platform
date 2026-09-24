'use client'

import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { createProduct } from '@/lib/actions/products'
import { productSchema } from '@/lib/types/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { LoadingButton } from '@/components/ui/loading-button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Draft = {
  name_uk: string
  name_en: string
  uktzed: string
  drawing_number: string
  unit_weight_kg: string
  requires_vrb_mesh: boolean
}

const emptyDraft: Draft = {
  name_uk: '', name_en: '', uktzed: '', drawing_number: '',
  unit_weight_kg: '', requires_vrb_mesh: false,
}

export function QuickProductCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (productId: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)

  function update(key: keyof Draft, value: string | boolean) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function changeOpen(nextOpen: boolean) {
    if (isSubmitting) return
    if (!nextOpen) {
      setDraft(emptyDraft)
      setCreatedProductId(null)
    }
    onOpenChange(nextOpen)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      let productId = createdProductId
      if (!productId) {
        const parsed = productSchema.safeParse({
          ...draft,
          name_uk: draft.name_uk.trim(),
          name_en: draft.name_en.trim(),
          uktzed: draft.uktzed.trim(),
          drawing_number: draft.drawing_number.trim(),
          unit_weight_kg: draft.unit_weight_kg === '' ? undefined : Number(draft.unit_weight_kg),
          characteristics: '',
          base_price_eur: 0,
          status: 'active',
        })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Проверьте поля продукта')
        const result = await createProduct(parsed.data)
        if (!result.success || !result.product) throw new Error(result.error || 'Не удалось создать продукт')
        productId = result.product.id
        setCreatedProductId(productId)
      }
      await onCreated(productId)
      toast.success('Продукт создан и выбран')
      setDraft(emptyDraft)
      setCreatedProductId(null)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать продукт')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Добавить продукт</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {([
            ['name_uk', 'Название на украинском'],
            ['name_en', 'Название на английском'],
            ['uktzed', 'Код УКТЗЕД'],
            ['drawing_number', 'Номер чертежа'],
          ] as const).map(([key, label]) => (
            <label key={key} className="block space-y-1 text-sm font-medium text-[#1B3A6B]">
              <span>{label} *</span>
              <Input required value={draft[key]} onChange={(event) => update(key, event.target.value)} disabled={isSubmitting || Boolean(createdProductId)} />
            </label>
          ))}
          <label className="block space-y-1 text-sm font-medium text-[#1B3A6B]">
            <span>Вес изделия, кг *</span>
            <Input required type="number" min="0.001" step="any" value={draft.unit_weight_kg} onChange={(event) => update('unit_weight_kg', event.target.value)} disabled={isSubmitting || Boolean(createdProductId)} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-[#1B3A6B]">
            <span>Нужна сетка VRB</span>
            <Switch checked={draft.requires_vrb_mesh} onCheckedChange={(checked) => update('requires_vrb_mesh', checked)} disabled={isSubmitting || Boolean(createdProductId)} />
          </label>
          {createdProductId && <p className="text-sm text-amber-700">Продукт сохранён. Повторите обновление списка, чтобы выбрать его.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={isSubmitting}>Отмена</Button>
            <LoadingButton type="submit" loading={isSubmitting}>{createdProductId ? 'Обновить список' : 'Создать продукт'}</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
