'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Archive, Clock3, Download, FileArchive, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { registerMachineCuttingArchive, type MachineCuttingPayload, type MachineCuttingRequest } from '@/lib/actions/machine-cutting'
import { cleanupDirectMachineCuttingUpload, uploadMachineCuttingFileDirect } from '@/lib/machine-cutting/direct-upload-client'
import { validateMachineCuttingUploadRequest } from '@/lib/machine-cutting/files'
import { cn } from '@/lib/utils'

type Props = {
  machineId: string
  initialData: MachineCuttingPayload | null
  error: string | null
  canManage: boolean
}

const acceptArchives = '.zip,.rar,.7z,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed'

function formatDateTime(value: string) {
  return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: ru })
}

function formatHoursMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} МБ`
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(bytes / 1024)} КБ`
}

function TimeCard({ label, minutes, emphasized = false }: { label: string; minutes: number; emphasized?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border p-4 shadow-sm', emphasized ? 'border-blue-200 bg-blue-950 text-white' : 'border-slate-200 bg-white text-slate-950')}>
      <div className={cn('text-sm font-medium', emphasized ? 'text-blue-100' : 'text-slate-500')}>{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{minutes} мин</div>
      <div className={cn('mt-1 text-sm tabular-nums', emphasized ? 'text-blue-200' : 'text-slate-500')}>{formatHoursMinutes(minutes)}</div>
    </div>
  )
}

function RequestTitle({ request }: { request: MachineCuttingRequest }) {
  return (
    <div className="min-w-0">
      <h3 className="font-semibold text-slate-950">Заявка №{request.number}</h3>
      <p className="mt-1 break-words text-sm text-slate-500">{formatDateTime(request.createdAt)} · {request.authorName}</p>
    </div>
  )
}

export function MachineCuttingPanel({ machineId, initialData, error, canManage }: Props) {
  const [data, setData] = useState(initialData)
  const [uploadingRequestId, setUploadingRequestId] = useState<string | null>(null)

  useEffect(() => setData(initialData), [initialData])

  const handleUpload = async (requestGroup: MachineCuttingRequest, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    event.target.value = ''
    if (!file || !requestGroup.completion) return
    try {
      validateMachineCuttingUploadRequest({ fileName: file.name, fileSize: file.size })
      setUploadingRequestId(requestGroup.id)
      const upload = await uploadMachineCuttingFileDirect(machineId, requestGroup.id, file)
      if (upload.completionId !== requestGroup.completion.id) {
        await cleanupDirectMachineCuttingUpload(machineId, upload)
        throw new Error('Завершение заявки изменилось. Повторите загрузку')
      }
      const result = await registerMachineCuttingArchive(machineId, upload)
      if (!result.success || !result.data) {
        await cleanupDirectMachineCuttingUpload(machineId, upload)
        throw new Error(result.error || 'Не удалось зарегистрировать архив')
      }
      setData(result.data)
      toast.success(`Архив добавлен к заявке №${requestGroup.number}`)
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Не удалось загрузить архив')
    } finally {
      setUploadingRequestId(null)
    }
  }

  if (error) return <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm" role="alert">Не удалось загрузить данные порезки: {error}</section>
  if (!data) return <section className="flex min-h-40 items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm" role="status">Загрузка данных порезки…</section>

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:p-5" aria-label="Общее время заказа">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-blue-800">Общее итоговое время заказа</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-950">{data.totalActualMinutes} мин</p>
          </div>
          <Badge className="bg-blue-950 text-white">{formatHoursMinutes(data.totalActualMinutes)}</Badge>
        </div>
      </section>

      {data.requests.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600 shadow-sm">Заявки технолога ещё не созданы</section>
      ) : data.requests.map((requestGroup) => (
        <article key={requestGroup.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <RequestTitle request={requestGroup} />
            <Badge variant="outline" className={requestGroup.completion ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}>
              {requestGroup.completion ? 'Завершена' : 'Не завершена'}
            </Badge>
          </div>

          {!requestGroup.completion ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div><p className="font-medium text-slate-900">Время плазмы пока не рассчитано</p><p className="mt-1 text-sm text-slate-600">Время плазмы появится после завершения заявки технолога</p></div>
            </div>
          ) : (
            <>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-3">
                <TimeCard label="Указал технолог" minutes={requestGroup.completion.enteredMinutes} />
                <TimeCard label="Добавлено +25%" minutes={requestGroup.completion.addedMinutes} />
                <TimeCard label="Итоговое время" minutes={requestGroup.completion.actualMinutes} emphasized />
              </div>

              <div className="mt-4 flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex items-center gap-2"><FileArchive className="h-5 w-5 shrink-0 text-blue-800" aria-hidden="true" /><p className="font-medium text-slate-950">Программы порезки</p></div><p className="mt-1 text-sm text-slate-500">ZIP, RAR или 7Z до 500 МБ. Можно загрузить несколько архивов.</p></div>
                {requestGroup.canUpload && canManage ? (
                  <label className={cn(buttonVariants(), 'min-h-11 w-full cursor-pointer bg-blue-950 text-white hover:bg-blue-900 sm:w-auto', uploadingRequestId && 'pointer-events-none opacity-60')}>
                    {uploadingRequestId === requestGroup.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {uploadingRequestId === requestGroup.id ? 'Загрузка…' : 'Добавить архив'}
                    <input type="file" accept={acceptArchives} className="sr-only" disabled={Boolean(uploadingRequestId)} onChange={(event) => void handleUpload(requestGroup, event)} />
                  </label>
                ) : <Badge variant="outline" className="w-fit border-slate-200 bg-white text-slate-600">{data.isArchived ? 'Архивная машина' : 'Только просмотр'}</Badge>}
              </div>
            </>
          )}

          <section className="mt-4 min-w-0" aria-label={`Архивы заявки №${requestGroup.number}`}>
            <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Archive className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" /><h4 className="font-medium text-slate-950">Архивы</h4></div><span className="shrink-0 text-sm text-slate-500">{requestGroup.archives.length}</span></div>
            {requestGroup.archives.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Программа не загружена</div> : (
              <div className="mt-2 divide-y divide-slate-100">{requestGroup.archives.map((archive, index) => (
                <div key={archive.id} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-all font-medium text-slate-950">{archive.fileName}</span>{index === 0 && <Badge className="bg-blue-100 text-blue-800">Последний</Badge>}</div><div className="mt-1 text-sm text-slate-500">{formatFileSize(archive.fileSize)} · {archive.uploadedByName} · {formatDateTime(archive.uploadedAt)}</div></div><a href={archive.downloadUrl} download={archive.fileName} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11 w-full shrink-0 border-blue-200 text-blue-800 sm:w-auto')}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Скачать</a></div>
              ))}</div>
            )}
          </section>
        </article>
      ))}
    </div>
  )
}
