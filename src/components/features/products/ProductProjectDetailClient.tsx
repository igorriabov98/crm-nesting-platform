'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, Download, FilePlus2, Mail, Paperclip, Plus, Trash2, Upload, X } from 'lucide-react'
import {
  approveProductProjectForClient,
  deleteProductProjectFile,
  requestProductProjectCorrection,
  uploadProductProjectFile,
  type ProductProjectApprovalInput,
  type ProductProjectDetails,
} from '@/lib/actions/products'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MailThreadPicker } from '@/components/features/mail/MailThreadPicker'
import { LinkedMailSection } from '@/components/features/mail/LinkedMailSection'
import { cleanupProductProjectCorrectionFiles, uploadProductProjectCorrectionFiles } from '@/lib/products/product-project-upload-client'
import {
  PRODUCT_PROJECT_FILE_MAX_COUNT,
  type DirectProductProjectUpload,
  validateProductProjectFile,
} from '@/lib/products/product-project-file-upload'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type { ProductProjectFile, ProductProjectVersion } from '@/lib/types'
import type { CrmMailLink, MailLinkInput, MailLinkPreview } from '@/lib/mail/types'
import { ProductProjectLifecycle, productProjectStatusLabels } from './ProductProjectLifecycle'

const versionStatusLabels: Record<ProductProjectVersion['status'], string> = {
  draft: 'Черновик',
  client_review: 'Предварительно готова',
  approved: 'Готова к заказу',
  superseded: 'Заменена',
}

const fileKindLabels: Record<ProductProjectFile['file_kind'], string> = {
  drawing: 'Чертёж',
  step: 'STEP',
  pdf: 'PDF',
  photo: 'Фото',
  other: 'Другое',
}

const correctionFileAccept = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.csv', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.dxf', '.dwg', '.step', '.stp', '.iges', '.igs',
].join(',')

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function versionTitle(version: ProductProjectVersion) {
  return `Версия ${version.version_label || version.version_number}`
}

