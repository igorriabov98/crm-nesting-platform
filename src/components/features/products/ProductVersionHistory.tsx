'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileBox,
  FileText,
  History,
  Loader2,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  PRODUCT_COMPLETION_TYPE_LABELS,
  PRODUCT_FASTENING_TYPE_LABELS,
  type ProductCompletionType,
  type ProductFasteningType,
} from '@/lib/constants/product-version-labels'
import {
  completeCurrentVersionFiles,
  createProductVersion,
  rollbackToVersion,
  updateCurrentVersionCompletion,
  type ProductVersionWithFiles,
} from '@/lib/actions/product-versions'
import {
  cleanupDirectProductUploads,
  uploadProductFileDirect,
} from '@/lib/products/direct-product-upload-client'
import { versionDocumentState, type DirectProductUpload } from '@/lib/products/product-file-upload'
import type { ProductFile } from '@/lib/types'
import { usePermissions } from '@/components/providers/PermissionProvider'

type ProductVersionAuthor = {
  id: string
  full_name: string | null
}

type ProductVersionHistoryProps = {
  productId: string
  versions: ProductVersionWithFiles[]
  authorsById: Record<string, ProductVersionAuthor>
}

const FASTENING_OPTIONS = Object.entries(PRODUCT_FASTENING_TYPE_LABELS) as Array<[ProductFasteningType, string]>
const COMPLETION_OPTIONS = Object.entries(PRODUCT_COMPLETION_TYPE_LABELS) as Array<[ProductCompletionType, string]>

const versionDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatVersionDate(value: string | null) {
  if (!value) return '—'
  return versionDateFormatter.format(new Date(value))
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

function authorName(version: ProductVersionWithFiles, authorsById: Record<string, ProductVersionAuthor>) {
  if (!version.created_by) return '—'
  return authorsById[version.created_by]?.full_name || 'Пользователь'
}

function fileGroups(files: ProductFile[]) {
  return {
    drawing: files.filter((file) => file.file_kind === 'drawing' || file.file_kind === 'pdf'),
    step: files.filter((file) => file.file_kind === 'step'),
  }
}

function getActionError(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function toggleFasteningValue(current: ProductFasteningType[], value: ProductFasteningType, checked: boolean) {
  if (checked) return Array.from(new Set([...current, value]))
  return current.filter((item) => item !== value)
}

function ActionError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">{children}</label>
}

function FasteningCheckboxes({
  value,
  onChange,
  disabled,
}: {
  value: ProductFasteningType[]
  onChange: (nextValue: ProductFasteningType[]) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FASTENING_OPTIONS.map(([type, label]) => {
        const checked = value.includes(type)
        return (
          <label
            key={type}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
              checked ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(nextChecked) => onChange(toggleFasteningValue(value, type, nextChecked === true))}
            />
            <span>{label}</span>
          </label>
        )
      })}
    </div>
  )
}

function CompletionSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProductCompletionType | null
  onChange: (nextValue: ProductCompletionType | null) => void
  disabled?: boolean
}) {
  const label = value ? PRODUCT_COMPLETION_TYPE_LABELS[value] : 'Не заполнено'
  return (
    <Select
      value={value || 'none'}
      onValueChange={(nextValue) => onChange(nextValue === 'none' ? null : nextValue as ProductCompletionType)}
      disabled={disabled}
    >
      <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Не заполнено</SelectItem>
        {COMPLETION_OPTIONS.map(([type, optionLabel]) => (
          <SelectItem key={type} value={type}>{optionLabel}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FilePicker({
  id,
  title,
  description,
  accept,
  file,
  onChange,
  disabled,
}: {
  id: string
  title: string
  description: string
  accept: string
  file: File | null
  onChange: (file: File | null) => void
  disabled: boolean
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm ring-1 ring-slate-200">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={id}>{title}</FieldLabel>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
          <Input
            id={id}
            type="file"
            accept={accept}
            disabled={disabled}
            onChange={(event) => onChange(event.target.files?.[0] || null)}
            className="mt-3 min-h-11 cursor-pointer border-slate-200 bg-white file:cursor-pointer"
          />
          {file && <p className="mt-2 truncate text-xs font-medium text-emerald-700">Выбран: {file.name}</p>}
        </div>
      </div>
    </div>
  )
}

function VersionFilesActionDialog({ productId, version }: { productId: string; version: ProductVersionWithFiles }) {
  const router = useRouter()
  const documentState = versionDocumentState(version.product_files)
  const isNewVersionMode = documentState.complete
  const [open, setOpen] = useState(false)
  const [drawingNumber, setDrawingNumber] = useState(version.drawing_number || '')
  const [changeSummary, setChangeSummary] = useState('')
  const [fasteningTypes, setFasteningTypes] = useState<ProductFasteningType[]>(version.fastening_types || [])
  const [completionType, setCompletionType] = useState<ProductCompletionType | null>(version.completion_type || null)
  const [drawingFile, setDrawingFile] = useState<File | null>(null)
  const [stepFile, setStepFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDrawingNumber(version.drawing_number || '')
    setChangeSummary('')
    setFasteningTypes(version.fastening_types || [])
    setCompletionType(version.completion_type || null)
    setDrawingFile(null)
    setStepFile(null)
    setUploadStatus(null)
    setError(null)
  }, [open, version])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!drawingFile && !stepFile) {
      const message = 'Добавьте PDF или STEP файл'
      setError(message)
      return
    }
    if (isNewVersionMode && !changeSummary.trim()) {
      setError('Опишите изменения в новой версии')
      return
    }

    const uploadedFiles: DirectProductUpload[] = []
    setIsSubmitting(true)
    setError(null)

    try {
      if (drawingFile) {
        setUploadStatus('Загружаю PDF…')
        uploadedFiles.push(await uploadProductFileDirect(productId, 'drawing', drawingFile))
      }
      if (stepFile) {
        setUploadStatus('Загружаю STEP…')
        uploadedFiles.push(await uploadProductFileDirect(productId, 'step', stepFile))
      }

      setUploadStatus('Сохраняю версию…')
      const result = isNewVersionMode
        ? await createProductVersion(productId, {
            drawingNumber,
            changeSummary,
            fasteningTypes,
            completionType,
            files: uploadedFiles,
          })
        : await completeCurrentVersionFiles(productId, {
            drawingNumber,
            files: uploadedFiles,
          })

      if (!result.success) throw new Error(result.error || 'Не удалось сохранить файлы версии')
      toast.success(isNewVersionMode ? 'Новая версия создана' : 'Файлы добавлены в текущую версию')
      setOpen(false)
      router.refresh()
    } catch (submitError) {
      await cleanupDirectProductUploads(productId, uploadedFiles)
      const message = getActionError(submitError)
      setError(message)
      toast.error(message)
    } finally {
      setUploadStatus(null)
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && setOpen(nextOpen)}>
      <Button type="button" onClick={() => setOpen(true)} className="min-h-11 bg-blue-700 text-white hover:bg-blue-800">
        {isNewVersionMode ? <History className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {isNewVersionMode ? 'Создать новую версию' : 'Добавить файлы'}
      </Button>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white text-slate-950 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNewVersionMode ? 'Новая версия изделия' : 'Дополнить текущую версию'}</DialogTitle>
          <DialogDescription>
            PDF и STEP загружаются независимо. Можно сохранить один файл сейчас и добавить второй позже.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <ActionError message={error} />

          <div className="space-y-1.5">
            <FieldLabel htmlFor="version-drawing-number">Номер чертежа</FieldLabel>
            <Input
              id="version-drawing-number"
              value={drawingNumber}
              onChange={(event) => setDrawingNumber(event.target.value)}
              required
              disabled={isSubmitting}
              className="h-11 border-slate-200 bg-white"
            />
          </div>

          {isNewVersionMode && (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="version-change-summary">Что изменилось</FieldLabel>
              <Textarea
                id="version-change-summary"
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
                required
                disabled={isSubmitting}
                placeholder="Коротко опишите изменения в чертеже или конструкции"
                className="min-h-24 border-slate-200 bg-white"
              />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {(isNewVersionMode || !documentState.hasDrawing) && (
              <FilePicker
                id="version-pdf-file"
                title="PDF-чертёж"
                description="Необязательно добавлять вместе со STEP · до 50 МБ"
                accept=".pdf,application/pdf"
                file={drawingFile}
                onChange={setDrawingFile}
                disabled={isSubmitting}
              />
            )}
            {(isNewVersionMode || !documentState.hasStep) && (
              <FilePicker
                id="version-step-file"
                title="STEP-модель"
                description="Можно добавить позже · форматы STEP и STP · до 50 МБ"
                accept=".step,.stp"
                file={stepFile}
                onChange={setStepFile}
                disabled={isSubmitting}
              />
            )}
          </div>

          {!isNewVersionMode && (documentState.hasDrawing || documentState.hasStep) && (
            <div className="flex flex-wrap gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              {documentState.hasDrawing && <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> PDF уже загружен</span>}
              {documentState.hasStep && <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> STEP уже загружен</span>}
            </div>
          )}

          {isNewVersionMode && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel>Крепление</FieldLabel>
                <FasteningCheckboxes value={fasteningTypes} onChange={setFasteningTypes} disabled={isSubmitting} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Комплектация</FieldLabel>
                <CompletionSelect value={completionType} onChange={setCompletionType} disabled={isSubmitting} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting} className="min-h-11">
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-h-11 bg-blue-700 text-white hover:bg-blue-800">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              {uploadStatus || 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VersionCompletionEditor({ productId, version }: { productId: string; version: ProductVersionWithFiles }) {
  const router = useRouter()
  const [fasteningTypes, setFasteningTypes] = useState<ProductFasteningType[]>(version.fastening_types || [])
  const [completionType, setCompletionType] = useState<ProductCompletionType | null>(version.completion_type || null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFasteningTypes(version.fastening_types || [])
    setCompletionType(version.completion_type || null)
    setError(null)
  }, [version])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await updateCurrentVersionCompletion(productId, { fasteningTypes, completionType })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить комплектацию')
      toast.success('Комплектация сохранена')
      router.refresh()
    } catch (submitError) {
      const message = getActionError(submitError)
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Крепление и комплектация</h3>
        <p className="mt-1 text-xs text-slate-500">Параметры относятся только к текущей версии.</p>
      </div>
      <ActionError message={error} />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel>Крепление</FieldLabel>
          <FasteningCheckboxes value={fasteningTypes} onChange={setFasteningTypes} disabled={isSubmitting} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <FieldLabel>Комплектация</FieldLabel>
            <CompletionSelect value={completionType} onChange={setCompletionType} disabled={isSubmitting} />
          </div>
          <Button type="submit" disabled={isSubmitting} className="min-h-11 bg-slate-900 text-white hover:bg-slate-800">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />}
            {isSubmitting ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function RollbackVersionAction({ productId, version }: { productId: string; version: ProductVersionWithFiles }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRollback() {
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await rollbackToVersion(productId, version.id)
      if (!result.success) throw new Error(result.error || 'Не удалось сделать версию актуальной')
      toast.success(`Версия v${version.version_number} стала актуальной`)
      setOpen(false)
      router.refresh()
    } catch (rollbackError) {
      const message = getActionError(rollbackError)
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !isSubmitting && setOpen(nextOpen)}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-10" />}>
        <RotateCcw className="h-3.5 w-3.5" />
        Сделать актуальной
      </AlertDialogTrigger>
      <AlertDialogContent className="border-slate-200 bg-white text-slate-950">
        <AlertDialogHeader>
          <AlertDialogTitle>Вернуть версию v{version.version_number}?</AlertDialogTitle>
          <AlertDialogDescription>
            Она станет текущей для новых заказов, а нынешняя версия перейдёт в архив.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ActionError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Отмена</AlertDialogCancel>
          <AlertDialogAction type="button" disabled={isSubmitting} onClick={() => void handleRollback()} className="bg-blue-700 text-white hover:bg-blue-800">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {isSubmitting ? 'Сохранение…' : 'Сделать актуальной'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FileLinks({ files }: { files: ProductFile[] }) {
  if (files.length === 0) return <span className="text-sm text-slate-400">Не загружен</span>
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => (
        <a
          key={file.id}
          href={`/api/products/files/${file.id}`}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-10 max-w-full gap-1.5 border-slate-200 bg-white px-3 text-xs')}
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{file.file_name}</span>
          <span className="shrink-0 text-slate-400">{formatFileSize(file.file_size)}</span>
        </a>
      ))}
    </div>
  )
}

function FasteningBadges({ version }: { version: ProductVersionWithFiles }) {
  if (!version.fastening_types?.length) return <span className="text-sm text-slate-400">Не заполнено</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {version.fastening_types.map((type) => <Badge key={type} variant="secondary">{PRODUCT_FASTENING_TYPE_LABELS[type]}</Badge>)}
    </div>
  )
}

function CompletionBadge({ version }: { version: ProductVersionWithFiles }) {
  if (!version.completion_type) return <span className="text-sm text-slate-400">Не заполнено</span>
  return <Badge variant="secondary">{PRODUCT_COMPLETION_TYPE_LABELS[version.completion_type]}</Badge>
}

function DocumentCard({ title, files, ready }: { title: string; files: ProductFile[]; ready: boolean }) {
  return (
    <div className={cn('rounded-2xl border p-4', ready ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70')}>
      <div className="flex items-center gap-2">
        {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : <CircleAlert className="h-5 w-5 text-amber-700" />}
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className={cn('text-xs', ready ? 'text-emerald-700' : 'text-amber-700')}>{ready ? 'Файл готов' : 'Можно добавить позже'}</p>
        </div>
      </div>
      <div className="mt-3"><FileLinks files={files} /></div>
    </div>
  )
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  )
}

function CurrentVersionCard({
  productId,
  version,
  authorsById,
  canManageVersions,
}: {
  productId: string
  version: ProductVersionWithFiles
  authorsById: Record<string, ProductVersionAuthor>
  canManageVersions: boolean
}) {
  const groups = fileGroups(version.product_files)
  const state = versionDocumentState(version.product_files)
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/80 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-700 text-white"><FileBox className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Текущая версия</p>
                <h2 className="text-xl font-semibold text-slate-950">Версия {version.version_number}</h2>
              </div>
              <Badge className={state.complete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
                {state.complete ? 'Комплект готов' : 'Файлы не полные'}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-500">{formatVersionDate(version.created_at)} · {authorName(version, authorsById)}</p>
          </div>
          {canManageVersions && <VersionFilesActionDialog productId={productId} version={version} />}
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCard title="PDF-чертёж" files={groups.drawing} ready={state.hasDrawing} />
          <DocumentCard title="STEP-модель" files={groups.step} ready={state.hasStep} />
        </div>

        <div className="grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2">
          <InfoField label="Номер чертежа">{version.drawing_number}</InfoField>
          <InfoField label="Комментарий">{version.change_summary || 'Первая версия'}</InfoField>
          <InfoField label="Крепление"><FasteningBadges version={version} /></InfoField>
          <InfoField label="Комплектация"><CompletionBadge version={version} /></InfoField>
        </div>

        {canManageVersions && <VersionCompletionEditor productId={productId} version={version} />}
      </div>
    </section>
  )
}

function ArchivedVersions({
  productId,
  versions,
  authorsById,
  canManageVersions,
}: {
  productId: string
  versions: ProductVersionWithFiles[]
  authorsById: Record<string, ProductVersionAuthor>
  canManageVersions: boolean
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><History className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">История версий</h2>
          <p className="text-sm text-slate-500">Предыдущие комплекты документов и параметры изделия.</p>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          Архивных версий пока нет.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {versions.map((version) => {
            const groups = fileGroups(version.product_files)
            return (
              <article key={version.id} className="rounded-2xl border border-slate-200 p-4 transition-colors hover:bg-slate-50/60">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">v{version.version_number}</Badge>
                      <span className="font-medium text-slate-900">{version.drawing_number}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatVersionDate(version.created_at)} · {authorName(version, authorsById)}</p>
                  </div>
                  {canManageVersions && <RollbackVersionAction productId={productId} version={version} />}
                </div>
                <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                  <InfoField label="PDF"><FileLinks files={groups.drawing} /></InfoField>
                  <InfoField label="STEP"><FileLinks files={groups.step} /></InfoField>
                  <InfoField label="Крепление"><FasteningBadges version={version} /></InfoField>
                  <InfoField label="Комплектация"><CompletionBadge version={version} /></InfoField>
                </div>
                {version.change_summary && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{version.change_summary}</p>}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function ProductVersionHistory({ productId, versions, authorsById }: ProductVersionHistoryProps) {
  const { can } = usePermissions()
  const currentVersion = versions.find((version) => version.status === 'current') || null
  const archivedVersions = versions
    .filter((version) => version.status === 'archived')
    .sort((left, right) => right.version_number - left.version_number)
  const canManageVersions = can('products', 'manage')

  if (versions.length === 0) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 text-slate-600">
          <FileBox className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Версии изделия</h2>
            <p className="mt-1 text-sm">Для этого изделия пока нет ни одной версии.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {currentVersion ? (
        <CurrentVersionCard
          productId={productId}
          version={currentVersion}
          authorsById={authorsById}
          canManageVersions={canManageVersions}
        />
      ) : (
        <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Текущая версия изделия не найдена.
        </section>
      )}
      <ArchivedVersions
        productId={productId}
        versions={archivedVersions}
        authorsById={authorsById}
        canManageVersions={canManageVersions}
      />
    </div>
  )
}
