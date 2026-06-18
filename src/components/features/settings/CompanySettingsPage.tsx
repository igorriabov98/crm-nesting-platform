"use client"

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, ImageIcon, Upload } from 'lucide-react'
import { useForm, type FieldPath, type Resolver, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { updateCompanySettings, uploadCompanyImage } from '@/lib/actions/company-settings'
import { companySettingsSchema, type UpdateCompanySettingsData } from '@/lib/types/schemas'
import type { CompanySettings } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { LoadingButton } from '@/components/ui/loading-button'
import { Textarea } from '@/components/ui/textarea'

type ImageType = 'signature' | 'stamp'

type CompanySettingsPageProps = {
  settings: CompanySettings
  imageUrls: {
    signature: string | null
    stamp: string | null
  }
}

function defaultValues(settings: CompanySettings): UpdateCompanySettingsData {
  return {
    name_en: settings.name_en || '',
    name_ua: settings.name_ua || '',
    address_en: settings.address_en || '',
    director_name_en: settings.director_name_en || '',
    director_name_ua: settings.director_name_ua || '',
    enterprise_code: settings.enterprise_code || '',
    iban: settings.iban || '',
    swift: settings.swift || '',
    bank_name: settings.bank_name || '',
    bank_address: settings.bank_address || '',
    delivery_basis_en: settings.delivery_basis_en || 'Delivery Basis: DAP',
    delivery_basis_ua: settings.delivery_basis_ua || 'Базис постачання: DAP',
    intermediary_bank_name: settings.intermediary_bank_name || '',
    intermediary_bank_swift: settings.intermediary_bank_swift || '',
    signature_image_path: settings.signature_image_path,
    stamp_image_path: settings.stamp_image_path,
  }
}

function isPngOrJpg(file: File) {
  const name = file.name.toLowerCase()
  return file.type === 'image/png'
    || file.type === 'image/jpeg'
    || /\.(png|jpe?g)$/.test(name)
}

export function CompanySettingsPage({ settings, imageUrls }: CompanySettingsPageProps) {
  const router = useRouter()
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadingType, setUploadingType] = useState<ImageType | null>(null)
  const [localPreviews, setLocalPreviews] = useState<Record<ImageType, string | null>>({
    signature: null,
    stamp: null,
  })

  const form = useForm<UpdateCompanySettingsData>({
    resolver: zodResolver(companySettingsSchema) as Resolver<UpdateCompanySettingsData>,
    defaultValues: defaultValues(settings),
  })

  useEffect(() => {
    return () => {
      Object.values(localPreviews).forEach((url) => {
        if (url) URL.revokeObjectURL(url)
      })
    }
  }, [localPreviews])

  async function onSubmit(values: UpdateCompanySettingsData) {
    setIsSubmitting(true)
    try {
      const result = await updateCompanySettings(values)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить настройки компании')
      toast.success('Настройки компании сохранены')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function uploadImage(type: ImageType, file: File) {
    if (!isPngOrJpg(file)) {
      toast.error('Загрузите изображение в формате PNG или JPG')
      return
    }

    const localPreview = URL.createObjectURL(file)
    setLocalPreviews((current) => {
      if (current[type]) URL.revokeObjectURL(current[type])
      return { ...current, [type]: localPreview }
    })
    setUploadingType(type)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const result = await uploadCompanyImage(formData, type)
      if (!result.success) throw new Error(result.error || 'Не удалось загрузить изображение')
      toast.success(type === 'signature' ? 'Подпись загружена' : 'Печать загружена')
      router.refresh()
    } catch (error) {
      setLocalPreviews((current) => {
        if (current[type]) URL.revokeObjectURL(current[type])
        return { ...current, [type]: null }
      })
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setUploadingType(null)
    }
  }

  function onFileChange(type: ImageType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void uploadImage(type, file)
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1B3A6B]/10 text-[#1B3A6B]">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Настройки компании</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Реквизиты для Specification, Invoice и Packing List.
            </p>
          </div>
        </div>
      </section>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-[#1B3A6B]">Основная информация</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField form={form} name="name_en" label="Название компании EN" />
                <TextField form={form} name="name_ua" label="Назва компанії UA" />
                <TextareaField form={form} name="address_en" label="Адрес EN" />
                <TextField form={form} name="director_name_en" label="Директор EN" />
                <TextField form={form} name="director_name_ua" label="Директор UA" />
                <TextField form={form} name="enterprise_code" label="Код підприємства" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-[#1B3A6B]">Банковские реквизиты</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField form={form} name="iban" label="IBAN" />
                <TextField form={form} name="swift" label="SWIFT код" />
                <TextField form={form} name="bank_name" label="Название банка" />
                <TextField form={form} name="bank_address" label="Адрес банка" />
                <TextField form={form} name="intermediary_bank_name" label="Банк-корреспондент" />
                <TextField form={form} name="intermediary_bank_swift" label="SWIFT банка-корреспондента" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-[#1B3A6B]">Инвойс</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField form={form} name="delivery_basis_en" label="Delivery Basis EN" />
                <TextField form={form} name="delivery_basis_ua" label="Базис постачання UA" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-[#1B3A6B]">Подпись и печать</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-2">
                <ImageUploadBlock
                  title="Подпись директора"
                  buttonLabel="Загрузить подпись"
                  previewUrl={localPreviews.signature || imageUrls.signature}
                  isUploading={uploadingType === 'signature'}
                  inputRef={signatureInputRef}
                  onPick={() => signatureInputRef.current?.click()}
                  onFileChange={(event) => onFileChange('signature', event)}
                />
                <ImageUploadBlock
                  title="Печать компании"
                  buttonLabel="Загрузить печать"
                  previewUrl={localPreviews.stamp || imageUrls.stamp}
                  isUploading={uploadingType === 'stamp'}
                  inputRef={stampInputRef}
                  onPick={() => stampInputRef.current?.click()}
                  onFileChange={(event) => onFileChange('stamp', event)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <LoadingButton type="submit" loading={isSubmitting}>
              Сохранить настройки
            </LoadingButton>
          </div>
        </form>
      </Form>
    </div>
  )
}

function TextField({
  form,
  name,
  label,
}: {
  form: UseFormReturn<UpdateCompanySettingsData>
  name: FieldPath<UpdateCompanySettingsData>
  label: string
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Input {...field} value={(field.value as string | null | undefined) || ''} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )} />
  )
}

function TextareaField({
  form,
  name,
  label,
}: {
  form: UseFormReturn<UpdateCompanySettingsData>
  name: FieldPath<UpdateCompanySettingsData>
  label: string
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Textarea {...field} value={(field.value as string | null | undefined) || ''} rows={3} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )} />
  )
}

function ImageUploadBlock({
  title,
  buttonLabel,
  previewUrl,
  isUploading,
  inputRef,
  onPick,
  onFileChange,
}: {
  title: string
  buttonLabel: string
  previewUrl: string | null
  isUploading: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onPick: () => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
      <div className="text-sm font-semibold text-[#1B3A6B]">{title}</div>
      <div className="mt-3 flex h-44 items-center justify-center rounded-lg border border-dashed border-[#D1D5DB] bg-white p-3">
        {previewUrl ? (
          <img src={previewUrl} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[#9CA3AF]">
            <ImageIcon className="h-8 w-8" />
            <span className="text-sm">Файл не загружен</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className="hidden"
        onChange={onFileChange}
      />
      <Button type="button" variant="outline" className="mt-3" disabled={isUploading} onClick={onPick}>
        <Upload className="mr-2 h-4 w-4" />
        {isUploading ? 'Загрузка...' : buttonLabel}
      </Button>
    </div>
  )
}
