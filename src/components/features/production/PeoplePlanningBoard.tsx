'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  Printer,
  Settings2,
  UserRoundPlus,
  Users,
  Weight,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmEmployeeAssignmentAction,
  saveEmployeeAction,
  saveEmployeeRateAction,
  scheduleEmployeeAction,
  updateEmployeeAssignmentAction,
} from '@/lib/actions/people-planning'
import { addPlanningDays, type PlanningHalf } from '@/lib/people-planning/slots'
import type { PeoplePlanningWorkspace } from '@/lib/people-planning/types'
import type { EmployeeAssignment } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Props = { data: PeoplePlanningWorkspace }

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' })
const longDateFormatter = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function formatDate(value: string, long = false) {
  return (long ? longDateFormatter : dateFormatter).format(new Date(`${value}T00:00:00Z`))
}

function assignmentKey(employeeId: string, date: string, half: number) {
  return `${employeeId}:${date}:${half}`
}

export function PeoplePlanningBoard({ data }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<EmployeeAssignment | null>(null)
  const [scheduleSectionId, setScheduleSectionId] = useState(data.sections[0]?.id || '')
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState('')
  const [scheduleMachineId, setScheduleMachineId] = useState('')
  const [scheduleDate, setScheduleDate] = useState(data.selectedDate)
  const [scheduleHalf, setScheduleHalf] = useState<PlanningHalf>(1)
  const [employeeName, setEmployeeName] = useState('')
  const [employeeSectionId, setEmployeeSectionId] = useState(data.sections[0]?.id || '')
  const [rateEmployeeId, setRateEmployeeId] = useState('')
  const [rateSectionId, setRateSectionId] = useState(data.sections[0]?.id || '')
  const [rateKg, setRateKg] = useState('')

  const activeEmployees = data.employees.filter((employee) => employee.active)
  const rateByEmployeeSection = useMemo(() => new Map(
    data.rates.map((rate) => [`${rate.employee_id}:${rate.section_id}`, rate]),
  ), [data.rates])
  const employeeById = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees])
  const machineById = useMemo(() => new Map(data.machines.map((machine) => [machine.id, machine])), [data.machines])
  const assignmentBySlot = useMemo(() => new Map(
    data.assignments.map((assignment) => [assignmentKey(assignment.employee_id, assignment.work_date, assignment.half), assignment]),
  ), [data.assignments])
  const pendingCount = data.assignments.filter((assignment) => assignment.status === 'pending').length
  const confirmedKg = data.assignments
    .filter((assignment) => assignment.status === 'confirmed')
    .reduce((sum, assignment) => sum + Number(assignment.kg_planned), 0)
  const sectionEmployees = (sectionId: string) => activeEmployees.filter((employee) => (
    rateByEmployeeSection.get(`${employee.id}:${sectionId}`)?.active
  ))

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams({
      factory: data.selectedFactoryId,
      date: data.selectedDate,
      view: data.view,
      ...changes,
    })
    router.push(`/production/people?${params.toString()}`)
  }

  function runAction(action: () => Promise<{ success: boolean; error: string | null }>, success: string, close?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить')
        return
      }
      toast.success(success)
      close?.()
      router.refresh()
    })
  }

  function openSchedule(sectionId?: string, employeeId?: string) {
    const nextSectionId = sectionId || scheduleSectionId || data.sections[0]?.id || ''
    const candidates = sectionEmployees(nextSectionId)
    setScheduleSectionId(nextSectionId)
    setScheduleEmployeeId(employeeId || candidates[0]?.id || '')
    setScheduleMachineId(data.machines.find((machine) => machine.totalWeightKg > machine.confirmedKg)?.id || data.machines[0]?.id || '')
    setScheduleDate(data.selectedDate)
    setScheduleHalf(1)
    setScheduleOpen(true)
  }

  function renderAssignment(employeeId: string, date: string, half: PlanningHalf) {
    const assignment = assignmentBySlot.get(assignmentKey(employeeId, date, half))
    if (!assignment) return <span className="text-xs text-[#9CA3AF]">Свободно</span>
    const machine = machineById.get(assignment.machine_id)
    const pendingSuggestion = assignment.status === 'pending'
    return (
      <div className={`min-w-[132px] rounded-lg border p-2 ${pendingSuggestion ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#1B3A6B]">{machine?.name || 'Машина'}</p>
            <p className="mt-0.5 text-[11px] text-[#6B7280]">{numberFormatter.format(assignment.kg_planned)} кг</p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Изменить назначение"
            className="-mr-1 -mt-1 text-[#6B7280]"
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

  return (
    <div className="min-h-full bg-[#F4F6F9] p-4 text-[#1B3A6B] sm:p-6">
      <div className="mx-auto max-w-[1800px] space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
              <Users className="size-4 text-[#1B3A6B]" /> Производство
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Планирование людей</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#6B7280]">Независимая полудневная доска загрузки сотрудников. Она не меняет действующий план и производственный факт.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-[#D9E0E8] bg-white" onClick={() => setPeopleOpen(true)}>
              <Settings2 /> Сотрудники и ставки
            </Button>
            <Button
              variant="outline"
              className="border-[#D9E0E8] bg-white"
              render={<a href={`/api/production/people/work-order?factory=${data.selectedFactoryId}&date=${data.selectedDate}&view=${data.view}`} target="_blank" rel="noreferrer" />}
            >
              <Printer /> Наряд PDF
            </Button>
            <Button className="bg-[#1B3A6B] text-white hover:bg-[#142E56]" onClick={() => openSchedule()}>
              <Plus /> Назначить
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Активные сотрудники', value: activeEmployees.length, icon: Users, tone: 'bg-blue-50 text-blue-700' },
            { label: 'Подтверждено сегодня', value: `${numberFormatter.format(confirmedKg)} кг`, icon: Weight, tone: 'bg-emerald-50 text-emerald-700' },
            { label: 'Ожидают подтверждения', value: pendingCount, icon: Clock3, tone: 'bg-amber-50 text-amber-700' },
            { label: 'Машин в работе', value: data.machines.filter((machine) => machine.progressPercent < 100).length, icon: CalendarDays, tone: 'bg-violet-50 text-violet-700' },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-medium text-[#6B7280]">{label}</p><p className="mt-1 text-2xl font-semibold text-[#1B3A6B]">{value}</p></div>
                <div className={`grid size-10 place-items-center rounded-lg ${tone}`}><Icon className="size-5" /></div>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#E8ECF0] bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {data.isDirector && (
                <Select value={data.selectedFactoryId} onValueChange={(value) => value && navigate({ factory: value })}>
                  <SelectTrigger className="h-9 min-w-48 bg-white"><SelectValue>{data.factories.find((factory) => factory.id === data.selectedFactoryId)?.name}</SelectValue></SelectTrigger>
                  <SelectContent>{data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <div className="flex rounded-lg border border-[#D9E0E8] bg-[#F4F6F9] p-1">
                <Button size="sm" variant={data.view === 'day' ? 'default' : 'ghost'} className={data.view === 'day' ? 'bg-[#1B3A6B] text-white' : ''} onClick={() => navigate({ view: 'day' })}>День</Button>
                <Button size="sm" variant={data.view === 'week' ? 'default' : 'ghost'} className={data.view === 'week' ? 'bg-[#1B3A6B] text-white' : ''} onClick={() => navigate({ view: 'week' })}>Неделя</Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <Button variant="outline" size="icon" aria-label="Предыдущий период" onClick={() => navigate({ date: addPlanningDays(data.selectedDate, data.view === 'week' ? -7 : -1) })}><ChevronLeft /></Button>
              <div className="min-w-52 text-center text-sm font-semibold capitalize">{data.view === 'day' ? formatDate(data.selectedDate, true) : `${formatDate(data.dates[0])} — ${formatDate(data.dates.at(-1)!)}`}</div>
              <Button variant="outline" size="icon" aria-label="Следующий период" onClick={() => navigate({ date: addPlanningDays(data.selectedDate, data.view === 'week' ? 7 : 1) })}><ChevronRight /></Button>
            </div>
          </div>
        </section>

        <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {data.sections.map((section) => {
              const employees = sectionEmployees(section.id)
              return (
                <article key={section.id} className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-[#E8ECF0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#6B7280]">{section.parentName}</p>
                      <h2 className="text-base font-semibold">{section.name}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openSchedule(section.id)}><Plus /> Назначить на участок</Button>
                  </div>
                  {employees.length === 0 ? (
                    <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">Для участка ещё не настроены ставки сотрудников.</p><Button variant="link" className="mt-1" onClick={() => setPeopleOpen(true)}>Настроить ставки</Button></div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-max">
                        <TableHeader>
                          <TableRow className="bg-[#F8FAFC]">
                            <TableHead className="sticky left-0 z-10 min-w-56 bg-[#F8FAFC]">Сотрудник</TableHead>
                            {data.dates.flatMap((date) => ([1, 2] as PlanningHalf[]).map((half) => (
                              <TableHead key={`${date}:${half}`} className="min-w-40 text-center">
                                <span className="block text-xs font-semibold capitalize text-[#1B3A6B]">{formatDate(date)}</span>
                                <span className="text-[11px] font-normal text-[#6B7280]">{half === 1 ? 'Первая половина' : 'Вторая половина'}</span>
                              </TableHead>
                            )))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map((employee) => {
                            const rate = rateByEmployeeSection.get(`${employee.id}:${section.id}`)!
                            return (
                              <TableRow key={employee.id}>
                                <TableCell className="sticky left-0 z-10 bg-white">
                                  <div className="flex items-center gap-3">
                                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#EAF0F8] text-sm font-semibold text-[#1B3A6B]">{employee.full_name.charAt(0).toUpperCase()}</div>
                                    <div><p className="font-medium text-[#1B3A6B]">{employee.full_name}</p><p className="text-xs text-[#6B7280]">{numberFormatter.format(rate.kg_per_day)} кг/день</p></div>
                                  </div>
                                </TableCell>
                                {data.dates.flatMap((date) => ([1, 2] as PlanningHalf[]).map((half) => (
                                  <TableCell key={`${date}:${half}`} className="align-top">{renderAssignment(employee.id, date, half)}</TableCell>
                                )))}
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

          <aside className="h-fit rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm 2xl:sticky 2xl:top-4">
            <div className="mb-4"><p className="text-xs font-medium uppercase tracking-wider text-[#6B7280]">Прогресс по машинам</p><h2 className="mt-1 text-lg font-semibold">Подтверждённая загрузка</h2></div>
            <div className="max-h-[720px] space-y-4 overflow-y-auto pr-1">
              {data.machines.length === 0 && <p className="text-sm text-[#6B7280]">Нет доступных машин.</p>}
              {data.machines.map((machine) => (
                <div key={machine.id} className="rounded-lg border border-[#E8ECF0] p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{machine.name}</p><p className="mt-0.5 text-xs text-[#6B7280]">{numberFormatter.format(machine.confirmedKg)} из {numberFormatter.format(machine.totalWeightKg)} кг</p></div><Badge variant="secondary" className="shrink-0">{machine.progressPercent}%</Badge></div>
                  <Progress value={machine.progressPercent} className="mt-3 h-2" />
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#E8ECF0] bg-white sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">Назначить сотрудника</DialogTitle><DialogDescription>Первый слот подтверждается сразу. Остаток веса превращается в предложения на следующие полдня.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <FieldSelect label="Участок" value={scheduleSectionId} onChange={(value) => { setScheduleSectionId(value); setScheduleEmployeeId(sectionEmployees(value)[0]?.id || '') }} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
            <FieldSelect label="Сотрудник" value={scheduleEmployeeId} onChange={setScheduleEmployeeId} options={sectionEmployees(scheduleSectionId).map((employee) => ({ value: employee.id, label: employee.full_name }))} placeholder="Нет сотрудника со ставкой" />
            <FieldSelect label="Машина" value={scheduleMachineId} onChange={setScheduleMachineId} options={data.machines.map((machine) => ({ value: machine.id, label: `${machine.name} · ${numberFormatter.format(Math.max(machine.totalWeightKg - machine.confirmedKg, 0))} кг осталось` }))} />
            <div className="space-y-1.5"><Label htmlFor="schedule-date">Начать с даты</Label><Input id="schedule-date" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></div>
            <FieldSelect label="Половина дня" value={String(scheduleHalf)} onChange={(value) => setScheduleHalf(Number(value) as PlanningHalf)} options={[{ value: '1', label: 'Первая половина' }, { value: '2', label: 'Вторая половина' }]} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setScheduleOpen(false)}>Отмена</Button><Button disabled={pending || !scheduleEmployeeId || !scheduleMachineId || !scheduleSectionId} className="bg-[#1B3A6B] text-white" onClick={() => runAction(() => scheduleEmployeeAction({ employeeId: scheduleEmployeeId, machineId: scheduleMachineId, sectionId: scheduleSectionId, startDate: scheduleDate, startHalf: scheduleHalf }), 'Назначение и предложения созданы', () => setScheduleOpen(false))}>{pending ? 'Сохраняем…' : 'Создать план'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-[#E8ECF0] bg-white sm:max-w-4xl">
          <DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">Сотрудники и ставки</DialogTitle><DialogDescription>Ставка задаётся на полный рабочий день отдельно для каждого участка.</DialogDescription></DialogHeader>
          <div className="grid gap-5 py-2 lg:grid-cols-2">
            <section className="rounded-xl border border-[#E8ECF0] p-4">
              <div className="mb-4 flex items-center gap-2"><UserRoundPlus className="size-4" /><h3 className="font-semibold">Новый сотрудник</h3></div>
              <div className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="employee-name">ФИО</Label><Input id="employee-name" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Например, Иван Петров" /></div>
                <FieldSelect label="Основной участок" value={employeeSectionId} onChange={setEmployeeSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                <Button disabled={pending || employeeName.trim().length < 2} className="w-full bg-[#1B3A6B] text-white" onClick={() => runAction(() => saveEmployeeAction({ fullName: employeeName, factoryId: data.selectedFactoryId, defaultSectionId: employeeSectionId || null }), 'Сотрудник добавлен', () => setEmployeeName(''))}><Plus /> Добавить сотрудника</Button>
              </div>
              <div className="mt-5 space-y-2 border-t border-[#E8ECF0] pt-4">
                {data.employees.map((employee) => <div key={employee.id} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] px-3 py-2"><div><p className="text-sm font-medium">{employee.full_name}</p><p className="text-xs text-[#6B7280]">{employee.active ? 'Активен' : 'Неактивен'}</p></div><Badge variant={employee.active ? 'secondary' : 'outline'}>{data.rates.filter((rate) => rate.employee_id === employee.id && rate.active).length} ставок</Badge></div>)}
              </div>
            </section>
            <section className="rounded-xl border border-[#E8ECF0] p-4">
              <div className="mb-4 flex items-center gap-2"><Weight className="size-4" /><h3 className="font-semibold">Ставка сотрудника</h3></div>
              <div className="space-y-4">
                <FieldSelect label="Сотрудник" value={rateEmployeeId} onChange={setRateEmployeeId} options={activeEmployees.map((employee) => ({ value: employee.id, label: employee.full_name }))} />
                <FieldSelect label="Участок" value={rateSectionId} onChange={setRateSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                <div className="space-y-1.5"><Label htmlFor="rate-kg">Килограммов за полный день</Label><Input id="rate-kg" type="number" min="0.001" step="0.001" value={rateKg} onChange={(event) => setRateKg(event.target.value)} placeholder="Например, 800" /></div>
                <Button disabled={pending || !rateEmployeeId || !rateSectionId || Number(rateKg) <= 0} className="w-full bg-[#1B3A6B] text-white" onClick={() => runAction(() => saveEmployeeRateAction({ employeeId: rateEmployeeId, sectionId: rateSectionId, kgPerDay: rateKg }), 'Ставка сохранена', () => setRateKg(''))}><Check /> Сохранить ставку</Button>
              </div>
              <div className="mt-5 space-y-2 border-t border-[#E8ECF0] pt-4">
                {data.rates.filter((rate) => rate.active).map((rate) => <div key={rate.id} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] px-3 py-2"><div><p className="text-sm font-medium">{employeeById.get(rate.employee_id)?.full_name || 'Сотрудник'}</p><p className="text-xs text-[#6B7280]">{data.sections.find((section) => section.id === rate.section_id)?.displayName}</p></div><span className="text-sm font-semibold">{numberFormatter.format(rate.kg_per_day)} кг/день</span></div>)}
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
        onSave={(value) => runAction(() => updateEmployeeAssignmentAction(value), 'Назначение изменено', () => setEditingAssignment(null))}
      />
    </div>
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

  return <Dialog key={stateKey} open={Boolean(assignment)} onOpenChange={(open) => !open && close()}><DialogContent className="border-[#E8ECF0] bg-white sm:max-w-lg"><DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">Изменить назначение</DialogTitle><DialogDescription>Можно перенести предложенный или подтверждённый слот. Вес останется снимком ставки на момент создания.</DialogDescription></DialogHeader>{assignment && initialized && <div className="grid gap-4 py-2 sm:grid-cols-2"><FieldSelect label="Сотрудник" value={initialized.employeeId} onChange={setEmployeeId} options={data.employees.filter((employee) => employee.active).map((employee) => ({ value: employee.id, label: employee.full_name }))} /><FieldSelect label="Участок" value={initialized.sectionId} onChange={setSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} /><FieldSelect label="Машина" value={initialized.machineId} onChange={setMachineId} options={data.machines.map((machine) => ({ value: machine.id, label: machine.name }))} /><div className="space-y-1.5"><Label htmlFor="edit-date">Дата</Label><Input id="edit-date" type="date" value={initialized.workDate} onChange={(event) => setWorkDate(event.target.value)} /></div><FieldSelect label="Половина дня" value={String(initialized.half)} onChange={(value) => setHalf(Number(value) as PlanningHalf)} options={[{ value: '1', label: 'Первая половина' }, { value: '2', label: 'Вторая половина' }]} /></div>}<DialogFooter><Button variant="outline" onClick={close}>Отмена</Button><Button disabled={pending || !assignment || !initialized} className="bg-[#1B3A6B] text-white" onClick={() => assignment && initialized && onSave({ id: assignment.id, ...initialized })}>{pending ? 'Сохраняем…' : 'Сохранить'}</Button></DialogFooter></DialogContent></Dialog>
}
