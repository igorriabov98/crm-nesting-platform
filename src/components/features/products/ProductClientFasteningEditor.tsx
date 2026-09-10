'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronsUpDown,
  CircleAlert,
  Download,
  Loader2,
  Paperclip,
  Save,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  deleteProductClientFasteningFile,
  saveProductClientFastening,
  type ProductClientFasteningSettingDto,
  type ProductClientOption,
} from '@/lib/actions/product-client-fastening'
import { PRODUCT_FASTENING_TYPE_LABELS } from '@/lib/constants/product-version-labels'
import {
  cleanupClientFasteningUploads,
  uploadClientFasteningFileDirect,
} from '@/lib/products/direct-client-fastening-upload-client'
import {
  CLIENT_FASTENING_FILE_MAX_BYTES,
  CLIENT_FASTENING_TYPES,
  missingClientFasteningFiles,
  type ClientFasteningFileType,
  type ClientFasteningType,
  type DirectClientFasteningUpload,
  type ProductCompletionType,
} from '@/lib/products/product-client-fastening'
import { cn } from '@/lib/utils'

type Props = {
  productId: string
  productVersionId: string
  completionType: ProductCompletionType | null
  clients: ProductClientOption[]
  settings: ProductClientFasteningSettingDto[]
  canManage: boolean
}

