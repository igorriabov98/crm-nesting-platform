"use client"

import React, { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'
import { ClipboardList, FileText, Loader2, Upload, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MachineRequestPanel } from '@/components/features/machines/MachineRequestPanel'
import { useRole } from '@/lib/hooks/useRole'
import { useUser } from '@/lib/hooks/useUser'
import { updateMachineMaterialType } from '@/app/(protected)/sales-plan/actions'
import {
  requestMachineLayout,
  uploadMachineLayoutPdf,
  type MachineLayoutDiffItem,
  type MachineLayoutPayload,
  type MachineLayoutSnapshotItem,
  type MachineLayoutVersion,
} from '@/lib/actions/machine-layout'
import { cn } from '@/lib/utils'
import type { MachineDetails, MaterialType } from '@/lib/types'
import type { TechnologistRequestPayload } from '@/lib/actions/technologist-requests'

type Props = {
  machine: MachineDetails
  requestData: TechnologistRequestPayload | null
  layoutData: MachineLayoutPayload | null
  canManageTechnologistRequests: boolean
  canViewSupplyRequest: boolean
}

const MATERIAL_TYPE_LABELS = {
  undefined: 'Не определён',
  standard: 'Стандартный',
  non_standard: 'Нестандартный',
} satisfies Record<MaterialType, string>

const CHANGE_LABELS: Record<MachineLayoutDiffItem['changes'][number], string> = {
  productName: 'наименование',
  drawingNumber: 'чертёж',
  quantity: 'кол-во',
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: ru })
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function LayoutStatusBadge({ version }: { version: MachineLayoutVersion | null }) {
  if (!version) return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Нет запроса</Badge>
  if (version.status === 'completed') {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">PDF загружен</Badge>
  }
  return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Ожидает PDF</Badge>
}

function DrawingLink({ item }: { item: MachineLayoutSnapshotItem }) {
  if (!item.drawingNumber) return <span className="text-slate-400">—</span>
  if (!item.drawingUrl) return <span>{item.drawingNumber}</span>
  return (
    <a
      href={item.drawingUrl}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-blue-800 underline-offset-4 hover:underline"
      title={item.drawingFileName || item.drawingNumber}
    >
      {item.drawingNumber}
    </a>
  )
}

