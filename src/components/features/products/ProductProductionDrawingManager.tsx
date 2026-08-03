'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileStack, FileText, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  deleteProductProductionDrawing,
  registerProductProductionDrawings,
  type ProductProductionDrawingDto,
} from '@/lib/actions/product-production-drawings'
import {
  PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH,
  validateProductProductionDrawingFile,
  type DirectProductProductionDrawingUpload,
} from '@/lib/products/product-production-drawing'
import {
  cleanupProductProductionDrawingUploads,
  uploadProductProductionDrawingDirect,
} from '@/lib/products/product-production-drawing-upload-client'
import { cn } from '@/lib/utils'

type ProductProductionDrawingManagerProps = {
  productId: string
  productVersionId: string
  files: ProductProductionDrawingDto[]
  canManage: boolean
  isCurrent: boolean
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function ProductProductionDrawingManager({
  productId,
  productVersionId,
  files: initialFiles,
  canManage,
  isCurrent,
}: ProductProductionDrawingManagerProps) {
  const router = useRouter()
  const inputId = useId()
  const descriptionId = `${inputId}-description`
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState(initialFiles)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductProductionDrawingDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => setFiles(initialFiles), [initialFiles])

  function selectFiles(nextFiles: File[]) {
    setError(null)
    setStatus(null)
    if (nextFiles.length > PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH) {
      setSelectedFiles([])
      setError('За один раз можно выбрать не больше 10 PDF-файлов')
      return
    }
    try {
      nextFiles.forEach((file) => validateProductProductionDrawingFile({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || null,
      }))
      setSelectedFiles(nextFiles)
    } catch (selectionError) {
      setSelectedFiles([])
      setError(errorMessage(selectionError))
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedFiles.length === 0) {
      setError('Выберите хотя бы один PDF-файл')
      return
    }

    const uploaded: DirectProductProductionDrawingUpload[] = []
    setIsUploading(true)
    setError(null)
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index]
        setStatus(`Загрузка ${index + 1} из ${selectedFiles.length}: ${file.name}`)
        uploaded.push(await uploadProductProductionDrawingDirect(productId, productVersionId, file))
      }

      setStatus('Сохранение комплекта…')
      const result = await registerProductProductionDrawings(productId, productVersionId, uploaded)
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось сохранить комплектные чертежи')

      setFiles((current) => [...result.data!, ...current])
      setSelectedFiles([])
      if (inputRef.current) inputRef.current.value = ''
      setStatus(`Загружено файлов: ${result.data.length}`)
      toast.success(`Комплектные чертежи добавлены: ${result.data.length}`)
      router.refresh()
    } catch (uploadError) {
      await cleanupProductProductionDrawingUploads(productId, productVersionId, uploaded)
      const message = errorMessage(uploadError)
      setStatus(null)
      setError(message)
      toast.error(message)
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    setError(null)
    try {
      const result = await deleteProductProductionDrawing(productId, productVersionId, deleteTarget.id)
      if (!result.success) throw new Error(result.error || 'Не удалось удалить комплектный чертёж')
      setFiles((current) => current.filter((file) => file.id !== deleteTarget.id))
      toast.success('Комплектный чертёж удалён')
      setDeleteTarget(null)
      router.refresh()
    } catch (deleteError) {
      const message = errorMessage(deleteError)
      setError(message)
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  const editable = canManage && isCurrent

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      aria-busy={isUploading || isDeleting}
      className="rounded-2xl border border-indigo-200 bg-indigo-50/45 p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-700 text-white">
            <FileStack className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id={`${inputId}-title`} className="font-semibold text-slate-950">Комплектные чертежи для производства</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {isCurrent
                ? 'Закрытый PDF-комплект этой версии изделия.'
                : 'Архивный комплект доступен только для чтения.'}
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-800">
          <ShieldCheck className="h-3.5 w-3.5" />
          Ограниченный доступ
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-indigo-200 bg-white/70 px-4 py-5 text-center text-sm text-slate-500">
            Комплектные чертежи не загружены.
          </div>
        ) : (
          <ul className="grid gap-2" aria-label="Комплектные чертежи">
            {files.map((file) => (
              <li key={file.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <FileText className="h-5 w-5 shrink-0 text-indigo-700" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900" title={file.file_name}>{file.file_name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(file.file_size)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:shrink-0">
                  <a
                    href={`/api/products/production-drawings/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Скачать комплектный чертёж ${file.file_name}`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11 justify-center border-slate-200 bg-white')}
                  >
                    <Download className="h-4 w-4" />
                    Скачать
                  </a>
                  {editable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                      onClick={() => setDeleteTarget(file)}
                      disabled={isUploading || isDeleting}
                      aria-label={`Удалить комплектный чертёж ${file.file_name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editable && (
        <form onSubmit={handleUpload} className="mt-4 rounded-xl border border-indigo-200 bg-white p-3 sm:p-4">
          <label htmlFor={inputId} className="text-sm font-medium text-slate-800">Добавить PDF-файлы</label>
          <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-500">
            До 10 файлов за одну загрузку, не более 50 МБ каждый. Можно догружать новые файлы позже.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Input
              ref={inputRef}
              id={inputId}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              aria-describedby={descriptionId}
              disabled={isUploading || isDeleting}
              onChange={(event) => selectFiles(Array.from(event.target.files || []))}
              className="min-h-11 cursor-pointer border-slate-200 bg-white file:cursor-pointer"
            />
            <Button
              type="submit"
              disabled={isUploading || isDeleting || selectedFiles.length === 0}
              className="min-h-11 w-full bg-indigo-700 text-white hover:bg-indigo-800 sm:w-auto"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Upload className="h-4 w-4" />}
              {isUploading ? 'Загрузка…' : `Загрузить${selectedFiles.length ? ` (${selectedFiles.length})` : ''}`}
            </Button>
          </div>
          {selectedFiles.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">Выбрано файлов: {selectedFiles.length}</p>
          )}
        </form>
      )}

      <div className="mt-3 min-h-5 text-sm" aria-live="polite" aria-atomic="true">
        {error ? <p role="alert" className="text-red-700">{error}</p> : status ? <p className="text-indigo-800">{status}</p> : null}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <AlertDialogContent className="border-slate-200 bg-white text-slate-950">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить комплектный чертёж?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл «{deleteTarget?.file_name}» будет безвозвратно удалён из текущей версии.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
              className="bg-red-700 text-white hover:bg-red-800"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              {isDeleting ? 'Удаление…' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