const FILE_LABELS: Record<ClientFasteningFileType, string> = {
  metal_plate: 'Файл металлической таблички',
  a4_plate: 'Файл таблички А4',
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

function actionError(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось сохранить настройку клиента'
}

export function ProductClientFasteningEditor({
  productId,
  productVersionId,
  completionType,
  clients,
  settings,
  canManage,
}: Props) {
  const router = useRouter()
  const settingsByClient = useMemo(
    () => new Map(settings.map((setting) => [setting.clientId, setting])),
    [settings],
  )
  const firstIncomplete = clients.find((client) => !settingsByClient.get(client.id)?.complete)
  const [selectedClientId, setSelectedClientId] = useState(firstIncomplete?.id || clients[0]?.id || '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [fasteningTypes, setFasteningTypes] = useState<ClientFasteningType[]>([])
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<ClientFasteningFileType, File>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedClient = clients.find((client) => client.id === selectedClientId) || null
  const selectedSetting = settingsByClient.get(selectedClientId) || null
  const completeCount = settings.filter((setting) => setting.complete).length

  useEffect(() => {
    setFasteningTypes(selectedSetting?.fasteningTypes || [])
    setPendingFiles({})
    setError(null)
  }, [selectedClientId, selectedSetting])

  function toggle(type: ClientFasteningType, checked: boolean) {
    setFasteningTypes((current) => checked
      ? Array.from(new Set([...current, type]))
      : current.filter((item) => item !== type))
    if (!checked && (type === 'metal_plate' || type === 'a4_plate')) {
      setPendingFiles((current) => {
        const next = { ...current }
        delete next[type]
        return next
      })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedClient) return
    setIsSubmitting(true)
    setError(null)
    const uploads: DirectClientFasteningUpload[] = []
    try {
      for (const type of ['metal_plate', 'a4_plate'] as const) {
        const file = pendingFiles[type]
        if (!file) continue
        if (file.size > CLIENT_FASTENING_FILE_MAX_BYTES) throw new Error(`${FILE_LABELS[type]} превышает лимит 50 МБ`)
        uploads.push(await uploadClientFasteningFileDirect({
          productId,
          productVersionId,
          clientId: selectedClient.id,
          fasteningType: type,
          file,
        }))
      }
      const result = await saveProductClientFastening({
        productId,
        productVersionId,
        clientId: selectedClient.id,
        fasteningTypes,
        uploads,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить настройку клиента')
      toast.success(`Крепление для клиента «${selectedClient.name}» сохранено`)
      setPendingFiles({})
      router.refresh()
    } catch (submitError) {
      await cleanupClientFasteningUploads({
        productId,
        productVersionId,
        clientId: selectedClient.id,
        uploads,
      })
      const message = actionError(submitError)
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!selectedClient) return
    setDeletingFileId(fileId)
    setError(null)
    try {
      const result = await deleteProductClientFasteningFile({
        productId,
        productVersionId,
        clientId: selectedClient.id,
        fileId,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось удалить файл')
      toast.success('Файл таблички удалён')
      router.refresh()
    } catch (deleteError) {
      const message = actionError(deleteError)
      setError(message)
      toast.error(message)
    } finally {
      setDeletingFileId(null)
    }
  }

  if (clients.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Крепление по клиентам</h3>
        <p className="mt-1 text-sm text-slate-500">В базе пока нет клиентов.</p>
      </section>
    )
  }

  const existingFileTypes = selectedSetting?.files.map((file) => file.fasteningType) || []
  const stagedFileTypes = Object.entries(pendingFiles).filter(([, file]) => Boolean(file)).map(([type]) => type)
  const missingFiles = missingClientFasteningFiles(fasteningTypes, [...existingFileTypes, ...stagedFileTypes])

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">Крепление по клиентам</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">У каждого клиента свои галочки и файлы табличек.</p>
        </div>
        <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50 text-blue-800">
          Полностью настроено: {completeCount} из {clients.length}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <label id="client-fastening-picker-label" className="text-sm font-medium text-slate-700">Клиент</label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={(
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-labelledby="client-fastening-picker-label"
                aria-expanded={pickerOpen}
                className="min-h-11 w-full justify-between border-slate-200 bg-white font-normal"
              />
            )}
          >
            <span className="truncate">{selectedClient?.name || 'Выберите клиента'}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-1">
            <Command>
              <CommandInput autoFocus placeholder="Поиск клиента" />
              <CommandList>
                <CommandEmpty>Клиент не найден</CommandEmpty>
                <CommandGroup heading="Все клиенты">
                  {clients.map((client) => (
                    <CommandItem
                      key={client.id}
                      value={client.name}
                      data-checked={client.id === selectedClientId}
                      onSelect={() => {
                        setSelectedClientId(client.id)
                        setPickerOpen(false)
                      }}
                      className="min-h-10"
                    >
                      <span className="truncate">{client.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <fieldset disabled={!canManage || isSubmitting}>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Крепление</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLIENT_FASTENING_TYPES.map((type) => {
              const checked = fasteningTypes.includes(type)
              return (
                <label
                  key={type}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                    checked ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    (!canManage || isSubmitting) && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={(value) => toggle(type, value === true)} />
                  <span>{PRODUCT_FASTENING_TYPE_LABELS[type]}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 md:grid-cols-2">
          {(['metal_plate', 'a4_plate'] as const).map((type) => {
            if (!fasteningTypes.includes(type)) return null
            const existing = selectedSetting?.files.find((file) => file.fasteningType === type) || null
            const pending = pendingFiles[type]
            const missing = !existing && !pending
            return (
              <div key={type} className={cn('rounded-2xl border p-4', missing ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200 bg-white')}>
                <div className="flex items-start gap-3">
                  <Paperclip className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`client-fastening-${selectedClientId}-${type}`} className="text-sm font-semibold text-slate-900">
                      {FILE_LABELS[type]}
                    </label>
                    <p className="mt-0.5 text-xs text-slate-500">Любой формат · до 50 МБ · один файл</p>
                    {existing && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <a
                          href={`/api/products/client-fastening/files/${existing.id}`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-10 min-w-0 flex-1 justify-start bg-white')}
                        >
                          <Download className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{existing.fileName}</span>
                          <span className="shrink-0 text-slate-400">{formatFileSize(existing.fileSize)}</span>
                        </a>
                        {canManage && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(deletingFileId) || isSubmitting}
                            onClick={() => void handleDeleteFile(existing.id)}
                            className="min-h-10 text-red-700 hover:bg-red-50 hover:text-red-800"
                            aria-label={`Удалить ${FILE_LABELS[type].toLowerCase()}`}
                          >
                            {deletingFileId === existing.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}
                            Удалить
                          </Button>
                        )}
                      </div>
                    )}
                    {canManage && (
                      <Input
                        key={`${selectedClientId}-${type}-${existing?.id || 'empty'}`}
                        id={`client-fastening-${selectedClientId}-${type}`}
                        type="file"
                        disabled={isSubmitting}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          setPendingFiles((current) => ({ ...current, [type]: file }))
                        }}
                        className="mt-3 min-h-11 cursor-pointer border-slate-200 bg-white file:cursor-pointer"
                        aria-describedby={missing ? `client-fastening-${selectedClientId}-${type}-missing` : undefined}
                      />
                    )}
                    {pending && <p className="mt-2 truncate text-xs font-medium text-emerald-700">Выбран: {pending.name}</p>}
                    {missing && (
                      <p id={`client-fastening-${selectedClientId}-${type}-missing`} role="status" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-800">
                        <CircleAlert className="h-3.5 w-3.5" />
                        Обязательный файл не загружен
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!completionType && (
          <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <CircleAlert className="h-3.5 w-3.5" />
            Общая комплектация не заполнена — настройка клиента останется незавершённой.
          </p>
        )}
        {missingFiles.length > 0 && <span className="sr-only" aria-live="polite">Есть обязательные файлы, которые ещё не загружены.</span>}

        {canManage && (
          <Button type="submit" disabled={isSubmitting || Boolean(deletingFileId)} className="min-h-11 w-full bg-slate-900 text-white hover:bg-slate-800 sm:w-auto">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />}
            {isSubmitting ? 'Сохранение…' : 'Сохранить для клиента'}
          </Button>
        )}
      </form>
    </section>
  )
}

export function ClientFasteningHistory({
  clients,
  settings,
  legacyTypes,
}: {
  clients: ProductClientOption[]
  settings: ProductClientFasteningSettingDto[]
  legacyTypes: ClientFasteningType[]
}) {
  const clientsById = new Map(clients.map((client) => [client.id, client.name]))
  if (settings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-xs font-medium text-slate-600">Общая настройка до перехода на клиентские</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {legacyTypes.length > 0
            ? legacyTypes.map((type) => <Badge key={type} variant="secondary">{PRODUCT_FASTENING_TYPE_LABELS[type]}</Badge>)
            : <span className="text-xs text-slate-400">Не заполнено</span>}
        </div>
      </div>
    )
  }

  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium text-slate-800">
        Клиентские настройки ({settings.length})
      </summary>
      <div className="space-y-2 border-t border-slate-200 p-3">
        {settings.map((setting) => (
          <div key={setting.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{clientsById.get(setting.clientId) || 'Клиент'}</p>
              <Badge variant="outline" className={setting.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                {setting.complete ? 'Заполнено' : 'Не заполнено'}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {setting.fasteningTypes.map((type) => <Badge key={type} variant="secondary">{PRODUCT_FASTENING_TYPE_LABELS[type]}</Badge>)}
            </div>
            {setting.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {setting.files.map((file) => (
                  <a key={file.id} href={`/api/products/client-fastening/files/${file.id}`} className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
                    {file.fasteningType === 'a4_plate' ? 'A4' : 'Металлическая'}: {file.fileName}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
