'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FilePlus2, Hand, Paperclip, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelDepartmentRequest,
  claimDepartmentRequest,
  completeDepartmentRequest,
  rejectDepartmentRequest,
} from '@/lib/actions/department-requests'
import type { DepartmentRequestStatus } from '@/lib/department-requests'
import {
  cleanupDepartmentRequestUploads,
  uploadDepartmentRequestFiles,
} from '@/lib/department-request-upload-client'
import {
  DEPARTMENT_REQUEST_FILE_MAX_COUNT,
  validateDepartmentRequestFile,
} from '@/lib/department-request-files'
import { Button } from '@/components/ui/button'
import { notifySidebarWorkQueuesChanged } from '@/lib/sidebar-work-queue-events'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Decision = 'done' | 'rejected'

export function RequestActions({
  requestId,
  status,
  mode,
  requestKind,
  machineId,
  canClaimMachineLayout,
}: {
  requestId: string
  status: DepartmentRequestStatus
  mode: 'mine' | 'inbox'
  requestKind: 'manual' | 'machine_layout' | 'long_stock_recalculation'
  machineId: string | null
  canClaimMachineLayout: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [decision, setDecision] = useState<Decision | null>(null)
  const [response, setResponse] = useState('')
  const [files, setFiles] = useState<File[]>([])

  function refreshWith(result: { ok: boolean; message: string }) {
    if (!result.ok) throw new Error(result.message)
    toast.success(result.message)
    notifySidebarWorkQueuesChanged()
    router.refresh()
  }

  function claim() {
    startTransition(async () => {
      try {
        refreshWith(await claimDepartmentRequest(requestId))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось взять запрос в работу')
        router.refresh()
      }
    })
  }

  function cancel() {
    if (!window.confirm('Отменить этот запрос?')) return
    startTransition(async () => {
      try {
        refreshWith(await cancelDepartmentRequest(requestId))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось отменить запрос')
      }
    })
  }

  function addFiles(incoming: File[]) {
    try {
      const next = [...files, ...incoming.filter((file) =>
        !files.some((current) =>
          current.name === file.name && current.size === file.size && current.lastModified === file.lastModified))]
      if (next.length > DEPARTMENT_REQUEST_FILE_MAX_COUNT) {
        throw new Error('Можно прикрепить не больше 10 файлов')
      }
      next.forEach((file) => validateDepartmentRequestFile({ fileName: file.name, fileSize: file.size }))
      setFiles(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось добавить файл')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision) return
    startTransition(async () => {
      let uploads: Awaited<ReturnType<typeof uploadDepartmentRequestFiles>> = []
      try {
        if (decision === 'done') {
          uploads = await uploadDepartmentRequestFiles(requestId, 'resolution', files)
          refreshWith(await completeDepartmentRequest({
            requestId,
            response,
            attachments: uploads,
          }))
        } else {
          refreshWith(await rejectDepartmentRequest({ requestId, response }))
        }
        setDecision(null)
        setResponse('')
        setFiles([])
      } catch (error) {
        if (uploads.length > 0) {
          await cleanupDepartmentRequestUploads(requestId, 'resolution', uploads)
        }
        toast.error(error instanceof Error ? error.message : 'Не удалось изменить запрос')
      }
    })
  }

  if (requestKind === 'long_stock_recalculation') return null

  if (mode === 'mine') {
    if (!['new', 'in_progress'].includes(status)) return null
    return (
      <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={cancel}>
        <XCircle className="size-4" aria-hidden="true" />
        {pending ? 'Отменяем…' : 'Отменить запрос'}
      </Button>
    )
  }

  if (!['new', 'in_progress'].includes(status)) return null
  const isMachineLayout = requestKind === 'machine_layout'

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === 'new' && (!isMachineLayout || canClaimMachineLayout) && (
          <Button type="button" className="min-h-11 bg-[#1B3A6B] text-white hover:bg-[#152f59]" disabled={pending} onClick={claim}>
            <Hand className="size-4" aria-hidden="true" />
            {pending ? 'Назначаем…' : 'Взять в работу'}
          </Button>
        )}
        {status === 'in_progress' && !isMachineLayout && (
          <Button type="button" className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => setDecision('done')}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Завершить запрос
          </Button>
        )}
        {status === 'in_progress' && isMachineLayout && machineId && (
          <Link
            href={`${ROUTES.SALES_PLAN}/${machineId}?tab=technologist`}
            className={cn('inline-flex min-h-11 items-center justify-center rounded-md bg-[#1B3A6B] px-4 text-sm font-medium text-white hover:bg-[#152f59]')}
          >
            Открыть машину
          </Link>
        )}
        <Button type="button" variant="outline" className="min-h-11 border-red-200 text-red-700 hover:bg-red-50" onClick={() => setDecision('rejected')}>
          <XCircle className="size-4" aria-hidden="true" />
          Отклонить
        </Button>
      </div>

      <Dialog open={decision !== null} onOpenChange={(open) => {
        if (!open && !pending) {
          setDecision(null)
          setResponse('')
          setFiles([])
        }
      }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white p-0 sm:max-w-xl">
          <form onSubmit={submitDecision}>
            <DialogHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
              <DialogTitle className="text-xl text-slate-950">
                {decision === 'done' ? 'Завершить запрос' : 'Отклонить запрос'}
              </DialogTitle>
              <DialogDescription>
                {decision === 'done'
                  ? 'Опишите выполненное решение. Автор увидит текст и приложенные файлы.'
                  : 'Укажите понятную причину отклонения для автора запроса.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor={`request-response-${requestId}`}>
                  {decision === 'done' ? 'Решение запроса' : 'Причина отклонения'}
                </Label>
                <Textarea
                  id={`request-response-${requestId}`}
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  minLength={3}
                  maxLength={5000}
                  required
                  rows={6}
                  className="min-h-36 resize-y"
                  placeholder={decision === 'done' ? 'Что было сделано и какой получен результат' : 'Почему запрос невозможно выполнить'}
                />
              </div>

              {decision === 'done' && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor={`request-resolution-files-${requestId}`}>
                      Файлы <span className="font-normal text-slate-500">· необязательно</span>
                    </Label>
                    <p className="mt-1 text-xs text-slate-500">До 10 файлов, каждый не больше 25 МБ.</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    id={`request-resolution-files-${requestId}`}
                    type="file"
                    multiple
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.webp,.heic,.zip,.rar,.7z,.dxf,.dwg,.step,.stp,.iges,.igs"
                    onChange={(event) => addFiles(Array.from(event.target.files || []))}
                  />
                  <Button type="button" variant="outline" className="min-h-11 w-full gap-2 border-dashed" onClick={() => fileInputRef.current?.click()}>
                    <FilePlus2 className="size-4" aria-hidden="true" />
                    Добавить файлы
                  </Button>
                  {files.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <Paperclip className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Убрать файл ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setDecision(null)}>
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className={decision === 'done'
                  ? 'min-h-11 bg-emerald-700 text-white hover:bg-emerald-800'
                  : 'min-h-11 bg-red-700 text-white hover:bg-red-800'}
              >
                {pending ? 'Сохраняем…' : decision === 'done' ? 'Завершить запрос' : 'Отклонить запрос'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
