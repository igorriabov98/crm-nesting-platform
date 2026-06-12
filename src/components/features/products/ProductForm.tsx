"use client"

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createProductWithFiles, updateProduct } from '@/lib/actions/products'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Product } from '@/lib/types'
import type { ProductInput } from '@/lib/types/schemas'

type ProductFormState = {
  name_uk: string
  name_en: string
  uktzed: string
  drawing_number: string
  characteristics: string
  unit_weight_kg: string
  base_price_eur: string
  status: ProductInput['status']
}

function initialState(product?: Product | null): ProductFormState {
  return {
    name_uk: product?.name_uk || '',
    name_en: product?.name_en || '',
    uktzed: product?.uktzed || '',
    drawing_number: product?.drawing_number || '',
    characteristics: product?.characteristics || '',
    unit_weight_kg: product ? String(product.unit_weight_kg) : '',
    base_price_eur: product ? String(product.base_price_eur) : '0',
    status: product?.status || 'draft',
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

const productStatusLabels: Record<ProductInput['status'], string> = {
  draft: 'Черновик',
  active: 'Активен',
  archived: 'Архив',
}

export function ProductForm({ product }: { product?: Product | null }) {
  const router = useRouter()
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<ProductFormState>(() => initialState(product))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEdit = Boolean(product?.id)

  function setField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const payload: ProductInput = {
        name_uk: values.name_uk,
        name_en: values.name_en,
        uktzed: values.uktzed,
        drawing_number: values.drawing_number,
        characteristics: values.characteristics,
        unit_weight_kg: Number(values.unit_weight_kg),
        base_price_eur: Number(values.base_price_eur || 0),
        status: values.status,
      }
      const result = isEdit && product
        ? await updateProduct(product.id, payload)
        : await createProductWithFiles(buildCreateFormData(payload))

      if (!result.success) throw new Error(result.error || 'Не удалось сохранить продукт')
      toast.success(isEdit ? 'Продукт обновлен' : 'Продукт создан')
      const createdProduct = 'product' in result ? result.product as { id?: string } | null : null
      if (!isEdit && createdProduct?.id) {
        router.push(`${ROUTES.PRODUCTS}/${createdProduct.id}`)
      } else {
        router.refresh()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  function buildCreateFormData(payload: ProductInput) {
    const formData = new FormData()
    formData.append('name_uk', payload.name_uk)
    formData.append('name_en', payload.name_en)
    formData.append('uktzed', payload.uktzed)
    formData.append('drawing_number', payload.drawing_number)
    formData.append('characteristics', payload.characteristics || '')
    formData.append('unit_weight_kg', String(payload.unit_weight_kg))
    formData.append('base_price_eur', String(payload.base_price_eur))
    formData.append('status', payload.status)

    const pdfFile = pdfInputRef.current?.files?.[0]
    if (pdfFile) formData.append('pdf_file', pdfFile)
    return formData
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name_uk">Название на укр *</Label>
          <Input id="name_uk" value={values.name_uk} onChange={(event) => setField('name_uk', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name_en">Название на англ *</Label>
          <Input id="name_en" value={values.name_en} onChange={(event) => setField('name_en', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="uktzed">УКТЗЕД *</Label>
          <Input id="uktzed" value={values.uktzed} onChange={(event) => setField('uktzed', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="drawing_number">Номер чертежа *</Label>
          <Input id="drawing_number" value={values.drawing_number} onChange={(event) => setField('drawing_number', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit_weight_kg">Вес единицы, кг *</Label>
          <Input id="unit_weight_kg" type="number" min="0" step="0.001" value={values.unit_weight_kg} onChange={(event) => setField('unit_weight_kg', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="base_price_eur">Базовая цена, EUR *</Label>
          <Input id="base_price_eur" type="number" min="0" step="0.01" value={values.base_price_eur} onChange={(event) => setField('base_price_eur', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Статус</Label>
          <Select value={values.status} onValueChange={(value) => setField('status', (value || 'draft') as ProductInput['status'])}>
            <SelectTrigger>
              <SelectValue>{productStatusLabels[values.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(productStatusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!isEdit && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pdf_file">PDF файл</Label>
            <Input id="pdf_file" ref={pdfInputRef} type="file" accept=".pdf,application/pdf" disabled={isSubmitting} />
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="characteristics">Описание продукта</Label>
        <Textarea id="characteristics" rows={5} value={values.characteristics} onChange={(event) => setField('characteristics', event.target.value)} />
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.PRODUCTS)} disabled={isSubmitting}>
          Отмена
        </Button>
        <LoadingButton type="submit" loading={isSubmitting} className="bg-[#1B3A6B] text-white hover:bg-[#152D54]">
          {isEdit ? 'Сохранить' : 'Создать'}
        </LoadingButton>
      </div>
    </form>
  )
}
