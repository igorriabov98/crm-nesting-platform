'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Archive, Clock3, Download, FileArchive, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  registerMachineCuttingArchive,
  type MachineCuttingPayload,
} from '@/lib/actions/machine-cutting'
import {
  cleanupDirectMachineCuttingUpload,
  uploadMachineCuttingFileDirect,
} from '@/lib/machine-cutting/direct-upload-client'
import { validateMachineCuttingUploadRequest } from '@/lib/machine-cutting/files'
import { cn } from '@/lib/utils'

type Props = {
  machineId: string
  initialData: MachineCuttingPayload | null
  error: string | null
  canManage: boolean
}

function formatDateTime(value: string) {
  return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: ru })
}

function formatHoursMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} МБ`
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(bytes / 1024)} КБ`
}

function TimeCard({ label, minutes, emphasized = false }: { label: string; minutes: number; emphasized?: boolean }) {
  return (
    <div className={cn(
      'min-w-0 rounded-2xl border p-4 shadow-sm',
      emphasized ? 'border-blue-200 bg-blue-950 text-white' : 'border-slate-200 bg-white text-slate-950',
    )}>
      <div className={cn('text-sm font-medium', emphasized ? 'text-blue-100' : 'text-slate-500')}>{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{minutes} мин</div>
      <div className={cn('mt-1 text-sm tabular-nums', emphasized ? 'text-blue-200' : 'text-slate-500')}>
        {formatHoursMinutes(minutes)}
      </div>
    </div>
  )
}

export function MachineCuttingPanel({ machineId, initialData, error, canManage }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState(initialData)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    setData(initialData)
  }, [initialData])

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    event.target.value = ''
    if (!file) return

    try {
      validateMachineCuttingUploadRequest({ fileName: file.name, fileSize: file.size })
      setIsUploading(true)
      const upload = await uploadMachineCuttingFileDirect(machineId, file)
      const result = await registerMachineCuttingArchive(machineId, upload)
      if (!result.success || !result.data) {
        await cleanupDirectMachineCuttingUpload(machineId, upload)
        throw new Error(result.error || 'Не удалось зарегистрировать архив')
      }
      setData(result.data)
      toast.success('Архив порезки загружен')
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Не удалось загрузить архив')
    } finally {
      setIsUploading(false)
    }
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm" role="alert">
        Не удалось загрузить данные порезки: {error}
      </section>
    )
  }

  if (!data) {
    return (
      <section className="flex min-h-40 items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm" role="status">
        Загрузка данных порезки…
      </section>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      {!data.completion ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-950">Время плазмы пока не рассчитано</h3>
              <p className="mt-1 text-sm text-slate-600">Время плазмы появится после завершения заявки технолога</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="cutting-time-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="cutting-time-title" className="font-semibold text-slate-950">Время порезки на плазме</h3>
                <p className="mt-1 text-sm text-slate-500">Завершено {formatDateTime(data.completion.finalizedAt)}</p>
              </div>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Заявка завершена</Badge>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <TimeCard label="Указал технолог" minutes={data.completion.enteredMinutes} />
              <TimeCard label="Добавлено +25%" minutes={data.completion.addedMinutes} />
              <TimeCard label="Итоговое время" minutes={data.completion.actualMinutes} emphasized />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileArchive className="h-5 w-5 shrink-0 text-blue-800" aria-hidden="true" />
                  <h3 className="font-semibold text-slate-950">Архив для порезки</h3>
                </div>
                <p className="mt-1 text-sm text-slate-500">ZIP, RAR или 7Z, до 500 МБ. Каждая загрузка сохраняется отдельной версией.</p>
              </div>
              {data.canUpload && canManage ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.rar,.7z,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed"
                    className="hidden"
                    onChange={handleUpload}
                  />
                  <Button
                    type="button"
                    className="min-h-11 w-full shrink-0 bg-blue-950 text-white hover:bg-blue-900 sm:w-auto"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
                    {isUploading ? 'Загрузка…' : 'Загрузить архив'}
                  </Button>
                </>
              ) : (
                <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-600">
                  {data.isArchived ? 'Архивная машина' : 'Только просмотр'}
                </Badge>
              )}
            </div>
          </section>
        </>
      )}

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="cutting-history-title">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Archive className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
            <h3 id="cutting-history-title" className="font-semibold text-slate-950">История архивов</h3>
          </div>
          <span className="shrink-0 text-sm text-slate-500">{data.archives.length} верс.</span>
        </div>
        {data.archives.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Архивы ещё не загружены
          </div>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {data.archives.map((archive, index) => (
              <div key={archive.id} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-all font-medium text-slate-950">{archive.fileName}</span>
                    {index === 0 && <Badge className="bg-blue-100 text-blue-800">Последняя</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {formatFileSize(archive.fileSize)} · {archive.uploadedByName} · {formatDateTime(archive.uploadedAt)}
                  </div>
                </div>
                <a
                  href={archive.downloadUrl}
                  download={archive.fileName}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-10 w-full shrink-0 border-blue-200 text-blue-800 sm:w-auto')}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Скачать
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
