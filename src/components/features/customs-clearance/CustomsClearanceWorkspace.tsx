'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  Factory,
  FileDown,
  FileText,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants/routes'
import {
  CUSTOMS_DOCUMENT_KIND_LABELS,
  filterCustomsClearanceMachines,
  getCustomsClearanceState,
  localDateKey,
  type CustomsClearanceMachine,
  type CustomsClearanceSort,
  type CustomsDocumentKind,
} from '@/lib/customs-clearance'
import {
  deleteCustomsClearanceDocument,
  registerCustomsClearanceDocuments,
  updateCustomsClearanceDate,
} from '@/lib/actions/customs-clearance'
import {
  cleanupCustomsClearanceUploads,
  uploadCustomsClearanceFiles,
} from '@/lib/customs-clearance-upload-client'

type Props = {
  machines: CustomsClearanceMachine[]
  factories: Array<{ id: string; name: string }>
  canManage: boolean
  headAssigned: boolean
}

const PDF_LABELS: Record<'invoice' | 'specification' | 'packing_list', string> = {
  invoice: 'Инвойс',
  specification: 'Спецификация',
  packing_list: 'Упаковочный лист',
}

function formatDate(value: string | null) {
  if (!value) return 'Не указана'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatFileSize(value: number) {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.ceil(value / 1024)} КБ`
}

function Metric({ label, value, tone = 'blue' }: { label: string; value: number; tone?: 'blue' | 'red' | 'green' }) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-900',
    red: 'border-red-100 bg-red-50 text-red-900',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={cn('rounded-xl border px-4 py-3', tones[tone])}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function MachineCard({
  machine,
  canManage,
  focused,
}: {
  machine: CustomsClearanceMachine
  canManage: boolean
  focused: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [date, setDate] = useState(machine.customsClearanceDate || '')
  const [documentKind, setDocumentKind] = useState<CustomsDocumentKind>('other')
  const [busy, startTransition] = useTransition()
  const [pdfType, setPdfType] = useState<string | null>(null)
  const state = getCustomsClearanceState(machine)
  const today = localDateKey()
  const overdue = machine.shippingReadinessDate < today

  useEffect(() => setDate(machine.customsClearanceDate || ''), [machine.customsClearanceDate])

  function saveDate() {
    startTransition(async () => {
      const result = await updateCustomsClearanceDate(machine.id, date || null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Дата затаможивания сохранена')
      router.refresh()
    })
  }

  async function generatePdf(type: keyof typeof PDF_LABELS) {
    setPdfType(type)
    try {
      const response = await fetch('/api/customs-clearance/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId: machine.id, type }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Не удалось сформировать PDF')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${PDF_LABELS[type]}_${machine.name}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(`${PDF_LABELS[type]} сформирован. Для комплектности прикрепите файл вручную.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сформировать PDF')
    } finally {
      setPdfType(null)
    }
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return
    startTransition(async () => {
      let uploads: Awaited<ReturnType<typeof uploadCustomsClearanceFiles>> = []
      try {
        uploads = await uploadCustomsClearanceFiles(machine.id, files)
        const result = await registerCustomsClearanceDocuments({
          machineId: machine.id,
          documentKind,
          uploads,
        })
        if (!result.success) throw new Error(result.error || 'Не удалось прикрепить документы')
        toast.success(files.length === 1 ? 'Документ прикреплён' : `Прикреплено документов: ${files.length}`)
        router.refresh()
      } catch (error) {
        await cleanupCustomsClearanceUploads(machine.id, uploads)
        toast.error(error instanceof Error ? error.message : 'Не удалось загрузить документы')
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    })
  }

  function deleteDocument(id: string, fileName: string) {
    if (!window.confirm(`Удалить документ «${fileName}»?`)) return
    startTransition(async () => {
      const result = await deleteCustomsClearanceDocument(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Документ удалён')
      router.refresh()
    })
  }

  return (
    <article
      data-focus-id={machine.id}
      data-focus-active={focused ? 'true' : undefined}
      tabIndex={-1}
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm outline-none transition sm:p-5',
        state.incompleteAfterDelivery
          ? 'border-red-300 bg-red-50/40 ring-1 ring-red-100'
          : 'border-slate-200',
        'data-[focus-active=true]:ring-4 data-[focus-active=true]:ring-blue-300',
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">{machine.name}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
              <Factory className="h-3.5 w-3.5" aria-hidden="true" />
              {machine.factoryName}
            </span>
            {overdue && !state.cleared && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Просрочено
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <p><span className="font-medium text-slate-800">Готовность:</span> {formatDate(machine.shippingReadinessDate)}</p>
            <p><span className="font-medium text-slate-800">Затаможивание:</span> {formatDate(machine.customsClearanceDate)}</p>
            <p><span className="font-medium text-slate-800">Доставка:</span> {formatDate(machine.deliveryToClientDate)}</p>
          </div>
        </div>
        {state.cleared && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Затаможено
          </span>
        )}
      </div>

      {state.incompleteAfterDelivery && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-100/70 p-3 text-sm text-red-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Доставка указана, но оформление не завершено.</p>
            <p className="mt-1">Не хватает: {state.missing.join(', ')}.</p>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <section aria-label="Дата и формирование документов" className="space-y-4">
          <div>
            <Label htmlFor={`customs-date-${machine.id}`}>Дата затаможивания</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                id={`customs-date-${machine.id}`}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={!canManage || busy}
                className="min-h-11"
              />
              {canManage && (
                <Button type="button" onClick={saveDate} disabled={busy} className="min-h-11 sm:w-auto">
                  {busy ? 'Сохранение…' : 'Сохранить'}
                </Button>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-800">Сформировать PDF</p>
            <p className="mt-1 text-xs text-slate-500">PDF скачивается и не считается прикреплённым документом.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {(Object.keys(PDF_LABELS) as Array<keyof typeof PDF_LABELS>).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  className="min-h-11 whitespace-normal"
                  onClick={() => void generatePdf(type)}
                  disabled={Boolean(pdfType)}
                >
                  <FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {pdfType === type ? 'Формирование…' : PDF_LABELS[type]}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Прикреплённые документы">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Прикреплённые документы</h3>
              <p className="mt-1 text-xs text-slate-500">PDF, DOC/DOCX, XLS/XLSX, JPG/PNG · до 25 МБ</p>
            </div>
            {canManage && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <div>
                  <Label htmlFor={`document-kind-${machine.id}`} className="sr-only">Тип документа</Label>
                  <select
                    id={`document-kind-${machine.id}`}
                    value={documentKind}
                    onChange={(event) => setDocumentKind(event.target.value as CustomsDocumentKind)}
                    disabled={busy}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 sm:w-48"
                  >
                    {(Object.keys(CUSTOMS_DOCUMENT_KIND_LABELS) as CustomsDocumentKind[]).map((kind) => (
                      <option key={kind} value={kind}>{CUSTOMS_DOCUMENT_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  className="sr-only"
                  onChange={(event) => void uploadFiles(Array.from(event.target.files || []))}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {busy ? 'Загрузка…' : 'Загрузить'}
                </Button>
              </div>
            )}
          </div>

          {machine.documents.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
              <FileText className="mx-auto mb-2 h-7 w-7 text-slate-400" aria-hidden="true" />
              Документы ещё не прикреплены
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {machine.documents.map((document) => (
                <li key={document.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all font-medium text-slate-900">{document.fileName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {CUSTOMS_DOCUMENT_KIND_LABELS[document.documentKind]} · {formatFileSize(document.fileSize)} · {document.uploadedByName} · {formatDateTime(document.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a
                      href={`/api/customs-clearance/files/${document.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />Открыть
                    </a>
                    <a
                      href={`/api/customs-clearance/files/${document.id}?download=1`}
                      download
                      className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
                    >
                      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Скачать
                    </a>
                    {canManage && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-11"
                        onClick={() => deleteDocument(document.id, document.fileName)}
                        disabled={busy}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Удалить
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}

export function CustomsClearanceWorkspace({ machines, factories, canManage, headAssigned }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const focus = searchParams.get('focus')
  const focusedMachine = focus ? machines.find((machine) => machine.id === focus) : null
  const [tab, setTab] = useState<'active' | 'cleared'>(() =>
    focusedMachine && getCustomsClearanceState(focusedMachine).cleared ? 'cleared' : 'active',
  )
  const [factoryId, setFactoryId] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<CustomsClearanceSort>('default')
  const activeCount = machines.filter((machine) => !getCustomsClearanceState(machine).cleared).length
  const clearedCount = machines.length - activeCount
  const incompleteCount = machines.filter((machine) => getCustomsClearanceState(machine).incompleteAfterDelivery).length
  const selectedTab = focusedMachine
    ? (getCustomsClearanceState(focusedMachine).cleared ? 'cleared' : 'active')
    : tab
  const visibleMachines = useMemo(
    () => filterCustomsClearanceMachines(machines, { tab: selectedTab, factoryId, search, sort }),
    [machines, selectedTab, factoryId, search, sort],
  )

  useEffect(() => {
    if (!focus || !visibleMachines.some((machine) => machine.id === focus)) return
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-id]'))
        .find((element) => element.dataset.focusId === focus)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focus, visibleMachines])

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-800">
            <CalendarClock className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Затамаживание</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Машины обоих заводов с готовностью к погрузке, таможенные даты и прикреплённые документы.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Активные" value={activeCount} />
          <Metric label="Неполные после доставки" value={incompleteCount} tone="red" />
          <Metric label="Затаможено" value={clearedCount} tone="green" />
        </div>
      </header>

      {!headAssigned && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Начальник Брокерского отдела не назначен.</p>
            <p className="mt-1">Автоматические задачи пока не создаются. После назначения все актуальные и просроченные задачи появятся автоматически.</p>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Фильтры затамаживания">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 sm:w-fit">
            <button
              type="button"
              onClick={() => {
                setTab('active')
                if (focus) router.replace(ROUTES.CUSTOMS_CLEARANCE, { scroll: false })
              }}
              className={cn('min-h-11 rounded-lg px-4 text-sm font-medium', selectedTab === 'active' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600')}
              aria-pressed={selectedTab === 'active'}
            >
              Активные · {activeCount}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('cleared')
                if (focus) router.replace(ROUTES.CUSTOMS_CLEARANCE, { scroll: false })
              }}
              className={cn('min-h-11 rounded-lg px-4 text-sm font-medium', selectedTab === 'cleared' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600')}
              aria-pressed={selectedTab === 'cleared'}
            >
              Затаможено · {clearedCount}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px_240px]">
            <div className="relative">
              <Label htmlFor="customs-search" className="sr-only">Поиск по названию машины</Label>
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <Input
                id="customs-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по названию машины"
                className="min-h-11 pl-9"
              />
            </div>
            <div>
              <Label htmlFor="customs-factory" className="sr-only">Завод</Label>
              <select
                id="customs-factory"
                value={factoryId}
                onChange={(event) => setFactoryId(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              >
                <option value="all">Все заводы</option>
                {factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="customs-sort" className="sr-only">Сортировка</Label>
              <select
                id="customs-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as CustomsClearanceSort)}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              >
                <option value="default">Просроченные и ближайшие</option>
                <option value="readiness">По готовности к погрузке</option>
                <option value="customs">По дате затаможивания</option>
                <option value="delivery">По дате доставки</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {visibleMachines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-medium text-slate-900">Машины не найдены</p>
          <p className="mt-1 text-sm text-slate-500">Измените фильтры или поиск. Машины без даты готовности здесь не показываются.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleMachines.map((machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              canManage={canManage}
              focused={machine.id === focus}
            />
          ))}
        </div>
      )}
    </div>
  )
}
