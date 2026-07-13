'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, History, Loader2, RotateCcw, Save, Upload } from 'lucide-react'
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

function hasVersionFiles(version: ProductVersionWithFiles) {
  return version.product_files.length > 0
}

function toggleFasteningValue(
  current: ProductFasteningType[],
  value: ProductFasteningType,
  checked: boolean,
) {
  if (checked) return Array.from(new Set([...current, value]))
  return current.filter((item) => item !== value)
}

function ActionError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
      {message}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium text-[#374151]">{children}</label>
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
            className="flex min-h-10 items-center gap-2 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm text-[#374151]"
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
  const label = value ? PRODUCT_COMPLETION_TYPE_LABELS[value] : 'не заполнено'

  return (
    <Select
      value={value || 'none'}
      onValueChange={(nextValue) => onChange(nextValue === 'none' ? null : nextValue as ProductCompletionType)}
      disabled={disabled}
    >
      <SelectTrigger className="h-10 w-full border-[#E8ECF0] bg-[#F8F9FA]">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">не заполнено</SelectItem>
        {COMPLETION_OPTIONS.map(([type, optionLabel]) => (
          <SelectItem key={type} value={type}>{optionLabel}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function VersionFilesActionDialog({
  productId,
  version,
}: {
  productId: string
  version: ProductVersionWithFiles
}) {
  const router = useRouter()
  const drawingFileRef = useRef<HTMLInputElement>(null)
  const stepFileRef = useRef<HTMLInputElement>(null)
  const isNewVersionMode = hasVersionFiles(version)
  const [open, setOpen] = useState(false)
  const [drawingNumber, setDrawingNumber] = useState(version.drawing_number || '')
  const [changeSummary, setChangeSummary] = useState('')
  const [fasteningTypes, setFasteningTypes] = useState<ProductFasteningType[]>(version.fastening_types || [])
  const [completionType, setCompletionType] = useState<ProductCompletionType | null>(version.completion_type || null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDrawingNumber(version.drawing_number || '')
    setChangeSummary('')
    setFasteningTypes(version.fastening_types || [])
    setCompletionType(version.completion_type || null)
    setError(null)
    if (drawingFileRef.current) drawingFileRef.current.value = ''
    if (stepFileRef.current) stepFileRef.current.value = ''
  }, [open, version])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const drawingFile = drawingFileRef.current?.files?.[0]
    const stepFile = stepFileRef.current?.files?.[0]

    if (!drawingFile || !stepFile) {
      const message = 'Загрузите чертеж и STEP файл'
      setError(message)
      toast.error(message)
      return
    }
    if (isNewVersionMode && !changeSummary.trim()) {
      const message = 'Опишите изменения в версии'
      setError(message)
      toast.error(message)
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const result = isNewVersionMode
        ? await createProductVersion(productId, {
            drawingNumber,
            changeSummary,
            fasteningTypes,
            completionType,
            drawingFile,
            stepFile,
          })
        : await completeCurrentVersionFiles(productId, {
            drawingNumber,
            drawingFile,
            stepFile,
          })

      if (!result.success) throw new Error(result.error || 'Не удалось сохранить версию товара')
      toast.success(isNewVersionMode ? 'Новая версия создана' : 'Файлы версии загружены')
      setOpen(false)
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
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && setOpen(nextOpen)}>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-[#1B3A6B] text-white hover:bg-[#152D54]"
      >
        {isNewVersionMode ? <History className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {isNewVersionMode ? 'Новая версия' : 'Загрузить чертёж и STEP'}
      </Button>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#E8ECF0] bg-white text-[#1B3A6B] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNewVersionMode ? 'Новая версия товара' : 'Загрузить файлы текущей версии'}</DialogTitle>
          <DialogDescription>
            {isNewVersionMode
              ? 'Новая версия станет текущей после сохранения.'
              : 'Файлы будут привязаны к текущей версии товара.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ActionError message={error} />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel>Номер чертежа</FieldLabel>
              <Input
                value={drawingNumber}
                onChange={(event) => setDrawingNumber(event.target.value)}
                required
                disabled={isSubmitting}
                className="border-[#E8ECF0] bg-[#F8F9FA]"
              />
            </div>
            {isNewVersionMode && (
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel>Что изменилось</FieldLabel>
                <Textarea
                  value={changeSummary}
                  onChange={(event) => setChangeSummary(event.target.value)}
                  required
                  disabled={isSubmitting}
                  className="min-h-24 border-[#E8ECF0] bg-[#F8F9FA]"
                />
              </div>
            )}
            {isNewVersionMode && (
              <>
                <div className="space-y-1.5 md:col-span-2">
                  <FieldLabel>Крепление</FieldLabel>
                  <FasteningCheckboxes
                    value={fasteningTypes}
                    onChange={setFasteningTypes}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Комплектация</FieldLabel>
                  <CompletionSelect
                    value={completionType}
                    onChange={setCompletionType}
                    disabled={isSubmitting}
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <FieldLabel>Файл чертежа</FieldLabel>
              <Input
                ref={drawingFileRef}
                type="file"
                accept=".pdf,application/pdf"
                required
                disabled={isSubmitting}
                className="border-[#E8ECF0] bg-[#F8F9FA]"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>STEP файл</FieldLabel>
              <Input
                ref={stepFileRef}
                type="file"
                accept=".step,.stp"
                required
                disabled={isSubmitting}
                className="border-[#E8ECF0] bg-[#F8F9FA]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-[#1B3A6B] text-white hover:bg-[#152D54]">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VersionCompletionEditor({
  productId,
  version,
}: {
  productId: string
  version: ProductVersionWithFiles
}) {
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
      const result = await updateCurrentVersionCompletion(productId, {
        fasteningTypes,
        completionType,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить крепление и комплектацию')
      toast.success('Крепление и комплектация сохранены')
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
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[#1B3A6B]">Крепление и комплектация</h3>
      </div>
      <ActionError message={error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
        <div className="space-y-1.5">
          <FieldLabel>Крепление</FieldLabel>
          <FasteningCheckboxes value={fasteningTypes} onChange={setFasteningTypes} disabled={isSubmitting} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Комплектация</FieldLabel>
          <CompletionSelect value={completionType} onChange={setCompletionType} disabled={isSubmitting} />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#1B3A6B] text-white hover:bg-[#152D54] lg:w-auto"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function RollbackVersionAction({
  productId,
  version,
}: {
  productId: string
  version: ProductVersionWithFiles
}) {
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
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <RotateCcw className="h-3.5 w-3.5" />
        Сделать актуальной
      </AlertDialogTrigger>
      <AlertDialogContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
        <AlertDialogHeader>
          <AlertDialogTitle>Сделать версию v{version.version_number} актуальной?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Эта версия станет актуальной и будет подставляться по умолчанию в новые заказы.
            Текущая актуальная версия перейдет в архив.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ActionError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleRollback()}
            className="bg-[#1B3A6B] text-white hover:bg-[#152D54]"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Сохранение...' : 'Сделать актуальной'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FileLinks({ files }: { files: ProductFile[] }) {
  if (files.length === 0) {
    return <span className="text-sm text-[#9CA3AF]">—</span>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => (
        <a
          key={file.id}
          href={`/api/products/files/${file.id}`}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 gap-1 px-2 text-xs')}
        >
          <Download className="h-3.5 w-3.5" />
          {file.file_name}
        </a>
      ))}
    </div>
  )
}

function MissingBadge() {
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      не заполнено
    </Badge>
  )
}

function FasteningBadges({ version }: { version: ProductVersionWithFiles }) {
  if (version.fastening_types.length === 0) return <MissingBadge />

  return (
    <div className="flex flex-wrap gap-1.5">
      {version.fastening_types.map((type) => (
        <Badge key={type} variant="secondary">
          {PRODUCT_FASTENING_TYPE_LABELS[type]}
        </Badge>
      ))}
    </div>
  )
}

function CompletionBadge({ version }: { version: ProductVersionWithFiles }) {
  if (!version.completion_type) return <MissingBadge />
  return <Badge variant="secondary">{PRODUCT_COMPLETION_TYPE_LABELS[version.completion_type]}</Badge>
}

function VersionFiles({ version }: { version: ProductVersionWithFiles }) {
  const files = fileGroups(version.product_files)
  const hasFiles = files.drawing.length > 0 || files.step.length > 0

  if (!hasFiles) {
    return <div className="text-sm text-[#9CA3AF]">Файлы не загружены</div>
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[90px_1fr]">
        <div className="text-xs font-medium uppercase text-[#6B7280]">Чертеж</div>
        <FileLinks files={files.drawing} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[90px_1fr]">
        <div className="text-xs font-medium uppercase text-[#6B7280]">STEP</div>
        <FileLinks files={files.step} />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-[#6B7280]">{label}</div>
      <div className="mt-1 text-sm text-[#374151]">{children}</div>
    </div>
  )
}

function CurrentVersionCard({
  productId,
  version,
  authorsById,
  canManageVersions,
  canManageCompletion,
}: {
  productId: string
  version: ProductVersionWithFiles
  authorsById: Record<string, ProductVersionAuthor>
  canManageVersions: boolean
  canManageCompletion: boolean
}) {
  return (
    <section className="space-y-5 rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Текущая версия</h2>
            <Badge>v{version.version_number}</Badge>
          </div>
          <p className="mt-1 text-sm text-[#6B7280]">
            {formatVersionDate(version.created_at)} · {authorName(version, authorsById)}
          </p>
        </div>
        {canManageVersions && <VersionFilesActionDialog productId={productId} version={version} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Номер чертежа">{version.drawing_number}</Field>
        <Field label="Комментарий изменений">{version.change_summary || '—'}</Field>
        <Field label="Крепление"><FasteningBadges version={version} /></Field>
        <Field label="Комплектация"><CompletionBadge version={version} /></Field>
      </div>

      {canManageCompletion && <VersionCompletionEditor productId={productId} version={version} />}

      <div className="border-t border-[#E8ECF0] pt-4">
        <VersionFiles version={version} />
      </div>
    </section>
  )
}

function ArchivedVersionsTable({
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
  const columnCount = canManageVersions ? 8 : 7

  return (
    <section className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Архивные версии</h2>
        <p className="text-sm text-[#6B7280]">Предыдущие версии карточки продукта.</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E8ECF0]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Версия</th>
                <th className="px-4 py-3">Дата и автор</th>
                <th className="px-4 py-3">Чертеж</th>
                <th className="px-4 py-3">Файлы</th>
                <th className="px-4 py-3">Крепление</th>
                <th className="px-4 py-3">Комплектация</th>
                <th className="px-4 py-3">Комментарий</th>
                {canManageVersions && <th className="px-4 py-3 text-right">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {versions.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-8 text-center text-[#9CA3AF]">
                    Архивных версий пока нет.
                  </td>
                </tr>
              ) : versions.map((version) => (
                <tr key={version.id} className="bg-white text-[#6B7280]">
                  <td className="px-4 py-3 font-semibold text-[#374151]">v{version.version_number}</td>
                  <td className="px-4 py-3">
                    <div>{formatVersionDate(version.created_at)}</div>
                    <div className="text-xs text-[#9CA3AF]">{authorName(version, authorsById)}</div>
                  </td>
                  <td className="px-4 py-3 text-[#374151]">{version.drawing_number}</td>
                  <td className="px-4 py-3"><VersionFiles version={version} /></td>
                  <td className="px-4 py-3"><FasteningBadges version={version} /></td>
                  <td className="px-4 py-3"><CompletionBadge version={version} /></td>
                  <td className="max-w-[220px] px-4 py-3 text-[#374151]">{version.change_summary || '—'}</td>
                  {canManageVersions && (
                    <td className="px-4 py-3 text-right">
                      <RollbackVersionAction productId={productId} version={version} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export function ProductVersionHistory({
  productId,
  versions,
  authorsById,
}: ProductVersionHistoryProps) {
  const { can } = usePermissions()
  const currentVersion = versions.find((version) => version.status === 'current') || null
  const archivedVersions = versions
    .filter((version) => version.status === 'archived')
    .sort((left, right) => right.version_number - left.version_number)
  const canManageVersions = can('products', 'manage')
  const canManageCompletion = canManageVersions

  if (versions.length === 0) {
    return (
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex items-start gap-3 text-[#6B7280]">
          <FileText className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Версии продукта</h2>
            <p className="mt-1 text-sm">Для этого продукта пока нет ни одной версии.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {currentVersion ? (
        <CurrentVersionCard
          productId={productId}
          version={currentVersion}
          authorsById={authorsById}
          canManageVersions={canManageVersions}
          canManageCompletion={canManageCompletion}
        />
      ) : (
        <section className="rounded-xl border border-[#E8ECF0] bg-white p-5 text-sm text-[#6B7280]">
          Текущая версия продукта не найдена.
        </section>
      )}
      <ArchivedVersionsTable
        productId={productId}
        versions={archivedVersions}
        authorsById={authorsById}
        canManageVersions={canManageVersions}
      />
    </div>
  )
}
