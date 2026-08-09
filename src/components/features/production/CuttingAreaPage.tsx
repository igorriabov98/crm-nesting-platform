'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Archive, CheckCircle2, ChevronDown, Download, FileStack, Loader2, Play, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  completeProductionCuttingCycle,
  getProductionCuttingAreaDetails,
  reopenProductionCuttingCycle,
  startProductionCuttingCycle,
  type CuttingAreaOrder,
  type CuttingAreaOrderDetails,
  type CuttingAreaQueueStatus,
  type CuttingAreaWorkspace,
} from '@/lib/actions/production-cutting-area'
import { cn } from '@/lib/utils'

type Filter = CuttingAreaQueueStatus | 'all'

const statusLabels: Record<CuttingAreaQueueStatus, string> = { waiting: 'Ожидают', in_progress: 'В работе', completed: 'Выполненные' }
const statusStyles: Record<CuttingAreaQueueStatus, string> = { waiting: 'border-amber-200 bg-amber-50 text-amber-800', in_progress: 'border-blue-200 bg-blue-50 text-blue-800', completed: 'border-emerald-200 bg-emerald-50 text-emerald-800' }

function formatMinutes(minutes: number) { return `${minutes} мин · ${Math.floor(minutes / 60)} ч ${minutes % 60} мин` }
function formatDate(value: string | null) { return value ? format(new Date(`${value}T12:00:00`), 'dd.MM.yyyy', { locale: ru }) : 'Без даты' }
function formatDateTime(value: string) { return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: ru }) }
function formatFileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ` }

function dueRank(order: CuttingAreaOrder, today: string) {
  if (!order.plannedStartDate) return 3
  if (order.plannedStartDate < today) return 0
  if (order.plannedStartDate === today) return 1
  return 2
}

function DueBadge({ order, today }: { order: CuttingAreaOrder; today: string }) {
  if (!order.plannedStartDate) return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Без даты</Badge>
  if (order.plannedStartDate < today) return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Просрочено</Badge>
  if (order.plannedStartDate === today) return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Сегодня</Badge>
  return <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">По плану</Badge>
}

export function CuttingAreaPage({ workspace }: { workspace: CuttingAreaWorkspace }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<Filter>('waiting')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, CuttingAreaOrderDetails>>({})
  const [detailsError, setDetailsError] = useState<Record<string, string>>({})
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null)
  const [filesOpen, setFilesOpen] = useState<Record<string, boolean>>({})
  const [startOrder, setStartOrder] = useState<CuttingAreaOrder | null>(null)
  const [sectionId, setSectionId] = useState('')
  const [shift, setShift] = useState<'day' | 'night'>('day')
  const [reopenOrder, setReopenOrder] = useState<CuttingAreaOrder | null>(null)
  const [reopenReason, setReopenReason] = useState('')

  const orders = useMemo(() => workspace.orders
    .filter((order) => filter === 'all' || order.queueStatus === filter)
    .filter((order) => order.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
    .sort((left, right) => dueRank(left, workspace.today) - dueRank(right, workspace.today)
      || (left.plannedStartDate || '9999').localeCompare(right.plannedStartDate || '9999')
      || left.name.localeCompare(right.name, 'ru')),
  [filter, search, workspace.orders, workspace.today])

  async function toggleDetails(order: CuttingAreaOrder) {
    if (expanded === order.machineId) { setExpanded(null); return }
    setExpanded(order.machineId)
    if (details[order.machineId]) return
    setDetailsLoading(order.machineId)
    const result = await getProductionCuttingAreaDetails(order.machineId)
    setDetailsLoading(null)
    if (!result.success || !result.data) {
      setDetailsError((current) => ({ ...current, [order.machineId]: result.error || 'Не удалось загрузить подробности' }))
      return
    }
    setDetails((current) => ({ ...current, [order.machineId]: result.data }))
  }

  function openStart(order: CuttingAreaOrder) {
    const options = workspace.sections.filter((section) => section.factoryId === order.factoryId)
    setSectionId(options.length === 1 ? options[0].id : '')
    setShift('day')
    setStartOrder(order)
  }

  function startCycle() {
    if (!startOrder || !sectionId) return toast.error('Выберите участок Заготовки')
    startTransition(async () => {
      const result = await startProductionCuttingCycle({ machineId: startOrder.machineId, factoryId: startOrder.factoryId, sectionId, shift, factDate: workspace.today })
      if (!result.success) { toast.error(result.error || 'Не удалось взять заказ в работу'); return }
      toast.success('Заказ взят в работу, факт Заготовки создан')
      setStartOrder(null)
      router.refresh()
    })
  }

  function completeCycle(order: CuttingAreaOrder) {
    if (!order.cycleId) return
    startTransition(async () => {
      const result = await completeProductionCuttingCycle(order.cycleId!)
      if (!result.success) { toast.error(result.error || 'Не удалось завершить машину'); return }
      toast.success('Машина завершена на участке')
      router.refresh()
    })
  }

  function reopenCycle() {
    if (!reopenOrder?.cycleId) return
    startTransition(async () => {
      const result = await reopenProductionCuttingCycle({ cycleId: reopenOrder.cycleId!, reason: reopenReason })
      if (!result.success) { toast.error(result.error || 'Не удалось вернуть машину в работу'); return }
      toast.success('Машина возвращена в работу; складской факт не изменён')
      setReopenOrder(null); setReopenReason('')
      router.refresh()
    })
  }

  return <main className="min-w-0 space-y-5 pb-16">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="flex flex-wrap gap-2"><Badge className="bg-blue-100 text-blue-800">Производство</Badge>{!workspace.canManage && <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Только просмотр</Badge>}</div><h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Участок заготовки</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Заказы по плану производства, программы порезки, актуальные чертежи и STEP.</p></div>
        <div className="relative w-full lg:max-w-sm"><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 pl-10" placeholder="Найти заказ" aria-label="Поиск по названию заказа" /></div>
      </div>
    </header>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-4" aria-label="Фильтр очереди">
      {(['waiting','in_progress','completed','all'] as Filter[]).map((value) => <Button key={value} type="button" variant={filter === value ? 'default' : 'ghost'} className="min-h-11" onClick={() => setFilter(value)}>{value === 'all' ? 'Все' : statusLabels[value]}</Button>)}
    </nav>

    {orders.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-slate-600">В выбранном разделе заказов нет</section> : <section className="space-y-3" aria-label="Заказы Заготовки">
      {orders.map((order) => {
        const isExpanded = expanded === order.machineId
        const orderDetails = details[order.machineId]
        return <article key={order.machineId} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
            <button type="button" className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-expanded={isExpanded} aria-controls={`cutting-details-${order.machineId}`} onClick={() => void toggleDetails(order)}>
              <ChevronDown className={cn('mt-1 h-5 w-5 shrink-0 text-slate-500 transition-transform', isExpanded && 'rotate-180')} aria-hidden="true" />
              <span className="min-w-0"><span className="block break-words text-lg font-semibold text-slate-950">{order.name}</span><span className="mt-2 flex flex-wrap gap-2"><Badge variant="outline" className={statusStyles[order.queueStatus]}>{statusLabels[order.queueStatus]}</Badge><DueBadge order={order} today={workspace.today} />{order.cycleNumber && <Badge variant="outline">Цикл №{order.cycleNumber}</Badge>}</span></span>
            </button>
            <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:w-[480px]">
              <div><dt className="text-slate-500">Начало</dt><dd className="mt-1 font-medium text-slate-900">{formatDate(order.plannedStartDate)}</dd></div>
              <div><dt className="text-slate-500">Заявки</dt><dd className="mt-1 font-medium tabular-nums text-slate-900">{order.completedRequestCount}/{order.requestCount}</dd></div>
              <div className="col-span-2 sm:col-span-1"><dt className="text-slate-500">Общее время</dt><dd className="mt-1 font-medium tabular-nums text-slate-900">{formatMinutes(order.totalActualMinutes)}</dd></div>
            </dl>
            {workspace.canManage && order.queueStatus === 'waiting' && <div className="lg:w-48"><Button type="button" className="min-h-11 w-full bg-blue-950 text-white hover:bg-blue-900" disabled={!order.canStart || pending} onClick={() => openStart(order)}><Play className="mr-2 h-4 w-4" />Взял в работу</Button>{order.startBlocker && <p className="mt-1.5 text-xs leading-4 text-amber-700">{order.startBlocker}</p>}</div>}
            {workspace.canManage && order.queueStatus === 'in_progress' && <Button type="button" className="min-h-11 w-full bg-emerald-700 hover:bg-emerald-800 lg:w-auto" disabled={pending} onClick={() => completeCycle(order)}><CheckCircle2 className="mr-2 h-4 w-4" />Машина завершена</Button>}
            {workspace.canManage && order.queueStatus === 'completed' && <Button type="button" variant="outline" className="min-h-11 w-full lg:w-auto" disabled={pending} onClick={() => { setReopenOrder(order); setReopenReason('') }}><RotateCcw className="mr-2 h-4 w-4" />Вернуть в работу</Button>}
          </div>

          {isExpanded && <div id={`cutting-details-${order.machineId}`} className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5">
            {detailsLoading === order.machineId ? <div className="flex min-h-28 items-center justify-center text-sm text-slate-600" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загружаем заявки и файлы…</div> : detailsError[order.machineId] ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{detailsError[order.machineId]}</div> : orderDetails ? <div className="min-w-0 space-y-5">
              <section aria-labelledby={`requests-${order.machineId}`}><h2 id={`requests-${order.machineId}`} className="font-semibold text-slate-950">Заявки технолога</h2><div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">{orderDetails.requests.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">Заявок нет</div> : orderDetails.requests.map((request) => <article key={request.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-medium text-slate-950">Заявка №{request.number}</h3><p className="mt-1 text-sm text-slate-500">{formatDateTime(request.createdAt)} · {request.authorName}</p></div><Badge variant="outline" className={request.completion ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}>{request.completion ? 'Завершена' : 'Не завершена'}</Badge></div>{request.completion && <div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div className="rounded-lg bg-slate-50 p-2"><span className="block text-xs text-slate-500">Технолог</span><strong>{request.completion.enteredMinutes} мин</strong></div><div className="rounded-lg bg-slate-50 p-2"><span className="block text-xs text-slate-500">+25%</span><strong>+{request.completion.addedMinutes} мин</strong></div><div className="rounded-lg bg-blue-950 p-2 text-white"><span className="block text-xs text-blue-200">Итого</span><strong>{request.completion.actualMinutes} мин</strong></div></div>}<div className="mt-3"><p className="flex items-center gap-2 text-sm font-medium text-slate-800"><Archive className="h-4 w-4" />Программы: {request.archives.length}</p>{request.archives.map((archive) => <a key={archive.id} href={archive.downloadUrl} className="mt-2 flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="min-w-0 break-all">{archive.fileName}<span className="ml-2 text-xs text-blue-700">{formatFileSize(archive.fileSize)}</span></span><Download className="h-4 w-4 shrink-0" /></a>)}{request.archives.length === 0 && <p className="mt-1 text-sm text-slate-500">Программа не добавлена</p>}</div></article>)}</div></section>
              <section><h2 className="font-semibold text-slate-950">Изделия заказа</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{orderDetails.items.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3"><p className="font-medium text-slate-900">{item.productName}</p><p className="mt-1 text-sm text-slate-500">{item.drawingNumber} · {item.quantity} шт.</p></div>)}</div></section>
              <section><Button type="button" variant="outline" className="min-h-11 w-full border-blue-200 text-blue-900 sm:w-auto" aria-expanded={Boolean(filesOpen[order.machineId])} onClick={() => setFilesOpen((current) => ({ ...current, [order.machineId]: !current[order.machineId] }))}><FileStack className="mr-2 h-4 w-4" />Все чертежи и STEP ({orderDetails.files.length})</Button>{filesOpen[order.machineId] && <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{orderDetails.files.length === 0 ? <p className="text-sm text-slate-500">У закреплённых версий файлов нет</p> : orderDetails.files.map((file) => <a key={`${file.kind}-${file.id}`} href={file.downloadUrl} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 min-w-0 justify-between bg-white')}><span className="min-w-0 truncate"><span className="mr-2 text-xs text-slate-500">{file.label}</span>{file.fileName}</span><Download className="ml-2 h-4 w-4 shrink-0" /></a>)}</div>}</section>
            </div> : null}
          </div>}
        </article>
      })}
    </section>}

    <Dialog open={Boolean(startOrder)} onOpenChange={(open) => { if (!open && !pending) setStartOrder(null) }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Взять заказ в работу</DialogTitle><DialogDescription>Будет создан факт Заготовки, а складские резервы спишутся сразу.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="font-medium text-blue-950">{startOrder?.name}</p><p className="mt-1 text-sm text-blue-800">Фактическая дата: {formatDate(workspace.today)}</p></div><div className="space-y-1.5"><Label htmlFor="cutting-shift">Смена</Label><select id="cutting-shift" value={shift} onChange={(event) => setShift(event.target.value as 'day' | 'night')} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="day">Дневная</option><option value="night">Ночная</option></select></div><div className="space-y-1.5"><Label htmlFor="cutting-section">Участок Заготовки</Label><select id="cutting-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">Выберите участок</option>{workspace.sections.filter((section) => section.factoryId === startOrder?.factoryId).map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div></div><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setStartOrder(null)}>Отмена</Button><Button type="button" disabled={pending || !sectionId} onClick={startCycle}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Взял в работу</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(reopenOrder)} onOpenChange={(open) => { if (!open && !pending) setReopenOrder(null) }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Вернуть машину в работу</DialogTitle><DialogDescription>Складской факт и списания не откатываются. Причина сохранится в аудите.</DialogDescription></DialogHeader><div className="space-y-1.5"><Label htmlFor="reopen-reason">Причина</Label><textarea id="reopen-reason" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3" maxLength={500} /></div><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setReopenOrder(null)}>Отмена</Button><Button type="button" disabled={pending || reopenReason.trim().length < 3} onClick={reopenCycle}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Вернуть в работу</Button></DialogFooter></DialogContent></Dialog>
  </main>
}
