'use client'

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  GripVertical,
  Layers3,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  Route,
  Search,
  Trash2,
  Truck,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  cancelTransportTrip,
  completeTransportTrip,
  createTransportTrip,
  decideTransportTripDateChange,
  getTransportWorkspace,
  startTransportTrip,
  updateTransportTrip,
  updateTransportTripStopStatus,
  type TransportNeedKind,
  type TransportTrip,
  type TransportTripStatus,
  type TransportWorkspace,
  type UnifiedTransportNeed,
} from '@/lib/actions/transport-trips'
import {
  buildTransportStopPlan,
  getTransportStopOrderError,
  reconcileTransportStopPlan,
  type TransportDraftAssignment,
  type TransportDraftStop,
} from '@/lib/transport/trip-rules'
import { notifySidebarWorkQueuesChanged } from '@/lib/sidebar-work-queue-events'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 40

const categoryMeta: Record<TransportNeedKind, {
  label: string
  shortLabel: string
  icon: typeof Package
  chip: string
  iconTone: string
}> = {
  materials: {
    label: 'Материалы',
    shortLabel: 'Материалы',
    icon: Boxes,
    chip: 'border-sky-200 bg-sky-50 text-sky-800',
    iconTone: 'bg-sky-100 text-sky-700',
  },
  detailing: {
    label: 'Деталировка',
    shortLabel: 'Деталировка',
    icon: Layers3,
    chip: 'border-violet-200 bg-violet-50 text-violet-800',
    iconTone: 'bg-violet-100 text-violet-700',
  },
  outsourcing: {
    label: 'Аутсорсинг',
    shortLabel: 'Аутсорсинг',
    icon: Wrench,
    chip: 'border-amber-200 bg-amber-50 text-amber-900',
    iconTone: 'bg-amber-100 text-amber-800',
  },
}

