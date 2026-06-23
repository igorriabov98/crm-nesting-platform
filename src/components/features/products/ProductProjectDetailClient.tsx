"use client"

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import {
  deleteProductProjectFile,
  approveProductProjectForClient,
  requestProductProjectCorrection,
  uploadProductProjectFile,
  type ProductProjectDetails,
  type ProductProjectApprovalInput,
} from '@/lib/actions/products'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProductProjectFile, ProductProjectVersion } from '@/lib/types'

const versionStatusLabels: Record<ProductProjectVersion['status'], string> = {
  draft: 'Черновик',
  client_review: 'Согласование',
  approved: 'Подтверждена',
  superseded: 'Заменена',
}

const projectStatusLabels: Record<ProductProjectDetails['status'], string> = {
  new_project: 'Новый проект',
  draft: 'Черновик',
  engineering: 'В работе у инженера',
  client_review: 'На согласовании',
  approved: 'Подтвержден',
  added_to_products: 'Добавлен в продукцию',
  cancelled: 'Отменен',
}

const fileKindLabels: Record<ProductProjectFile['file_kind'], string> = {
  drawing: 'Чертеж',
  step: 'STEP',
  pdf: 'PDF',
  photo: 'Фото',
  other: 'Другое',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function ProductProjectDetailClient({ project }: { project: ProductProjectDetails }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileKind, setFileKind] = useState<ProductProjectFile['file_kind']>('drawing')
  const [fileVersionId, setFileVersionId] = useState<string>('project')
  const [isUploading, setIsUploading] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false)
  const [correctionText, setCorrectionText] = useState('')
  const [isRequestingCorrection, setIsRequestingCorrection] = useState(false)
  const currentVersion = [...project.versions].sort((a, b) => a.version_number - b.version_number).at(-1) || null
  const [approvalDraft, setApprovalDraft] = useState<ProductProjectApprovalInput>({
    name_uk: currentVersion?.name_uk || project.title,
    name_en: currentVersion?.name_en || project.title,
    uktzed: currentVersion?.uktzed || '',
    base_price_eur: Number(currentVersion?.base_price_eur || 0),
  })

  async function approveForClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentVersion) {
      toast.error('Версия проекта не найдена')
      return
    }
    setIsApproving(true)
    try {
      const result = await approveProductProjectForClient(project.id, approvalDraft)
      if (!result.success) throw new Error(result.error || 'Не удалось утвердить проект')
      toast.success('Проект утвержден')
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsApproving(false)
    }
  }

  async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsRequestingCorrection(true)
    try {
      const result = await requestProductProjectCorrection(project.id, { client_wishes: correctionText })
      if (!result.success) throw new Error(result.error || 'Не удалось создать корректировку')
      toast.success('Корректировка отправлена инженеру')
      setCorrectionText('')
      setIsCorrectionOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsRequestingCorrection(false)
    }
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Выберите файл')
      return
    }
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
    toast.success('Файл удален')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">{project.title}</h1>
            <p className="text-sm text-[#6B7280]">
              Клиент: {project.client?.name || '—'} · Инженер: {project.assigned_engineer?.full_name || '—'}
            </p>
          </div>
          <Badge variant={project.status === 'added_to_products' ? 'default' : 'secondary'}>{projectStatusLabels[project.status]}</Badge>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <InfoBlock title="Описание продукта" value={project.description} />
          <InfoBlock title="Характеристики" value={project.characteristics} />
          <InfoBlock title="Пожелания клиента" value={project.client_wishes} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Версии изделия</h2>
            <div className="mt-4 space-y-3">
              {project.versions.map((version) => (
                <div key={version.id} className="rounded-lg border border-[#E8ECF0] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#1B3A6B]">
                          Версия {version.version_label || version.version_number}
                        </div>
                        <div className="text-xs text-[#9CA3AF]">#{version.version_number}</div>
                      </div>
                      <Badge variant={version.status === 'approved' ? 'default' : 'secondary'}>{versionStatusLabels[version.status]}</Badge>
                    </div>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                    <InfoBlock title="Описание" value={version.description} compact />
                    <InfoBlock title="Характеристики" value={version.characteristics} compact />
                    <InfoBlock title="Пожелания" value={version.client_wishes} compact />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Файлы проекта</h2>
            <form onSubmit={uploadFile} className="mt-4 grid gap-3 md:grid-cols-[150px_180px_1fr_auto]">
              <Select value={fileKind} onValueChange={(value) => setFileKind((value || 'other') as ProductProjectFile['file_kind'])}>
                <SelectTrigger><SelectValue>{fileKindLabels[fileKind]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {Object.entries(fileKindLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fileVersionId} onValueChange={(value) => setFileVersionId(value || 'project')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Весь проект</SelectItem>
                  {project.versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>Версия {version.version_label || version.version_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input ref={fileInputRef} type="file" />
              <Button type="submit" disabled={isUploading}>
                <Upload className="mr-2 h-4 w-4" />
                Загрузить
              </Button>
            </form>
            <div className="mt-4 overflow-hidden rounded-lg border border-[#E8ECF0]">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-[#E8ECF0]">
                  {project.files.length === 0 ? (
                    <tr><td className="px-4 py-8 text-center text-[#9CA3AF]">Файлов пока нет.</td></tr>
                  ) : project.files.map((file) => (
                    <tr key={file.id}>
                      <td className="px-4 py-3">{fileKindLabels[file.file_kind]}</td>
                      <td className="px-4 py-3 font-medium text-[#1B3A6B]">{file.file_name}</td>
                      <td className="px-4 py-3 text-[#6B7280]">
                        {file.version_id ? `Версия ${project.versions.find((version) => version.id === file.version_id)?.version_label || ''}` : 'Весь проект'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <a href={`/api/product-projects/files/${file.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                            <Download className="mr-1 h-4 w-4" />
                            Открыть
                          </a>
                          <Button type="button" variant="ghost" size="icon" onClick={() => void deleteFile(file)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#1B3A6B]">Корректировки</h2>
              <Button type="button" variant="outline" onClick={() => setIsCorrectionOpen(true)} disabled={project.status === 'added_to_products'}>
                <Plus className="mr-2 h-4 w-4" />
                Новая корректировка
              </Button>
            </div>
            <p className="text-sm text-[#6B7280]">
              Если клиент просит изменения, создайте новую версию. Задача автоматически вернется назначенному инженеру.
            </p>
          </section>

          <form onSubmit={approveForClient} className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Согласование с клиентом</h2>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <InfoBlock title="Номер чертежа" value={currentVersion?.drawing_number} compact />
              <InfoBlock title="Вес, кг" value={currentVersion?.unit_weight_kg ? String(currentVersion.unit_weight_kg) : null} compact />
            </div>
            <div className="space-y-2">
              <Label>Название на украинском *</Label>
              <Input value={approvalDraft.name_uk} onChange={(event) => setApprovalDraft((current) => ({ ...current, name_uk: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Название на английском *</Label>
              <Input value={approvalDraft.name_en} onChange={(event) => setApprovalDraft((current) => ({ ...current, name_en: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>УКТЗЕД *</Label>
              <Input value={approvalDraft.uktzed} onChange={(event) => setApprovalDraft((current) => ({ ...current, uktzed: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Базовая цена, EUR *</Label>
              <Input type="number" min="0" step="0.01" value={approvalDraft.base_price_eur || ''} onChange={(event) => setApprovalDraft((current) => ({ ...current, base_price_eur: Number(event.target.value) }))} required />
            </div>
            <LoadingButton type="submit" disabled={!currentVersion || project.status === 'added_to_products'} loading={isApproving} className="w-full bg-[#1B3A6B] text-white hover:bg-[#152D54]">
              Утвердить модель
            </LoadingButton>
          </form>
        </div>
      </div>

      <Dialog open={isCorrectionOpen} onOpenChange={setIsCorrectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая корректировка</DialogTitle>
            <DialogDescription>Опишите замечания клиента. CRM создаст новую версию и задачу инженеру.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCorrection} className="space-y-4">
            <Textarea value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} rows={5} placeholder="Что нужно изменить" required />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCorrectionOpen(false)}>Отмена</Button>
              <LoadingButton type="submit" loading={isRequestingCorrection}>Отправить инженеру</LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoBlock({ title, value, compact = false }: { title: string; value?: string | null; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'rounded-lg bg-[#F8F9FA] p-4'}>
      <div className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-[#374151]">{value || '—'}</div>
    </div>
  )
}
