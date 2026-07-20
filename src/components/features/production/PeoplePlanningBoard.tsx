'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Factory,
  Layers3,
  ListOrdered,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Settings2,
  Trash2,
  UserRoundPlus,
  Users,
  Weight,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelEmployeeDayAction,
  confirmEmployeeAssignmentAction,
  copyEmployeePreviousDayAction,
  saveEmployeeAction,
  saveEmployeeRateAction,
  scheduleEmployeeAction,
  scheduleEmployeeFullDayAction,
  updateEmployeeAssignmentAction,
} from '@/lib/actions/people-planning'
import { addPlanningDays, planningDateRange, type PlanningHalf } from '@/lib/people-planning/slots'
import type {
  PeoplePlanningActionResult,
  PeoplePlanningMachine,
  PeoplePlanningPeriod,
  PeoplePlanningSection,
  PeoplePlanningWorkspace,
} from '@/lib/people-planning/types'
import type { EmployeeAssignment } from '@/lib/types'
import {
  applyPeoplePlanningAssignmentChanges,
  applyPeoplePlanningEmployeeChange,
  applyPeoplePlanningPeriod,
  applyPeoplePlanningRateChange,
} from '@/lib/people-planning/state'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Props = { data: PeoplePlanningWorkspace }

type PlanningLocation = Pick<
  PeoplePlanningWorkspace,
  'selectedFactoryId' | 'selectedDate' | 'selectedMonth' | 'view'
>

type WorkspaceResponse<T> = { success: true; data: T } | { success: false; error: string }

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' })
const longDateFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function formatDate(value: string, long = false) {
  return (long ? longDateFormatter : dateFormatter).format(new Date(`${value}T00:00:00Z`))
}

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function assignmentKey(employeeId: string, date: string, half: number) {
  return `${employeeId}:${date}:${half}`
}

function halfLabel(half: PlanningHalf) {
  return half === 1 ? 'Первая половина' : 'Вторая половина'
}

function compactSectionName(parentName: string, sectionName: string) {
  return sectionName === parentName ? sectionName : `${parentName} · ${sectionName}`
}

function queueLabel(machine: PeoplePlanningMachine) {
  const workshop = machine.productionWorkshop ? `Цех ${machine.productionWorkshop}` : 'Без цеха'
  const queue = machine.queueNumber ? `№ ${machine.queueNumber}` : 'без номера'
  return `${workshop} · ${queue}`
}

function planningLocation(workspace: PeoplePlanningWorkspace, changes: Record<string, string> = {}): PlanningLocation {
  return {
    selectedFactoryId: changes.factory || workspace.selectedFactoryId,
    selectedDate: changes.date || workspace.selectedDate,
    selectedMonth: changes.month || workspace.selectedMonth,
    view: changes.view === 'week' ? 'week' : changes.view === 'day' ? 'day' : workspace.view,
  }
}

function planningHref(location: PlanningLocation) {
  const params = new URLSearchParams({
    factory: location.selectedFactoryId,
    date: location.selectedDate,
    month: location.selectedMonth,
    view: location.view,
  })
  return `/production/people?${params.toString()}`
}

function periodCacheKey(location: Pick<PlanningLocation, 'selectedFactoryId' | 'selectedDate' | 'view'>) {
  return `${location.selectedFactoryId}:${location.selectedDate}:${location.view}`
}