const statusMeta: Record<TransportTripStatus, {
  label: string
  badge: string
}> = {
  needed: { label: 'Нужен транспорт', badge: 'border-slate-200 bg-slate-50 text-slate-700' },
  found: { label: 'Запланирован', badge: 'border-blue-200 bg-blue-50 text-blue-800' },
  in_transit: { label: 'Выполняется', badge: 'border-amber-200 bg-amber-50 text-amber-900' },
  completed: { label: 'Выполнен', badge: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  cancelled: { label: 'Отменён', badge: 'border-rose-200 bg-rose-50 text-rose-800' },
}

type NeedFilter = 'all' | TransportNeedKind

type TripDraft = {
  status: Exclude<TransportTripStatus, 'needed'>
  carrierSupplierId: string
  scheduledDate: string
  price: string
  route: string
  comment: string
}

type EditingTransportStop = TransportDraftStop & {
  id: string | null
  status: TransportTrip['stops'][number]['status']
  arrivedAt: string | null
  completedAt: string | null
}

function formatDate(value: string | null) {
  if (!value) return 'Дата не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function formatMoney(value: number | null) {
  if (value === null) return 'Цена не указана'
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₴`
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function formatTime(value: string | null) {
  if (!value) return 'Время не указано'
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function plannedArrivalIso(date: string, time: string) {
  if (!date || !time) return ''
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString()
}

function addHour(time: string) {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeFromDate(value: string | null) {
  if (!value) return ''
  return new Date(value).toTimeString().slice(0, 5)
}

function editableTripNeed(trip: TransportTrip, need: TransportTrip['needs'][number]): UnifiedTransportNeed {
  const pickup = trip.stops.find((stop) => stop.id === need.pickupStopId)
  const delivery = trip.stops.find((stop) => stop.id === need.deliveryStopId)
  return {
    key: need.key,
    id: need.id,
    kind: need.kind,
    source: need.source,
    direction: need.direction,
    planState: 'confirmed',
    status: 'linked',
    title: need.title,
    subtitle: need.subtitle,
    sourcePointKey: need.sourcePointKey,
    sourcePointLabel: need.sourcePointLabel,
    sourcePointCity: pickup?.city || null,
    sourcePointAddress: pickup?.address || null,
    destinationPointKey: need.destinationPointKey,
    destinationPointLabel: need.destinationPointLabel,
    destinationPointCity: delivery?.city || null,
    destinationPointAddress: delivery?.address || null,
    neededDate: need.neededDate,
    deadline: need.neededDate,
    itemLabels: [],
    volumeLabel: null,
    deliveryRisk: false,
    selectable: true,
    unavailableReason: null,
  }
}

function matchesSearch(need: UnifiedTransportNeed, search: string) {
  if (!search) return true
  const haystack = [
    need.title,
    need.subtitle,
    need.sourcePointLabel,
    need.destinationPointLabel,
    ...need.itemLabels,
  ].join(' ').toLocaleLowerCase('ru')
  return haystack.includes(search)
}

function tripDraft(trip: TransportTrip): TripDraft {
  return {
    status: trip.status === 'needed' ? 'found' : trip.status,
    carrierSupplierId: trip.carrierSupplierId || '',
    scheduledDate: trip.scheduledDate || '',
    price: trip.price === null ? '' : String(trip.price),
    route: trip.route || trip.routeStart || '',
    comment: trip.comment || '',
  }
}

function tripNeedCurrentDate(trip: TransportTrip, need: TransportTrip['needs'][number]) {
  for (const request of trip.dateChangeRequests) {
    const approved = request.items.find((item) => item.status === 'approved' && item.needSource === need.source && item.needId === need.id)
    if (approved) return approved.newDate
  }
  return need.neededDate
}

function operationalStops(trip: TransportTrip) {
  return trip.stops.filter((stop) => stop.kind !== 'start')
}

function tripStartAvailable(trip: TransportTrip, clockNow: number | null) {
  const firstStop = operationalStops(trip)[0]
  return Boolean(
    firstStop?.plannedArrivalAt
      && clockNow !== null
      && new Date(firstStop.plannedArrivalAt).getTime() <= clockNow,
  )
}

function tripEndAvailable(trip: TransportTrip, clockNow: number | null) {
  const stops = operationalStops(trip)
  const lastStop = stops[stops.length - 1]
  return Boolean(
    lastStop?.plannedArrivalAt
      && clockNow !== null
      && new Date(lastStop.plannedArrivalAt).getTime() + lastStop.serviceDurationMinutes * 60_000 <= clockNow,
  )
}

function tripRouteLabel(trip: TransportTrip) {
  const stops = operationalStops(trip)
  return stops.length > 0
    ? stops.map((stop) => stop.pointLabel).join(' → ')
    : trip.route || trip.routeStart || 'Маршрут не указан'
}

const NeedCard = memo(function NeedCard({
  need,
  selected,
  compatible,
  onToggle,
}: {
  need: UnifiedTransportNeed
  selected: boolean
  compatible: boolean
  onToggle: (need: UnifiedTransportNeed) => void
}) {
  const meta = categoryMeta[need.kind]
  const Icon = meta.icon
  const disabled = !need.selectable || !compatible
  const disabledReason = !need.selectable
    ? need.unavailableReason || 'Недоступно'
    : !compatible
      ? 'Другая стартовая точка'
      : null

  return (
    <button
      type="button"
      data-focus-id={need.key}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle(need)}
      className={cn(
        'group w-full rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,transform] motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2',
        !disabled && 'hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md',
        selected && 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600',
        disabled && 'cursor-not-allowed border-slate-200 bg-slate-50/80 opacity-65',
      )}
    >
      <span className="flex gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors',
            selected
              ? 'border-blue-700 bg-blue-700 text-white'
              : 'border-slate-300 bg-white text-transparent',
          )}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', meta.chip)}>
              <Icon className="h-3.5 w-3.5" />
              {meta.shortLabel}
            </span>
            {need.deliveryRisk && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                <CircleAlert className="h-3.5 w-3.5" />
                Риск срока
              </span>
            )}
            {disabledReason && (
              <span className="text-xs font-medium text-slate-500">{disabledReason}</span>
            )}
          </span>

          <span className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-slate-950">{need.title}</span>
              <span className="block truncate text-sm text-slate-600">{need.subtitle}</span>
            </span>
            <span className="shrink-0 text-right text-xs text-slate-500">
              Требуется перевезти
              <span className="mt-0.5 block text-sm font-semibold text-slate-700">{formatDate(need.neededDate)}</span>
            </span>
          </span>

          <span className="mt-3 flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            <span className="truncate">{need.sourcePointLabel}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{need.destinationPointLabel}</span>
          </span>

          {(need.volumeLabel || need.itemLabels.length > 0) && (
            <span className="mt-2 block truncate text-xs text-slate-500">
              {[need.volumeLabel, ...need.itemLabels.slice(0, 2)].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      </span>
    </button>
  )
})

export function TransportWorkspacePage({ workspace: initialWorkspace }: { workspace: TransportWorkspace }) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const searchParams = useSearchParams()
  const focusedNeedKey = searchParams.get('focus')
  const [isPending, startTransition] = useTransition()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [needFilter, setNeedFilter] = useState<NeedFilter>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('ru'))
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [carrierSupplierId, setCarrierSupplierId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [price, setPrice] = useState('')
  const [routeStops, setRouteStops] = useState<TransportDraftStop[]>([])
  const [routeAssignments, setRouteAssignments] = useState<TransportDraftAssignment[]>([])
  const [draggedStopId, setDraggedStopId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [dateChangeReason, setDateChangeReason] = useState('')
  const [mobileShortcutHidden, setMobileShortcutHidden] = useState(false)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<TripDraft | null>(null)
  const [editingNeeds, setEditingNeeds] = useState<UnifiedTransportNeed[]>([])
  const [editingStops, setEditingStops] = useState<EditingTransportStop[]>([])
  const [editingAssignments, setEditingAssignments] = useState<TransportDraftAssignment[]>([])
  const [editingDateChangeReason, setEditingDateChangeReason] = useState('')
  const [editingRemovalReason, setEditingRemovalReason] = useState('')
  const [editingDirty, setEditingDirty] = useState(false)
  const [needPickerOpen, setNeedPickerOpen] = useState(false)
  const [needPickerSearch, setNeedPickerSearch] = useState('')
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState<{
    action: 'start' | 'complete'
    tripId: string
  } | null>(null)
  const [clockNow, setClockNow] = useState<number | null>(null)

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now())
    const initialClock = window.setTimeout(updateClock, 0)
    const interval = window.setInterval(updateClock, 30_000)
    return () => {
      window.clearTimeout(initialClock)
      window.clearInterval(interval)
    }
  }, [])

  const needByKey = useMemo(
    () => new Map(workspace.needs.map((need) => [need.key, need])),
    [workspace.needs],
  )
  const selectedNeeds = useMemo(
    () => selectedKeys.map((key) => needByKey.get(key)).filter((need): need is UnifiedTransportNeed => Boolean(need)),
    [needByKey, selectedKeys],
  )
  const selectedCarrierLabel = workspace.carriers.find((carrier) => carrier.id === carrierSupplierId)?.name
    || 'Выберите перевозчика'

  const rebuildRoutePlan = useCallback((needs: UnifiedTransportNeed[], preserve = false) => {
    if (needs.length === 0) {
      setRouteStops([])
      setRouteAssignments([])
      return
    }
    const plan = preserve
      ? reconcileTransportStopPlan(routeStops, routeAssignments, needs)
      : buildTransportStopPlan(needs)
    setRouteStops(plan.stops)
    setRouteAssignments(plan.assignments)
  }, [routeAssignments, routeStops])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset pagination after filter changes
    setVisibleCount(PAGE_SIZE)
  }, [deferredSearch, needFilter])

  useEffect(() => {
    if (!focusedNeedKey) return
    const focusedIndex = workspace.needs.findIndex((need) => need.key === focusedNeedKey)
    if (focusedIndex >= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL focus initializes the visible list
      setNeedFilter('all')
      setSearch('')
      setVisibleCount(Math.max(PAGE_SIZE, focusedIndex + 1))
    }
  }, [focusedNeedKey, workspace.needs])

  const categoryCounts = useMemo(() => ({
    all: workspace.needs.length,
    materials: workspace.needs.filter((need) => need.kind === 'materials').length,
    detailing: workspace.needs.filter((need) => need.kind === 'detailing').length,
    outsourcing: workspace.needs.filter((need) => need.kind === 'outsourcing').length,
  }), [workspace.needs])

  const filteredNeeds = useMemo(
    () => workspace.needs.filter((need) => (
      (needFilter === 'all' || need.kind === needFilter)
      && matchesSearch(need, deferredSearch)
    )),
    [deferredSearch, needFilter, workspace.needs],
  )
  const visibleNeeds = filteredNeeds.slice(0, visibleCount)
  const activeTrips = workspace.trips.filter((trip) => !['completed', 'cancelled'].includes(trip.status))
  const historyTrips = workspace.trips.filter((trip) => ['completed', 'cancelled'].includes(trip.status))
  const editingTrip = workspace.trips.find((trip) => trip.id === editingTripId) || null
  const visibleEditingStops = editingStops.filter((stop) => stop.kind !== 'start')
  const editingNeedKeys = new Set(editingNeeds.map((need) => need.key))
  const removedEditingNeeds = editingTrip?.needs.filter((need) => !need.released && !editingNeedKeys.has(need.key)) || []
  const availableEditingNeeds = workspace.needs.filter((need) => (
    !editingNeedKeys.has(need.key)
    && matchesSearch(need, needPickerSearch.trim().toLocaleLowerCase('ru'))
  ))
  const editingOperationalStops = editingTrip ? operationalStops(editingTrip) : []
  const editingFirstStop = editingOperationalStops[0] || null
  const editingEndAvailable = editingTrip ? tripEndAvailable(editingTrip, clockNow) : false
  const editingStartAvailable = editingTrip ? tripStartAvailable(editingTrip, clockNow) : false

  const toggleNeed = useCallback((need: UnifiedTransportNeed) => {
    setMobileShortcutHidden(false)
    const nextKeys = selectedKeys.includes(need.key)
      ? selectedKeys.filter((key) => key !== need.key)
      : [...selectedKeys, need.key]
    setSelectedKeys(nextKeys)
    const nextNeeds = nextKeys
      .map((key) => needByKey.get(key))
      .filter((candidate): candidate is UnifiedTransportNeed => Boolean(candidate))
    if (nextNeeds.length === 0) {
      setScheduledDate('')
      setDateChangeReason('')
    } else if (selectedKeys.length === 0) {
      setScheduledDate(need.neededDate || '')
    }
    rebuildRoutePlan(nextNeeds, routeStops.length > 0)
  }, [needByKey, rebuildRoutePlan, routeStops.length, selectedKeys])

  function resetComposer() {
    setSelectedKeys([])
    setCarrierSupplierId('')
    setScheduledDate('')
    setPrice('')
    setRouteStops([])
    setRouteAssignments([])
    setComment('')
    setDateChangeReason('')
  }

  async function refreshWorkspaceData() {
    const result = await getTransportWorkspace()
    if (result.error) {
      toast.error(result.error || 'Не удалось обновить транспортный раздел')
      return null
    }
    setWorkspace(result.data)
    notifySidebarWorkQueuesChanged()
    return result.data
  }

  function updateRouteStop(clientId: string, patch: Partial<TransportDraftStop>) {
    setRouteStops((current) => current.map((stop) => stop.clientId === clientId ? { ...stop, ...patch } : stop))
  }

  function moveRouteStop(clientId: string, direction: -1 | 1, targetClientId?: string) {
    setRouteStops((current) => {
      const from = current.findIndex((stop) => stop.clientId === clientId)
      const target = targetClientId
        ? current.findIndex((stop) => stop.clientId === targetClientId)
        : from + direction
      if (from < 0 || target < 0 || target >= current.length) return current
      if (current[from].kind !== 'service' || current[target].kind !== 'service') return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(target, 0, moved)
      const orderedTimes = current.map((stop) => stop.plannedTime)
      const withOrderedTimes = next.map((stop, index) => ({ ...stop, plannedTime: orderedTimes[index] }))
      const error = getTransportStopOrderError(withOrderedTimes, routeAssignments)
      if (error) {
        toast.error(error)
        return current
      }
      return withOrderedTimes
    })
  }

  function addFinishStop() {
    setRouteStops((current) => {
      if (current.some((stop) => stop.kind === 'finish')) return current
      const last = current[current.length - 1]
      return [...current, {
        clientId: 'trip-finish',
        pointKey: 'custom:finish',
        pointLabel: last?.pointLabel || 'Точка завершения',
        city: null,
        address: null,
        kind: 'finish',
        plannedTime: last ? addHour(last.plannedTime) : '18:00',
        serviceDurationMinutes: 0,
      }]
    })
  }

  function createTrip() {
    if (dateMismatches.length > 0 && !window.confirm(
      `Будет создан один запрос на согласование ${dateMismatches.length} переносов дат. Продолжить?`,
    )) return
    setPendingAction('create')
    startTransition(async () => {
      const result = await createTransportTrip({
        needs: selectedNeeds.map((need) => ({ source: need.source, id: need.id })),
        carrierSupplierId,
        scheduledDate,
        price,
        stops: routeStops.map((stop) => ({
          ...stop,
          plannedArrivalAt: plannedArrivalIso(scheduledDate, stop.plannedTime),
        })),
        assignments: routeAssignments,
        comment: comment || null,
        dateChangeReason: dateChangeReason || null,
      })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось создать рейс')
        return
      }
      toast.success('Рейс создан и потребности объединены')
      resetComposer()
      await refreshWorkspaceData()
    })
  }

  function openTrip(trip: TransportTrip) {
    const stopById = new Map(trip.stops.map((stop) => [stop.id, stop]))
    setEditingTripId(trip.id)
    setEditingDraft(tripDraft(trip))
    setEditingNeeds(trip.needs.filter((need) => !need.released).map((need) => editableTripNeed(trip, need)))
    setEditingStops(trip.stops.map((stop) => ({
      id: stop.id,
      clientId: stop.clientKey,
      pointKey: stop.pointKey,
      pointLabel: stop.pointLabel,
      city: stop.city,
      address: stop.address,
      kind: stop.kind,
      plannedTime: timeFromDate(stop.plannedArrivalAt),
      serviceDurationMinutes: stop.serviceDurationMinutes,
      status: stop.status,
      arrivedAt: stop.arrivedAt,
      completedAt: stop.completedAt,
    })))
    setEditingAssignments(trip.needs.filter((need) => !need.released).flatMap((need) => {
      const pickup = need.pickupStopId ? stopById.get(need.pickupStopId) : null
      const delivery = need.deliveryStopId ? stopById.get(need.deliveryStopId) : null
      return pickup && delivery ? [{
        needKey: need.key,
        pickupStopClientId: pickup.clientKey,
        deliveryStopClientId: delivery.clientKey,
      }] : []
    }))
    setEditingDateChangeReason('')
    setEditingRemovalReason('')
    setEditingDirty(false)
    setNeedPickerOpen(false)
    setNeedPickerSearch('')
    setCancelReason('')
  }

  function reconcileEditingComposition(nextNeeds: UnifiedTransportNeed[]) {
    const plan = reconcileTransportStopPlan(editingStops, editingAssignments, nextNeeds)
    const currentByClientId = new Map(editingStops.map((stop) => [stop.clientId, stop]))
    let nextStops = plan.stops.map((stop): EditingTransportStop => {
      const current = currentByClientId.get(stop.clientId)
      return current ? { ...current, ...stop } : {
        ...stop,
        id: null,
        status: 'planned',
        arrivedAt: null,
        completedAt: null,
      }
    })
    if (editingTrip?.status === 'in_transit') {
      const locked = editingStops.filter((stop) => stop.status !== 'planned')
      const lockedKeys = new Set(locked.map((stop) => stop.clientId))
      nextStops = [...locked, ...nextStops.filter((stop) => !lockedKeys.has(stop.clientId))]
    }
    setEditingNeeds(nextNeeds)
    setEditingStops(nextStops)
    setEditingAssignments(plan.assignments)
    setEditingDirty(true)
  }

  function addNeedToEditingTrip(need: UnifiedTransportNeed) {
    reconcileEditingComposition([...editingNeeds, need])
    setNeedPickerOpen(false)
    setNeedPickerSearch('')
  }

  function canRemoveEditingNeed(need: UnifiedTransportNeed) {
    if (editingTrip?.status !== 'in_transit') return true
    const tripNeed = editingTrip.needs.find((candidate) => candidate.key === need.key)
    const pickup = tripNeed?.pickupStopId
      ? editingTrip.stops.find((stop) => stop.id === tripNeed.pickupStopId)
      : null
    return !pickup || pickup.status === 'planned'
  }

  function removeNeedFromEditingTrip(need: UnifiedTransportNeed) {
    if (!canRemoveEditingNeed(need)) {
      toast.error('Нельзя исключить потребность после начала её точки забора')
      return
    }
    if (editingNeeds.length === 1) {
      setCancelDialogOpen(true)
      return
    }
    reconcileEditingComposition(editingNeeds.filter((candidate) => candidate.key !== need.key))
  }

  function saveTrip() {
    if (!editingTrip || !editingDraft) return
    setPendingAction(`trip:${editingTrip.id}`)
    startTransition(async () => {
      const result = await updateTransportTrip({
        tripId: editingTrip.id,
        needs: editingNeeds.map((need) => ({ source: need.source, id: need.id })),
        carrierSupplierId: editingDraft.carrierSupplierId,
        scheduledDate: editingDraft.scheduledDate,
        price: editingDraft.price,
        comment: editingDraft.comment || null,
        dateChangeReason: editingDateChangeReason || null,
        removalReason: editingRemovalReason || null,
        stops: editingStops.map((stop) => ({
          id: stop.id,
          clientId: stop.clientId,
          pointKey: stop.pointKey,
          pointLabel: stop.pointLabel,
          city: stop.city,
          address: stop.address,
          kind: stop.kind,
          plannedArrivalAt: plannedArrivalIso(editingDraft.scheduledDate, stop.plannedTime),
          serviceDurationMinutes: stop.serviceDurationMinutes,
        })),
        assignments: editingAssignments,
      })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить рейс')
        return
      }
      toast.success(editingDraft.status === 'completed' ? 'Рейс завершён' : 'Рейс сохранён')
      setEditingTripId(null)
      setEditingDraft(null)
      setEditingNeeds([])
      setEditingAssignments([])
      await refreshWorkspaceData()
    })
  }

  function moveEditingStop(stopId: string, direction: -1 | 1) {
    const from = editingStops.findIndex((stop) => stop.clientId === stopId)
    const target = from + direction
    if (from < 0 || target < 0 || target >= editingStops.length) return
    if (editingStops[from].kind !== 'service' || editingStops[target].kind !== 'service') return
    if (editingTrip?.status === 'in_transit' && (
      editingStops[from].status !== 'planned' || editingStops[target].status !== 'planned'
    )) {
      toast.error('Пройденную или начатую часть маршрута нельзя изменить')
      return
    }
    const next = [...editingStops]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    const positions = new Map(next.map((stop, index) => [stop.clientId, index]))
    if (editingAssignments.some((assignment) => (
      (positions.get(assignment.pickupStopClientId) ?? -1) >= (positions.get(assignment.deliveryStopClientId) ?? -1)
    ))) {
      toast.error('Доставка не может быть раньше забора')
      return
    }
    const orderedTimes = editingStops.map((stop) => stop.plannedTime)
    setEditingStops(next.map((stop, index) => ({ ...stop, plannedTime: orderedTimes[index] })))
    setEditingDirty(true)
  }

  function changeStopStatus(stopId: string, status: 'arrived' | 'completed') {
    setPendingAction(`stop:${stopId}:${status}`)
    startTransition(async () => {
      const result = await updateTransportTripStopStatus({ stopId, status })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось обновить остановку')
        return
      }
      toast.success(status === 'arrived' ? 'Прибытие отмечено' : 'Остановка выполнена')
      const refreshed = await refreshWorkspaceData()
      const refreshedTrip = refreshed?.trips.find((trip) => trip.id === editingTripId)
      if (refreshedTrip) openTrip(refreshedTrip)
    })
  }

  function cancelTrip() {
    if (!editingTrip || !cancelReason.trim()) return
    setPendingAction(`cancel:${editingTrip.id}`)
    startTransition(async () => {
      const result = await cancelTransportTrip({ tripId: editingTrip.id, reason: cancelReason })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось отменить рейс')
        return
      }
      toast.success('Рейс отменён, потребности возвращены в очередь')
      setCancelDialogOpen(false)
      setEditingTripId(null)
      setEditingDraft(null)
      setEditingNeeds([])
      setEditingStops([])
      setEditingAssignments([])
      await refreshWorkspaceData()
    })
  }

  function decideDateChange(requestId: string, decision: 'approved' | 'rejected') {
    const comment = window.prompt(decision === 'approved' ? 'Комментарий к одобрению (необязательно)' : 'Причина отклонения')
    if (comment === null) return
    setPendingAction(`date:${requestId}:${decision}`)
    startTransition(async () => {
      const result = await decideTransportTripDateChange({ requestId, decision, comment })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось обработать согласование')
        return
      }
      toast.success(result.outcome === 'conflicted' ? 'Обнаружен конфликт исходных дат' : decision === 'approved' ? 'Перенос дат одобрен' : 'Перенос дат отклонён')
      const refreshed = await refreshWorkspaceData()
      const refreshedTrip = refreshed?.trips.find((trip) => trip.id === editingTripId)
      if (refreshedTrip) openTrip(refreshedTrip)
    })
  }

  function confirmTripLifecycle() {
    if (!lifecycleConfirmation) return
    const { action, tripId } = lifecycleConfirmation
    const targetTrip = workspace.trips.find((trip) => trip.id === tripId)
    if (!targetTrip) return
    setPendingAction(`${action}:${tripId}`)
    startTransition(async () => {
      const result = action === 'start'
        ? await startTransportTrip({ tripId })
        : await completeTransportTrip({ tripId })
      setPendingAction(null)
      if (!result.success) {
        toast.error(result.error || (action === 'start' ? 'Не удалось начать рейс' : 'Не удалось завершить рейс'))
        return
      }

      toast.success(action === 'start' ? 'Рейс выполняется' : 'Рейс выполнен и перенесён в историю')
      setLifecycleConfirmation(null)
      const refreshed = await refreshWorkspaceData()
      if (action === 'start') {
        const refreshedTrip = refreshed?.trips.find((trip) => trip.id === tripId)
        if (refreshedTrip && editingTripId === tripId) openTrip(refreshedTrip)
      } else if (editingTripId === tripId) {
        setEditingTripId(null)
        setEditingDraft(null)
        setEditingNeeds([])
        setEditingStops([])
        setEditingAssignments([])
      }
    })
  }

  const dateMismatches = selectedNeeds.filter((need) => need.neededDate && scheduledDate && need.neededDate !== scheduledDate)
  const canCreate = selectedNeeds.length > 0
    && Boolean(carrierSupplierId)
    && Boolean(scheduledDate)
    && price !== ''
    && routeStops.length > 1
    && routeStops.every((stop) => Boolean(stop.pointLabel.trim()) && Boolean(stop.plannedTime))
    && !getTransportStopOrderError(routeStops, routeAssignments)
    && (dateMismatches.length === 0 || Boolean(dateChangeReason.trim()))
    && !isPending

  return (
    <div className="min-w-0 space-y-5 pb-10">
      <header className="overflow-hidden rounded-3xl border border-blue-100 bg-[linear-gradient(135deg,#f8fbff_0%,#eef5ff_58%,#f5f8fc_100%)] shadow-[0_14px_40px_rgba(30,64,175,0.08)]">
        <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-700">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-950 text-white shadow-sm">
                <Truck className="h-5 w-5" />
              </span>
              Логистика снабжения
            </div>
            <h1 className="max-w-3xl text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Потребности и рейсы
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
              Рейс создаётся только по выбранным потребностям — повторяющегося ежедневного расписания нет.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]">
            <Metric icon={Package} label="Потребности" value={workspace.needs.length} tone="blue" />
            <Metric icon={CheckCircle2} label="Выбрано" value={selectedNeeds.length} tone="emerald" />
            <Metric icon={Truck} label="Активные рейсы" value={activeTrips.length} tone="violet" />
            <Metric icon={Clock3} label="В истории" value={historyTrips.length} tone="slate" />
          </div>
        </div>
      </header>

      {Object.keys(workspace.errors).length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Часть категорий загрузилась с ошибкой</div>
              <div className="mt-1 text-amber-800">{Object.values(workspace.errors).join(' · ')}</div>
            </div>
          </div>
        </div>
      )}

      {selectedNeeds.length > 0 && !mobileShortcutHidden && (
        <div className="fixed inset-x-4 bottom-4 z-40 xl:hidden">
          <Button
            type="button"
            onClick={() => {
              setMobileShortcutHidden(true)
              document.getElementById('transport-composer')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }}
            className="h-12 w-full rounded-2xl bg-emerald-700 text-base font-semibold shadow-[0_14px_36px_rgba(5,150,105,0.34)] hover:bg-emerald-800"
          >
            К оформлению рейса · {selectedNeeds.length}
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_470px] xl:items-start">
        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-[0_10px_32px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Все потребности</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Дата карточки означает «требуется перевезти». Выберите компании и настройте очередь справа.
                </p>
              </div>
              <Label className="relative block w-full lg:max-w-xs" htmlFor="transport-search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <span className="sr-only">Поиск потребностей</span>
                <Input
                  id="transport-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Машина, маршрут, позиция…"
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-9"
                />
              </Label>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <FilterButton active={needFilter === 'all'} onClick={() => setNeedFilter('all')}>
                Все <span>{categoryCounts.all}</span>
              </FilterButton>
              {(Object.keys(categoryMeta) as TransportNeedKind[]).map((kind) => {
                const meta = categoryMeta[kind]
                const Icon = meta.icon
                return (
                  <FilterButton key={kind} active={needFilter === kind} onClick={() => setNeedFilter(kind)}>
                    <Icon className="h-4 w-4" /> {meta.label} <span>{categoryCounts[kind]}</span>
                  </FilterButton>
                )
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {visibleNeeds.length === 0 ? (
              <EmptyNeeds hasSearch={Boolean(deferredSearch) || needFilter !== 'all'} />
            ) : (
              <div className="grid gap-3">
                {visibleNeeds.map((need) => (
                  <NeedCard
                    key={need.key}
                    need={need}
                    selected={selectedKeys.includes(need.key)}
                    compatible
                    onToggle={toggleNeed}
                  />
                ))}
              </div>
            )}

            {visibleCount < filteredNeeds.length && (
              <Button
                type="button"
                variant="outline"
                className="mt-4 h-11 w-full rounded-xl"
                onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              >
                Показать ещё {Math.min(PAGE_SIZE, filteredNeeds.length - visibleCount)}
              </Button>
            )}
          </div>
        </section>

        <aside id="transport-composer" className="scroll-mt-4 xl:sticky xl:top-4">
          <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-[0_16px_44px_rgba(5,150,105,0.10)]">
            <div className="bg-[linear-gradient(135deg,#064e3b_0%,#047857_100%)] p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Новый рейс</div>
                  <h2 className="mt-1 text-xl font-bold">Собрать маршрут</h2>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                  <Route className="h-6 w-6" />
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-sm">
                <span className="text-emerald-50">В рейсе</span>
                <span className="font-bold">{selectedNeeds.length} потребн.</span>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <RoutePlanner
                stops={routeStops}
                selectedNeeds={selectedNeeds}
                assignments={routeAssignments}
                draggedStopId={draggedStopId}
                onDraggedStopChange={setDraggedStopId}
                onStopChange={updateRouteStop}
                onMove={moveRouteStop}
                onAddFinish={addFinishStop}
                onRemoveFinish={() => setRouteStops((current) => current.filter((stop) => stop.kind !== 'finish'))}
              />

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Перевозчик
                  <Select value={carrierSupplierId} onValueChange={(value) => setCarrierSupplierId(value || '')}>
                    <SelectTrigger className="h-11 w-full rounded-xl bg-white">
                      <SelectValue>{selectedCarrierLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {workspace.carriers.map((carrier) => (
                        <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>

                <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Дата рейса
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(event) => setScheduledDate(event.target.value)}
                    className="h-11 rounded-xl"
                  />
                </Label>
              </div>

              {dateMismatches.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">Требуется согласование переноса дат</div>
                      <ul className="mt-2 space-y-1 text-xs">
                        {dateMismatches.map((need) => (
                          <li key={need.key}>{need.title}: {formatDate(need.neededDate)} → {formatDate(scheduledDate)}</li>
                        ))}
                      </ul>
                      <Label className="mt-3 grid gap-1.5 text-sm font-medium">
                        Обязательная причина
                        <Textarea value={dateChangeReason} onChange={(event) => setDateChangeReason(event.target.value)}
                          placeholder="Почему потребности нужно перевезти одним рейсом" className="min-h-20 bg-white" />
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Цена перевозки
                <div className="relative">
                  <Banknote className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0,00"
                    className="h-11 rounded-xl pl-9"
                  />
                </div>
              </Label>

              <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Комментарий
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Машина, контакты, особые условия…"
                  className="min-h-20 resize-none rounded-xl"
                />
              </Label>

              <Button
                type="button"
                disabled={!canCreate}
                onClick={createTrip}
                className="h-12 w-full gap-2 rounded-xl bg-emerald-700 text-base font-semibold hover:bg-emerald-800"
              >
                {pendingAction === 'create'
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <Plus className="h-5 w-5" />}
                Создать рейс
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <TripsSection
        title="Активные рейсы"
        description="Запланированные перевозки и рейсы в пути."
        trips={activeTrips}
        onOpen={openTrip}
        emptyText="Активных рейсов пока нет."
        clockNow={clockNow}
        onLifecycle={(trip, action) => setLifecycleConfirmation({ action, tripId: trip.id })}
      />

      {historyTrips.length > 0 && (
        <TripsSection
          title="История рейсов"
          description="Завершённые и отменённые рейсы."
          trips={historyTrips}
          onOpen={openTrip}
          emptyText=""
          collapsible
        />
      )}

      <Sheet
        open={Boolean(editingTrip)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTripId(null)
            setEditingDraft(null)
            setEditingNeeds([])
            setEditingStops([])
            setEditingAssignments([])
            setEditingRemovalReason('')
            setEditingDirty(false)
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {editingTrip && editingDraft && (
            <>
              <SheetHeader className="border-b border-slate-100 p-5 pr-14">
                <SheetTitle className="text-xl font-bold text-slate-950">
                  Рейс #{editingTrip.id.slice(0, 8).toUpperCase()}
                </SheetTitle>
                <SheetDescription>
                  {tripRouteLabel(editingTrip)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-5 pb-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Состав рейса</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {['completed', 'cancelled'].includes(editingTrip.status)
                          ? `${editingTrip.needs.length} потребн.`
                          : `${editingNeeds.length} потребн.`}
                      </div>
                    </div>
                    {!['completed', 'cancelled'].includes(editingTrip.status) && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setNeedPickerOpen(true)} className="rounded-xl">
                        <Plus className="h-4 w-4" /> Добавить
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(['completed', 'cancelled'].includes(editingTrip.status)
                      ? editingTrip.needs
                      : editingNeeds
                    ).map((need) => (
                      <div key={'linkId' in need ? need.linkId || need.key : need.key} className="rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
                        <div className="flex items-start gap-2">
                          <Badge variant="outline" className={categoryMeta[need.kind].chip}>
                            {categoryMeta[need.kind].label}
                          </Badge>
                          <span className="min-w-0 flex-1 font-semibold text-slate-900">{need.title}</span>
                          {!['completed', 'cancelled'].includes(editingTrip.status) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Исключить потребность ${need.title}`}
                              disabled={!canRemoveEditingNeed(need as UnifiedTransportNeed)}
                              onClick={() => removeNeedFromEditingTrip(need as UnifiedTransportNeed)}
                              className="h-8 w-8 shrink-0 rounded-lg text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {need.sourcePointLabel} → {need.destinationPointLabel}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Текущая дата: {formatDate('linkId' in need ? tripNeedCurrentDate(editingTrip, need) : need.neededDate)}
                        </div>
                        {'released' in need && need.released && (
                          <div className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-800">
                            Исключена {formatDateTime(need.releasedAt)} · {need.releasedByName || 'Автор не указан'}
                            <span className="mt-0.5 block">Причина: {need.releasedReason || 'не указана в старой версии'}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {!['completed', 'cancelled'].includes(editingTrip.status) && editingTrip.needs.some((need) => need.released) && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">История исключений</div>
                    <div className="mt-3 space-y-2">
                      {editingTrip.needs.filter((need) => need.released).map((need) => (
                        <div key={need.linkId || need.key} className="rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
                          <div className="font-semibold text-slate-900">{need.title}</div>
                          <div className="mt-1 text-xs text-slate-500">{need.sourcePointLabel} → {need.destinationPointLabel}</div>
                          <div className="mt-2 text-xs text-rose-800">
                            Исключена {formatDateTime(need.releasedAt)} · {need.releasedByName || 'Автор не указан'}
                            <span className="mt-0.5 block">Причина: {need.releasedReason || 'не указана в старой версии'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {removedEditingNeeds.length > 0 && (
                  <Label className="grid gap-1.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-950">
                    Причина исключения {removedEditingNeeds.length === 1 ? 'потребности' : 'потребностей'}
                    <Textarea
                      value={editingRemovalReason}
                      onChange={(event) => setEditingRemovalReason(event.target.value)}
                      placeholder="Обязательно для сохранения истории изменений"
                      aria-required="true"
                      className="min-h-20 bg-white"
                    />
                  </Label>
                )}

                {editingTrip.status === 'cancelled' && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
                    <div className="font-semibold">Рейс отменён</div>
                    <div className="mt-1">Причина: {editingTrip.cancellationReason || 'не указана в старой версии'}</div>
                    <div className="mt-1 text-xs text-rose-800">
                      {editingTrip.cancelledByName || 'Автор не указан'} · {formatDateTime(editingTrip.cancelledAt)}
                    </div>
                  </div>
                )}

                {editingTrip.dateChangeState !== 'not_required' && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="font-semibold text-amber-950">
                      Перенос дат: {{ pending: 'ожидает согласования', approved: 'одобрен', rejected: 'отклонён', conflicted: 'конфликт исходных данных' }[editingTrip.dateChangeState]}
                    </div>
                    {editingTrip.dateChangeRequests.map((request) => (
                      <div key={request.id} className="mt-3 rounded-xl border border-amber-200 bg-white p-3 text-sm">
                        <div className="font-medium text-slate-900">Причина: {request.reason}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {request.requestedByName || 'Пользователь'} · {formatDateTime(request.createdAt)}
                          {request.decidedAt && ` · решение ${request.decidedByName || 'планировщика'} ${formatDateTime(request.decidedAt)}`}
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-slate-600">
                          {request.items.map((item) => <li key={item.id}>{formatDate(item.oldDate)} → {formatDate(item.newDate)}</li>)}
                        </ul>
                        {request.decisionComment && <div className="mt-2 text-xs text-slate-600">Решение: {request.decisionComment}</div>}
                        {request.status === 'pending' && (
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={() => decideDateChange(request.id, 'approved')} disabled={isPending}>Одобрить</Button>
                            <Button size="sm" variant="outline" onClick={() => decideDateChange(request.id, 'rejected')} disabled={isPending}>Отклонить</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Статус
                  <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
                    <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusMeta[editingTrip.status].badge)}>
                      {statusMeta[editingTrip.status].label}
                    </span>
                  </div>
                </div>

                {editingTrip.status === 'found' && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                    <div className="font-semibold">Подтверждение начала рейса</div>
                    <div className="mt-1 text-blue-800">
                      Плановое начало: {formatDateTime(editingFirstStop?.plannedArrivalAt || null)}.
                      После подтверждения статус изменится на «Выполняется» и станут доступны отметки остановок.
                    </div>
                    {!editingStartAvailable && (
                      <div className="mt-2 text-xs font-medium text-amber-800">
                        Кнопка станет доступна в запланированное время начала рейса.
                      </div>
                    )}
                    {!['not_required', 'approved'].includes(editingTrip.dateChangeState) && (
                      <div className="mt-2 text-xs font-medium text-amber-800">
                        Сначала необходимо завершить согласование переноса дат.
                      </div>
                    )}
                    <Button
                      type="button"
                      disabled={
                        isPending
                        || editingDirty
                        || !editingStartAvailable
                        || !['not_required', 'approved'].includes(editingTrip.dateChangeState)
                      }
                      onClick={() => setLifecycleConfirmation({ action: 'start', tripId: editingTrip.id })}
                      className="mt-3 h-11 w-full rounded-xl bg-blue-800 hover:bg-blue-900"
                    >
                      {pendingAction === `start:${editingTrip.id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                      Подтвердить начало рейса
                    </Button>
                  </div>
                )}

                {editingTrip.status === 'in_transit' && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <div className="font-semibold">Рейс выполняется</div>
                    <div className="mt-1 text-amber-900">
                      {editingTrip.startedAt
                        ? `Начат ${formatDateTime(editingTrip.startedAt)} · ${editingTrip.startedByName || 'Пользователь'}`
                        : 'Начало подтверждено в старой версии без записи автора и времени.'}
                    </div>
                    <div className="mt-2 text-xs text-amber-800">
                      {editingEndAvailable
                        ? 'Плановое время маршрута закончилось. Подтвердите выполнение рейса, чтобы перенести его в историю.'
                        : 'Подтверждение завершения станет доступно после планового времени последней остановки.'}
                    </div>
                    <Button
                      type="button"
                      disabled={isPending || editingDirty || !editingEndAvailable}
                      onClick={() => setLifecycleConfirmation({ action: 'complete', tripId: editingTrip.id })}
                      className="mt-3 h-11 w-full rounded-xl bg-emerald-700 hover:bg-emerald-800"
                    >
                      {pendingAction === `complete:${editingTrip.id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                      Подтвердить: рейс выполнен
                    </Button>
                  </div>
                )}

                {editingTrip.status === 'completed' && editingTrip.completedAt && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                    <div className="font-semibold">Выполнение подтверждено</div>
                    <div className="mt-1 text-emerald-800">
                      {formatDateTime(editingTrip.completedAt)} · {editingTrip.completedByName || 'Пользователь'}
                    </div>
                  </div>
                )}

                <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Перевозчик
                  <Select
                    value={editingDraft.carrierSupplierId}
                    onValueChange={(value) => {
                      setEditingDraft((current) => current && ({ ...current, carrierSupplierId: value || '' }))
                      setEditingDirty(true)
                    }}
                    disabled={['completed', 'cancelled'].includes(editingTrip.status)}
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue>
                        {workspace.carriers.find((carrier) => carrier.id === editingDraft.carrierSupplierId)?.name
                          || 'Выберите перевозчика'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {workspace.carriers.map((carrier) => (
                        <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    Дата
                    <Input
                      type="date"
                      value={editingDraft.scheduledDate}
                      onChange={(event) => {
                        setEditingDraft((current) => current && ({ ...current, scheduledDate: event.target.value }))
                        setEditingDirty(true)
                      }}
                      disabled={['completed', 'cancelled'].includes(editingTrip.status)}
                      className="h-11 rounded-xl"
                    />
                  </Label>
                  <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    Цена
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editingDraft.price}
                      onChange={(event) => {
                        setEditingDraft((current) => current && ({ ...current, price: event.target.value }))
                        setEditingDirty(true)
                      }}
                      disabled={['completed', 'cancelled'].includes(editingTrip.status)}
                      className="h-11 rounded-xl"
                    />
                  </Label>
                </div>

                {editingDraft.scheduledDate && editingNeeds.some((need) => need.neededDate && need.neededDate !== editingDraft.scheduledDate) && (
                  <Label className="grid gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950">
                    Причина переноса даты рейса
                    <Textarea value={editingDateChangeReason} onChange={(event) => setEditingDateChangeReason(event.target.value)}
                      placeholder="Обязательно для повторной отправки на согласование" className="min-h-20 bg-white" />
                  </Label>
                )}

                {editingStops.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Остановки</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {visibleEditingStops.filter((stop) => stop.status === 'completed').length}
                          {' из '}
                          {visibleEditingStops.length} выполнено
                        </div>
                      </div>
                    </div>
                    <ol className="space-y-2">
                      {visibleEditingStops.map((stop, index) => {
                        const previousServiceStops = visibleEditingStops
                          .slice(0, index)
                        const canArrive = stop.status === 'planned'
                          && previousServiceStops.every((candidate) => candidate.status === 'completed')
                        return (
                          <li key={stop.clientId} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start gap-2">
                              <span className={cn(
                                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                stop.status === 'completed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : stop.status === 'arrived'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600',
                              )}>
                                {stop.status === 'completed' ? <Check className="h-4 w-4" /> : index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900">{stop.pointLabel}</span>
                                  <span className="text-sm font-bold text-slate-700">{stop.plannedTime || 'Время не указано'}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {stop.kind === 'finish'
                                      ? 'Завершение маршрута'
                                      : `${stop.serviceDurationMinutes} мин. на площадке`}
                                </div>

                                {!['completed', 'cancelled'].includes(editingTrip.status) && (
                                  <div className={cn(
                                    'mt-2 grid gap-1.5',
                                    stop.kind === 'service' ? 'grid-cols-[minmax(0,1fr)_5.5rem_auto_auto]' : 'grid-cols-1',
                                  )}>
                                    <Input
                                      type="time"
                                      value={stop.plannedTime}
                                      disabled={editingTrip.status === 'in_transit' && stop.status !== 'planned'}
                                      onChange={(event) => {
                                        setEditingStops((current) => current.map((candidate) => (
                                          candidate.clientId === stop.clientId
                                            ? { ...candidate, plannedTime: event.target.value }
                                            : candidate
                                        )))
                                        setEditingDirty(true)
                                      }}
                                      className="h-9 rounded-lg"
                                    />
                                    {stop.kind === 'service' && (
                                      <>
                                        <Input
                                          type="number"
                                          min={0}
                                          step={5}
                                          value={stop.serviceDurationMinutes}
                                          aria-label={`Время на площадке ${stop.pointLabel}, минут`}
                                          disabled={editingTrip.status === 'in_transit' && stop.status !== 'planned'}
                                          onChange={(event) => {
                                            setEditingStops((current) => current.map((candidate) => (
                                              candidate.clientId === stop.clientId
                                                ? { ...candidate, serviceDurationMinutes: Number(event.target.value) }
                                                : candidate
                                            )))
                                            setEditingDirty(true)
                                          }}
                                          className="h-9 rounded-lg"
                                        />
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          aria-label={`Поднять остановку ${stop.pointLabel}`}
                                          disabled={
                                            visibleEditingStops[index - 1]?.kind !== 'service'
                                            || (editingTrip.status === 'in_transit' && (
                                              stop.status !== 'planned' || visibleEditingStops[index - 1]?.status !== 'planned'
                                            ))
                                          }
                                          onClick={() => moveEditingStop(stop.clientId, -1)}
                                          className="h-9 w-9 rounded-lg"
                                        >
                                          <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          aria-label={`Опустить остановку ${stop.pointLabel}`}
                                          disabled={
                                            visibleEditingStops[index + 1]?.kind !== 'service'
                                            || (editingTrip.status === 'in_transit' && (
                                              stop.status !== 'planned' || visibleEditingStops[index + 1]?.status !== 'planned'
                                            ))
                                          }
                                          onClick={() => moveEditingStop(stop.clientId, 1)}
                                          className="h-9 w-9 rounded-lg"
                                        >
                                          <ArrowDown className="h-4 w-4" />
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                )}

                                {editingTrip.status === 'in_transit' && stop.id && !editingDirty && stop.status !== 'completed' && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={stop.status === 'arrived' ? 'default' : 'outline'}
                                    disabled={isPending || (!canArrive && stop.status === 'planned')}
                                    onClick={() => changeStopStatus(stop.id as string, stop.status === 'arrived' ? 'completed' : 'arrived')}
                                    className="mt-2 rounded-lg"
                                  >
                                    {pendingAction?.startsWith(`stop:${stop.id}`) && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {stop.status === 'arrived' ? 'Остановка выполнена' : 'Машина прибыла'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )}

                <Label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Комментарий
                  <Textarea
                    value={editingDraft.comment}
                    onChange={(event) => {
                      setEditingDraft((current) => current && ({ ...current, comment: event.target.value }))
                      setEditingDirty(true)
                    }}
                    disabled={['completed', 'cancelled'].includes(editingTrip.status)}
                    className="min-h-24 resize-none rounded-xl"
                  />
                </Label>
              </div>

              {!['completed', 'cancelled'].includes(editingTrip.status) && (
                <SheetFooter className="sticky bottom-0 grid grid-cols-1 gap-2 border-t border-slate-100 bg-white p-5 sm:grid-cols-[auto_1fr]">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isPending}
                    className="h-12 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  >
                    <Trash2 className="h-4 w-4" /> Отменить рейс
                  </Button>
                  <Button
                    type="button"
                    onClick={saveTrip}
                    disabled={
                      isPending
                      || !editingDraft.carrierSupplierId
                      || !editingDraft.scheduledDate
                      || editingDraft.price === ''
                      || editingNeeds.length === 0
                      || editingStops.length < 2
                      || editingStops.some((stop) => !stop.pointLabel.trim() || !stop.plannedTime)
                      || Boolean(getTransportStopOrderError(editingStops, editingAssignments))
                      || (editingNeeds.some((need) => need.neededDate && need.neededDate !== editingDraft.scheduledDate)
                        && !editingDateChangeReason.trim())
                      || (removedEditingNeeds.length > 0 && !editingRemovalReason.trim())
                    }
                    className="h-12 rounded-xl"
                  >
                    {pendingAction === `trip:${editingTrip.id}`
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : <CheckCircle2 className="h-5 w-5" />}
                    Сохранить рейс
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={needPickerOpen} onOpenChange={setNeedPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить потребности в рейс</DialogTitle>
            <DialogDescription>
              Выберите свободную потребность — точки забора и доставки добавятся в будущую часть маршрута.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="trip-need-search" className="grid gap-1.5 text-sm font-medium text-slate-700">
            Поиск
            <Input
              id="trip-need-search"
              value={needPickerSearch}
              onChange={(event) => setNeedPickerSearch(event.target.value)}
              placeholder="Машина, компания или маршрут…"
              className="h-11 rounded-xl"
            />
          </Label>
          <div className="space-y-2">
            {availableEditingNeeds.length > 0 ? availableEditingNeeds.map((need) => (
              <NeedCard
                key={need.key}
                need={need}
                selected={false}
                compatible
                onToggle={addNeedToEditingTrip}
              />
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Свободных потребностей по этому запросу нет.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить рейс?</AlertDialogTitle>
            <AlertDialogDescription>
              Рейс останется в истории, а {editingNeeds.length || editingTrip?.needs.length || 0} потребн. вернутся в свободную очередь.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label htmlFor="trip-cancel-reason" className="grid gap-1.5 text-sm font-medium text-slate-800">
            Причина отмены <span className="text-rose-700">*</span>
            <Textarea
              id="trip-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Почему рейс больше не должен выполняться"
              aria-required="true"
              className="min-h-24"
            />
          </Label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Вернуться</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                cancelTrip()
              }}
              disabled={isPending || !cancelReason.trim()}
              className="bg-rose-700 text-white hover:bg-rose-800 focus-visible:ring-rose-700"
            >
              {pendingAction?.startsWith('cancel:') && <Loader2 className="h-4 w-4 animate-spin" />}
              Отменить рейс
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={lifecycleConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setLifecycleConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycleConfirmation?.action === 'start' ? 'Начать выполнение рейса?' : 'Подтвердить выполнение рейса?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycleConfirmation?.action === 'start'
                ? 'Статус изменится на «Выполняется». После этого можно отмечать прибытие и выполнение остановок.'
                : 'Статус изменится на «Выполнен», потребности будут закрыты, а рейс переместится в историю.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Вернуться</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                confirmTripLifecycle()
              }}
              disabled={isPending}
              className={lifecycleConfirmation?.action === 'start'
                ? 'bg-blue-800 text-white hover:bg-blue-900 focus-visible:ring-blue-800'
                : 'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-700'}
            >
              {lifecycleConfirmation && pendingAction?.startsWith(`${lifecycleConfirmation.action}:`) && <Loader2 className="h-4 w-4 animate-spin" />}
              {lifecycleConfirmation?.action === 'start' ? 'Начать рейс' : 'Рейс выполнен'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RoutePlanner({
  stops,
  selectedNeeds,
  assignments,
  draggedStopId,
  onDraggedStopChange,
  onStopChange,
  onMove,
  onAddFinish,
  onRemoveFinish,
}: {
  stops: TransportDraftStop[]
  selectedNeeds: UnifiedTransportNeed[]
  assignments: TransportDraftAssignment[]
  draggedStopId: string | null
  onDraggedStopChange: (id: string | null) => void
  onStopChange: (id: string, patch: Partial<TransportDraftStop>) => void
  onMove: (id: string, direction: -1 | 1, targetId?: string) => void
  onAddFinish: () => void
  onRemoveFinish: () => void
}) {
  if (stops.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
        Выберите потребности — точки забора и доставки появятся здесь автоматически.
      </div>
    )
  }

  const needByKey = new Map(selectedNeeds.map((need) => [need.key, need]))
  const assignmentActions = assignments.flatMap((assignment) => {
    const need = needByKey.get(assignment.needKey)
    if (!need) return []
    return [
      { stopId: assignment.pickupStopClientId, label: `Забрать · ${need.title}`, tone: 'pickup' as const },
      { stopId: assignment.deliveryStopClientId, label: `Доставить · ${need.title}`, tone: 'delivery' as const },
    ]
  })
  const hasFinish = stops.some((stop) => stop.kind === 'finish')

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Очередь остановок</div>
          <p className="mt-1 text-xs text-slate-500">Перетащите точки или используйте стрелки.</p>
        </div>
        {!hasFinish && (
          <Button type="button" variant="outline" size="sm" onClick={onAddFinish} className="rounded-xl">
            <Plus className="h-4 w-4" /> Возврат
          </Button>
        )}
      </div>

      <ol className="space-y-2" aria-label="Маршрут рейса">
        {stops.map((stop, index) => {
          const actions = assignmentActions.filter((action) => action.stopId === stop.clientId)
          const canMoveUp = stop.kind === 'service' && stops[index - 1]?.kind === 'service'
          const canMoveDown = stop.kind === 'service' && stops[index + 1]?.kind === 'service'
          return (
            <li
              key={stop.clientId}
              draggable={stop.kind === 'service'}
              onDragStart={() => onDraggedStopChange(stop.clientId)}
              onDragEnd={() => onDraggedStopChange(null)}
              onDragOver={(event) => {
                if (stop.kind === 'service') event.preventDefault()
              }}
              onDrop={() => {
                if (draggedStopId && draggedStopId !== stop.clientId) onMove(draggedStopId, 1, stop.clientId)
                onDraggedStopChange(null)
              }}
              className={cn(
                'relative rounded-2xl border bg-white p-3 shadow-sm transition-colors',
                draggedStopId === stop.clientId ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-7 flex-col items-center gap-1">
                  {stop.kind === 'service'
                    ? <GripVertical className="mt-2 h-4 w-4 cursor-grab text-slate-400" aria-hidden="true" />
                    : <MapPin className="mt-2 h-4 w-4 text-emerald-700" aria-hidden="true" />}
                  <span className="text-[11px] font-bold text-slate-400">{index + 1}</span>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {stop.kind === 'service' ? (
                    <div>
                      <div className="truncate text-sm font-semibold text-slate-950">{stop.pointLabel}</div>
                      {(stop.city || stop.address) && (
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {[stop.city, stop.address].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Label className="grid gap-1 text-xs font-medium text-slate-600">
                      Точка завершения
                      <Input
                        value={stop.pointLabel}
                        onChange={(event) => onStopChange(stop.clientId, {
                          pointLabel: event.target.value,
                          pointKey: `custom:${stop.kind}`,
                        })}
                        className="h-9 rounded-lg bg-slate-50"
                      />
                    </Label>
                  )}

                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                    <Label className="grid gap-1 text-xs font-medium text-slate-600">
                      Время
                      <Input
                        type="time"
                        value={stop.plannedTime}
                        onChange={(event) => onStopChange(stop.clientId, { plannedTime: event.target.value })}
                        className="h-9 rounded-lg"
                      />
                    </Label>
                    {stop.kind === 'service' && (
                      <Label className="grid gap-1 text-xs font-medium text-slate-600">
                        На площадке, мин.
                        <Input
                          type="number"
                          min={0}
                          max={1440}
                          value={stop.serviceDurationMinutes}
                          onChange={(event) => onStopChange(stop.clientId, {
                            serviceDurationMinutes: Number(event.target.value),
                          })}
                          className="h-9 rounded-lg"
                        />
                      </Label>
                    )}
                  </div>

                  {actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((action) => (
                        <span
                          key={`${stop.clientId}:${action.label}`}
                          className={cn(
                            'rounded-full px-2 py-1 text-[11px] font-semibold',
                            action.tone === 'pickup'
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-emerald-50 text-emerald-800',
                          )}
                        >
                          {action.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  {stop.kind === 'service' && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Поднять остановку ${stop.pointLabel}`}
                        disabled={!canMoveUp}
                        onClick={() => onMove(stop.clientId, -1)}
                        className="h-8 w-8 rounded-lg"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Опустить остановку ${stop.pointLabel}`}
                        disabled={!canMoveDown}
                        onClick={() => onMove(stop.clientId, 1)}
                        className="h-8 w-8 rounded-lg"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {stop.kind === 'finish' && (
                    <Button type="button" variant="ghost" size="sm" onClick={onRemoveFinish} className="text-rose-700">
                      Убрать
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Package
  label: string
  value: number
  tone: 'blue' | 'emerald' | 'violet' | 'slate'
}) {
  const tones = {
    blue: 'bg-blue-100 text-blue-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    violet: 'bg-violet-100 text-violet-800',
    slate: 'bg-slate-200 text-slate-700',
  }
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl', tones[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2',
        active
          ? 'border-blue-800 bg-blue-950 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-900',
      )}
    >
      {children}
    </button>
  )
}

function EmptyNeeds({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
        <Package className="h-6 w-6" />
      </span>
      <div className="mt-4 font-semibold text-slate-900">
        {hasSearch ? 'По фильтру ничего не найдено' : 'Открытых потребностей нет'}
      </div>
      <div className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
        {hasSearch
          ? 'Измените категорию или поисковый запрос.'
          : 'Новые потребности появятся здесь автоматически из материалов, деталировки и аутсорсинга.'}
      </div>
    </div>
  )
}

function TripsSection({
  title,
  description,
  trips,
  onOpen,
  emptyText,
  collapsible = false,
  clockNow = null,
  onLifecycle,
}: {
  title: string
  description: string
  trips: TransportTrip[]
  onOpen: (trip: TransportTrip) => void
  emptyText: string
  collapsible?: boolean
  clockNow?: number | null
  onLifecycle?: (trip: TransportTrip, action: 'start' | 'complete') => void
}) {
  const heading = (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="rounded-full px-3">{trips.length}</Badge>
        {collapsible && <ChevronRight className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-90" />}
      </div>
    </div>
  )

  const content = trips.length === 0 ? (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {emptyText}
    </div>
  ) : (
    <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200" aria-label={title}>
      {trips.map((trip) => {
        const stops = operationalStops(trip)
        const nextStop = stops.find((stop) => stop.status !== 'completed')
        const completedStopCount = stops.filter((stop) => stop.status === 'completed').length
        const canStart = trip.status === 'found'
          && tripStartAvailable(trip, clockNow)
          && ['not_required', 'approved'].includes(trip.dateChangeState)
        const canComplete = trip.status === 'in_transit' && tripEndAvailable(trip, clockNow)
        return (
          <li
            key={trip.id}
            className="grid min-w-0 gap-3 bg-white px-4 py-3 transition-colors hover:bg-slate-50 sm:grid-cols-[minmax(0,1.5fr)_minmax(190px,0.8fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusMeta[trip.status].badge)}>
                  {statusMeta[trip.status].label}
                </span>
                <span className="text-xs font-semibold text-slate-400">#{trip.id.slice(0, 8).toUpperCase()}</span>
                {Array.from(new Set(trip.needs.map((need) => need.kind))).map((kind) => (
                  <span key={kind} className={cn('rounded-full border px-2 py-1 text-[11px] font-semibold', categoryMeta[kind].chip)}>
                    {categoryMeta[kind].label}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                <Route className="h-4 w-4 shrink-0 text-blue-700" />
                <span className="truncate">{tripRouteLabel(trip)}</span>
              </div>
              {nextStop && (
                <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-blue-800">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate"><span className="font-semibold">Следующая:</span> {nextStop.pointLabel}</span>
                  <span className="shrink-0 font-semibold">{formatTime(nextStop.plannedArrivalAt)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600 sm:grid-cols-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate font-medium">{trip.carrierName || 'Не назначен'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                {formatDate(trip.scheduledDate)}
              </span>
              <span className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-slate-400" />
                {formatMoney(trip.price)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                {stops.length > 0 ? `${completedStopCount} из ${stops.length}` : `${trip.needs.length} потребн.`}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {trip.status === 'found' && onLifecycle && (
                <Button
                  type="button"
                  size="sm"
                  disabled={!canStart}
                  title={!canStart
                    ? !['not_required', 'approved'].includes(trip.dateChangeState)
                      ? 'Ожидается согласование переноса дат'
                      : 'Запланированное время начала ещё не наступило'
                    : undefined}
                  onClick={() => onLifecycle(trip, 'start')}
                  className="min-h-10 rounded-xl bg-blue-800 px-3 hover:bg-blue-900"
                >
                  Начать рейс
                </Button>
              )}
              {trip.status === 'in_transit' && onLifecycle && (
                <Button
                  type="button"
                  size="sm"
                  disabled={!canComplete}
                  title={!canComplete ? 'Плановое время завершения ещё не наступило' : undefined}
                  onClick={() => onLifecycle(trip, 'complete')}
                  className="min-h-10 rounded-xl bg-emerald-700 px-3 hover:bg-emerald-800"
                >
                  Рейс выполнен
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Открыть рейс ${trip.id.slice(0, 8)}`}
                onClick={() => onOpen(trip)}
                className="h-11 w-11 rounded-xl"
              >
                {['completed', 'cancelled'].includes(trip.status)
                  ? <ChevronRight className="h-5 w-5" />
                  : <Pencil className="h-4 w-4" />}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )

  if (collapsible) {
    return (
      <details className="group rounded-3xl border border-slate-200 bg-white shadow-[0_10px_32px_rgba(15,23,42,0.05)]">
        <summary className="cursor-pointer list-none p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 sm:p-5">
          {heading}
        </summary>
        <div className="border-t border-slate-100 px-4 pb-4 sm:px-5 sm:pb-5">
          {content}
        </div>
      </details>
    )
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_10px_32px_rgba(15,23,42,0.05)] sm:p-5">
      {heading}

      {content}
    </section>
  )
}
