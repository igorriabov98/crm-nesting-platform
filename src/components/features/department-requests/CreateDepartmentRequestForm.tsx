'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays,
  Check,
  FilePlus2,
  PackageSearch,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createDepartmentRequest,
  searchDepartmentRequestMachines,
  type DepartmentRequestMachineOption,
} from '@/lib/actions/department-requests'
import {
  cleanupDepartmentRequestUploads,
  uploadDepartmentRequestFiles,
} from '@/lib/department-request-upload-client'
import {
  DEPARTMENT_REQUEST_FILE_MAX_COUNT,
  validateDepartmentRequestFile,
} from '@/lib/department-request-files'
import { DEPARTMENT_REQUEST_TARGETS, type DepartmentRequestTarget } from '@/lib/department-requests'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function CreateDepartmentRequestForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<DepartmentRequestTarget>('supply')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [machineSearch, setMachineSearch] = useState('')
  const [machineOptions, setMachineOptions] = useState<DepartmentRequestMachineOption[]>([])
  const [selectedMachine, setSelectedMachine] = useState<DepartmentRequestMachineOption | null>(null)
  const [machinesLoading, setMachinesLoading] = useState(false)

  useEffect(() => {
    if (!open || selectedMachine) return
    const timeout = window.setTimeout(async () => {
      setMachinesLoading(true)
      try {
        setMachineOptions(await searchDepartmentRequestMachines(machineSearch))
      } catch {
        setMachineOptions([])
      } finally {
        setMachinesLoading(false)
      }
    }, machineSearch ? 250 : 0)
    return () => window.clearTimeout(timeout)
  }, [machineSearch, open, selectedMachine])

  function resetForm() {
    setTarget('supply')
    setTitle('')
    setDescription('')
    setDueDate('')
    setFiles([])
    setMachineSearch('')
    setMachineOptions([])
    setSelectedMachine(null)
  }

  function addFiles(incoming: File[]) {
    try {
      const unique = incoming.filter((file) =>
        !files.some((current) =>
          current.name === file.name && current.size === file.size && current.lastModified === file.lastModified))
      const next = [...files, ...unique]
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const requestId = crypto.randomUUID()
      let uploads: Awaited<ReturnType<typeof uploadDepartmentRequestFiles>> = []
      try {
        uploads = await uploadDepartmentRequestFiles(requestId, 'source', files)
        const result = await createDepartmentRequest({
          requestId,
          target,
          title,
          description,
          machineId: selectedMachine?.id || null,
          dueDate,
          attachments: uploads,
        })
        if (!result.ok) throw new Error(result.message)

        toast.success(result.message)
        resetForm()
        setOpen(false)
        router.refresh()
      } catch (error) {
        if (uploads.length > 0) {
          await cleanupDepartmentRequestUploads(requestId, 'source', uploads)
        }
        toast.error(error instanceof Error ? error.message : 'Не удалось создать запрос')
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 gap-2 bg-[#1B3A6B] px-4 text-white hover:bg-[#152f59]"
      >
        <Plus className="size-4" aria-hidden="true" />
        Создать запрос
      </Button>

      <Dialog open={open} onOpenChange={(value) => {
        if (!pending) setOpen(value)
      }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white p-0 sm:max-w-2xl">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#1B3A6B] text-white">
                <Send className="size-4" aria-hidden="true" />
              </div>
              <DialogTitle className="text-xl font-semibold text-slate-950">Новый рабочий запрос</DialogTitle>
              <DialogDescription>
                Выберите отдел и подробно опишите результат, который вам нужен.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="department-request-target">Кому адресован запрос</Label>
                <select
                  id="department-request-target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value as DepartmentRequestTarget)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  {(Object.entries(DEPARTMENT_REQUEST_TARGETS) as Array<[DepartmentRequestTarget, typeof DEPARTMENT_REQUEST_TARGETS[DepartmentRequestTarget]]>)
                    .map(([value, config]) => (
                      <option key={value} value={value}>{config.label}</option>
                    ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="department-request-title">Название задачи</Label>
                <Input
                  id="department-request-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  minLength={3}
                  maxLength={160}
                  className="h-11"
                  placeholder="Коротко, что нужно сделать"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="department-request-description">Описание задачи</Label>
                <Textarea
                  id="department-request-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  minLength={3}
                  maxLength={5000}
                  rows={6}
                  className="min-h-36 resize-y"
                  placeholder="Опишите ожидаемый результат и важные условия"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="department-request-due-date">Желаемый срок</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <Input
                      id="department-request-due-date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      type="date"
                      className="h-11 pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Заказ <span className="font-normal text-slate-500">· необязательно</span></Label>
                  {selectedMachine ? (
                    <div className="flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3">
                      <Check className="size-4 shrink-0 text-blue-700" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-blue-950">
                        {selectedMachine.label}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Убрать заказ"
                        onClick={() => {
                          setSelectedMachine(null)
                          setMachineSearch('')
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" />
                      <Input
                        value={machineSearch}
                        onChange={(event) => setMachineSearch(event.target.value)}
                        className="h-11 pl-9"
                        placeholder="Название или спецификация"
                        aria-label="Поиск заказа"
                      />
                      {(machineSearch || machineOptions.length > 0) && (
                        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                          {machinesLoading ? (
                            <div className="px-3 py-3 text-sm text-slate-500">Ищем заказы…</div>
                          ) : machineOptions.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-500">Заказы не найдены</div>
                          ) : machineOptions.map((machine) => (
                            <button
                              key={machine.id}
                              type="button"
                              onClick={() => setSelectedMachine(machine)}
                              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                              <PackageSearch className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="line-clamp-2">{machine.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="department-request-files">Файлы <span className="font-normal text-slate-500">· необязательно</span></Label>
                  <p className="mt-1 text-xs leading-5 text-slate-500">До 10 файлов, каждый не больше 25 МБ.</p>
                </div>
                <input
                  ref={fileInputRef}
                  id="department-request-files"
                  type="file"
                  multiple
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.webp,.heic,.zip,.rar,.7z,.dxf,.dwg,.step,.stp,.iges,.igs"
                  onChange={(event) => addFiles(Array.from(event.target.files || []))}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full gap-2 border-dashed"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FilePlus2 className="size-4" aria-hidden="true" />
                  Добавить файлы
                </Button>
                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${file.lastModified}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <Paperclip className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{file.name}</span>
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
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" className="min-h-11 bg-[#1B3A6B] text-white hover:bg-[#152f59]" disabled={pending}>
                <Send className="size-4" aria-hidden="true" />
                {pending ? 'Отправляем…' : `Отправить ${DEPARTMENT_REQUEST_TARGETS[target].recipientLabel}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
