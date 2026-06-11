"use client"

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarClock, Check, ChevronDown, Landmark, Loader2, RefreshCw, Save, Send, Wallet, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  createFinanceExpense,
  createGeneralFinanceExpense,
  saveFinanceBudgetLimits,
  saveFinanceCurrentBalance,
  sendFinanceTelegramTestMessage,
  updateFinanceExpense,
  updateFinanceIncome,
  type FinanceCalendarData,
  type FinanceEvent,
} from '@/lib/actions/finance'
import { GENERAL_FINANCE_EXPENSE_CATEGORIES, SUPPLY_FINANCE_CATEGORIES, type GeneralFinanceExpenseCategory, type SupplyFinanceCategory } from '@/lib/constants/finance'

type EventFilter = 'all' | 'income' | 'expense'
type StatusFilter = 'all' | FinanceEvent['status']
type ViewMode = 'calendar' | 'list'

const DAY_WIDTH = 38

const statusLabels: Record<FinanceEvent['status'], string> = {
  planned: 'План',
  partially_paid: 'Частично',
  paid: 'Оплачено',
  overdue: 'Просрочено',
  rejected: 'Не подтверждено',
}

const statusClass: Record<FinanceEvent['status'], string> = {
  planned: 'bg-slate-100 text-slate-700 border-slate-200',
  partially_paid: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  paid: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  overdue: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-zinc-100 text-zinc-700 border-zinc-200',
}

function parseAmount(value: string) {
  return Number(value.replace(',', '.'))
}

