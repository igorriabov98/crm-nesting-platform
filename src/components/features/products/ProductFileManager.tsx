'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileArchive, FilePlus2, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteProductFile, registerProductFileUpload } from '@/lib/actions/products'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  cleanupDirectProductUploads,
  uploadProductFileDirect,
} from '@/lib/products/direct-product-upload-client'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/components/providers/PermissionProvider'
import type { ProductFile } from '@/lib/types'

const fileKindLabels: Record<ProductFile['file_kind'], string> = {
  drawing: 'Дополнительный чертёж',
  step: 'Дополнительная STEP-модель',
  pdf: 'PDF-документ',
  photo: 'Фото',
  other: 'Другой файл',
}

const fileKindAccept: Partial<Record<ProductFile['file_kind'], string>> = {
  drawing: '.pdf,.dxf,.dwg',
  step: '.step,.stp',
  pdf: '.pdf,application/pdf',
  photo: 'image/png,image/jpeg,image/webp,image/gif,.heic,.heif',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

export function ProductFileManager({ productId, files }: { productId: string; files: ProductFile[] }) {
  const router = useRouter()
  const { can } = usePermissions()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileKind, setFileKind] = useState<ProductFile['file_kind']>('other')
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const canManage = can('products', 'manage')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      toast.error('Выберите файл')
      return
    }

    setIsUploading(true)
    let uploaded = null
    try {
      uploaded = await uploadProductFileDirect(productId, fileKind, file)
      const result = await registerProductFileUpload(productId, uploaded)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить файл')
      toast.success('Дополнительный файл загружен')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (error) {
      if (uploaded) await cleanupDirectProductUploads(productId, [uploaded])
      toast.error(errorMessage(error))
    } finally {
      setIsUploading(false)
    }
  }

  async function onDelete(productFile: ProductFile) {
    setDeletingId(productFile.id)
    try {
      const result = await deleteProductFile(productFile.id, productId)
      if (!result.success) throw new Error(result.error || 'Не удалось удалить файл')
      toast.success('Файл удалён')
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
          <FileArchive className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Дополнительные материалы</h2>
          <p className="mt-1 text-sm text-slate-500">Фото, инструкции и прочие файлы. Основные PDF и STEP находятся в текущей версии выше.</p>
        </div>
      </div>

      {canManage && (
        <form onSubmit={onSubmit} className="mt-5 grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="supplementary-file-kind">Тип материала</Label>
            <Select value={fileKind} onValueChange={(value) => setFileKind((value || 'other') as ProductFile['file_kind'])}>
              <SelectTrigger id="supplementary-file-kind" className="min-h-11 border-slate-200 bg-white">
                <SelectValue>{fileKindLabels[fileKind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(fileKindLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplementary-product-file">Файл до 50 МБ</Label>
            <Input
              key={fileKind}
              ref={fileInputRef}
              id="supplementary-product-file"
              type="file"
              accept={fileKindAccept[fileKind]}
              disabled={isUploading}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="min-h-11 cursor-pointer border-slate-200 bg-white file:cursor-pointer"
            />
          </div>
          <Button type="submit" disabled={isUploading} className="min-h-11 bg-slate-900 text-white hover:bg-slate-800">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FilePlus2 className="h-4 w-4" />}
            {isUploading ? 'Загрузка…' : 'Добавить файл'}
          </Button>
        </form>
      )}

      {files.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Дополнительных материалов пока нет.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {files.map((productFile) => (
            <article key={productFile.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 p-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <FileArchive className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{productFile.file_name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{fileKindLabels[productFile.file_kind]} · {formatFileSize(productFile.file_size)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`/api/products/files/${productFile.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Открыть ${productFile.file_name}`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'h-10 w-10')}
                >
                  <Download className="h-4 w-4" />
                </a>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Удалить ${productFile.file_name}`}
                    disabled={deletingId === productFile.id}
                    onClick={() => void onDelete(productFile)}
                    className="h-10 w-10 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {deletingId === productFile.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
