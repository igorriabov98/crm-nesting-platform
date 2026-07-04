"use client"

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Download, Trash2, Upload } from 'lucide-react'
import { deleteProductFile, uploadProductFile } from '@/lib/actions/products'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProductFile } from '@/lib/types'

const fileKindLabels: Record<ProductFile['file_kind'], string> = {
  drawing: 'Чертеж',
  step: 'STEP',
  pdf: 'PDF',
  photo: 'Фото',
  other: 'Другое',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function ProductFileManager({ productId, files }: { productId: string; files: ProductFile[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileKind, setFileKind] = useState<ProductFile['file_kind']>('drawing')
  const [isUploading, setIsUploading] = useState(false)
  const duplicateKindFiles = fileKind === 'step' || fileKind === 'pdf'
    ? files.filter((file) => file.file_kind === fileKind)
    : []

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Выберите файл')
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('product_id', productId)
      formData.append('file_kind', fileKind)
      formData.append('file', file)
      const result = await uploadProductFile(formData)
      if (!result.success) throw new Error(result.error || 'Не удалось загрузить файл')
      toast.success('Файл загружен')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsUploading(false)
    }
  }

  async function onDelete(file: ProductFile) {
    const result = await deleteProductFile(file.id, productId)
    if (!result.success) {
      toast.error(result.error || 'Не удалось удалить файл')
      return
    }
    toast.success('Файл удален')
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Файлы продукта</h2>
        <p className="text-sm text-[#6B7280]">Чертежи, STEP и дополнительные материалы карточки продукта.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
        <Select value={fileKind} onValueChange={(value) => setFileKind((value || 'other') as ProductFile['file_kind'])}>
          <SelectTrigger>
            <SelectValue>{fileKindLabels[fileKind]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(fileKindLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input ref={fileInputRef} type="file" />
        <Button type="submit" disabled={isUploading} className="bg-[#1B3A6B] text-white hover:bg-[#152D54]">
          <Upload className="mr-2 h-4 w-4" />
          Загрузить
        </Button>
      </form>
      {duplicateKindFiles.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {fileKindLabels[fileKind]} уже есть: {duplicateKindFiles.map((file) => file.file_name).join(', ')}.
            Новая загрузка добавит ещё один файл этого типа.
          </p>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-[#E8ECF0]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F8F9FA] text-[#6B7280]">
            <tr>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3">Файл</th>
              <th className="px-4 py-3">Размер</th>
              <th className="px-4 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8ECF0]">
            {files.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[#9CA3AF]">Файлов пока нет.</td>
              </tr>
            ) : files.map((file) => (
              <tr key={file.id}>
                <td className="px-4 py-3">{fileKindLabels[file.file_kind]}</td>
                <td className="px-4 py-3 font-medium text-[#1B3A6B]">{file.file_name}</td>
                <td className="px-4 py-3 text-[#6B7280]">{file.file_size ? `${Math.round(file.file_size / 1024)} KB` : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <a href={`/api/products/files/${file.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      <Download className="mr-1 h-4 w-4" />
                      Открыть
                    </a>
                    <Button type="button" variant="ghost" size="icon" onClick={() => void onDelete(file)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