function formatMoney(amount: number) {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const sign = safeAmount < 0 ? '-' : ''
  const [whole, fraction] = Math.abs(safeAmount).toFixed(2).split('.')
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`
}

function formatUah(amount: number) {
  return `${formatMoney(amount)} грн.`
}

function formatEventAmount(amount: number, currency: 'UAH' | 'EUR') {
  return `${formatMoney(amount)} ${currency === 'UAH' ? 'грн' : 'EUR'}`
}

function dateLabel(value: string | null) {
  return value ? format(parseISO(value), 'dd.MM.yyyy') : '-'
}

function eventColor(event: FinanceEvent) {
  if (event.status === 'paid') return '#16A34A'
  if (event.status === 'partially_paid') return '#D97706'
  if (event.status === 'overdue') return '#DC2626'
  if (event.status === 'rejected') return '#71717A'
  return event.type === 'income' ? '#16A34A' : '#DC2626'
}

function eventTimelineDate(event: FinanceEvent) {
  return event.type === 'income' ? event.cashArrivalDate : event.plannedDate
}

function eventActionKey(event: FinanceEvent) {
  return `${event.type}-${event.id}-${event.paymentPart}`
}

function telegramEventValue(event: FinanceEvent) {
  return `${event.type}:${event.id}:${event.paymentPart}`
}

function SummaryCard({ title, value, tone, icon: Icon }: { title: string; value: string; tone: string; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[#6B7280]">{title}</span>
        <Icon className={cn('h-5 w-5', tone)} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-[#1B3A6B]">{value}</div>
    </div>
  )
}

export function FinanceCalendar({ data, mode = 'general' }: { data: FinanceCalendarData; mode?: 'general' | 'supply' }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    category: SUPPLY_FINANCE_CATEGORIES[0] as SupplyFinanceCategory,
    currency: 'EUR' as 'UAH' | 'EUR',
    counterparty: '',
    factoryId: data.factories[0]?.id || '',
    responsibleUserId: '',
    plannedDate: format(new Date(), 'yyyy-MM-dd'),
    recurring: 'none',
    weekdays: [] as number[],
    monthDays: String(new Date().getDate()),
  })
  const [generalExpenseForm, setGeneralExpenseForm] = useState({
    title: '',
    amount: '',
    category: GENERAL_FINANCE_EXPENSE_CATEGORIES[0] as GeneralFinanceExpenseCategory,
    currency: 'UAH' as 'UAH' | 'EUR',
    counterparty: '',
    factoryId: 'none',
    plannedDate: format(new Date(), 'yyyy-MM-dd'),
  })
  const [budgetForms, setBudgetForms] = useState<Record<SupplyFinanceCategory, string>>(() =>
    data.budgetLimits.reduce((acc, item) => {
      acc[item.category] = item.monthlyLimitUah === null ? '' : String(item.monthlyLimitUah)
      return acc
    }, {} as Record<SupplyFinanceCategory, string>)
  )
  const [currentBalance, setCurrentBalance] = useState(String(data.currentBalanceUah || 0))
  const [actionForms, setActionForms] = useState<Record<string, { amount: string; date: string; comment: string; applyToFuture: boolean }>>({})
  const [expandedActionKey, setExpandedActionKey] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('calendar')
  const [dateFrom, setDateFrom] = useState(data.range.start)
  const [dateTo, setDateTo] = useState(data.range.end)
  const [telegramTestEvent, setTelegramTestEvent] = useState(() => {
    const event = data.events.find((item) => item.status !== 'paid' && item.status !== 'rejected')
    return event ? telegramEventValue(event) : ''
  })
  const isSupplyMode = mode === 'supply'
  const isDirector = ['financial_director', 'commercial_director', 'planning_director'].includes(data.currentUserRole)
  const hasFinanceFullAccess = data.currentUserRole === 'financial_director' || data.currentUserRole === 'planning_director'
  const isSupplyManager = data.currentUserRole === 'supply_manager'

  const calculatedExpenseUah = useMemo(() => {
    const amount = parseAmount(expenseForm.amount || '0')
    if (!Number.isFinite(amount) || amount <= 0) return 0
    if (expenseForm.currency === 'UAH') return amount
    return data.nbuEurRate ? amount * data.nbuEurRate : 0
  }, [expenseForm.amount, expenseForm.currency, data.nbuEurRate])

  const calculatedGeneralExpenseUah = useMemo(() => {
    const amount = parseAmount(generalExpenseForm.amount || '0')
    if (!Number.isFinite(amount) || amount <= 0) return 0
    if (generalExpenseForm.currency === 'UAH') return amount
    return data.nbuEurRate ? amount * data.nbuEurRate : 0
  }, [generalExpenseForm.amount, generalExpenseForm.currency, data.nbuEurRate])

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.events.filter((event) => {
      if (isSupplyMode && (event.type !== 'expense' || !event.isSupplyPlan)) return false
      if (!isSupplyMode && eventFilter !== 'all' && event.type !== eventFilter) return false
      if (statusFilter !== 'all' && event.status !== statusFilter) return false
      const date = eventTimelineDate(event)
      if (dateFrom && date < dateFrom) return false
      if (dateTo && date > dateTo) return false
      if (q && !`${event.title} ${event.category} ${event.counterparty} ${event.responsibleName || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.events, eventFilter, statusFilter, search, isSupplyMode, dateFrom, dateTo])

  const attentionEvents = data.events.filter((event) =>
    (!isSupplyMode || (event.type === 'expense' && event.isSupplyPlan)) &&
    (event.status === 'overdue' || event.status === 'partially_paid')
  )
  const telegramTestEvents = data.events.filter((event) => event.status !== 'paid' && event.status !== 'rejected' && event.remainingAmount > 0)
  const rangeStart = parseISO(data.range.start)
  const days = differenceInCalendarDays(parseISO(data.range.end), rangeStart) + 1
  const chartWidth = days * DAY_WIDTH

  const setActionForm = (eventId: string, patch: Partial<{ amount: string; date: string; comment: string; applyToFuture: boolean }>) => {
    const defaults = {
      amount: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      comment: '',
      applyToFuture: false,
    }
    setActionForms((prev) => ({
      ...prev,
      [eventId]: {
        ...defaults,
        ...prev[eventId],
        ...patch,
      },
    }))
  }

  const submitExpense = () => {
    startTransition(async () => {
      const recurring = isSupplyMode ? false : expenseForm.recurring !== 'none'
      const monthDays = isSupplyMode
        ? []
        : expenseForm.monthDays
          .split(',')
          .map((day) => Number(day.trim()))
          .filter((day) => day >= 1 && day <= 31)

      const response = await createFinanceExpense({
        title: expenseForm.title || `${expenseForm.category}: ${expenseForm.counterparty}`,
        amount: parseAmount(expenseForm.amount),
        category: expenseForm.category,
        counterparty: expenseForm.counterparty,
        currency: expenseForm.currency,
        factoryId: expenseForm.factoryId,
        responsibleUserId: isSupplyMode ? null : expenseForm.responsibleUserId || null,
        plannedDate: expenseForm.plannedDate,
        recurring,
        frequency: recurring ? expenseForm.recurring as 'weekly' | 'monthly' | 'quarterly' : undefined,
        weekdays: isSupplyMode ? [] : expenseForm.weekdays,
        monthDays,
      })

      if (response.success) {
        toast.success(`Расход создан${response.count ? `: ${response.count} событий` : ''}`)
        setExpenseForm((prev) => ({ ...prev, title: '', amount: '', counterparty: '' }))
        router.refresh()
      } else {
        toast.error(response.error)
      }
    })
  }

  const submitGeneralExpense = () => {
    startTransition(async () => {
      const response = await createGeneralFinanceExpense({
        title: generalExpenseForm.title || `${generalExpenseForm.category}: ${generalExpenseForm.counterparty}`,
        amount: parseAmount(generalExpenseForm.amount),
        category: generalExpenseForm.category,
        counterparty: generalExpenseForm.counterparty,
        currency: generalExpenseForm.currency,
        factoryId: generalExpenseForm.factoryId === 'none' ? null : generalExpenseForm.factoryId,
        plannedDate: generalExpenseForm.plannedDate,
      })

      if (response.success) {
        toast.success('Расход создан')
        setGeneralExpenseForm((prev) => ({ ...prev, title: '', amount: '', counterparty: '' }))
        router.refresh()
      } else {
        toast.error(response.error)
      }
    })
  }

  const sendTestTelegram = () => {
    startTransition(async () => {
      const [eventType, eventId] = telegramTestEvent.split(':') as [FinanceEvent['type'] | undefined, string | undefined]
      const response = await sendFinanceTelegramTestMessage(eventType && eventId ? { eventType, eventId } : undefined)
      if (response.success) {
        toast.success('Тестовое сообщение отправлено')
      } else {
        toast.error(response.error)
      }
    })
  }

  const saveBudgets = () => {
    startTransition(async () => {
      const response = await saveFinanceBudgetLimits(SUPPLY_FINANCE_CATEGORIES.map((category) => ({
        category,
        monthlyLimitUah: budgetForms[category] ? parseAmount(budgetForms[category]) : null,
      })))
      if (response.success) {
        toast.success('Нормы бюджета сохранены')
        router.refresh()
      } else {
        toast.error(response.error)
      }
    })
  }

  const saveBalance = () => {
    startTransition(async () => {
      const response = await saveFinanceCurrentBalance(parseAmount(currentBalance))
      if (response.success) {
        toast.success('Текущий остаток сохранен')
        router.refresh()
      } else {
        toast.error(response.error)
      }
    })
  }

  const updateEvent = (event: FinanceEvent, action: 'paid' | 'partial' | 'postpone' | 'reject') => {
    if (!isDirector && !(isSupplyManager && event.type === 'expense' && event.isSupplyPlan)) return
    const form = actionForms[eventActionKey(event)] || { amount: '', date: format(new Date(), 'yyyy-MM-dd'), comment: '', applyToFuture: false }
    startTransition(async () => {
      const payload = {
        action,
        amount: form.amount ? parseAmount(form.amount) : undefined,
        date: form.date,
        comment: form.comment || undefined,
        applyToFuture: event.type === 'expense' ? form.applyToFuture : false,
      }
      const response = event.type === 'income'
        ? await updateFinanceIncome(event.id, payload)
        : await updateFinanceExpense(event.id, payload)

      if (response.success) {
        toast.success('Финансовое событие обновлено')
        router.refresh()
      } else {
        toast.error(response.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      {!isSupplyMode && (
        <Tabs defaultValue="plan" className="space-y-4">
          <TabsList>
            <TabsTrigger value="plan">План</TabsTrigger>
            {isDirector && <TabsTrigger value="budget">Настройки бюджета</TabsTrigger>}
          </TabsList>

          <TabsContent value="plan" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <SummaryCard title="Ожидаемые приходы" value={formatUah(data.summary.expectedIncome)} tone="text-emerald-600" icon={ArrowUpCircle} />
              <SummaryCard title="Ожидаемые расходы" value={formatUah(data.summary.expectedExpense)} tone="text-red-600" icon={ArrowDownCircle} />
              <SummaryCard title="Просроченные приходы" value={formatUah(data.summary.overdueIncome)} tone="text-red-600" icon={AlertTriangle} />
              <SummaryCard title="Просроченные расходы" value={formatUah(data.summary.overdueExpense)} tone="text-red-600" icon={AlertTriangle} />
              <SummaryCard title="Прогноз остатка" value={formatUah(data.summary.forecastBalance)} tone={data.summary.forecastBalance < 0 ? 'text-red-600' : 'text-[#1B3A6B]'} icon={Wallet} />
            </div>

            {hasFinanceFullAccess && (
              <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_minmax(280px,520px)_auto] lg:items-end">
                  <div>
                    <div className="font-semibold text-[#1B3A6B]">Тест Telegram-уведомлений</div>
                  </div>
                  <Select value={telegramTestEvent || 'none'} onValueChange={(value) => setTelegramTestEvent(value === 'none' ? '' : String(value))}>
                    <SelectTrigger><SelectValue placeholder="Выберите событие" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Выберите событие</SelectItem>
                      {telegramTestEvents.map((event) => (
                        <SelectItem key={eventActionKey(event)} value={telegramEventValue(event)}>
                          {event.type === 'income' ? 'Приход' : 'Расход'} · {dateLabel(eventTimelineDate(event))} · {event.title} · {formatUah(event.remainingAmountUah)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={sendTestTelegram} disabled={isPending || !telegramTestEvent}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Отправить тест Telegram
                  </Button>
                </div>
              </section>
            )}

            {isDirector && (
              <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} placeholder="Текущий остаток, грн" />
                  <Button variant="outline" onClick={saveBalance} disabled={isPending}>Сохранить остаток</Button>
                </div>
              </section>
            )}

            {hasFinanceFullAccess && (
              <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
                <div className="mb-4 flex items-center gap-2 font-semibold text-[#1B3A6B]">
                  <CalendarClock className="h-5 w-5" />
                  Новый планируемый расход
                </div>
                <div className="grid gap-3 lg:grid-cols-4">
                  <Input placeholder="Название" value={generalExpenseForm.title} onChange={(e) => setGeneralExpenseForm((prev) => ({ ...prev, title: e.target.value }))} />
                  <Select value={generalExpenseForm.category} onValueChange={(value) => setGeneralExpenseForm((prev) => ({ ...prev, category: value as GeneralFinanceExpenseCategory }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GENERAL_FINANCE_EXPENSE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder={`Сумма ${generalExpenseForm.currency}`} value={generalExpenseForm.amount} onChange={(e) => setGeneralExpenseForm((prev) => ({ ...prev, amount: e.target.value }))} />
                  <Select value={generalExpenseForm.currency} onValueChange={(value) => setGeneralExpenseForm((prev) => ({ ...prev, currency: (value || 'UAH') as 'UAH' | 'EUR' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UAH">Гривна</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Контрагент" value={generalExpenseForm.counterparty} onChange={(e) => setGeneralExpenseForm((prev) => ({ ...prev, counterparty: e.target.value }))} />
                  <Select value={generalExpenseForm.factoryId} onValueChange={(value) => setGeneralExpenseForm((prev) => ({ ...prev, factoryId: String(value || 'none') }))}>
                    <SelectTrigger><SelectValue placeholder="Завод" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Без привязки к заводу</SelectItem>
                      {data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="rounded-md border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm">
                    <div className="text-xs text-[#6B7280]">Сумма в гривне</div>
                    <div className="font-semibold text-[#1B3A6B]">{formatUah(calculatedGeneralExpenseUah)}</div>
                    {generalExpenseForm.currency === 'EUR' && (
                      <div className="text-[11px] text-[#6B7280]">Курс НБУ: {data.nbuEurRate ? data.nbuEurRate.toFixed(4) : 'недоступен'}</div>
                    )}
                  </div>
                  <Input type="date" value={generalExpenseForm.plannedDate} onChange={(e) => setGeneralExpenseForm((prev) => ({ ...prev, plannedDate: e.target.value }))} />
                </div>
                <Button className="mt-3" onClick={submitGeneralExpense} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Создать расход
                </Button>
              </section>
            )}
          </TabsContent>

          {isDirector && (
            <TabsContent value="budget" className="space-y-4">
              <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
                <div className="mb-3 text-sm font-semibold text-[#1B3A6B]">Нормы бюджета снабжения</div>
                <div className="grid gap-2">
                  {SUPPLY_FINANCE_CATEGORIES.map((category) => (
                    <Input
                      key={category}
                      placeholder={`${category}: без нормы`}
                      value={budgetForms[category] || ''}
                      onChange={(e) => setBudgetForms((prev) => ({ ...prev, [category]: e.target.value }))}
                    />
                  ))}
                  <Button variant="outline" onClick={saveBudgets} disabled={isPending}>
                    <Save className="mr-2 h-4 w-4" />
                    Сохранить нормы
                  </Button>
                </div>
              </section>
            </TabsContent>
          )}
        </Tabs>
      )}

      {attentionEvents.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            Требует внимания: {attentionEvents.length}
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {attentionEvents.slice(0, 9).map((event) => (
              <div key={`${event.type}-${event.id}`} className="rounded-md border border-red-100 bg-white px-3 py-2 text-sm">
                <div className="font-medium text-[#1B3A6B]">{event.title}</div>
                <div className="text-[#6B7280]">{dateLabel(eventTimelineDate(event))} · {formatUah(event.remainingAmountUah)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isSupplyMode && (
        <>
      <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 font-semibold text-[#1B3A6B]">
          <CalendarClock className="h-5 w-5" />
          Новый планируемый расход
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <Input placeholder="Название" value={expenseForm.title} onChange={(e) => setExpenseForm((prev) => ({ ...prev, title: e.target.value }))} />
          <Select value={expenseForm.category} onValueChange={(value) => setExpenseForm((prev) => ({ ...prev, category: value as SupplyFinanceCategory }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUPPLY_FINANCE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder={`Сумма ${expenseForm.currency}`} value={expenseForm.amount} onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))} />
          <Select value={expenseForm.currency} onValueChange={(value) => setExpenseForm((prev) => ({ ...prev, currency: (value || 'EUR') as 'UAH' | 'EUR' }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="UAH">Гривна</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Контрагент" value={expenseForm.counterparty} onChange={(e) => setExpenseForm((prev) => ({ ...prev, counterparty: e.target.value }))} />
          <Select value={expenseForm.factoryId || 'none'} onValueChange={(value) => setExpenseForm((prev) => ({ ...prev, factoryId: value === 'none' ? '' : String(value) }))}>
            <SelectTrigger><SelectValue placeholder="Завод" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Завод не выбран</SelectItem>
              {data.factories.map((factory) => <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="rounded-md border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm">
            <div className="text-xs text-[#6B7280]">Сумма в гривне</div>
            <div className="font-semibold text-[#1B3A6B]">{formatUah(calculatedExpenseUah)}</div>
            {expenseForm.currency === 'EUR' && (
              <div className="text-[11px] text-[#6B7280]">Курс НБУ: {data.nbuEurRate ? data.nbuEurRate.toFixed(4) : 'недоступен'}</div>
            )}
          </div>
          <Input type="date" value={expenseForm.plannedDate} onChange={(e) => setExpenseForm((prev) => ({ ...prev, plannedDate: e.target.value }))} />
        </div>
        <Button className="mt-3" onClick={submitExpense} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Создать расход
        </Button>
      </section>

      <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 font-semibold text-[#1B3A6B]">
          <Wallet className="h-5 w-5" />
          Финансовый план снабжения
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="overflow-x-auto rounded-md border border-[#E8ECF0]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F8F9FA] text-left text-[#6B7280]">
                <tr>
                  <th className="px-3 py-2">Неделя</th>
                  {SUPPLY_FINANCE_CATEGORIES.map((category) => <th key={category} className="px-3 py-2">{category}</th>)}
                  <th className="px-3 py-2">Итого</th>
                </tr>
              </thead>
              <tbody>
                {data.weeklySupplyReport.map((week) => (
                  <tr key={week.weekStart} className="border-t border-[#E8ECF0]">
                    <td className="px-3 py-2 text-[#1B3A6B]">{dateLabel(week.weekStart)} - {dateLabel(week.weekEnd)}</td>
                    {SUPPLY_FINANCE_CATEGORIES.map((category) => <td key={category} className="px-3 py-2">{formatUah(week.totalsByCategory[category])}</td>)}
                    <td className="px-3 py-2 font-semibold">{formatUah(week.totalUah)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-[#E8ECF0] p-3">
              <div className="mb-2 text-sm font-semibold text-[#1B3A6B]">Итого за месяц: {formatUah(data.monthlySupplyReport.totalUah)}</div>
              <div className="space-y-2">
                {data.budgetLimits.map((item) => {
                  const fact = data.monthlySupplyReport.totalsByCategory[item.category]
                  const over = item.monthlyLimitUah !== null && fact > item.monthlyLimitUah
                  return (
                    <div key={item.category} className="grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
                      <span className={over ? 'font-medium text-red-700' : 'text-[#374151]'}>{item.category}</span>
                      <span className="text-right">{formatUah(fact)} / {item.monthlyLimitUah === null ? 'без нормы' : formatUah(item.monthlyLimitUah)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
        </>
      )}

      <section className="rounded-lg border border-[#E8ECF0] bg-white p-4">
        <div className={cn('mb-4 grid gap-3', isSupplyMode ? 'lg:grid-cols-[1fr_160px_160px_180px_180px]' : 'lg:grid-cols-[1fr_160px_160px_180px_180px_180px]')}>
          <Input placeholder="Поиск по событию, категории, контрагенту" value={search} onChange={(e) => setSearch(e.target.value)} />
          {!isSupplyMode && (
            <Select value={eventFilter} onValueChange={(value) => setEventFilter((value || 'all') as EventFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все события</SelectItem>
                <SelectItem value="income">Приходы</SelectItem>
                <SelectItem value="expense">Расходы</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter((value || 'all') as StatusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 rounded-md border border-[#E8ECF0] p-1">
            <Button size="sm" variant={viewMode === 'calendar' ? 'default' : 'ghost'} onClick={() => setViewMode('calendar')}>Календарь</Button>
            <Button size="sm" variant={viewMode === 'list' ? 'default' : 'ghost'} onClick={() => setViewMode('list')}>Список</Button>
          </div>
        </div>

        {viewMode === 'calendar' && (
        <div className="overflow-x-auto rounded-md border border-[#E8ECF0]">
          <div className="min-w-full" style={{ width: Math.max(chartWidth + 320, 900) }}>
            <div className="sticky top-0 z-10 grid border-b border-[#E8ECF0] bg-[#F8F9FA]" style={{ gridTemplateColumns: `320px ${chartWidth}px` }}>
              <div className="border-r border-[#E8ECF0] px-3 py-2 text-sm font-semibold text-[#1B3A6B]">Событие</div>
              <div className="relative h-10">
                {Array.from({ length: days }).map((_, index) => {
                  const date = addDays(rangeStart, index)
                  const forecast = data.forecast[index]
                  return (
                    <div
                      key={index}
                      className={cn('absolute top-0 flex h-full items-center justify-center border-r border-[#E8ECF0] text-[10px]', forecast?.isNegative && 'bg-red-50 text-red-700')}
                      style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                      title={`Прогноз: ${formatUah(forecast?.balance || 0)}`}
                    >
                      {format(date, 'dd.MM')}
                    </div>
                  )
                })}
              </div>
            </div>

            {filteredEvents.map((event) => {
              const timelineDate = eventTimelineDate(event)
              const eventKey = eventActionKey(event)
              const left = Math.max(0, differenceInCalendarDays(parseISO(timelineDate), rangeStart) * DAY_WIDTH)
              const originalLeft = event.originalPlannedDate
                ? Math.max(0, differenceInCalendarDays(parseISO(event.originalPlannedDate), rangeStart) * DAY_WIDTH)
                : null
              const bankLeft = event.bankProcessingStartDate
                ? Math.max(0, differenceInCalendarDays(parseISO(event.bankProcessingStartDate), rangeStart) * DAY_WIDTH)
                : null
              const bankWidth = event.bankProcessingStartDate && event.bankProcessingEndDate
                ? (differenceInCalendarDays(parseISO(event.bankProcessingEndDate), parseISO(event.bankProcessingStartDate)) + 1) * DAY_WIDTH
                : 0
              const actualLeft = event.actualPaidDate
                ? Math.max(0, differenceInCalendarDays(parseISO(event.actualPaidDate), rangeStart) * DAY_WIDTH)
                : null
              const form = actionForms[eventKey] || { amount: '', date: format(new Date(), 'yyyy-MM-dd'), comment: '', applyToFuture: false }
              const canManageEvent = isDirector || (isSupplyManager && event.type === 'expense' && event.isSupplyPlan)
              const isActionsExpanded = expandedActionKey === eventKey

              return (
                <div key={eventKey} className="grid border-b border-[#E8ECF0]" style={{ gridTemplateColumns: `320px ${chartWidth}px` }}>
                  <div className="border-r border-[#E8ECF0] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {event.type === 'income' ? <ArrowUpCircle className="h-4 w-4 text-emerald-600" /> : <ArrowDownCircle className="h-4 w-4 text-red-600" />}
                          <span className="truncate font-medium text-[#1B3A6B]">{event.title}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#6B7280]">
                          {event.category} · {event.counterparty}
                        </div>
                        {event.factoryName && (
                          <div className="mt-1 text-xs text-[#6B7280]">
                            Завод: {event.factoryName}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-[#6B7280]">
                          {event.type === 'income'
                            ? <>Дата оплаты клиентом: {dateLabel(event.paymentObligationDate || event.plannedDate)}</>
                            : <>Плановая дата оплаты: {dateLabel(event.plannedDate)}</>
                          }
                        </div>
                        {event.type === 'income' && (
                          <>
                            <div className="text-xs text-emerald-700">
                              Банк: {dateLabel(event.bankProcessingStartDate)} - {dateLabel(event.bankProcessingEndDate)}
                            </div>
                            <div className="text-xs text-[#1B3A6B]">
                              Ожидаемый приход: {dateLabel(event.cashArrivalDate)}
                            </div>
                          </>
                        )}
                        {event.actualPaidDate && <div className="text-xs text-emerald-700">Факт: {dateLabel(event.actualPaidDate)}</div>}
                      </div>
                      <Badge variant="outline" className={statusClass[event.status]}>{statusLabels[event.status]}</Badge>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-[#374151]">
                      {formatUah(event.remainingAmountUah)}
                      <span className="ml-2 text-xs font-normal text-[#6B7280]">{formatEventAmount(event.remainingAmount, event.currency)}</span>
                      {event.paidAmount > 0 && <span className="ml-2 text-xs font-normal text-[#6B7280]">оплачено {formatEventAmount(event.paidAmount, event.currency)}</span>}
                    </div>

                    {canManageEvent && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => setExpandedActionKey((current) => current === eventKey ? null : eventKey)}
                          aria-expanded={isActionsExpanded}
                        >
                          Действия
                          <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', isActionsExpanded && 'rotate-180')} />
                        </Button>

                        {isActionsExpanded && (
                          <div className="mt-3 rounded-md border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                            <div className="grid grid-cols-2 gap-2">
                              <Input className="h-8 bg-white" placeholder="Сумма" value={form.amount} onChange={(e) => setActionForm(eventKey, { amount: e.target.value })} />
                              <Input className="h-8 bg-white" type="date" value={form.date} onChange={(e) => setActionForm(eventKey, { date: e.target.value })} />
                            </div>
                            <Textarea className="mt-2 min-h-16 bg-white" placeholder="Комментарий" value={form.comment} onChange={(e) => setActionForm(eventKey, { comment: e.target.value })} />
                            {event.type === 'expense' && event.seriesId && (
                              <label className="mt-2 flex items-center gap-2 text-xs text-[#374151]">
                                <Checkbox
                                  checked={form.applyToFuture}
                                  onCheckedChange={(checked) => setActionForm(eventKey, { applyToFuture: checked === true })}
                                />
                                Применить перенос ко всем будущим платежам серии
                              </label>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => updateEvent(event, 'paid')} disabled={isPending}><Check className="mr-1 h-3.5 w-3.5" />Оплачено</Button>
                              <Button size="sm" variant="outline" onClick={() => updateEvent(event, 'partial')} disabled={isPending}>Частично</Button>
                              <Button size="sm" variant="outline" onClick={() => updateEvent(event, 'postpone')} disabled={isPending}><RefreshCw className="mr-1 h-3.5 w-3.5" />Перенести</Button>
                              <Button size="sm" variant="outline" onClick={() => updateEvent(event, 'reject')} disabled={isPending}>Не подтвердить</Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {event.sourceHref && (
                      <Link href={event.sourceHref} className={buttonVariants({ size: 'sm', variant: 'ghost', className: 'mt-2' })}>
                        Открыть
                      </Link>
                    )}
                  </div>
                  <div className="relative h-48">
                    {Array.from({ length: days }).map((_, index) => (
                      <div key={index} className="absolute top-0 h-full border-r border-[#F1F5F9]" style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }} />
                    ))}
                    {originalLeft !== null && originalLeft !== left && (
                      <div className="absolute top-5 h-12 border-l-2 border-dashed border-[#64748B]" style={{ left: originalLeft }} title={`Изначальная дата: ${dateLabel(event.originalPlannedDate)}`} />
                    )}
                    {event.type === 'income' && bankLeft !== null && bankWidth > 0 && (
                      <div
                        className="absolute top-10 h-5 rounded bg-emerald-200/80 ring-1 ring-emerald-500/20"
                        style={{ left: bankLeft, width: Math.max(bankWidth - 4, DAY_WIDTH - 4) }}
                        title={`Банковская обработка: ${dateLabel(event.bankProcessingStartDate)} - ${dateLabel(event.bankProcessingEndDate)}`}
                      />
                    )}
                    <div
                      className="absolute top-16 h-7 rounded-md px-2 text-xs font-medium leading-7 text-white shadow-sm"
                      style={{ left, width: Math.max(DAY_WIDTH - 6, 28), backgroundColor: eventColor(event) }}
                      title={`${event.title}: ${formatUah(event.remainingAmountUah)}`}
                    >
                      {event.type === 'income' ? '+' : '-'}
                    </div>
                    {actualLeft !== null && (
                      <div
                        className="absolute top-28 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-[#1B3A6B] text-[10px] font-bold text-white"
                        style={{ left: actualLeft + DAY_WIDTH / 2 }}
                        title={`Фактическая дата: ${dateLabel(event.actualPaidDate)}`}
                      >
                        Ф
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )}

        {filteredEvents.length === 0 && (
          <div className="py-10 text-center text-sm text-[#6B7280]">
            <Landmark className="mx-auto mb-2 h-8 w-8 text-[#9CA3AF]" />
            Финансовые события не найдены.
          </div>
        )}

        {!isSupplyMode && viewMode === 'calendar' && (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-[#1B3A6B]">Прогноз остатка по дням</div>
          <div className="overflow-x-auto rounded-md border border-[#E8ECF0]">
            <div className="min-w-full text-xs" style={{ width: Math.max(chartWidth + 160, 900) }}>
              <div className="grid border-b border-[#E8ECF0] bg-[#F8F9FA]" style={{ gridTemplateColumns: `160px ${chartWidth}px` }}>
                <div className="border-r border-[#E8ECF0] px-3 py-2 font-semibold text-[#1B3A6B]">Показатель</div>
                <div className="relative h-9">
                  {data.forecast.map((item, index) => (
                    <div
                      key={item.date}
                      className={cn('absolute top-0 flex h-full items-center justify-center border-r border-[#E8ECF0] text-[10px]', item.isNegative && 'bg-red-50 text-red-700')}
                      style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                    >
                      {format(parseISO(item.date), 'dd.MM')}
                    </div>
                  ))}
                </div>
              </div>

              {[
                { label: 'Приход', values: data.forecast.map((item) => ({ value: item.income, tone: item.income > 0 ? 'text-emerald-700' : 'text-[#6B7280]' })) },
                { label: 'Расход', values: data.forecast.map((item) => ({ value: item.expense, tone: item.expense > 0 ? 'text-red-700' : 'text-[#6B7280]' })) },
                { label: 'Остаток', values: data.forecast.map((item) => ({ value: item.balance, tone: item.isNegative ? 'font-semibold text-red-700' : 'text-[#1B3A6B]' })) },
              ].map((row) => (
                <div key={row.label} className="grid border-b border-[#E8ECF0] last:border-b-0" style={{ gridTemplateColumns: `160px ${chartWidth}px` }}>
                  <div className="border-r border-[#E8ECF0] bg-white px-3 py-2 font-medium text-[#374151]">{row.label}</div>
                  <div className="relative h-9">
                    {row.values.map((item, index) => (
                      <div
                        key={`${row.label}-${index}`}
                        className={cn('absolute top-0 flex h-full items-center justify-center border-r border-[#F1F5F9] px-1 text-[10px]', item.tone)}
                        style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                        title={formatUah(item.value)}
                      >
                        {formatMoney(item.value)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        {viewMode === 'list' && (
          <div className="overflow-x-auto rounded-md border border-[#E8ECF0]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F8F9FA] text-left text-[#6B7280]">
                <tr>
                  <th className="px-3 py-2">Дата</th>
                  {!isSupplyMode && <th className="px-3 py-2">Тип</th>}
                  <th className="px-3 py-2">Событие</th>
                  <th className="px-3 py-2">Категория</th>
                  <th className="px-3 py-2">Контрагент</th>
                  <th className="px-3 py-2">Завод</th>
                  <th className="px-3 py-2 text-right">Сумма</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={eventActionKey(event)} className="border-t border-[#E8ECF0]">
                    <td className="whitespace-nowrap px-3 py-2 text-[#1B3A6B]">{dateLabel(eventTimelineDate(event))}</td>
                    {!isSupplyMode && (
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={event.type === 'income' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}>
                          {event.type === 'income' ? 'Приход' : 'Расход'}
                        </Badge>
                      </td>
                    )}
                    <td className="px-3 py-2 font-medium text-[#1B3A6B]">{event.title}</td>
                    <td className="px-3 py-2">{event.category}</td>
                    <td className="px-3 py-2">{event.counterparty}</td>
                    <td className="px-3 py-2">{event.factoryName || '-'}</td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold', event.type === 'income' ? 'text-emerald-700' : 'text-red-700')}>
                      {event.type === 'income' ? '+' : '-'}{formatUah(event.remainingAmountUah)}
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className={statusClass[event.status]}>{statusLabels[event.status]}</Badge></td>
                    <td className="px-3 py-2">{event.responsibleName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