export function ProductProjectDetailClient({
  project,
  mailLinks,
  initialCorrectionMailLink,
  canManage,
}: {
  project: ProductProjectDetails
  mailLinks: CrmMailLink[]
  initialCorrectionMailLink?: MailLinkPreview | null
  canManage: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const correctionFileInputRef = useRef<HTMLInputElement>(null)
  const versions = useMemo(
    () => [...project.versions].sort((a, b) => a.version_number - b.version_number),
    [project.versions],
  )
  const currentVersion = versions.at(-1) || null
  const approvedVersion = versions.find((version) => version.id === project.approved_version_id) || null
  const commonFiles = project.files.filter((file) => file.version_id === null)
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(currentVersion?.id || null)
  const [fileKind, setFileKind] = useState<ProductProjectFile['file_kind']>('drawing')
  const [fileVersionId, setFileVersionId] = useState<string>('project')
  const [isUploading, setIsUploading] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(Boolean(initialCorrectionMailLink))
  const [correctionText, setCorrectionText] = useState('')
  const [correctionFiles, setCorrectionFiles] = useState<File[]>([])
  const [correctionThreadIds, setCorrectionThreadIds] = useState<string[]>([])
  const [prefilledCorrectionMail, setPrefilledCorrectionMail] = useState<MailLinkPreview | null>(initialCorrectionMailLink || null)
  const [isRequestingCorrection, setIsRequestingCorrection] = useState(false)
  const [approvalDraft, setApprovalDraft] = useState<ProductProjectApprovalInput>({
    name_uk: currentVersion?.name_uk || project.title,
    name_en: currentVersion?.name_en || project.title,
    uktzed: currentVersion?.uktzed || '',
    base_price_eur: Number(currentVersion?.base_price_eur || 0),
  })
  const selectedFileVersion = versions.find((version) => version.id === fileVersionId) || null
  const selectedFileVersionLabel = fileVersionId === 'project'
    ? 'Весь проект'
    : selectedFileVersion ? versionTitle(selectedFileVersion) : 'Выберите версию'

  function resetCorrection() {
    setCorrectionText('')
    setCorrectionFiles([])
    setCorrectionThreadIds([])
    setPrefilledCorrectionMail(null)
    if (correctionFileInputRef.current) correctionFileInputRef.current.value = ''
  }

  function setCorrectionOpen(open: boolean) {
    if (isRequestingCorrection) return
    setIsCorrectionOpen(open)
    if (!open) {
      resetCorrection()
      if (initialCorrectionMailLink) {
        router.replace(`${ROUTES.PRODUCT_PROJECTS}/${project.id}`, { scroll: false })
      }
    }
  }

  function addCorrectionFiles(incoming: File[]) {
    try {
      const unique = incoming.filter((file) => !correctionFiles.some((current) => (
        current.name === file.name && current.size === file.size && current.lastModified === file.lastModified
      )))
      const next = [...correctionFiles, ...unique]
      if (next.length > PRODUCT_PROJECT_FILE_MAX_COUNT) throw new Error('Можно прикрепить не больше 10 файлов')
      next.forEach((file) => validateProductProjectFile({ fileName: file.name, fileSize: file.size }))
      setCorrectionFiles(next)
    } catch (error) {
      toast.error(errorMessage(error))
    }
    if (correctionFileInputRef.current) correctionFileInputRef.current.value = ''
  }

  async function approveForClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentVersion) return toast.error('Версия проекта не найдена')
    setIsApproving(true)
    try {
      const result = await approveProductProjectForClient(project.id, currentVersion.id, approvalDraft)
      if (!result.success) throw new Error(result.error || 'Не удалось утвердить проект')
      toast.success(`${versionTitle(currentVersion)} готова к добавлению в заказ`)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsApproving(false)
    }
  }

  async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const versionId = crypto.randomUUID()
    let uploads: DirectProductProjectUpload[] = []
    setIsRequestingCorrection(true)
    try {
      uploads = await uploadProductProjectCorrectionFiles(project.id, versionId, correctionFiles)
      const mailLinks: MailLinkInput[] = [
        ...(prefilledCorrectionMail ? [{ kind: prefilledCorrectionMail.kind, id: prefilledCorrectionMail.id } satisfies MailLinkInput] : []),
        ...correctionThreadIds.map((id) => ({ kind: 'thread' as const, id })),
      ]
      const result = await requestProductProjectCorrection(project.id, {
        versionId,
        correctionNote: correctionText,
        files: uploads,
        mailLinks,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось создать корректировку')
      toast.success('Корректировка и вложения отправлены инженеру')
      resetCorrection()
      setIsCorrectionOpen(false)
      router.replace(`${ROUTES.PRODUCT_PROJECTS}/${project.id}`, { scroll: false })
      router.refresh()
    } catch (error) {
      if (uploads.length > 0) await cleanupProductProjectCorrectionFiles(project.id, versionId, uploads)
      toast.error(errorMessage(error))
    } finally {
      setIsRequestingCorrection(false)
    }
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = fileInputRef.current?.files?.[0]
    if (!file) return toast.error('Выберите файл')
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('project_id', project.id)
      if (fileVersionId !== 'project') formData.append('version_id', fileVersionId)
      formData.append('file_kind', fileKind)
      formData.append('file', file)
      const result = await uploadProductProjectFile(formData)
      if (!result.success) throw new Error(result.error || 'Не удалось загрузить файл')
      toast.success('Файл загружен')
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsUploading(false)
    }
  }

  async function deleteFile(file: ProductProjectFile) {
    const result = await deleteProductProjectFile(file.id, project.id)
    if (!result.success) {
      toast.error(result.error || 'Не удалось удалить файл')
      return
    }
    toast.success('Файл удалён')
    router.refresh()
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-[#1B3A6B]">{project.title}</h1>
            <p className="break-words text-sm text-[#6B7280]">Клиент: {project.client?.name || '—'} · Инженер: {project.assigned_engineer?.full_name || '—'}</p>
          </div>
          <Badge variant={project.status === 'added_to_products' ? 'default' : 'secondary'}>{productProjectStatusLabels[project.status]}</Badge>
        </div>
        <div className="mt-5"><ProductProjectLifecycle status={project.status} /></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <InfoBlock title="Описание продукта" value={project.description} />
          <InfoBlock title="Характеристики" value={project.characteristics} />
          <InfoBlock title="Пожелания клиента" value={project.client_wishes} />
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section className="min-w-0 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Версии изделия</h2>
            <p className="mt-1 text-sm text-muted-foreground">Откройте версию, чтобы увидеть требования, корректировки, чертежи, файлы и переписку.</p>
            <div className="mt-4 min-w-0 space-y-3">
              {versions.map((version) => {
                const expanded = expandedVersionId === version.id
                const isCurrent = version.id === currentVersion?.id
                const versionFiles = project.files.filter((file) => file.version_id === version.id)
                const versionMailLinks = mailLinks.filter((link) => link.version_id === version.id)
                return (
                  <article key={version.id} className="min-w-0 overflow-hidden rounded-xl border border-[#E8ECF0]">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`product-project-version-${version.id}`}
                      onClick={() => setExpandedVersionId(expanded ? null : version.id)}
                      className="flex min-h-16 w-full min-w-0 items-center gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#1B3A6B]">{versionTitle(version)}</span>
                          <Badge variant={isCurrent ? 'default' : 'outline'}>{isCurrent ? 'Текущая версия' : 'Архивная версия'}</Badge>
                          <Badge variant={version.status === 'approved' ? 'default' : 'secondary'}>{versionStatusLabels[version.status]}</Badge>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">Создана {new Date(version.created_at).toLocaleDateString('ru-RU')} · файлов: {versionFiles.length} · писем: {versionMailLinks.length}</span>
                      </span>
                      <ChevronDown className={cn('size-5 shrink-0 text-[#1B3A6B] transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                    </button>

                    {expanded && (
                      <div id={`product-project-version-${version.id}`} className="min-w-0 space-y-6 border-t bg-muted/10 p-4 sm:p-5">
                        {version.correction_note && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Что изменяет эта версия</p>
                            <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-amber-950">{version.correction_note}</p>
                          </div>
                        )}
                        <VersionInformation version={version} />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-[#1B3A6B]">Файлы и чертежи версии</h3>
                          <div className="mt-3"><ProjectFileList files={versionFiles} onDelete={deleteFile} /></div>
                        </div>
                        <div className="min-w-0">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]"><Mail className="size-4" aria-hidden="true" /> Переписка версии</h3>
                          <div className="mt-3">
                            <LinkedMailSection target="product_project" targetId={project.id} links={versionMailLinks} canUnlink={canManage} emptyText="К этой версии почта не прикреплена." />
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Файлы проекта</h2>
            <p className="mt-1 text-sm text-muted-foreground">Выберите «Весь проект» для общего файла или конкретную версию.</p>
            <form onSubmit={uploadFile} className="mt-4 grid min-w-0 gap-3 md:grid-cols-[150px_180px_minmax(0,1fr)_auto]">
              <Select value={fileKind} onValueChange={(value) => setFileKind((value || 'other') as ProductProjectFile['file_kind'])}>
                <SelectTrigger className="min-h-11 w-full"><SelectValue>{fileKindLabels[fileKind]}</SelectValue></SelectTrigger>
                <SelectContent>{Object.entries(fileKindLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={fileVersionId} onValueChange={(value) => setFileVersionId(value || 'project')}>
                <SelectTrigger className="min-h-11 w-full"><SelectValue>{selectedFileVersionLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Весь проект</SelectItem>
                  {versions.map((version) => <SelectItem key={version.id} value={version.id}>{versionTitle(version)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input ref={fileInputRef} type="file" className="min-h-11 min-w-0" />
              <Button type="submit" className="min-h-11" disabled={isUploading}><Upload className="size-4" aria-hidden="true" />{isUploading ? 'Загрузка…' : 'Загрузить'}</Button>
            </form>
            <div className="mt-4"><ProjectFileList files={commonFiles} onDelete={deleteFile} emptyText="Общих файлов проекта пока нет." /></div>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#1B3A6B]">Корректировки</h2>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setIsCorrectionOpen(true)} disabled={!canManage || ['added_to_products', 'cancelled'].includes(project.status)}>
                <Plus className="size-4" aria-hidden="true" />Новая корректировка
              </Button>
            </div>
            <p className="text-sm text-[#6B7280]">Новая версия сохранит исходные пожелания клиента, а замечания менеджера, файлы и почта будут показаны отдельно.</p>
          </section>

          <form onSubmit={approveForClient} className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <div>
              <h2 className="text-lg font-semibold text-[#1B3A6B]">Подготовка к заказу</h2>
              <p className="mt-1 text-sm font-medium text-primary">{approvedVersion ? `Готова к заказу: ${versionTitle(approvedVersion)}` : currentVersion ? `К заказу готовится: ${versionTitle(currentVersion)}` : 'Версия не найдена'}</p>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <InfoBlock title="Номер чертежа" value={currentVersion?.drawing_number} compact />
              <InfoBlock title="Вес, кг" value={currentVersion?.unit_weight_kg ? String(currentVersion.unit_weight_kg) : null} compact />
            </div>
            <div className="space-y-2"><Label>Название на украинском *</Label><Input value={approvalDraft.name_uk} onChange={(event) => setApprovalDraft((current) => ({ ...current, name_uk: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>Название на английском *</Label><Input value={approvalDraft.name_en} onChange={(event) => setApprovalDraft((current) => ({ ...current, name_en: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>УКТЗЕД *</Label><Input value={approvalDraft.uktzed} onChange={(event) => setApprovalDraft((current) => ({ ...current, uktzed: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>Базовая цена, EUR *</Label><Input type="number" min="0" step="0.01" value={approvalDraft.base_price_eur || ''} onChange={(event) => setApprovalDraft((current) => ({ ...current, base_price_eur: Number(event.target.value) }))} required /></div>
            <LoadingButton type="submit" disabled={!canManage || !currentVersion || ['added_to_products', 'cancelled'].includes(project.status)} loading={isApproving} className="min-h-11 w-full bg-[#1B3A6B] text-white hover:bg-[#152D54]">
              {currentVersion ? `Подтвердить версию ${currentVersion.version_label || currentVersion.version_number} готовой к заказу` : 'Подтвердить готовность к заказу'}
            </LoadingButton>
          </form>
        </div>
      </div>

      <CorrectionDialog
        open={isCorrectionOpen}
        onOpenChange={setCorrectionOpen}
        correctionText={correctionText}
        onCorrectionTextChange={setCorrectionText}
        files={correctionFiles}
        onAddFiles={addCorrectionFiles}
        onRemoveFile={(index) => setCorrectionFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
        fileInputRef={correctionFileInputRef}
        selectedThreadIds={correctionThreadIds}
        onSelectedThreadIdsChange={setCorrectionThreadIds}
        prefilledMail={prefilledCorrectionMail}
        onRemovePrefilledMail={() => setPrefilledCorrectionMail(null)}
        submitting={isRequestingCorrection}
        onSubmit={submitCorrection}
      />
    </div>
  )
}

function VersionInformation({ version }: { version: ProductProjectVersion }) {
  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-[#1B3A6B]">Требования</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <InfoBlock title="Описание" value={version.description} compact />
          <InfoBlock title="Характеристики" value={version.characteristics} compact />
          <InfoBlock title="Пожелания клиента" value={version.client_wishes} compact />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-[#1B3A6B]">Инженерные и коммерческие данные</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoBlock title="Номер чертежа" value={version.drawing_number} compact />
          <InfoBlock title="Вес, кг" value={version.unit_weight_kg ? String(version.unit_weight_kg) : null} compact />
          <InfoBlock title="УКТЗЕД" value={version.uktzed} compact />
          <InfoBlock title="Название на украинском" value={version.name_uk} compact />
          <InfoBlock title="Название на английском" value={version.name_en} compact />
          <InfoBlock title="Базовая цена, EUR" value={version.base_price_eur !== null ? String(version.base_price_eur) : null} compact />
        </div>
      </div>
    </>
  )
}

function CorrectionDialog({
  open,
  onOpenChange,
  correctionText,
  onCorrectionTextChange,
  files,
  onAddFiles,
  onRemoveFile,
  fileInputRef,
  selectedThreadIds,
  onSelectedThreadIdsChange,
  prefilledMail,
  onRemovePrefilledMail,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  correctionText: string
  onCorrectionTextChange: (value: string) => void
  files: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  selectedThreadIds: string[]
  onSelectedThreadIdsChange: (ids: string[]) => void
  prefilledMail: MailLinkPreview | null
  onRemovePrefilledMail: () => void
  submitting: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14">
          <DialogTitle>Новая корректировка</DialogTitle>
          <DialogDescription>Опишите изменения и при необходимости приложите почту, фото, документы или чертежи. CRM создаст новую версию и задачу инженеру.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="product-project-correction-note">Что нужно изменить *</Label>
              <Textarea id="product-project-correction-note" value={correctionText} onChange={(event) => onCorrectionTextChange(event.target.value)} rows={5} maxLength={5000} placeholder="Опишите замечания клиента и ожидаемый результат" required />
            </div>
            <div className="space-y-3">
              <div><Label htmlFor="product-project-correction-files">Файлы корректировки</Label><p className="mt-1 text-xs text-muted-foreground">До 10 файлов по 50 МБ: фото, документы, архивы, DXF/DWG и STEP/IGES.</p></div>
              <Input ref={fileInputRef} id="product-project-correction-files" type="file" accept={correctionFileAccept} multiple className="min-h-11" onChange={(event) => onAddFiles(Array.from(event.target.files || []))} />
              {files.length > 0 && <div className="space-y-2">{files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-w-0 items-center gap-3 rounded-lg border p-3">
                  <FilePlus2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} МБ</span>
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`Убрать файл ${file.name}`} onClick={() => onRemoveFile(index)}><Trash2 className="size-4 text-destructive" aria-hidden="true" /></Button>
                </div>
              ))}</div>}
            </div>
            <div className="min-w-0 space-y-3">
              <div><Label>Почтовая переписка</Label><p className="mt-1 text-xs text-muted-foreground">Выберите Gmail-цепочки, которые объясняют эту корректировку.</p></div>
              {prefilledMail && (
                <div className="flex min-w-0 items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <Paperclip className="mt-1 size-4 shrink-0 text-blue-700" aria-hidden="true" />
                  <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{prefilledMail.kind === 'thread' ? 'Цепочка из почты' : 'Письмо из почты'}</p><p className="mt-1 line-clamp-2 break-words text-sm font-medium text-blue-950">{prefilledMail.subject}</p></div>
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Убрать письмо" onClick={onRemovePrefilledMail}><X className="size-4" /></Button>
                </div>
              )}
              <div className="h-80 min-w-0 overflow-hidden">
                <MailThreadPicker selected={selectedThreadIds} onChange={onSelectedThreadIdsChange} maxSelected={prefilledMail ? 9 : 10} />
              </div>
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 shrink-0 border-t bg-background px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Отмена</Button>
            <LoadingButton type="submit" className="min-h-11 w-full sm:w-auto" loading={submitting}>Отправить инженеру</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectFileList({ files, onDelete, emptyText = 'Файлов этой версии пока нет.' }: {
  files: ProductProjectFile[]
  onDelete: (file: ProductProjectFile) => Promise<void>
  emptyText?: string
}) {
  if (files.length === 0) return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{emptyText}</div>
  return (
    <div className="min-w-0 space-y-2">
      {files.map((file) => (
        <div key={file.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fileKindLabels[file.file_kind]}</p><p className="mt-1 break-words [overflow-wrap:anywhere] text-sm font-medium text-[#1B3A6B]">{file.file_name}</p></div>
          <div className="flex shrink-0 gap-2">
            <a href={`/api/product-projects/files/${file.id}`} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 flex-1 sm:flex-none')}><Download className="size-4" aria-hidden="true" />Открыть</a>
            <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`Удалить файл ${file.file_name}`} onClick={() => void onDelete(file)}><Trash2 className="size-4 text-red-500" aria-hidden="true" /></Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function InfoBlock({ title, value, compact = false }: { title: string; value?: string | null; compact?: boolean }) {
  return (
    <div className={compact ? 'min-w-0' : 'min-w-0 rounded-lg bg-[#F8F9FA] p-4'}>
      <div className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">{title}</div>
      <div className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-[#374151]">{value || '—'}</div>
    </div>
  )
}
