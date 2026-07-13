'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Barcode, Edit3, Euro, FileText, Languages, Package2, Save, Weight, X } from 'lucide-react'
import { toast } from 'sonner'
import { createProduct, updateProduct } from '@/lib/actions/products'
import { completeCurrentVersionFiles } from '@/lib/actions/product-versions'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cleanupDirectProductUploads, uploadProductFileDirect } from '@/lib/products/direct-product-upload-client'
import type { DirectProductUpload } from '@/lib/products/product-file-upload'
import { usePermissions } from '@/components/providers/PermissionProvider'
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

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 break-words text-sm font-medium text-slate-900">{value || '—'}</div>
    </div>
  )
}

export function ProductForm({ product }: { product?: Product | null }) {
  const router = useRouter()
  const { can } = usePermissions()
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<ProductFormState>(() => initialState(product))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditing, setIsEditing] = useState(!product)
  const isEdit = Boolean(product?.id)
  const canManage = can('products', 'manage')

  function setField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function cancelEditing() {
    if (!isEdit) {
      router.push(ROUTES.PRODUCTS)
      return
    }
    setValues(initialState(product))
    setIsEditing(false)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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

      if (isEdit && product) {
        const result = await updateProduct(product.id, payload)
        if (!result.success) throw new Error(result.error || 'Не удалось сохранить изделие')
        toast.success('Карточка изделия обновлена')
        setIsEditing(false)
        router.refresh()
        return
      }

      const result = await createProduct(payload)
      if (!result.success || !result.product?.id) throw new Error(result.error || 'Не удалось создать изделие')

      const pdfFile = pdfInputRef.current?.files?.[0]
      if (pdfFile) {
        const uploadedFiles: DirectProductUpload[] = []
        try {
          uploadedFiles.push(await uploadProductFileDirect(result.product.id, 'drawing', pdfFile))
          const fileResult = await completeCurrentVersionFiles(result.product.id, {
            drawingNumber: payload.drawing_number,
            files: uploadedFiles,
          })
          if (!fileResult.success) throw new Error(fileResult.error || 'PDF не сохранён')
        } catch (uploadError) {
          await cleanupDirectProductUploads(result.product.id, uploadedFiles)
          toast.error(`Изделие создано, но PDF не загружен: ${errorMessage(uploadError)}`)
        }
      }

      toast.success('Изделие создано')
      router.push(`${ROUTES.PRODUCTS}/${result.product.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isEdit && !isEditing) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Package2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Карточка изделия</h2>
              <p className="mt-1 text-sm text-slate-500">Основные данные для продаж и производства.</p>
            </div>
          </div>
          {canManage && (
            <Button type="button" variant="outline" onClick={() => setIsEditing(true)} className="min-h-10 shrink-0">
              <Edit3 className="h-4 w-4" />
              <span className="hidden sm:inline">Редактировать</span>
            </Button>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailItem icon={<Languages className="h-4 w-4" />} label="Название на укр" value={product?.name_uk} />
          <DetailItem icon={<Languages className="h-4 w-4" />} label="Название на англ" value={product?.name_en} />
          <DetailItem icon={<Barcode className="h-4 w-4" />} label="УКТЗЕД" value={product?.uktzed} />
          <DetailItem icon={<FileText className="h-4 w-4" />} label="Чертёж" value={product?.drawing_number} />
          <DetailItem icon={<Weight className="h-4 w-4" />} label="Вес" value={`${product?.unit_weight_kg || 0} кг`} />
          <DetailItem icon={<Euro className="h-4 w-4" />} label="Базовая цена" value={`${product?.base_price_eur || 0} EUR`} />
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Описание</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{product?.characteristics || 'Описание пока не добавлено.'}</p>
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-700 text-white">
          <Edit3 className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{isEdit ? 'Редактирование карточки' : 'Новое изделие'}</h2>
          <p className="mt-1 text-sm text-slate-500">Поля со звёздочкой обязательны.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name_uk">Название на укр *</Label>
          <Input id="name_uk" value={values.name_uk} onChange={(event) => setField('name_uk', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name_en">Название на англ *</Label>
          <Input id="name_en" value={values.name_en} onChange={(event) => setField('name_en', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uktzed">УКТЗЕД *</Label>
          <Input id="uktzed" value={values.uktzed} onChange={(event) => setField('uktzed', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drawing_number">Номер чертежа *</Label>
          <Input id="drawing_number" value={values.drawing_number} onChange={(event) => setField('drawing_number', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unit_weight_kg">Вес единицы, кг *</Label>
          <Input id="unit_weight_kg" type="number" min="0" step="0.001" value={values.unit_weight_kg} onChange={(event) => setField('unit_weight_kg', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="base_price_eur">Базовая цена, EUR *</Label>
          <Input id="base_price_eur" type="number" min="0" step="0.01" value={values.base_price_eur} onChange={(event) => setField('base_price_eur', event.target.value)} required className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="product-status">Статус</Label>
          <Select value={values.status} onValueChange={(value) => setField('status', (value || 'draft') as ProductInput['status'])}>
            <SelectTrigger id="product-status" className="min-h-11">
              <SelectValue>{productStatusLabels[values.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(productStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="pdf_file">PDF-чертёж <span className="font-normal text-slate-500">(необязательно)</span></Label>
            <Input id="pdf_file" ref={pdfInputRef} type="file" accept=".pdf,application/pdf" disabled={isSubmitting} className="min-h-11 cursor-pointer file:cursor-pointer" />
            <p className="text-xs text-slate-500">STEP можно добавить позже в карточке изделия.</p>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="characteristics">Описание изделия</Label>
        <Textarea id="characteristics" rows={5} value={values.characteristics} onChange={(event) => setField('characteristics', event.target.value)} className="min-h-28" />
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={cancelEditing} disabled={isSubmitting} className="min-h-11">
          <X className="h-4 w-4" />
          Отмена
        </Button>
        <LoadingButton type="submit" loading={isSubmitting} loadingText="Сохранение…" className="min-h-11 bg-blue-700 text-white hover:bg-blue-800">
          <Save className="h-4 w-4" />
          {isEdit ? 'Сохранить изменения' : 'Создать изделие'}
        </LoadingButton>
      </div>
    </form>
  )
}
