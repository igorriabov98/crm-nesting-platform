"use client"

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Download, Plus, Trash2, Upload } from 'lucide-react'
import {
  approveProductProjectVersion,
  createProductProjectVersion,
  deleteProductProjectFile,
  promoteProjectVersionToProduct,
  uploadProductProjectFile,
  type ProductProjectDetails,
} from '@/lib/actions/products'
import { ROUTES } from '@/lib/constants/routes'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ProductProjectFile, ProductProjectVersion } from '@/lib/types'
import type { ProductProjectVersionInput, PromoteProductVersionInput } from '@/lib/types/schemas'

const versionStatusLabels: Record<ProductProjectVersion['status'], string> = {
  draft: 'Черновик',
  client_review: 'Согласование',
  approved: 'Подтверждена',
  superseded: 'Заменена',
}

const projectStatusLabels: Record<ProductProjectDetails['status'], string> = {
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
  const [versionDraft, setVersionDraft] = useState<ProductProjectVersionInput>({
    version_label: '',
    description: project.description || '',
    characteristics: project.characteristics || '',
    client_wishes: project.client_wishes || '',
    status: 'draft',
  })
  const [fileKind, setFileKind] = useState<ProductProjectFile['file_kind']>('drawing')
  const [fileVersionId, setFileVersionId] = useState<string>('project')
  const [isUploading, setIsUploading] = useState(false)
  const [isAddingVersion, setIsAddingVersion] = useState(false)
  const approvedVersion = project.versions.find((version) => version.id === project.approved_version_id) || project.versions.find((version) => version.status === 'approved') || null
  const [promoteDraft, setPromoteDraft] = useState<PromoteProductVersionInput>({
    name_uk: project.title,
    name_en: project.title,
    uktzed: '',
    drawing_number: '',
    unit_weight_kg: 0,
    base_price_eur: 0,
    status: 'active',
  })

  async function addVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsAddingVersion(true)
    try {
      const result = await createProductProjectVersion(project.id, versionDraft)
      if (!result.success) throw new Error(result.error || 'Не удалось добавить версию')
      toast.success('Версия добавлена')
      setVersionDraft({ version_label: '', description: '', characteristics: '', client_wishes: '', status: 'draft' })
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsAddingVersion(false)
    }
  }

  async function approveVersion(version: ProductProjectVersion) {
    const result = await approveProductProjectVersion(project.id, version.id)
    if (!result.success) {
      toast.error(result.error || 'Не удалось подтвердить версию')
      return
    }
    toast.success('Версия подтверждена')
    router.refresh()
  }

  async function promoteVersion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!approvedVersion) {
      toast.error('Сначала подтвердите итоговую версию')
      return
    }
    const result = await promoteProjectVersionToProduct(project.id, approvedVersion.id, promoteDraft)
    if (!result.success) {
      toast.error(result.error || 'Не удалось добавить в продукцию')
      return
    }
    toast.success('Версия добавлена в продукцию')
    router.push(`${ROUTES.PRODUCTS}/${result.product?.id}`)
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
                    <div className="flex items-center gap-2">
                      <Badge variant={version.status === 'approved' ? 'default' : 'secondary'}>{versionStatusLabels[version.status]}</Badge>
                      <Button type="button" variant="outline" size="sm" onClick={() => void approveVersion(version)}>
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Подтвердить
                      </Button>
                    </div>
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
          <form onSubmit={addVersion} className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Новая версия</h2>
            <div className="space-y-2">
              <Label>Метка версии</Label>
              <Input value={versionDraft.version_label || ''} placeholder="2.3.4" onChange={(event) => setVersionDraft((current) => ({ ...current, version_label: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea rows={3} value={versionDraft.description || ''} onChange={(event) => setVersionDraft((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Характеристики</Label>
              <Textarea rows={3} value={versionDraft.characteristics || ''} onChange={(event) => setVersionDraft((current) => ({ ...current, characteristics: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Пожелания клиента</Label>
              <Textarea rows={3} value={versionDraft.client_wishes || ''} onChange={(event) => setVersionDraft((current) => ({ ...current, client_wishes: event.target.value }))} />
            </div>
            <LoadingButton type="submit" loading={isAddingVersion} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Добавить версию
            </LoadingButton>
          </form>

          <form onSubmit={promoteVersion} className="space-y-4 rounded-xl border border-[#E8ECF0] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Добавить в продукцию</h2>
            <p className="text-sm text-[#6B7280]">
              Переносит подтвержденную версию в базу продукции. После этого товар можно выбирать в машине.
            </p>
            <Input value={promoteDraft.name_uk} onChange={(event) => setPromoteDraft((current) => ({ ...current, name_uk: event.target.value }))} placeholder="Название на укр" required />
            <Input value={promoteDraft.name_en} onChange={(event) => setPromoteDraft((current) => ({ ...current, name_en: event.target.value }))} placeholder="Название на англ" required />
            <Input value={promoteDraft.uktzed} onChange={(event) => setPromoteDraft((current) => ({ ...current, uktzed: event.target.value }))} placeholder="УКТЗЕД" required />
            <Input value={promoteDraft.drawing_number} onChange={(event) => setPromoteDraft((current) => ({ ...current, drawing_number: event.target.value }))} placeholder="Номер чертежа" required />
            <Input type="number" min="0" step="0.001" value={promoteDraft.unit_weight_kg || ''} onChange={(event) => setPromoteDraft((current) => ({ ...current, unit_weight_kg: Number(event.target.value) }))} placeholder="Вес единицы, кг" required />
            <Input type="number" min="0" step="0.01" value={promoteDraft.base_price_eur || ''} onChange={(event) => setPromoteDraft((current) => ({ ...current, base_price_eur: Number(event.target.value) }))} placeholder="Базовая цена, EUR" required />
            <LoadingButton type="submit" disabled={!approvedVersion} loading={false} className="w-full bg-[#1B3A6B] text-white hover:bg-[#152D54]">
              Добавить итоговую версию в продукцию
            </LoadingButton>
          </form>
        </div>
      </div>
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