function ItemsTable({ items }: { items: MachineLayoutSnapshotItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-12 px-3 py-3 text-center">#</th>
              <th className="min-w-[280px] px-3 py-3">Наименование изделия</th>
              <th className="min-w-[180px] px-3 py-3">Номер чертежа</th>
              <th className="w-32 px-3 py-3 text-right">Кол-во</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="h-24 px-4 text-center text-slate-500">
                  Товары пока не добавлены
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={item.machineItemId} className="bg-white hover:bg-slate-50">
                  <td className="px-3 py-3 text-center text-slate-400">{index + 1}</td>
                  <td className="px-3 py-3 font-medium text-slate-900">{item.productName || '—'}</td>
                  <td className="px-3 py-3 text-slate-700"><DrawingLink item={item} /></td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{formatQuantity(item.quantity)} шт</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DiffPanel({ diff }: { diff: MachineLayoutDiffItem[] }) {
  if (diff.length === 0) return null

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-amber-700" aria-hidden="true" />
        <h3 className="font-semibold text-amber-900">Изменения с прошлой версии</h3>
      </div>
      <div className="mt-3 grid gap-2">
        {diff.map((change) => (
          <div key={`${change.type}-${change.item.machineItemId}`} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700">
            {change.type === 'added' && (
              <span><span className="font-semibold text-emerald-700">Добавлено:</span> {change.item.productName} · {formatQuantity(change.item.quantity)} шт</span>
            )}
            {change.type === 'removed' && (
              <span><span className="font-semibold text-red-700">Удалено:</span> {change.item.productName}</span>
            )}
            {change.type === 'changed' && (
              <span>
                <span className="font-semibold text-amber-800">Изменено:</span> {change.item.productName}
                <span className="text-slate-500"> ({change.changes.map((item) => CHANGE_LABELS[item]).join(', ')})</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function VersionHistory({ versions }: { versions: MachineLayoutVersion[] }) {
  if (versions.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="font-semibold text-slate-950">История расстановок</h3>
      <div className="mt-3 divide-y divide-slate-100">
        {versions.map((version) => (
          <div key={version.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-slate-900">Версия {version.versionNo}</div>
              <div className="text-sm text-slate-500">
                Запрос: {formatDateTime(version.createdAt)}
                {version.completedAt ? ` · PDF: ${formatDateTime(version.completedAt)}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <LayoutStatusBadge version={version} />
              {version.pdfUrl && (
                <a
                  href={version.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'border-blue-200 text-blue-800')}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  PDF
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function TechnologistTab({
  machine,
  requestData,
  layoutData,
  canManageTechnologistRequests,
  canViewSupplyRequest,
}: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { role, isDirector } = useRole()
  const { user } = useUser()
  const [isUpdatingMaterialType, setIsUpdatingMaterialType] = useState(false)
  const [isRequestingLayout, setIsRequestingLayout] = useState(false)
  const [isUploadingPdf, setIsUploadingPdf] = useState(false)

  const currentItems = layoutData?.currentItems || []
  const latest = layoutData?.latest || null
  const versions = layoutData?.versions || []
  const visibleItems = latest?.items?.length ? latest.items : currentItems
  const canRequestLayout = !machine.is_archived && currentItems.length > 0 && (isDirector || role === 'sales_manager')
  const canUploadPdf = !machine.is_archived && latest?.status === 'requested' && (
    isDirector || (role === 'technologist' && latest.assignedTo === user?.id)
  )
  const materialTypeValue = (machine.material_type || 'undefined') as MaterialType
  const materialTypeLabel = MATERIAL_TYPE_LABELS[materialTypeValue] ?? MATERIAL_TYPE_LABELS['undefined']
  const canEditMaterialType = isDirector || role === 'technologist'

  const handleMaterialTypeChange = async (value: MaterialType | null) => {
    if (!value) return
    setIsUpdatingMaterialType(true)
    const result = await updateMachineMaterialType(machine.id, value)
    setIsUpdatingMaterialType(false)
    if (!result.success) {
      toast.error(result.error || 'Не удалось обновить тип материала')
      return
    }
    toast.success('Тип материала обновлён')
    router.refresh()
  }

  const handleLayoutRequest = async () => {
    setIsRequestingLayout(true)
    const result = await requestMachineLayout(machine.id)
    setIsRequestingLayout(false)
    if (!result.success) {
      toast.error(result.error || 'Не удалось создать запрос на расстановку')
      return
    }
    toast.success('Запрос на расстановку отправлен технологу')
    router.refresh()
  }

  const handlePdfUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    event.target.value = ''
    if (!file || !latest) return

    setIsUploadingPdf(true)
    const formData = new FormData()
    formData.append('request_id', latest.id)
    formData.append('file', file)
    const result = await uploadMachineLayoutPdf(formData)
    setIsUploadingPdf(false)

    if (!result.success) {
      toast.error(result.error || 'Не удалось загрузить PDF')
      return
    }
    toast.success('PDF расстановки загружен, задача закрыта')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-800">
            <Wrench className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-950">Технолог</h2>
            <p className="mt-1 text-sm text-slate-500">Материалы, заявки и расстановка изделий в машине.</p>
          </div>
        </div>
        <div className="w-full sm:w-72">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Тип материала</span>
          <Select
            value={materialTypeValue}
            onValueChange={handleMaterialTypeChange}
            disabled={!canEditMaterialType || isUpdatingMaterialType}
          >
            <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
              <SelectValue>{materialTypeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="undefined">{MATERIAL_TYPE_LABELS['undefined']}</SelectItem>
              <SelectItem value="standard">{MATERIAL_TYPE_LABELS.standard}</SelectItem>
              <SelectItem value="non_standard">{MATERIAL_TYPE_LABELS.non_standard}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <MachineRequestPanel
        machineId={machine.id}
        requestData={requestData}
        canManageTechnologistRequests={canManageTechnologistRequests}
        canViewSupplyRequest={canViewSupplyRequest}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-950">Расстановка изделий в машине</h3>
              <LayoutStatusBadge version={latest} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {latest
                ? `Текущая версия ${latest.versionNo}, запрос создан ${formatDateTime(latest.createdAt)}.`
                : 'Запрос на расстановку ещё не создан.'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {latest?.pdfUrl && (
              <a
                href={latest.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 border-blue-200 text-blue-800')}
              >
                <FileText className="mr-2 h-4 w-4" />
                Открыть PDF
              </a>
            )}
            {canUploadPdf && (
              <>
                <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdfUpload} />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isUploadingPdf}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-11 border-emerald-200 text-emerald-700"
                >
                  {isUploadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Загрузить PDF
                </Button>
              </>
            )}
            {canRequestLayout && (
              <Button type="button" onClick={handleLayoutRequest} disabled={isRequestingLayout} className="min-h-11 bg-blue-950 text-white hover:bg-blue-900">
                {isRequestingLayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                Запрос на расстановку машины
              </Button>
            )}
          </div>
        </div>
        {!canRequestLayout && currentItems.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Добавьте товары в машину, чтобы запросить расстановку.
          </div>
        )}
      </section>

      <DiffPanel diff={latest?.diff || []} />

      <section className={cn('space-y-3', visibleItems.length === 0 && 'opacity-80')}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-950">Продукция для расстановки</h3>
          <span className="text-sm text-slate-500">{visibleItems.length} поз.</span>
        </div>
        <ItemsTable items={visibleItems} />
      </section>

      <VersionHistory versions={versions} />
    </div>
  )
}
