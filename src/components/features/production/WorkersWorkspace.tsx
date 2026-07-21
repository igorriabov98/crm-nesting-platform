'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays,
  Check,
  Clock3,
  Gauge,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Umbrella,
  UserPlus,
  Users,
  Weight,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelEmployeeVacationAction,
  saveEmployeeAction,
  saveEmployeeRateAction,
  saveEmployeeVacationAction,
} from '@/lib/actions/people-planning'
import { todayInUzhgorod } from '@/lib/people-planning/slots'
import { vacationDurationDays } from '@/lib/people-planning/vacations'
import type { PeoplePlanningActionResult, WorkersWorkspace as WorkersWorkspaceData } from '@/lib/people-planning/types'
import type { Employee, EmployeeRate, EmployeeVacation } from '@/lib/types'
import { ROUTES } from '@/lib/constants/routes'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Props = { data: WorkersWorkspaceData }

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatRateCount(count: number) {
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'норм'
    : lastDigit === 1
      ? 'норма'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'нормы'
        : 'норм'
  return `${count} ${label}`
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Выберите',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={(next) => next && onChange(next)} disabled={disabled}>
        <SelectTrigger className="h-11 w-full bg-white">
          <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }: {
  icon: React.ElementType
  label: string
  value: number
  tone: string
}) {
  return (
    <Card size="sm" className="border-0 bg-white shadow-sm">
      <CardContent className="flex items-center gap-3">
        <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', tone)}><Icon className="size-5" /></div>
        <div><p className="text-2xl font-semibold tabular-nums text-[#1B3A6B]">{value}</p><p className="text-xs text-slate-500">{label}</p></div>
      </CardContent>
    </Card>
  )
}

function vacationTone(vacation: EmployeeVacation, today: string) {
  if (vacation.start_date <= today && vacation.end_date >= today) {
    return { label: 'Сейчас в отпуске', className: 'border-blue-200 bg-blue-50 text-blue-800' }
  }
  if (vacation.start_date > today) {
    return { label: 'Запланирован', className: 'border-amber-200 bg-amber-50 text-amber-800' }
  }
  return { label: 'Завершён', className: 'border-slate-200 bg-slate-50 text-slate-600' }
}