async function fetchPlanningWorkspace<T>(location: PlanningLocation, scope: 'period' | 'workspace'): Promise<T> {
  const params = new URLSearchParams({
    factory: location.selectedFactoryId,
    date: location.selectedDate,
    month: location.selectedMonth,
    view: location.view,
    scope,
  })
  const response = await fetch(`/api/production/people/workspace?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  const payload = await response.json() as WorkspaceResponse<T>
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? 'Не удалось загрузить планирование' : payload.error)
  }
  return payload.data
}

function ProgressBar({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-[#2E5B9A]'
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-slate-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${color}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  )
}

export function PeoplePlanningBoard({ data: initialData }: Props) {
  const [data, setData] = useState(initialData)
  const [pending, startTransition] = useTransition()
  const [periodLoading, setPeriodLoading] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<EmployeeAssignment | null>(null)
  const [copyEmployeeId, setCopyEmployeeId] = useState<string | null>(null)
  const [clearEmployeeId, setClearEmployeeId] = useState<string | null>(null)
  const [scheduleSectionId, setScheduleSectionId] = useState(data.sections[0]?.id || '')
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState('')
  const [scheduleMachineId, setScheduleMachineId] = useState('')
  const [scheduleDate, setScheduleDate] = useState(data.selectedDate)
  const [scheduleHalf, setScheduleHalf] = useState<PlanningHalf>(1)
  const [scheduleMode, setScheduleMode] = useState<'half' | 'full-day'>('half')
  const [scheduleSlotLocked, setScheduleSlotLocked] = useState(false)
  const [employeeName, setEmployeeName] = useState('')
  const [employeeSectionId, setEmployeeSectionId] = useState(data.sections[0]?.id || '')
  const [rateEmployeeId, setRateEmployeeId] = useState('')
  const [rateSectionId, setRateSectionId] = useState(data.sections[0]?.id || '')
  const [rateKg, setRateKg] = useState('')
  const dataRef = useRef(data)
  const navigationSequence = useRef(0)
  const periodCache = useRef(new Map<string, PeoplePlanningPeriod>([[
    periodCacheKey(initialData),
    {
      selectedDate: initialData.selectedDate,
      view: initialData.view,
      dates: initialData.dates,
      assignments: initialData.assignments,
    },
  ]]))
  const periodRequests = useRef(new Map<string, Promise<PeoplePlanningPeriod>>())
  const workspaceCache = useRef(new Map<string, PeoplePlanningWorkspace>([[planningHref(initialData), initialData]]))

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const activeEmployees = data.employees.filter((employee) => employee.active)
  const rateByEmployeeSection = useMemo(() => new Map(
    data.rates.map((rate) => [`${rate.employee_id}:${rate.section_id}`, rate]),
  ), [data.rates])
  const employeeById = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees])
  const machineById = useMemo(() => new Map(data.machines.map((machine) => [machine.id, machine])), [data.machines])
  const sectionById = useMemo(() => new Map(data.sections.map((section) => [section.id, section])), [data.sections])
  const assignmentBySlot = useMemo(() => new Map(
    data.assignments.map((assignment) => [assignmentKey(assignment.employee_id, assignment.work_date, assignment.half), assignment]),
  ), [data.assignments])
  const completedStages = data.machines.reduce(
    (total, machine) => total + machine.stages.filter((stage) => stage.progressPercent >= 100).length,
    0,
  )
  const copyEmployee = copyEmployeeId ? employeeById.get(copyEmployeeId) : null
  const clearEmployee = clearEmployeeId ? employeeById.get(clearEmployeeId) : null
  const selectedMachine = machineById.get(scheduleMachineId)
  const selectedMachineStage = selectedMachine?.stages.find((stage) => stage.sectionId === scheduleSectionId)
  const navigationPending = periodLoading || workspaceLoading

  const commitWorkspace = useCallback((workspace: PeoplePlanningWorkspace) => {
    dataRef.current = workspace
    setData(workspace)
  }, [])

  const updateWorkspace = useCallback((update: (workspace: PeoplePlanningWorkspace) => PeoplePlanningWorkspace) => {
    setData((workspace) => {
      const updated = update(workspace)
      dataRef.current = updated
      return updated
    })
  }, [])

  const applyAssignmentChanges = (assignments: EmployeeAssignment[]) => {
    periodCache.current.clear()
    workspaceCache.current.clear()
    updateWorkspace((workspace) => {
      const updated = applyPeoplePlanningAssignmentChanges(workspace, assignments)
      periodCache.current.set(periodCacheKey(updated), {
        selectedDate: updated.selectedDate,
        view: updated.view,
        dates: updated.dates,
        assignments: updated.assignments,
      })
      return updated
    })
  }

  const applyEmployeeChange = (employee: Parameters<typeof applyPeoplePlanningEmployeeChange>[1]) => {
    workspaceCache.current.clear()
    updateWorkspace((workspace) => applyPeoplePlanningEmployeeChange(workspace, employee))
  }

  const applyRateChange = (rate: Parameters<typeof applyPeoplePlanningRateChange>[1]) => {
    workspaceCache.current.clear()
    updateWorkspace((workspace) => applyPeoplePlanningRateChange(workspace, rate))
  }

  const sectionEmployees = (sectionId: string) => activeEmployees.filter((employee) => (
    rateByEmployeeSection.get(`${employee.id}:${sectionId}`)?.active
  ))

  const getPeriod = useCallback((location: PlanningLocation) => {
    const key = periodCacheKey(location)
    const cached = periodCache.current.get(key)
    if (cached) return Promise.resolve(cached)
    const activeRequest = periodRequests.current.get(key)
    if (activeRequest) return activeRequest

    const request = fetchPlanningWorkspace<PeoplePlanningPeriod>(location, 'period')
      .then((period) => {
        periodCache.current.set(key, period)
        return period
      })
      .finally(() => periodRequests.current.delete(key))
    periodRequests.current.set(key, request)
    return request
  }, [])

  const navigate = useCallback(async (
    changes: Record<string, string>,
    historyMode: 'push' | 'none' = 'push',
  ) => {
    const current = dataRef.current
    const next = planningLocation(current, changes)
    const href = planningHref(next)
    if (historyMode === 'push') window.history.pushState(null, '', href)

    const requestSequence = ++navigationSequence.current
    const periodOnly = current.selectedFactoryId === next.selectedFactoryId
      && current.selectedMonth === next.selectedMonth

    if (periodOnly) {
      const cached = periodCache.current.get(periodCacheKey(next))
      if (cached) {
        updateWorkspace((workspace) => applyPeoplePlanningPeriod(workspace, cached))
        setPeriodLoading(false)
        return
      }

      setPeriodLoading(true)
      updateWorkspace((workspace) => ({
        ...workspace,
        selectedDate: next.selectedDate,
        view: next.view,
        dates: planningDateRange(next.selectedDate, next.view),
        assignments: [],
      }))
      try {
        const period = await getPeriod(next)
        if (navigationSequence.current !== requestSequence) return
        updateWorkspace((workspace) => applyPeoplePlanningPeriod(workspace, period))
      } catch (error) {
        if (navigationSequence.current !== requestSequence) return
        window.history.replaceState(null, '', planningHref(current))
        commitWorkspace(current)
        toast.error(error instanceof Error ? error.message : 'Не удалось загрузить период')
      } finally {
        if (navigationSequence.current === requestSequence) setPeriodLoading(false)
      }
      return
    }

    const cachedWorkspace = workspaceCache.current.get(href)
    if (cachedWorkspace) {
      commitWorkspace(cachedWorkspace)
      return
    }
    setWorkspaceLoading(true)
    try {
      const workspace = await fetchPlanningWorkspace<PeoplePlanningWorkspace>(next, 'workspace')
      if (navigationSequence.current !== requestSequence) return
      workspaceCache.current.set(planningHref(workspace), workspace)
      periodCache.current.set(periodCacheKey(workspace), {
        selectedDate: workspace.selectedDate,
        view: workspace.view,
        dates: workspace.dates,
        assignments: workspace.assignments,
      })
      commitWorkspace(workspace)
      window.history.replaceState(null, '', planningHref(workspace))
    } catch (error) {
      if (navigationSequence.current !== requestSequence) return
      window.history.replaceState(null, '', planningHref(current))
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить планирование')
    } finally {
      if (navigationSequence.current === requestSequence) setWorkspaceLoading(false)
    }
  }, [commitWorkspace, getPeriod, updateWorkspace])

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      void navigate({
        factory: params.get('factory') || dataRef.current.selectedFactoryId,
        date: params.get('date') || dataRef.current.selectedDate,
        month: params.get('month') || dataRef.current.selectedMonth,
        view: params.get('view') === 'week' ? 'week' : 'day',
      }, 'none')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigate])

  useEffect(() => {
    const step = data.view === 'week' ? 7 : 1
    const current = dataRef.current
    for (const offset of [-step, step]) {
      const location = planningLocation(current, { date: addPlanningDays(data.selectedDate, offset) })
      void getPeriod(location).catch(() => undefined)
    }
  }, [data.selectedDate, data.selectedFactoryId, data.selectedMonth, data.view, getPeriod])

  function runAction<T>(
    action: () => Promise<PeoplePlanningActionResult<T>>,
    success: string,
    close?: () => void,
    apply?: (value: T) => void,
  ) {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить')
        return
      }
      if (result.data !== undefined) apply?.(result.data)
      toast.success(success)
      close?.()
    })
  }

  function bestMachineForSection(sectionId: string) {
    return data.machines.find((machine) => (
      (machine.stages.find((stage) => stage.sectionId === sectionId)?.remainingPercent || 0) > 0
    )) || data.machines[0]
  }

  function openSchedule(options?: {
    sectionId?: string
    employeeId?: string
    machineId?: string
    date?: string
    half?: PlanningHalf
    fullDay?: boolean
  }) {
    const requestedMachine = options?.machineId ? machineById.get(options.machineId) : null
    const machineSection = requestedMachine?.stages.find((stage) => (
      stage.remainingPercent > 0 && sectionEmployees(stage.sectionId).length > 0
    ))
    const nextSectionId = options?.sectionId || machineSection?.sectionId || scheduleSectionId || data.sections[0]?.id || ''
    const candidates = sectionEmployees(nextSectionId)
    const nextMachine = requestedMachine || bestMachineForSection(nextSectionId)
    setScheduleSectionId(nextSectionId)
    setScheduleEmployeeId(options?.employeeId || candidates[0]?.id || '')
    setScheduleMachineId(nextMachine?.id || '')
    setScheduleDate(options?.date || data.selectedDate)
    setScheduleHalf(options?.half || 1)
    setScheduleMode(options?.fullDay ? 'full-day' : 'half')
    setScheduleSlotLocked(Boolean(options?.date && (options?.half || options?.fullDay)))
    setScheduleOpen(true)
  }

  function changeScheduleSection(sectionId: string) {
    setScheduleSectionId(sectionId)
    setScheduleEmployeeId(sectionEmployees(sectionId)[0]?.id || '')
    const currentStage = selectedMachine?.stages.find((stage) => stage.sectionId === sectionId)
    if (!currentStage || currentStage.remainingPercent <= 0) {
      setScheduleMachineId(bestMachineForSection(sectionId)?.id || '')
    }
  }

  function renderAssignment(sectionId: string, employeeId: string, date: string, half: PlanningHalf) {
    const assignment = assignmentBySlot.get(assignmentKey(employeeId, date, half))
    if (!assignment) {
      return (
        <button
          type="button"
          className="flex min-h-20 w-full min-w-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-slate-400 transition-colors hover:border-[#9CB3D1] hover:bg-[#F2F6FB] hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30"
          aria-label={`Назначить ${employeeById.get(employeeId)?.full_name || 'сотрудника'}, ${formatDate(date)}, ${halfLabel(half)}`}
          onClick={() => openSchedule({ sectionId, employeeId, date, half })}
        >
          <Plus className="mr-1 size-3.5" /> Свободно
        </button>
      )
    }

    const machine = machineById.get(assignment.machine_id)
    const pendingSuggestion = assignment.status === 'pending'
    if (assignment.section_id !== sectionId) {
      const occupiedSection = sectionById.get(assignment.section_id)
      return (
        <div className="min-h-20 min-w-40 rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Занят на другом участке</p>
              <p className="mt-1 text-xs font-semibold leading-snug">
                {occupiedSection ? compactSectionName(occupiedSection.parentName, occupiedSection.name) : 'Другой участок'}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-red-700">
                {machine?.name || 'Машина'} · {halfLabel(half).toLocaleLowerCase('ru')} · {pendingSuggestion ? 'предложение' : 'подтверждено'}
              </p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={`min-h-20 min-w-40 rounded-lg border p-2.5 ${pendingSuggestion ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#1B3A6B]">{machine?.name || 'Машина'}</p>
            <p className="mt-1 text-[11px] text-slate-600">{numberFormatter.format(assignment.kg_planned)} кг · {halfLabel(half).toLocaleLowerCase('ru')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Изменить назначение"
            className="-mr-1 -mt-1 text-slate-500"
            onClick={() => setEditingAssignment(assignment)}
          >
            <Pencil />
          </Button>
        </div>
        {pendingSuggestion ? (
          <Button
            size="xs"
            className="mt-2 w-full bg-amber-600 text-white hover:bg-amber-700"
            disabled={pending}
            onClick={() => runAction(
              () => confirmEmployeeAssignmentAction(assignment.id),
              'Предложение подтверждено',
              undefined,
              (updated) => applyAssignmentChanges([updated]),
            )}
          >
            <Check /> Подтвердить
          </Button>
        ) : (
          <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check className="size-3" /> Подтверждено</div>
        )}
      </div>
    )
  }

  function renderFullDayAction(sectionId: string, employeeId: string, date: string) {
    const firstHalf = assignmentBySlot.get(assignmentKey(employeeId, date, 1))
    const secondHalf = assignmentBySlot.get(assignmentKey(employeeId, date, 2))
    const occupied = [firstHalf, secondHalf].filter((assignment): assignment is EmployeeAssignment => Boolean(assignment))

    if (occupied.length === 0) {
      return (
        <button
          type="button"
          className="flex min-h-20 w-full min-w-36 flex-col items-center justify-center rounded-lg border border-dashed border-blue-200 bg-blue-50/60 px-3 text-xs font-semibold text-[#1B3A6B] transition-colors hover:border-[#6E8FB9] hover:bg-[#EAF0F8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30"
          aria-label={`Назначить ${employeeById.get(employeeId)?.full_name || 'сотрудника'}, ${formatDate(date)}, весь день`}
          onClick={() => openSchedule({ sectionId, employeeId, date, fullDay: true })}
        >
          <CalendarDays className="mb-1 size-4" /> Весь день
        </button>
      )
    }

    const occupiedElsewhere = occupied.some((assignment) => assignment.section_id !== sectionId)
    const occupiedHalves = [firstHalf ? 'первая' : '', secondHalf ? 'вторая' : ''].filter(Boolean).join(' и ')
    return (
      <div className={`flex min-h-20 min-w-36 flex-col justify-center rounded-lg border px-3 py-2.5 ${occupiedElsewhere ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        <p className="text-xs font-semibold">{occupied.length === 2 ? 'День заполнен' : 'День занят частично'}</p>
        <p className="mt-1 text-[11px] leading-snug">{occupiedHalves} половина</p>
        {occupiedElsewhere && <p className="mt-1 text-[10px] font-medium text-red-700">Есть назначение на другом участке</p>}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#F4F6F9] p-3 text-[#1B3A6B] sm:p-5">
      <div className="mx-auto max-w-[1920px] space-y-4">
        <header className="overflow-hidden rounded-2xl border border-[#DDE4EC] bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-[#E8ECF0] px-5 py-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <Factory className="size-4 text-[#1B3A6B]" /> Производство · {data.factories.find((factory) => factory.id === data.selectedFactoryId)?.name}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Планирование людей</h1>
              <p className="mt-1 text-sm text-slate-500">Полудневная загрузка сотрудников, конфликты между участками и очередь машин выбранного месяца.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="border-[#D9E0E8] bg-white" onClick={() => setPeopleOpen(true)}>
                <Settings2 /> Сотрудники и ставки
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                className="border-[#D9E0E8] bg-white"
                render={<a href={`/api/production/people/work-order?factory=${data.selectedFactoryId}&date=${data.selectedDate}&view=${data.view}`} target="_blank" rel="noreferrer" />}
              >
                <Printer /> Наряд PDF
              </Button>
              <Button disabled={navigationPending} className="bg-[#1B3A6B] text-white hover:bg-[#142E56]" onClick={() => openSchedule()}>
                <Plus /> Назначить человека
              </Button>
            </div>
          </div>

          <div className="grid gap-px bg-[#E8ECF0] sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Сотрудников', value: activeEmployees.length, icon: Users, tone: 'text-blue-700 bg-blue-50' },
              { label: 'Занятых слотов', value: data.assignments.length, icon: CalendarDays, tone: 'text-violet-700 bg-violet-50' },
              { label: 'Машин в месяце', value: data.machines.length, icon: ListOrdered, tone: 'text-amber-700 bg-amber-50' },
              { label: 'Завершённых этапов', value: completedStages, icon: Layers3, tone: 'text-emerald-700 bg-emerald-50' },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="flex items-center justify-between gap-3 bg-white px-5 py-3.5">
                <div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-0.5 text-xl font-semibold text-[#1B3A6B]">{value}</p></div>
                <div className={`grid size-9 place-items-center rounded-lg ${tone}`}><Icon className="size-4.5" /></div>
              </div>
            ))}
          </div>
        </header>

        <section className="rounded-xl border border-[#DDE4EC] bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {data.isDirector && (
                <Select disabled={navigationPending} value={data.selectedFactoryId} onValueChange={(value) => value && void navigate({ factory: value })}>
                  <SelectTrigger className="h-9 min-w-48 bg-white"><SelectValue>{data.factories.find((factory) => factory.id === data.selectedFactoryId)?.name}</SelectValue></SelectTrigger>
                  <SelectContent>{data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <div className="flex rounded-lg border border-[#D9E0E8] bg-[#F4F6F9] p-1">
                <Button disabled={navigationPending} size="sm" variant={data.view === 'day' ? 'default' : 'ghost'} className={data.view === 'day' ? 'bg-[#1B3A6B] text-white' : ''} onClick={() => void navigate({ view: 'day' })}>День</Button>
                <Button disabled={navigationPending} size="sm" variant={data.view === 'week' ? 'default' : 'ghost'} className={data.view === 'week' ? 'bg-[#1B3A6B] text-white' : ''} onClick={() => void navigate({ view: 'week' })}>Неделя</Button>
              </div>
              <Input
                type="date"
                aria-label="Дата начала периода"
                className="h-9 w-auto min-w-40"
                value={data.selectedDate}
                disabled={navigationPending}
                onChange={(event) => void navigate({ date: event.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <Button disabled={navigationPending} variant="outline" size="icon" aria-label="Предыдущий период" onClick={() => void navigate({ date: addPlanningDays(data.selectedDate, data.view === 'week' ? -7 : -1) })}><ChevronLeft /></Button>
              <div className="min-w-52 text-center text-sm font-semibold capitalize">{data.view === 'day' ? formatDate(data.selectedDate, true) : `${formatDate(data.dates[0])} — ${formatDate(data.dates.at(-1)!)}`}</div>
              <Button disabled={navigationPending} variant="outline" size="icon" aria-label="Следующий период" onClick={() => void navigate({ date: addPlanningDays(data.selectedDate, data.view === 'week' ? 7 : 1) })}><ChevronRight /></Button>
            </div>
          </div>
          {navigationPending && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#F2F6FB] px-3 py-2 text-xs font-medium text-[#1B3A6B]" role="status" aria-live="polite">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Обновляем данные без перезагрузки страницы…
            </div>
          )}
        </section>

        <section className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-4">
            {data.sections.map((section, sectionIndex) => {
              const employees = sectionEmployees(section.id)
              return (
                <article key={section.id} className="min-w-0 overflow-hidden rounded-xl border border-[#DDE4EC] bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-[#E8ECF0] bg-gradient-to-r from-white to-[#F7F9FC] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#1B3A6B] text-xs font-semibold text-white">{String(sectionIndex + 1).padStart(2, '0')}</div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.parentName}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{section.name}</h2><Badge variant="secondary">{employees.length} чел.</Badge></div>
                      </div>
                    </div>
                    <Button disabled={navigationPending} variant="outline" size="sm" className="bg-white" onClick={() => openSchedule({ sectionId: section.id })}><Plus /> Назначить на участок</Button>
                  </div>
                  {employees.length === 0 ? (
                    <div className="p-8 text-center"><p className="text-sm text-slate-500">Для участка ещё не настроены ставки сотрудников.</p><Button variant="link" className="mt-1" onClick={() => setPeopleOpen(true)}>Настроить ставки</Button></div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-max">
                        <TableHeader>
                          <TableRow className="bg-[#F8FAFC] hover:bg-[#F8FAFC]">
                            <TableHead className="sticky left-0 z-20 min-w-72 border-r border-[#E8ECF0] bg-[#F8FAFC]">Сотрудник и ставка</TableHead>
                            {data.dates.flatMap((date) => [
                              ...([1, 2] as PlanningHalf[]).map((half) => (
                                <TableHead key={`${date}:${half}`} className="min-w-44 text-center">
                                  <span className="block text-xs font-semibold capitalize text-[#1B3A6B]">{formatDate(date)}</span>
                                  <span className="text-[11px] font-normal text-slate-500">{halfLabel(half)}</span>
                                </TableHead>
                              )),
                              <TableHead key={`${date}:full-day`} className="min-w-36 border-l border-[#E8ECF0] text-center">
                                <span className="block text-xs font-semibold capitalize text-[#1B3A6B]">{formatDate(date)}</span>
                                <span className="text-[11px] font-normal text-slate-500">Весь день</span>
                              </TableHead>,
                            ])}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map((employee) => {
                            const rate = rateByEmployeeSection.get(`${employee.id}:${section.id}`)!
                            const hasSelectedDayAssignments = data.assignments.some((assignment) => (
                              assignment.employee_id === employee.id && assignment.work_date === data.selectedDate
                            ))
                            return (
                              <TableRow key={employee.id} className="hover:bg-[#FBFCFE]">
                                <TableCell className="sticky left-0 z-10 border-r border-[#E8ECF0] bg-white">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#EAF0F8] text-sm font-semibold text-[#1B3A6B]">{employee.full_name.charAt(0).toUpperCase()}</div>
                                      <div className="min-w-0"><p className="truncate font-medium text-[#1B3A6B]">{employee.full_name}</p><p className="text-xs text-slate-500">{numberFormatter.format(rate.kg_per_day)} кг/день</p></div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-slate-500 hover:text-[#1B3A6B]"
                                        title={`Скопировать оба назначения за ${formatDate(addPlanningDays(data.selectedDate, -1))}`}
                                        onClick={() => setCopyEmployeeId(employee.id)}
                                      >
                                        <Copy /> Вчера
                                      </Button>
                                      {hasSelectedDayAssignments && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                          aria-label={`Очистить назначения ${employee.full_name} за ${formatDate(data.selectedDate)}`}
                                          title={`Очистить обе половины за ${formatDate(data.selectedDate)}`}
                                          onClick={() => setClearEmployeeId(employee.id)}
                                        >
                                          <Trash2 /> Очистить
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                {data.dates.flatMap((date) => [
                                  ...([1, 2] as PlanningHalf[]).map((half) => (
                                    <TableCell key={`${date}:${half}`} className="align-top">
                                      {periodLoading ? <Skeleton className="h-20 min-w-40 rounded-lg" /> : renderAssignment(section.id, employee.id, date, half)}
                                    </TableCell>
                                  )),
                                  <TableCell key={`${date}:full-day`} className="border-l border-[#E8ECF0] align-top">
                                    {periodLoading ? <Skeleton className="h-20 min-w-36 rounded-lg" /> : renderFullDayAction(section.id, employee.id, date)}
                                  </TableCell>,
                                ])}
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          <MachineQueue
            machines={data.machines}
            sections={data.sections}
            selectedMonth={data.selectedMonth}
            productionMonths={data.productionMonths}
            onMonthChange={(month) => void navigate({ month })}
            onPlanMachine={(machineId) => openSchedule({ machineId })}
          />
        </section>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#DDE4EC] bg-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg text-[#1B3A6B]">{scheduleMode === 'full-day' ? 'Назначить сотрудника на весь день' : 'Назначить сотрудника'}</DialogTitle>
            <DialogDescription>Назначение сохраняется сразу и только в выбранную клетку. Остаток рассчитывается отдельно для выбранного участка.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            {scheduleSlotLocked ? (
              <div className="rounded-xl border border-[#C9D8EA] bg-[#F7F9FC] p-4 sm:col-span-2">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#EAF0F8] text-[#1B3A6B]"><CalendarDays className="size-5" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1B3A6B]">{employeeById.get(scheduleEmployeeId)?.full_name || 'Сотрудник'}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{sectionById.get(scheduleSectionId)?.displayName || 'Участок'}</p>
                    <p className="mt-1 text-xs font-medium text-[#1B3A6B]">{formatDate(scheduleDate, true)} · {scheduleMode === 'full-day' ? 'Весь день' : halfLabel(scheduleHalf)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <FieldSelect label="Участок" value={scheduleSectionId} onChange={changeScheduleSection} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                <FieldSelect label="Сотрудник" value={scheduleEmployeeId} onChange={setScheduleEmployeeId} options={sectionEmployees(scheduleSectionId).map((employee) => ({ value: employee.id, label: employee.full_name }))} placeholder="Нет сотрудника со ставкой" />
              </>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Машина месяца</Label>
              <MachineSelect machines={data.machines} sectionId={scheduleSectionId} value={scheduleMachineId} onChange={setScheduleMachineId} />
            </div>
            {selectedMachine && selectedMachineStage && (
              <div className="rounded-xl border border-[#C9D8EA] bg-[#F2F6FB] p-3 sm:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-medium text-slate-500">{compactSectionName(selectedMachineStage.parentName, selectedMachineStage.sectionName)}</p><p className="mt-0.5 text-sm font-semibold">{selectedMachine.name}</p></div>
                  <Badge className="bg-white text-[#1B3A6B]">Осталось {numberFormatter.format(selectedMachineStage.remainingPercent)}%</Badge>
                </div>
                <ProgressBar value={selectedMachineStage.progressPercent} />
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                  <span>Запланировано {numberFormatter.format(selectedMachineStage.confirmedKg)} кг</span>
                  <span>Остаток {numberFormatter.format(selectedMachineStage.remainingKg)} кг</span>
                </div>
              </div>
            )}
            {!scheduleSlotLocked && (
              <>
                <div className="space-y-1.5"><Label htmlFor="schedule-date">Дата</Label><Input id="schedule-date" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></div>
                <FieldSelect label="Половина дня" value={String(scheduleHalf)} onChange={(value) => setScheduleHalf(Number(value) as PlanningHalf)} options={[{ value: '1', label: 'Первая половина' }, { value: '2', label: 'Вторая половина' }]} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Отмена</Button>
            <Button
              disabled={pending || !scheduleEmployeeId || !scheduleMachineId || !scheduleSectionId}
              className="bg-[#1B3A6B] text-white"
              onClick={() => runAction(
                () => scheduleMode === 'full-day'
                  ? scheduleEmployeeFullDayAction({ employeeId: scheduleEmployeeId, machineId: scheduleMachineId, sectionId: scheduleSectionId, workDate: scheduleDate })
                  : scheduleEmployeeAction({ employeeId: scheduleEmployeeId, machineId: scheduleMachineId, sectionId: scheduleSectionId, startDate: scheduleDate, startHalf: scheduleHalf }),
                scheduleMode === 'full-day' ? 'Назначение на весь день сохранено' : 'Назначение сохранено',
                () => setScheduleOpen(false),
                applyAssignmentChanges,
              )}
            >
              {pending ? 'Сохраняем…' : scheduleMode === 'full-day' ? 'Назначить на весь день' : 'Назначить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(copyEmployeeId)} onOpenChange={(open) => !open && setCopyEmployeeId(null)}>
        <DialogContent className="border-[#DDE4EC] bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg text-[#1B3A6B]">Скопировать вчерашний день</DialogTitle>
            <DialogDescription>
              Оба назначения сотрудника {copyEmployee?.full_name || ''} за {formatDate(addPlanningDays(data.selectedDate, -1))} будут скопированы на {formatDate(data.selectedDate)}. Уже заполненные половины дня будут заменены.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyEmployeeId(null)}>Отмена</Button>
            <Button
              disabled={pending || !copyEmployeeId}
              className="bg-[#1B3A6B] text-white"
              onClick={() => copyEmployeeId && runAction(
                () => copyEmployeePreviousDayAction({ employeeId: copyEmployeeId, targetDate: data.selectedDate }),
                'Вчерашний полный день скопирован',
                () => setCopyEmployeeId(null),
                applyAssignmentChanges,
              )}
            >
              <Copy /> {pending ? 'Копируем…' : 'Скопировать день'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(clearEmployeeId)} onOpenChange={(open) => !open && setClearEmployeeId(null)}>
        <AlertDialogContent className="border-[#DDE4EC] bg-white sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#1B3A6B]">Очистить назначения за день?</AlertDialogTitle>
            <AlertDialogDescription>
              У сотрудника {clearEmployee?.full_name || ''} освободятся первая и вторая половина {formatDate(data.selectedDate)}. Записи останутся в истории планирования.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || !clearEmployeeId}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => clearEmployeeId && runAction(
                () => cancelEmployeeDayAction({ employeeId: clearEmployeeId, workDate: data.selectedDate }),
                'Назначения сотрудника за день очищены',
                () => setClearEmployeeId(null),
                applyAssignmentChanges,
              )}
            >
              <Trash2 /> {pending ? 'Очищаем…' : 'Очистить весь день'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#DDE4EC] bg-white sm:max-w-4xl">
          <DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">Сотрудники и ставки</DialogTitle><DialogDescription>Один сотрудник может иметь отдельную ставку на нескольких участках.</DialogDescription></DialogHeader>
          <div className="grid gap-5 py-2 lg:grid-cols-2">
            <section className="rounded-xl border border-[#E8ECF0] p-4">
              <div className="mb-4 flex items-center gap-2"><UserRoundPlus className="size-4" /><h3 className="font-semibold">Новый сотрудник</h3></div>
              <div className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="employee-name">ФИО</Label><Input id="employee-name" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Например, Иван Петров" /></div>
                <FieldSelect label="Основной участок" value={employeeSectionId} onChange={setEmployeeSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                <Button disabled={pending || employeeName.trim().length < 2} className="w-full bg-[#1B3A6B] text-white" onClick={() => runAction(() => saveEmployeeAction({ fullName: employeeName, factoryId: data.selectedFactoryId, defaultSectionId: employeeSectionId || null }), 'Сотрудник добавлен', () => setEmployeeName(''), applyEmployeeChange)}><Plus /> Добавить сотрудника</Button>
              </div>
              <div className="mt-5 space-y-2 border-t border-[#E8ECF0] pt-4">
                {data.employees.map((employee) => <div key={employee.id} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] px-3 py-2"><div><p className="text-sm font-medium">{employee.full_name}</p><p className="text-xs text-slate-500">{employee.active ? 'Активен' : 'Неактивен'}</p></div><Badge variant={employee.active ? 'secondary' : 'outline'}>{data.rates.filter((rate) => rate.employee_id === employee.id && rate.active).length} ставок</Badge></div>)}
              </div>
            </section>
            <section className="rounded-xl border border-[#E8ECF0] p-4">
              <div className="mb-4 flex items-center gap-2"><Weight className="size-4" /><h3 className="font-semibold">Ставка сотрудника</h3></div>
              <div className="space-y-4">
                <FieldSelect label="Сотрудник" value={rateEmployeeId} onChange={setRateEmployeeId} options={activeEmployees.map((employee) => ({ value: employee.id, label: employee.full_name }))} />
                <FieldSelect label="Участок" value={rateSectionId} onChange={setRateSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                <div className="space-y-1.5"><Label htmlFor="rate-kg">Килограммов за полный день</Label><Input id="rate-kg" type="number" min="0.001" step="0.001" value={rateKg} onChange={(event) => setRateKg(event.target.value)} placeholder="Например, 800" /></div>
                <Button disabled={pending || !rateEmployeeId || !rateSectionId || Number(rateKg) <= 0} className="w-full bg-[#1B3A6B] text-white" onClick={() => runAction(() => saveEmployeeRateAction({ employeeId: rateEmployeeId, sectionId: rateSectionId, kgPerDay: rateKg }), 'Ставка сохранена', () => setRateKg(''), applyRateChange)}><Check /> Сохранить ставку</Button>
              </div>
              <div className="mt-5 space-y-2 border-t border-[#E8ECF0] pt-4">
                {data.rates.filter((rate) => rate.active).map((rate) => <div key={rate.id} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] px-3 py-2"><div><p className="text-sm font-medium">{employeeById.get(rate.employee_id)?.full_name || 'Сотрудник'}</p><p className="text-xs text-slate-500">{data.sections.find((section) => section.id === rate.section_id)?.displayName}</p></div><span className="text-sm font-semibold">{numberFormatter.format(rate.kg_per_day)} кг/день</span></div>)}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <AssignmentEditDialog
        assignment={editingAssignment}
        data={data}
        pending={pending}
        onClose={() => setEditingAssignment(null)}
        onSave={(value) => runAction(() => updateEmployeeAssignmentAction(value), 'Назначение изменено', () => setEditingAssignment(null), (updated) => applyAssignmentChanges([updated]))}
      />
    </div>
  )
}

function MachineQueue({
  machines,
  sections,
  selectedMonth,
  productionMonths,
  onMonthChange,
  onPlanMachine,
}: {
  machines: PeoplePlanningMachine[]
  sections: PeoplePlanningSection[]
  selectedMonth: string
  productionMonths: string[]
  onMonthChange: (month: string) => void
  onPlanMachine: (machineId: string) => void
}) {
  return (
    <aside className="min-w-0 overflow-hidden rounded-xl border border-[#D3DDE8] bg-white shadow-md xl:sticky xl:top-4">
      <div className="border-b border-[#E8ECF0] bg-[#1B3A6B] p-4 text-white">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-blue-100"><ListOrdered className="size-4" /> Очередь планирования</div>
        <div className="mt-2 flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Машины месяца</h2><p className="mt-0.5 text-xs text-blue-100">В порядке: цех → номер очереди</p></div><Badge className="bg-white/15 text-white">{machines.length}</Badge></div>
      </div>
      <div className="border-b border-[#E8ECF0] p-3">
        <Label className="mb-1.5 block text-xs text-slate-500">Месяц производства</Label>
        <Select value={selectedMonth} onValueChange={(value) => value && onMonthChange(value)}>
          <SelectTrigger className="h-9 w-full bg-white"><SelectValue>{formatMonth(selectedMonth)}</SelectValue></SelectTrigger>
          <SelectContent>{productionMonths.map((month) => <SelectItem key={month} value={month}><span className="capitalize">{formatMonth(month)}</span></SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="max-h-[calc(100dvh-260px)] space-y-3 overflow-y-auto bg-[#F8FAFC] p-3">
        {machines.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">В выбранном месяце машин нет.</div>}
        {machines.map((machine, machineIndex) => (
          <article key={machine.id} className="rounded-xl border border-[#DDE4EC] bg-white p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#EAF0F8] text-xs font-bold text-[#1B3A6B]">{machineIndex + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold" title={machine.name}>{machine.name}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">{queueLabel(machine)} · {numberFormatter.format(machine.totalWeightKg)} кг</p></div><Button variant="outline" size="xs" onClick={() => onPlanMachine(machine.id)}><Plus /> План</Button></div>
              </div>
            </div>
            <div className="mt-3 space-y-2.5 border-t border-[#EEF1F4] pt-3">
              {machine.stages.map((stage) => (
                <div key={stage.sectionId}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px]"><span className="min-w-0 truncate font-medium text-slate-700" title={stage.displayName}>{compactSectionName(stage.parentName, stage.sectionName)}</span><span className={stage.remainingPercent <= 0 ? 'font-semibold text-emerald-700' : 'shrink-0 text-slate-500'}>{stage.remainingPercent <= 0 ? 'готово' : `ост. ${numberFormatter.format(stage.remainingPercent)}%`}</span></div>
                  <ProgressBar value={stage.progressPercent} tone={stage.progressPercent >= 100 ? 'green' : stage.pendingKg > 0 ? 'amber' : 'blue'} />
                  {stage.pendingKg > 0 && <p className="mt-1 text-[10px] text-amber-700">Ещё {numberFormatter.format(stage.pendingKg)} кг ожидают подтверждения</p>}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {sections.length > 0 && <div className="border-t border-[#E8ECF0] bg-white px-4 py-2 text-[11px] text-slate-500">Прогресс показан отдельно по каждому участку.</div>}
    </aside>
  )
}

function MachineSelect({ machines, sectionId, value, onChange }: { machines: PeoplePlanningMachine[]; sectionId: string; value: string; onChange: (value: string) => void }) {
  const selected = machines.find((machine) => machine.id === value)
  const selectedStage = selected?.stages.find((stage) => stage.sectionId === sectionId)
  return (
    <Select value={value || undefined} onValueChange={(nextValue) => nextValue && onChange(nextValue)}>
      <SelectTrigger className="h-11 w-full bg-white">
        <SelectValue placeholder="Выберите машину">
          {selected ? `${selected.name} · осталось ${numberFormatter.format(selectedStage?.remainingPercent || 0)}%` : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-96 min-w-[var(--anchor-width)]">
        {machines.map((machine) => {
          const stage = machine.stages.find((item) => item.sectionId === sectionId)
          return (
            <SelectItem key={machine.id} value={machine.id} className="py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3"><span className="truncate font-medium">{machine.name}</span><span className="shrink-0 text-xs font-semibold text-[#1B3A6B]">Осталось {numberFormatter.format(stage?.remainingPercent || 0)}%</span></div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-500"><span>{queueLabel(machine)}</span><span>{numberFormatter.format(stage?.remainingKg || 0)} кг</span></div>
                <div className="mt-1.5"><ProgressBar value={stage?.progressPercent || 0} tone={(stage?.progressPercent || 0) >= 100 ? 'green' : 'blue'} /></div>
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

function FieldSelect({ label, value, onChange, options, placeholder = 'Выберите' }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  const labelValue = options.find((option) => option.value === value)?.label
  return <div className="space-y-1.5"><Label>{label}</Label><Select value={value || undefined} onValueChange={(nextValue) => nextValue && onChange(nextValue)}><SelectTrigger className="w-full"><SelectValue placeholder={placeholder}>{labelValue}</SelectValue></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
}

function AssignmentEditDialog({ assignment, data, pending, onClose, onSave }: { assignment: EmployeeAssignment | null; data: PeoplePlanningWorkspace; pending: boolean; onClose: () => void; onSave: (value: { id: string; employeeId: string; machineId: string; sectionId: string; workDate: string; half: PlanningHalf }) => void }) {
  const [employeeId, setEmployeeId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [half, setHalf] = useState<PlanningHalf | null>(null)
  const stateKey = assignment?.id || 'closed'
  const initialized = assignment ? {
    employeeId: employeeId || assignment.employee_id,
    machineId: machineId || assignment.machine_id,
    sectionId: sectionId || assignment.section_id,
    workDate: workDate || assignment.work_date,
    half: half ?? assignment.half,
  } : null

  function close() {
    setEmployeeId(''); setMachineId(''); setSectionId(''); setWorkDate(''); setHalf(null); onClose()
  }

  return <Dialog key={stateKey} open={Boolean(assignment)} onOpenChange={(open) => !open && close()}><DialogContent className="border-[#DDE4EC] bg-white sm:max-w-lg"><DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">Изменить назначение</DialogTitle><DialogDescription>Можно перенести предложенный или подтверждённый слот. Вес останется снимком ставки на момент создания.</DialogDescription></DialogHeader>{assignment && initialized && <div className="grid gap-4 py-2 sm:grid-cols-2"><FieldSelect label="Сотрудник" value={initialized.employeeId} onChange={setEmployeeId} options={data.employees.filter((employee) => employee.active).map((employee) => ({ value: employee.id, label: employee.full_name }))} /><FieldSelect label="Участок" value={initialized.sectionId} onChange={setSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} /><FieldSelect label="Машина" value={initialized.machineId} onChange={setMachineId} options={data.machines.map((machine) => ({ value: machine.id, label: machine.name }))} /><div className="space-y-1.5"><Label htmlFor="edit-date">Дата</Label><Input id="edit-date" type="date" value={initialized.workDate} onChange={(event) => setWorkDate(event.target.value)} /></div><FieldSelect label="Половина дня" value={String(initialized.half)} onChange={(value) => setHalf(Number(value) as PlanningHalf)} options={[{ value: '1', label: 'Первая половина' }, { value: '2', label: 'Вторая половина' }]} /></div>}<DialogFooter><Button variant="outline" onClick={close}>Отмена</Button><Button disabled={pending || !assignment || !initialized} className="bg-[#1B3A6B] text-white" onClick={() => assignment && initialized && onSave({ id: assignment.id, ...initialized })}>{pending ? 'Сохраняем…' : 'Сохранить'}</Button></DialogFooter></DialogContent></Dialog>
}