export function WorkersWorkspace({ data: initialData }: Props) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    initialData.employees.find((employee) => employee.active)?.id || initialData.employees[0]?.id || '',
  )
  const [employeeOpen, setEmployeeOpen] = useState(false)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)
  const [employeeName, setEmployeeName] = useState('')
  const [employeeSectionId, setEmployeeSectionId] = useState(initialData.sections[0]?.id || '')
  const [employeeActive, setEmployeeActive] = useState(true)
  const [rateSectionId, setRateSectionId] = useState(initialData.sections[0]?.id || '')
  const [rateKg, setRateKg] = useState('')
  const [editingVacationId, setEditingVacationId] = useState<string | null>(null)
  const [vacationStart, setVacationStart] = useState('')
  const [vacationEnd, setVacationEnd] = useState('')
  const [vacationNote, setVacationNote] = useState('')
  const [cancelVacationId, setCancelVacationId] = useState<string | null>(null)
  const today = todayInUzhgorod()

  const selectedEmployee = data.employees.find((employee) => employee.id === selectedEmployeeId) || null
  const sectionById = useMemo(() => new Map(data.sections.map((section) => [section.id, section])), [data.sections])
  const filteredEmployees = data.employees.filter((employee) => (
    employee.full_name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))
  ))
  const selectedRates = data.rates.filter((rate) => rate.employee_id === selectedEmployeeId && rate.active)
  const selectedVacations = data.vacations
    .filter((vacation) => vacation.employee_id === selectedEmployeeId && !vacation.cancelled_at)
    .sort((left, right) => right.start_date.localeCompare(left.start_date))
  const activeEmployees = data.employees.filter((employee) => employee.active)
  const vacationsToday = data.vacations.filter((vacation) => (
    !vacation.cancelled_at && vacation.start_date <= today && vacation.end_date >= today
  )).length
  const upcomingVacations = data.vacations.filter((vacation) => !vacation.cancelled_at && vacation.start_date > today).length
  const cancelledVacation = cancelVacationId
    ? data.vacations.find((vacation) => vacation.id === cancelVacationId) || null
    : null

  function runAction<T>(
    action: () => Promise<PeoplePlanningActionResult<T>>,
    successMessage: string,
    apply: (value: T) => void,
    close?: () => void,
  ) {
    startTransition(async () => {
      const result = await action()
      if (!result.success || result.data === undefined) {
        toast.error(result.error || 'Не удалось сохранить')
        return
      }
      apply(result.data)
      toast.success(successMessage)
      close?.()
    })
  }

  function applyEmployee(employee: Employee) {
    setData((current) => ({
      ...current,
      employees: current.employees.some((row) => row.id === employee.id)
        ? current.employees.map((row) => row.id === employee.id ? employee : row)
        : [...current.employees, employee].sort((left, right) => left.full_name.localeCompare(right.full_name, 'ru')),
    }))
    setSelectedEmployeeId(employee.id)
  }

  function applyRate(rate: EmployeeRate) {
    setData((current) => ({
      ...current,
      rates: current.rates.some((row) => row.id === rate.id)
        ? current.rates.map((row) => row.id === rate.id ? rate : row)
        : [...current.rates, rate],
    }))
  }

  function applyVacation(vacation: EmployeeVacation) {
    setData((current) => ({
      ...current,
      vacations: current.vacations.some((row) => row.id === vacation.id)
        ? current.vacations.map((row) => row.id === vacation.id ? vacation : row)
        : [...current.vacations, vacation],
    }))
  }

  function resetVacationForm() {
    setEditingVacationId(null)
    setVacationStart('')
    setVacationEnd('')
    setVacationNote('')
  }

  function openNewEmployee() {
    setEditingEmployeeId(null)
    setEmployeeName('')
    setEmployeeSectionId(data.sections[0]?.id || '')
    setEmployeeActive(true)
    setEmployeeOpen(true)
  }

  function openEmployeeEdit(employee: Employee) {
    setEditingEmployeeId(employee.id)
    setEmployeeName(employee.full_name)
    setEmployeeSectionId(employee.default_section_id || data.sections[0]?.id || '')
    setEmployeeActive(employee.active)
    setEmployeeOpen(true)
  }

  function selectEmployee(employeeId: string) {
    setSelectedEmployeeId(employeeId)
    const firstRate = data.rates.find((rate) => rate.employee_id === employeeId && rate.active)
    setRateSectionId(firstRate?.section_id || data.employees.find((employee) => employee.id === employeeId)?.default_section_id || data.sections[0]?.id || '')
    setRateKg(firstRate ? String(firstRate.kg_per_day) : '')
    resetVacationForm()
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-2xl border border-[#D3DDE8] bg-gradient-to-r from-[#F7F9FC] to-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#1B3A6B] text-white"><Users className="size-5" /></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6E8FB9]">Производство</p><h1 className="mt-1 text-2xl font-semibold text-[#1B3A6B]">Работники</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Нормы выработки по участкам и график отпусков, который автоматически учитывается при планировании нагрузки.</p></div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {data.isDirector && (
              <FieldSelect
                label="Завод"
                value={data.selectedFactoryId}
                onChange={(factoryId) => router.push(`${ROUTES.PRODUCTION_WORKERS}?factory=${factoryId}`)}
                options={data.factories.map((factory) => ({ value: factory.id, label: factory.name }))}
              />
            )}
            <Button className="h-11 bg-[#1B3A6B] text-white hover:bg-[#244B83]" onClick={openNewEmployee}><UserPlus /> Добавить работника</Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Сводка по работникам">
        <MetricCard icon={Users} label="Активных работников" value={activeEmployees.length} tone="bg-blue-50 text-blue-700" />
        <MetricCard icon={Gauge} label="Действующих норм" value={data.rates.filter((rate) => rate.active).length} tone="bg-emerald-50 text-emerald-700" />
        <MetricCard icon={Umbrella} label="Сегодня в отпуске" value={vacationsToday} tone="bg-indigo-50 text-indigo-700" />
        <MetricCard icon={Clock3} label="Отпусков впереди" value={upcomingVacations} tone="bg-amber-50 text-amber-700" />
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.8fr)]">
        <Card className="min-w-0 border-0 bg-white shadow-sm">
          <CardHeader className="border-b border-[#E8ECF0]">
            <CardTitle className="text-[#1B3A6B]">Список работников</CardTitle>
            <CardDescription>Выберите человека, чтобы настроить его нормы и отпуска.</CardDescription>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Label htmlFor="worker-search" className="sr-only">Найти работника</Label>
              <Input id="worker-search" className="h-11 bg-white pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по ФИО" />
            </div>
          </CardHeader>
          <CardContent className="max-h-[660px] space-y-2 overflow-y-auto pt-1">
            {filteredEmployees.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center"><Users className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">Работники не найдены</p><p className="mt-1 text-xs text-slate-500">Измените поиск или добавьте нового работника.</p></div>
            )}
            {filteredEmployees.map((employee) => {
              const vacation = data.vacations.find((item) => item.employee_id === employee.id && item.start_date <= today && item.end_date >= today && !item.cancelled_at)
              const ratesCount = data.rates.filter((rate) => rate.employee_id === employee.id && rate.active).length
              const selected = employee.id === selectedEmployeeId
              return (
                <button
                  key={employee.id}
                  type="button"
                  aria-pressed={selected}
                  className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30', selected ? 'border-[#9CB3D1] bg-[#EEF3F9]' : 'border-transparent bg-[#F8FAFC] hover:border-[#D3DDE8] hover:bg-white')}
                  onClick={() => selectEmployee(employee.id)}
                >
                  <div className={cn('grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold', selected ? 'bg-[#1B3A6B] text-white' : 'bg-[#EAF0F8] text-[#1B3A6B]')}>{employee.full_name.charAt(0).toLocaleUpperCase('ru')}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#1B3A6B]">{employee.full_name}</p><p className="mt-0.5 text-xs text-slate-500">{formatRateCount(ratesCount)} · {employee.active ? 'активен' : 'неактивен'}</p></div>
                  {vacation && <Badge className="bg-blue-100 text-blue-800"><Umbrella /> Отпуск</Badge>}
                </button>
              )
            })}
          </CardContent>
        </Card>

        {selectedEmployee ? (
          <Card className="min-w-0 border-0 bg-white shadow-sm">
            <CardHeader className="border-b border-[#E8ECF0]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#EAF0F8] text-lg font-semibold text-[#1B3A6B]">{selectedEmployee.full_name.charAt(0).toLocaleUpperCase('ru')}</div>
                  <div className="min-w-0"><CardTitle className="truncate text-lg text-[#1B3A6B]">{selectedEmployee.full_name}</CardTitle><CardDescription className="mt-1">{selectedEmployee.default_section_id ? sectionById.get(selectedEmployee.default_section_id)?.displayName || 'Основной участок не найден' : 'Основной участок не задан'}</CardDescription></div>
                </div>
                <Button variant="outline" className="h-11 shrink-0" onClick={() => openEmployeeEdit(selectedEmployee)}><Pencil /> Редактировать</Button>
              </div>
            </CardHeader>
            <CardContent className="pt-1">
              <Tabs defaultValue="rates">
                <TabsList className="grid h-11 w-full grid-cols-2 bg-[#F4F6F9]">
                  <TabsTrigger value="rates" className="h-9"><Weight /> Нормы выработки</TabsTrigger>
                  <TabsTrigger value="vacations" className="h-9"><CalendarDays /> График отпусков</TabsTrigger>
                </TabsList>

                <TabsContent value="rates" className="mt-5 space-y-5">
                  <div className="rounded-xl border border-[#DDE4EC] bg-[#F8FAFC] p-4">
                    <div className="mb-4"><h2 className="font-semibold text-[#1B3A6B]">Норма на участке</h2><p className="mt-1 text-xs text-slate-500">Укажите среднюю выработку за полный рабочий день. Половина дня планируется как 50% этой нормы.</p></div>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.6fr)_auto] md:items-end">
                      <FieldSelect label="Участок" value={rateSectionId} onChange={setRateSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
                      <div className="space-y-1.5"><Label htmlFor="worker-rate">Килограммов за день</Label><Input id="worker-rate" className="h-11 bg-white" type="number" min="0.001" max="1000000" step="0.001" value={rateKg} onChange={(event) => setRateKg(event.target.value)} placeholder="Например, 800" /></div>
                      <Button
                        className="h-11 bg-[#1B3A6B] text-white"
                        disabled={pending || !rateSectionId || Number(rateKg) <= 0}
                        onClick={() => runAction(
                          () => saveEmployeeRateAction({ employeeId: selectedEmployee.id, sectionId: rateSectionId, kgPerDay: rateKg }),
                          'Норма выработки сохранена',
                          applyRate,
                          () => setRateKg(''),
                        )}
                      >
                        {pending ? <LoaderCircle className="animate-spin" /> : <Check />} Сохранить
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold text-[#1B3A6B]">Действующие нормы</h2><Badge variant="outline">{selectedRates.length}</Badge></div>
                    {selectedRates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 p-7 text-center"><Gauge className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">Нормы ещё не настроены</p><p className="mt-1 text-xs text-slate-500">Без нормы работник не появится в планировании выбранного участка.</p></div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {selectedRates.map((rate) => (
                          <button key={rate.id} type="button" className="flex min-h-20 items-center justify-between gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 text-left transition-colors hover:border-[#9CB3D1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30" onClick={() => { setRateSectionId(rate.section_id); setRateKg(String(rate.kg_per_day)) }}>
                            <div className="min-w-0"><p className="truncate text-sm font-medium text-[#1B3A6B]">{sectionById.get(rate.section_id)?.displayName || 'Участок не найден'}</p><p className="mt-1 text-xs text-slate-500">Нажмите, чтобы изменить</p></div><div className="shrink-0 text-right"><p className="text-lg font-semibold tabular-nums text-[#1B3A6B]">{numberFormatter.format(rate.kg_per_day)}</p><p className="text-xs text-slate-500">кг/день</p></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="vacations" className="mt-5 space-y-5">
                  <div className="rounded-xl border border-[#DDE4EC] bg-[#F8FAFC] p-4">
                    <div className="mb-4"><h2 className="font-semibold text-[#1B3A6B]">{editingVacationId ? 'Изменить отпуск' : 'Запланировать отпуск'}</h2><p className="mt-1 text-xs text-slate-500">Если в периоде уже есть назначения, отпуск не сохранится — сначала освободите эти дни в планировании людей.</p></div>
                    {!selectedEmployee.active && (
                      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
                        Нельзя планировать отпуск для неактивного работника. Сначала включите статус «Активный работник».
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label htmlFor="vacation-start">Первый день</Label><Input id="vacation-start" className="h-11 bg-white" type="date" disabled={!selectedEmployee.active} value={vacationStart} onChange={(event) => { setVacationStart(event.target.value); if (!vacationEnd || vacationEnd < event.target.value) setVacationEnd(event.target.value) }} /></div>
                      <div className="space-y-1.5"><Label htmlFor="vacation-end">Последний день</Label><Input id="vacation-end" className="h-11 bg-white" type="date" disabled={!selectedEmployee.active} min={vacationStart || undefined} value={vacationEnd} onChange={(event) => setVacationEnd(event.target.value)} /></div>
                      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="vacation-note">Комментарий</Label><Textarea id="vacation-note" maxLength={500} disabled={!selectedEmployee.active} value={vacationNote} onChange={(event) => setVacationNote(event.target.value)} placeholder="Например, ежегодный отпуск" /></div>
                    </div>
                    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      {editingVacationId && <Button variant="outline" className="h-11" onClick={resetVacationForm}>Отмена</Button>}
                      <Button
                        className="h-11 bg-[#1B3A6B] text-white"
                        disabled={pending || !selectedEmployee.active || !vacationStart || !vacationEnd || vacationEnd < vacationStart}
                        onClick={() => runAction(
                          () => saveEmployeeVacationAction({ id: editingVacationId || undefined, employeeId: selectedEmployee.id, startDate: vacationStart, endDate: vacationEnd, note: vacationNote || null }),
                          editingVacationId ? 'Отпуск изменён' : 'Отпуск запланирован',
                          applyVacation,
                          resetVacationForm,
                        )}
                      >
                        {pending ? <LoaderCircle className="animate-spin" /> : <CalendarDays />} {editingVacationId ? 'Сохранить изменения' : 'Добавить отпуск'}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold text-[#1B3A6B]">Периоды отпусков</h2><Badge variant="outline">{selectedVacations.length}</Badge></div>
                    {selectedVacations.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 p-7 text-center"><Umbrella className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">Отпуска не запланированы</p><p className="mt-1 text-xs text-slate-500">Добавьте период, и эти даты станут недоступны для нагрузки.</p></div>
                    ) : (
                      <div className="space-y-3">
                        {selectedVacations.map((vacation) => {
                          const status = vacationTone(vacation, today)
                          return (
                            <div key={vacation.id} className="flex flex-col gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Umbrella className="size-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[#1B3A6B]">{formatDate(vacation.start_date)} — {formatDate(vacation.end_date)}</p><Badge variant="outline" className={status.className}>{status.label}</Badge></div><p className="mt-1 text-xs text-slate-500">{vacationDurationDays(vacation)} дн.{vacation.note ? ` · ${vacation.note}` : ''}</p></div></div>
                              <div className="flex shrink-0 gap-2"><Button variant="outline" className="h-11" disabled={!selectedEmployee.active} onClick={() => { setEditingVacationId(vacation.id); setVacationStart(vacation.start_date); setVacationEnd(vacation.end_date); setVacationNote(vacation.note || '') }}><Pencil /> Изменить</Button><Button variant="outline" className="h-11 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setCancelVacationId(vacation.id)}><XCircle /> Отменить</Button></div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Card className="min-h-80 items-center justify-center border-0 bg-white text-center shadow-sm"><CardContent><Users className="mx-auto size-8 text-slate-400" /><p className="mt-3 font-medium text-[#1B3A6B]">Добавьте первого работника</p><p className="mt-1 text-sm text-slate-500">После этого можно настроить нормы и отпуск.</p><Button className="mt-4 h-11 bg-[#1B3A6B] text-white" onClick={openNewEmployee}><Plus /> Добавить работника</Button></CardContent></Card>
        )}
      </div>

      <Dialog open={employeeOpen} onOpenChange={setEmployeeOpen}>
        <DialogContent className="border-[#DDE4EC] bg-white sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-lg text-[#1B3A6B]">{editingEmployeeId ? 'Редактировать работника' : 'Новый работник'}</DialogTitle><DialogDescription>ФИО и основной участок используются в производственном планировании.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label htmlFor="employee-name">ФИО</Label><Input id="employee-name" className="h-11" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Например, Иван Петров" autoFocus /></div>
            <FieldSelect label="Основной участок" value={employeeSectionId} onChange={setEmployeeSectionId} options={data.sections.map((section) => ({ value: section.id, label: section.displayName }))} />
            {editingEmployeeId && <div className="flex min-h-11 items-center justify-between rounded-xl border border-[#E8ECF0] px-3"><div><Label>Активный работник</Label><p className="text-xs text-slate-500">Неактивный работник не доступен для новой нагрузки.</p></div><Switch className="cursor-pointer after:-inset-3" checked={employeeActive} onCheckedChange={(value) => setEmployeeActive(value === true)} aria-label="Активный работник" /></div>}
          </div>
          <DialogFooter><Button variant="outline" className="h-11" onClick={() => setEmployeeOpen(false)}>Отмена</Button><Button className="h-11 bg-[#1B3A6B] text-white" disabled={pending || employeeName.trim().length < 2 || !employeeSectionId} onClick={() => runAction(() => saveEmployeeAction({ id: editingEmployeeId || undefined, fullName: employeeName, factoryId: data.selectedFactoryId, defaultSectionId: employeeSectionId, active: employeeActive }), editingEmployeeId ? 'Работник обновлён' : 'Работник добавлен', applyEmployee, () => setEmployeeOpen(false))}>{pending ? <LoaderCircle className="animate-spin" /> : editingEmployeeId ? <Check /> : <UserPlus />} {editingEmployeeId ? 'Сохранить' : 'Добавить'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(cancelVacationId)} onOpenChange={(open) => !open && setCancelVacationId(null)}>
        <AlertDialogContent className="border-[#DDE4EC] bg-white sm:max-w-md">
          <AlertDialogHeader><AlertDialogTitle className="text-[#1B3A6B]">Отменить отпуск?</AlertDialogTitle><AlertDialogDescription>{cancelledVacation ? `Период ${formatDate(cancelledVacation.start_date)} — ${formatDate(cancelledVacation.end_date)} снова станет доступен для планирования. Запись останется в истории.` : 'Период снова станет доступен для планирования.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={pending}>Не отменять</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" disabled={pending || !cancelVacationId} onClick={() => cancelVacationId && runAction(() => cancelEmployeeVacationAction(cancelVacationId), 'Отпуск отменён', (vacation) => { applyVacation(vacation); if (editingVacationId === vacation.id) resetVacationForm() }, () => setCancelVacationId(null))}><XCircle /> {pending ? 'Отменяем…' : 'Отменить отпуск'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <span className="sr-only" aria-live="polite">{pending ? 'Сохранение данных' : ''}</span>
    </div>
  )
}
