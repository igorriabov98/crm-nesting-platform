"use server"

import { addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek, format, getDay, isAfter, isBefore, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { escapeHtml, sendTelegramMessage } from '@/lib/services/telegram'
import { getAppUrl } from '@/lib/config'
import { GENERAL_FINANCE_EXPENSE_CATEGORIES, SUPPLY_FINANCE_CATEGORIES, type GeneralFinanceExpenseCategory, type SupplyFinanceCategory } from '@/lib/constants/finance'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { recordInvoicePayment } from '@/lib/actions/invoices'
import { buildInvoicePaymentSchedule } from '@/lib/invoices/payment-schedule'
import type { TrustedDb } from '@/lib/supabase/trusted-db'
import type { PermissionOperation, ResourceKey } from '@/lib/permissions/resources'
import type { CurrentUser, UserRole } from '@/lib/types'

type FinanceEventType = 'income' | 'expense'
type FinanceExpenseStatus = 'planned' | 'partially_paid' | 'paid' | 'overdue' | 'rejected'
type FinanceRecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly'
type FinancePaymentPart = 'full' | 'prepayment' | 'final'
type FinanceCurrency = 'UAH' | 'EUR'

export type FinanceCalendarFilters = {
  start?: string | null
  end?: string | null
}

export type FinanceEvent = {
  id: string
  seriesId: string | null
  type: FinanceEventType
  title: string
  amount: number
  amountUah: number
  paidAmount: number
  paidAmountUah: number
  remainingAmount: number
  remainingAmountUah: number
  status: 'planned' | 'partially_paid' | 'paid' | 'overdue' | 'rejected'
  category: string
  counterparty: string
  currency: FinanceCurrency
  exchangeRate: number | null
  factoryId: string | null
  factoryName: string | null
  isSupplyPlan: boolean
  responsibleUserId: string | null
  responsibleName: string | null
  plannedDate: string
  originalPlannedDate: string | null
  rescheduledDate: string | null
  actualPaidDate: string | null
  paymentObligationDate: string | null
  bankProcessingStartDate: string | null
  bankProcessingEndDate: string | null
  cashArrivalDate: string
  paymentPart: FinancePaymentPart
  isForecast: boolean
  comment: string | null
  sourceHref: string | null
}

export type FinanceCalendarData = {
  events: FinanceEvent[]
  users: Array<{ id: string; full_name: string; role: UserRole; telegram_chat_id: string | null }>
  factories: Array<{ id: string; name: string }>
  budgetLimits: Array<{ category: SupplyFinanceCategory; monthlyLimitUah: number | null }>
  weeklySupplyReport: Array<{ weekStart: string; weekEnd: string; totalsByCategory: Record<SupplyFinanceCategory, number>; totalUah: number }>
  monthlySupplyReport: { month: string; totalsByCategory: Record<SupplyFinanceCategory, number>; totalUah: number }
  forecast: Array<{ date: string; income: number; expense: number; balance: number; isNegative: boolean }>
  currentBalanceUah: number
  nbuEurRate: number | null
  currentUserRole: UserRole
  summary: {
    expectedIncome: number
    expectedExpense: number
    overdueIncome: number
    overdueExpense: number
    forecastBalance: number
    attentionCount: number
  }
  range: { start: string; end: string }
}

type LooseDb = TrustedDb
type Relation<T> = T | T[] | null

type FinanceInvoiceRow = {
  id: string
  machine_id: string | null
  amount: number | null
  paid_amount: number | null
  invoice_date: string
  actual_paid_date: string | null
  payment_note: string | null
  finance_comment: string | null
  payment_terms_type_snapshot: string | null
  payment_due_days_snapshot: number | null
  prepayment_percent_snapshot: number | null
  final_payment_due_days_snapshot: number | null
  estimated_delivery_days_snapshot: number | null
  machine: Relation<{
    id: string
    name: string
    actual_shipping_date: string | null
    desired_shipping_date: string | null
    delivery_to_client_date: string | null
    factory_id: string | null
    factory: Relation<{ id: string; name: string }>
  }>
  updated_by_user: Relation<{ full_name: string | null }>
}

type FinanceExpenseRow = {
  id: string
  series_id: string | null
  title: string
  amount: number | null
  amount_uah: number | null
  category: string
  counterparty: string
  currency: string | null
  exchange_rate: number | null
  factory_id: string | null
  is_supply_plan: boolean | null
  responsible_user_id: string | null
  planned_date: string
  original_planned_date: string | null
  rescheduled_date: string | null
  actual_paid_date: string | null
  status: FinanceExpenseStatus
  paid_amount: number | null
  paid_amount_uah: number | null
  comment: string | null
  responsible: Relation<{ full_name: string | null }>
}

type ScrapIncomeRow = {
  id: string
  amount_uah: number | null
  payment_date: string
  status: string
  metal_scrap_sales: Relation<{
    factory_id: string | null
    buyer: string | null
    document_number: string | null
  }>
}

type FinanceExpenseMutationRow = {
  amount: number | null
  amount_uah: number | null
  currency: string | null
  exchange_rate: number | null
  is_supply_plan: boolean | null
  comment: string | null
  series_id: string | null
  planned_date: string
}

function relationOne<T>(value: Relation<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function isSupplyFinanceCategory(value: string): value is SupplyFinanceCategory {
  return (SUPPLY_FINANCE_CATEGORIES as readonly string[]).includes(value)
}

function isGeneralFinanceExpenseCategory(value: string): value is GeneralFinanceExpenseCategory {
  return (GENERAL_FINANCE_EXPENSE_CATEGORIES as readonly string[]).includes(value)
}

function emptyCategoryTotals() {
  return SUPPLY_FINANCE_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0
    return acc
  }, {} as Record<SupplyFinanceCategory, number>)
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function formatMoney(amount: number) {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const sign = safeAmount < 0 ? '-' : ''
  const [whole, fraction] = Math.abs(safeAmount).toFixed(2).split('.')
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`
}

function formatTelegramMoney(amount: number, currency: FinanceCurrency = 'UAH') {
  return `${formatMoney(amount)} ${currency === 'UAH' ? 'грн' : 'EUR'}`
}

function buildFinanceTelegramKeyboard(eventType: 'i' | 'e', eventId: string, href: string) {
  const appUrl = getAppUrl()
  if (eventType === 'i') {
    return { inline_keyboard: [[{ text: 'Открыть оплаты в CRM', url: `${appUrl}${href}` }]] }
  }
  return {
    inline_keyboard: [
      [
        { text: 'Подтвердить полностью', callback_data: `fin:paid:${eventType}:${eventId}` },
        { text: 'Частичная оплата', callback_data: `fin:partial:${eventType}:${eventId}` },
      ],
      [
        { text: 'Завтра', callback_data: `fin:post1:${eventType}:${eventId}` },
        { text: 'Через 3 дня', callback_data: `fin:post3:${eventType}:${eventId}` },
        { text: 'Через неделю', callback_data: `fin:post7:${eventType}:${eventId}` },
      ],
      [
        { text: 'Выбрать дату', callback_data: `fin:postc:${eventType}:${eventId}` },
        { text: 'Не подтвердить', callback_data: `fin:reject:${eventType}:${eventId}` },
      ],
      [{ text: 'Открыть в CRM', url: `${appUrl}${href}` }],
    ],
  }
}

async function getNbuEurRate() {
  try {
    const response = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?json&valcode=EUR', {
      next: { revalidate: 60 * 60 },
    })
    if (!response.ok) return null
    const data = await response.json() as Array<{ rate?: number }>
    const rate = Number(data?.[0]?.rate)
    return Number.isFinite(rate) && rate > 0 ? rate : null
  } catch {
    return null
  }
}

function convertToUah(amount: number, currency: FinanceCurrency, eurRate: number | null) {
  if (currency === 'UAH') return roundMoney(amount)
  if (!eurRate) throw new Error('Не удалось получить актуальный курс НБУ EUR')
  return roundMoney(amount * eurRate)
}

type FinanceResourceKey = Extract<ResourceKey, 'finance_calendar' | 'supply_finance'>

async function requireFinanceAccess(
  operation: PermissionOperation = 'view',
  resourceKey: FinanceResourceKey = 'finance_calendar'
) {
  await requirePermission(resourceKey, operation)
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !profile) throw new Error('Профиль не найден')
  const currentUser = profile as unknown as CurrentUser

  return { supabase, db: supabase as unknown as LooseDb, user: currentUser }
}

async function resolveSupplyExpenseResponsibleUserId(db: LooseDb, currentUser: CurrentUser) {
  if (currentUser.role === 'supply_manager') return currentUser.id

  const { data } = await db
    .from('users')
    .select('id')
    .eq('role', 'supply_manager')
    .eq('is_active', true)
    .order('full_name', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data as { id?: string } | null)?.id || currentUser.id
}

function nextYearRange(filters?: FinanceCalendarFilters) {
  const today = startOfDay(new Date())
  const start = filters?.start ? parseISO(filters.start) : addDays(today, -7)
  const end = filters?.end ? parseISO(filters.end) : addMonths(today, 12)
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  }
}

function expenseStatus(status: FinanceExpenseStatus, plannedDate: string): FinanceEvent['status'] {
  if ((status === 'planned' || status === 'partially_paid') && differenceInCalendarDays(new Date(), parseISO(plannedDate)) > 0) {
    return 'overdue'
  }
  return status
}

function buildForecast(events: FinanceEvent[], start: string, end: string, currentBalanceUah: number) {
  let balance = currentBalanceUah
  return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map((day) => {
    const date = format(day, 'yyyy-MM-dd')
    const dayEvents = events.filter((event) => {
      if (event.status === 'paid' || event.status === 'rejected') return false
      return event.type === 'income' ? event.cashArrivalDate === date : event.plannedDate === date
    })
    const income = dayEvents.filter((event) => event.type === 'income').reduce((sum, event) => sum + event.remainingAmountUah, 0)
    const expense = dayEvents.filter((event) => event.type === 'expense').reduce((sum, event) => sum + event.remainingAmountUah, 0)
    balance += income - expense
    return { date, income, expense, balance, isNegative: balance < 0 }
  })
}

function addCalendarDays(value: string, days: number) {
  return format(addDays(parseISO(value), days), 'yyyy-MM-dd')
}

function paymentWindow(paymentObligationDate: string | null) {
  const bankProcessingStartDate = paymentObligationDate ? addCalendarDays(paymentObligationDate, 1) : null
  const bankProcessingEndDate = paymentObligationDate ? addCalendarDays(paymentObligationDate, 3) : null

  return {
    bankProcessingStartDate,
    bankProcessingEndDate,
    cashArrivalDate: bankProcessingEndDate || paymentObligationDate || format(new Date(), 'yyyy-MM-dd'),
  }
}

function buildInvoiceFinanceEvents(invoice: FinanceInvoiceRow, range: { start: string; end: string }, eurRate: number | null): FinanceEvent[] {
  const amount = Number(invoice.amount || 0)
  const totalPaidAmount = Number(invoice.paid_amount || 0)
  const machine = relationOne(invoice.machine)
  const factory = relationOne(machine?.factory)
  const updatedBy = relationOne(invoice.updated_by_user)
  const baseTitle = machine?.name ? `Приход: ${machine.name}` : 'Планируемый приход'
  const schedule = buildInvoicePaymentSchedule({
    amount,
    paidAmount: totalPaidAmount,
    invoiceDate: invoice.invoice_date,
    paymentTermsType: invoice.payment_terms_type_snapshot,
    paymentDueDays: invoice.payment_due_days_snapshot,
    prepaymentPercent: invoice.prepayment_percent_snapshot,
    finalPaymentDueDays: invoice.final_payment_due_days_snapshot,
    estimatedDeliveryDays: invoice.estimated_delivery_days_snapshot,
    deliveryToClientDate: machine?.delivery_to_client_date,
    actualShippingDate: machine?.actual_shipping_date,
    desiredShippingDate: machine?.desired_shipping_date,
  })

  return schedule.flatMap((part): FinanceEvent[] => {
    if (!part.dueDate) return []
    const paymentDates = paymentWindow(part.dueDate)
    const plannedDate = part.dueDate
    if (isBefore(parseISO(paymentDates.cashArrivalDate), parseISO(range.start)) || isAfter(parseISO(paymentDates.cashArrivalDate), parseISO(range.end))) return []
    const amountUah = eurRate ? convertToUah(part.amount, 'EUR', eurRate) : part.amount
    const paidAmountUah = eurRate ? convertToUah(part.paidAmount, 'EUR', eurRate) : part.paidAmount
    const status: FinanceEvent['status'] = part.remainingAmount <= 0
      ? 'paid'
      : part.isOverdue
        ? 'overdue'
        : part.paidAmount > 0
          ? 'partially_paid'
          : 'planned'

    return [{
      id: invoice.id,
      seriesId: null,
      type: 'income',
      title: part.part === 'prepayment' ? `${baseTitle} (предоплата)` : part.part === 'final' ? `${baseTitle} (остаток)` : baseTitle,
      amount: part.amount,
      amountUah,
      paidAmount: part.paidAmount,
      paidAmountUah,
      remainingAmount: part.remainingAmount,
      remainingAmountUah: Math.max(0, amountUah - paidAmountUah),
      status,
      category: 'Инвойс',
      counterparty: machine?.name || 'Клиент',
      currency: 'EUR',
      exchangeRate: eurRate,
      factoryId: machine?.factory_id || null,
      factoryName: factory?.name || null,
      isSupplyPlan: false,
      responsibleUserId: null,
      responsibleName: updatedBy?.full_name || null,
      plannedDate,
      originalPlannedDate: part.dueDate,
      rescheduledDate: null,
      actualPaidDate: invoice.actual_paid_date,
      paymentObligationDate: part.dueDate,
      bankProcessingStartDate: paymentDates.bankProcessingStartDate,
      bankProcessingEndDate: paymentDates.bankProcessingEndDate,
      cashArrivalDate: paymentDates.cashArrivalDate,
      paymentPart: part.part,
      isForecast: part.isForecast,
      comment: invoice.finance_comment || invoice.payment_note,
      sourceHref: invoice.machine_id ? `${ROUTES.SALES_PLAN}/${invoice.machine_id}` : ROUTES.INVOICES,
    }]
  })
}

export async function getFinanceCalendarData(
  filters?: FinanceCalendarFilters,
  resourceKey: FinanceResourceKey = 'finance_calendar'
): Promise<FinanceCalendarData> {
  const { db, user } = await requireFinanceAccess('view', resourceKey)
  await db.rpc('check_daily_finance_overdue')

  const range = nextYearRange(filters)
  const currentMonthStart = startOfMonth(new Date())
  const currentMonthEnd = endOfMonth(currentMonthStart)
  const nbuEurRatePromise = getNbuEurRate()
  const [invoicesResult, expensesResult, scrapIncomeResult, usersResult, factoriesResult, budgetsResult, settingsResult, nbuEurRate] = await Promise.all([
    db
      .from('invoices')
      .select(`
        id,
        machine_id,
        amount,
        status,
        invoice_date,
        payment_date,
        due_date,
        paid_amount,
        balance_due_date,
        payment_note,
        original_planned_date,
        rescheduled_date,
        actual_paid_date,
        finance_comment,
        payment_terms_type_snapshot,
        payment_due_days_snapshot,
        prepayment_percent_snapshot,
        final_payment_due_days_snapshot,
        estimated_delivery_days_snapshot,
        machine:machines(
          id,
          name,
          actual_shipping_date,
          desired_shipping_date,
          delivery_to_client_date,
          factory_id,
          factory:factories(id, name)
        ),
        updated_by_user:users!invoices_updated_by_fkey(full_name)
      `)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true }),
    db
      .from('finance_expenses')
      .select(`
        id,
        series_id,
        title,
        amount,
        amount_uah,
        category,
        counterparty,
        currency,
        exchange_rate,
        factory_id,
        is_supply_plan,
        responsible_user_id,
        planned_date,
        original_planned_date,
        rescheduled_date,
        actual_paid_date,
        status,
        paid_amount,
        paid_amount_uah,
        comment,
        responsible:users!finance_expenses_responsible_user_id_fkey(full_name)
      `)
      .gte('planned_date', range.start)
      .lte('planned_date', range.end)
      .order('planned_date', { ascending: true }),
    db
      .from('metal_scrap_finance_incomes')
      .select('id,sale_id,amount_uah,payment_date,status,metal_scrap_sales(factory_id,buyer,document_number)')
      .gte('payment_date', range.start)
      .lte('payment_date', range.end)
      .order('payment_date', { ascending: true }),
    db
      .from('users')
      .select('id, full_name, role, telegram_chat_id')
      .eq('is_active', true)
      .order('full_name'),
    db
      .from('factories')
      .select('id, name')
      .order('name'),
    db
      .from('finance_budget_limits')
      .select('category, monthly_limit_uah'),
    db
      .from('finance_settings')
      .select('key, value_numeric')
      .eq('key', 'current_balance_uah')
      .maybeSingle(),
    nbuEurRatePromise,
  ])

  if (invoicesResult.error) throw new Error(invoicesResult.error.message)
  if (expensesResult.error) throw new Error(expensesResult.error.message)
  if (scrapIncomeResult.error) throw new Error(scrapIncomeResult.error.message)
  if (usersResult.error) throw new Error(usersResult.error.message)
  if (factoriesResult.error) throw new Error(factoriesResult.error.message)
  if (budgetsResult.error) throw new Error(budgetsResult.error.message)
  if (settingsResult.error) throw new Error(settingsResult.error.message)

  const invoices = ((invoicesResult.data || []) as FinanceInvoiceRow[])
    .flatMap((invoice) => buildInvoiceFinanceEvents(invoice, range, nbuEurRate))

  const factoryNameById = new Map(((factoriesResult.data || []) as Array<{ id: string; name: string }>).map((factory) => [factory.id, factory.name]))
  const expenses = ((expensesResult.data || []) as FinanceExpenseRow[]).map((expense): FinanceEvent => {
    const responsible = relationOne(expense.responsible)
    const amount = Number(expense.amount || 0)
    const currency = (expense.currency || 'EUR') as FinanceCurrency
    const expenseRate = Number(expense.exchange_rate || 0) || nbuEurRate
    const amountUah = Number(expense.amount_uah || 0) || (currency === 'EUR' && !expenseRate ? amount : convertToUah(amount, currency, expenseRate))
    const paidAmount = Number(expense.paid_amount || 0)
    const paidAmountUah = Number(expense.paid_amount_uah || 0)
    return {
      id: expense.id,
      seriesId: expense.series_id || null,
      type: 'expense',
      title: expense.title,
      amount,
      amountUah,
      paidAmount,
      paidAmountUah,
      remainingAmount: Math.max(0, amount - paidAmount),
      remainingAmountUah: Math.max(0, amountUah - paidAmountUah),
      status: expenseStatus(expense.status, expense.planned_date),
      category: expense.category,
      counterparty: expense.counterparty,
      currency,
      exchangeRate: expense.exchange_rate ? Number(expense.exchange_rate) : null,
      factoryId: expense.factory_id || null,
      factoryName: expense.factory_id ? factoryNameById.get(expense.factory_id) || null : null,
      isSupplyPlan: expense.is_supply_plan === true || isSupplyFinanceCategory(expense.category),
      responsibleUserId: expense.responsible_user_id,
      responsibleName: responsible?.full_name || null,
      plannedDate: expense.planned_date,
      originalPlannedDate: expense.original_planned_date,
      rescheduledDate: expense.rescheduled_date,
      actualPaidDate: expense.actual_paid_date,
      paymentObligationDate: null,
      bankProcessingStartDate: null,
      bankProcessingEndDate: null,
      cashArrivalDate: expense.planned_date,
      paymentPart: 'full',
      isForecast: false,
      comment: expense.comment,
      sourceHref: null,
    }
  })

  const scrapIncomes = ((scrapIncomeResult.data || []) as ScrapIncomeRow[])
    .filter((income) => income.status === 'paid')
    .map((income): FinanceEvent => {
      const sale = relationOne(income.metal_scrap_sales)
      return ({
      id: `scrap-${income.id}`, seriesId: null, type: 'income', title: 'Сдача металлолома',
      amount: Number(income.amount_uah), amountUah: Number(income.amount_uah), paidAmount: Number(income.amount_uah), paidAmountUah: Number(income.amount_uah),
      remainingAmount: 0, remainingAmountUah: 0, status: 'paid', category: 'Металлолом', counterparty: sale?.buyer || 'Покупатель металлолома',
      currency: 'UAH', exchangeRate: null, factoryId: sale?.factory_id || null,
      factoryName: sale?.factory_id ? factoryNameById.get(sale.factory_id) || null : null,
      isSupplyPlan: false, responsibleUserId: null, responsibleName: null, plannedDate: income.payment_date,
      originalPlannedDate: null, rescheduledDate: null, actualPaidDate: income.payment_date, paymentObligationDate: income.payment_date,
      bankProcessingStartDate: null, bankProcessingEndDate: null, cashArrivalDate: income.payment_date, paymentPart: 'full',
      isForecast: false,
      comment: sale?.document_number ? `Документ: ${sale.document_number}` : null,
      sourceHref: ROUTES.INVENTORY_METAL_SCRAP,
    })})

  const events = [...invoices, ...scrapIncomes, ...expenses].sort((a, b) => {
    const aDate = a.type === 'income' ? a.cashArrivalDate : a.plannedDate
    const bDate = b.type === 'income' ? b.cashArrivalDate : b.plannedDate
    return aDate.localeCompare(bDate)
  })
  const users = (usersResult.data || []) as FinanceCalendarData['users']
  const factories = (factoriesResult.data || []) as FinanceCalendarData['factories']
  const budgetMap = new Map(((budgetsResult.data || []) as Array<{ category: string; monthly_limit_uah: number | null }>).map((row) => [row.category, row.monthly_limit_uah === null ? null : Number(row.monthly_limit_uah)]))
  const budgetLimits = SUPPLY_FINANCE_CATEGORIES.map((category) => ({
    category,
    monthlyLimitUah: budgetMap.has(category) ? budgetMap.get(category) ?? null : null,
  }))
  const currentBalanceUah = Number((settingsResult.data as { value_numeric?: number | null } | null)?.value_numeric || 0)
  const forecast = buildForecast(events, range.start, range.end, currentBalanceUah)
  const supplyMonthEvents = events.filter((event) =>
    event.type === 'expense' &&
    event.isSupplyPlan &&
    !['paid', 'rejected'].includes(event.status) &&
    !isBefore(parseISO(event.plannedDate), currentMonthStart) &&
    !isAfter(parseISO(event.plannedDate), currentMonthEnd)
  )
  const monthlyTotals = emptyCategoryTotals()
  supplyMonthEvents.forEach((event) => {
    if (isSupplyFinanceCategory(event.category)) monthlyTotals[event.category] += event.remainingAmountUah
  })
  const weeklySupplyReport = eachDayOfInterval({
    start: startOfWeek(currentMonthStart, { weekStartsOn: 1 }),
    end: endOfWeek(currentMonthEnd, { weekStartsOn: 1 }),
  })
    .filter((day) => getDay(day) === 1)
    .map((weekStartDate) => {
      const weekEndDate = endOfWeek(weekStartDate, { weekStartsOn: 1 })
      const totalsByCategory = emptyCategoryTotals()
      supplyMonthEvents.forEach((event) => {
        const plannedDate = parseISO(event.plannedDate)
        if (!isBefore(plannedDate, weekStartDate) && !isAfter(plannedDate, weekEndDate) && isSupplyFinanceCategory(event.category)) {
          totalsByCategory[event.category] += event.remainingAmountUah
        }
      })
      return {
        weekStart: format(weekStartDate, 'yyyy-MM-dd'),
        weekEnd: format(weekEndDate, 'yyyy-MM-dd'),
        totalsByCategory,
        totalUah: Object.values(totalsByCategory).reduce((sum, value) => sum + value, 0),
      }
    })

  const summary = {
    expectedIncome: events.filter((event) => event.type === 'income' && event.status !== 'paid' && event.status !== 'rejected').reduce((sum, event) => sum + event.remainingAmountUah, 0),
    expectedExpense: events.filter((event) => event.type === 'expense' && event.status !== 'paid' && event.status !== 'rejected').reduce((sum, event) => sum + event.remainingAmountUah, 0),
    overdueIncome: events.filter((event) => event.type === 'income' && event.status === 'overdue').reduce((sum, event) => sum + event.remainingAmountUah, 0),
    overdueExpense: events.filter((event) => event.type === 'expense' && event.status === 'overdue').reduce((sum, event) => sum + event.remainingAmountUah, 0),
    forecastBalance: forecast.at(-1)?.balance || 0,
    attentionCount: events.filter((event) => event.status === 'overdue' || event.status === 'partially_paid').length,
  }

  return {
    events,
    users,
    factories,
    budgetLimits,
    weeklySupplyReport,
    monthlySupplyReport: {
      month: format(currentMonthStart, 'yyyy-MM'),
      totalsByCategory: monthlyTotals,
      totalUah: Object.values(monthlyTotals).reduce((sum, value) => sum + value, 0),
    },
    forecast,
    currentBalanceUah,
    nbuEurRate,
    currentUserRole: user.role,
    summary,
    range,
  }
}

export async function getSupplyFinanceData(filters?: FinanceCalendarFilters): Promise<FinanceCalendarData> {
  const data = await getFinanceCalendarData(filters, 'supply_finance')
  const events = data.events.filter((event) => event.type === 'expense' && event.isSupplyPlan)
  const forecast = buildForecast(events, data.range.start, data.range.end, data.currentBalanceUah)

  return {
    ...data,
    events,
    forecast,
    summary: {
      expectedIncome: 0,
      expectedExpense: events.filter((event) => event.status !== 'paid' && event.status !== 'rejected').reduce((sum, event) => sum + event.remainingAmountUah, 0),
      overdueIncome: 0,
      overdueExpense: events.filter((event) => event.status === 'overdue').reduce((sum, event) => sum + event.remainingAmountUah, 0),
      forecastBalance: forecast.at(-1)?.balance || data.currentBalanceUah,
      attentionCount: events.filter((event) => event.status === 'overdue' || event.status === 'partially_paid').length,
    },
  }
}

function generateExpenseDates(input: {
  startDate: string
  recurring: boolean
  frequency?: FinanceRecurrenceFrequency
  weekdays?: number[]
  monthDays?: number[]
}) {
  if (!input.recurring) return [input.startDate]

  const start = parseISO(input.startDate)
  const end = addMonths(start, 12)
  const dates: string[] = []
  const weekdays = new Set(input.weekdays || [])
  const monthDays = new Set(input.monthDays || [])

  for (const day of eachDayOfInterval({ start, end })) {
    const iso = format(day, 'yyyy-MM-dd')
    if (input.frequency === 'weekly') {
      const weekday = getDay(day) === 0 ? 7 : getDay(day)
      if (weekdays.has(weekday)) dates.push(iso)
      continue
    }

    if (input.frequency === 'monthly') {
      if (monthDays.has(day.getDate())) dates.push(iso)
      continue
    }

    if (input.frequency === 'quarterly') {
      const monthDelta = (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth()
      if (monthDelta % 3 === 0 && monthDays.has(day.getDate())) dates.push(iso)
    }
  }

  return dates.slice(0, 120)
}

export async function createFinanceExpense(input: {
  title: string
  amount: number
  category: string
  counterparty: string
  currency?: FinanceCurrency
  factoryId?: string | null
  responsibleUserId?: string | null
  plannedDate: string
  recurring: boolean
  frequency?: FinanceRecurrenceFrequency
  weekdays?: number[]
  monthDays?: number[]
}) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    if (!input.title.trim()) throw new Error('Введите название расхода')
    if (!input.category.trim()) throw new Error('Введите категорию')
    if (!input.counterparty.trim()) throw new Error('Введите контрагента')
    if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) throw new Error('Введите корректную сумму')

    if (!isSupplyFinanceCategory(input.category)) throw new Error('Выберите категорию финансового плана снабжения')
    if (!input.factoryId) throw new Error('Выберите завод для оплаты')

    const currency = input.currency || 'EUR'
    const amount = Number(input.amount)
    const exchangeRate = currency === 'EUR' ? await getNbuEurRate() : null
    const amountUah = convertToUah(amount, currency, exchangeRate)
    const defaultResponsible = await resolveSupplyExpenseResponsibleUserId(db, user)
    const dates = generateExpenseDates({
      startDate: input.plannedDate,
      recurring: input.recurring,
      frequency: input.frequency,
      weekdays: input.weekdays,
      monthDays: input.monthDays,
    })
    let seriesId: string | null = null

    if (input.recurring) {
      const seriesResult = await db.from('finance_expense_series').insert({
        title: input.title.trim(),
        amount,
        amount_uah: amountUah,
        category: input.category.trim(),
        counterparty: input.counterparty.trim(),
        currency,
        exchange_rate: exchangeRate,
        factory_id: input.factoryId,
        is_supply_plan: true,
        responsible_user_id: defaultResponsible,
        frequency: input.frequency || 'monthly',
        weekdays: input.weekdays || [],
        month_days: input.monthDays || [],
        start_date: input.plannedDate,
        end_date: dates.at(-1) || input.plannedDate,
        created_by: user.id,
      }).select('id').single()
      if (seriesResult.error) throw new Error(seriesResult.error.message)
      seriesId = (seriesResult.data as { id: string }).id
    }

    const rows = dates.map((plannedDate) => ({
      series_id: seriesId,
      title: input.title.trim(),
      amount,
      amount_uah: amountUah,
      category: input.category.trim(),
      counterparty: input.counterparty.trim(),
      currency,
      exchange_rate: exchangeRate,
      factory_id: input.factoryId,
      is_supply_plan: true,
      responsible_user_id: defaultResponsible,
      planned_date: plannedDate,
      original_planned_date: plannedDate,
      created_by: user.id,
      updated_by: user.id,
    }))

    const { error } = await db.from('finance_expenses').insert(rows)
    if (error) throw new Error(error.message)

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    return { success: true, count: rows.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать расход' }
  }
}

export async function createGeneralFinanceExpense(input: {
  title: string
  amount: number
  category: string
  counterparty: string
  currency?: FinanceCurrency
  factoryId?: string | null
  plannedDate: string
}) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    if (!input.title.trim()) throw new Error('Введите название расхода')
    if (!isGeneralFinanceExpenseCategory(input.category)) throw new Error('Выберите категорию расхода')
    if (!input.counterparty.trim()) throw new Error('Введите контрагента')
    if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) throw new Error('Введите корректную сумму')

    const currency = input.currency || 'UAH'
    const amount = Number(input.amount)
    const exchangeRate = currency === 'EUR' ? await getNbuEurRate() : null
    const amountUah = convertToUah(amount, currency, exchangeRate)

    const { error } = await db.from('finance_expenses').insert({
      title: input.title.trim(),
      amount,
      amount_uah: amountUah,
      category: input.category,
      counterparty: input.counterparty.trim(),
      currency,
      exchange_rate: exchangeRate,
      factory_id: input.factoryId || null,
      is_supply_plan: false,
      responsible_user_id: user.id,
      planned_date: input.plannedDate,
      original_planned_date: input.plannedDate,
      created_by: user.id,
      updated_by: user.id,
    })

    if (error) throw new Error(error.message)

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать расход' }
  }
}

async function logFinanceAction(db: LooseDb, values: Record<string, unknown>) {
  const { error } = await db.from('finance_event_actions').insert(values)
  if (error) throw new Error(error.message)
}

export async function updateFinanceExpense(
  expenseId: string,
  input: { action: 'paid' | 'partial' | 'postpone' | 'reject'; amount?: number; date?: string; comment?: string; applyToFuture?: boolean }
) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    const currentResult = await db.from('finance_expenses').select('*').eq('id', expenseId).single()
    if (currentResult.error || !currentResult.data) throw new Error('Расход не найден')
    const current = currentResult.data as FinanceExpenseMutationRow
    if (user.role === 'supply_manager' && current.is_supply_plan !== true) {
      throw new Error('Снабжение может менять только свои плановые расходы')
    }

    const update: Record<string, unknown> = { updated_by: user.id }
    if (input.action === 'paid') {
      update.status = 'paid'
      update.paid_amount = current.amount
      update.paid_amount_uah = Number(current.amount_uah || current.amount || 0)
      update.actual_paid_date = input.date || format(new Date(), 'yyyy-MM-dd')
    } else if (input.action === 'partial') {
      const amount = Number(input.amount || 0)
      const currency = (current.currency || 'EUR') as FinanceCurrency
      const exchangeRate = currency === 'EUR' ? Number(current.exchange_rate || 0) || await getNbuEurRate() : null
      if (amount <= 0 || amount > Number(current.amount)) throw new Error('Некорректная сумма частичной оплаты')
      update.status = amount >= Number(current.amount) ? 'paid' : 'partially_paid'
      update.paid_amount = amount
      update.paid_amount_uah = amount >= Number(current.amount)
        ? Number(current.amount_uah || 0)
        : convertToUah(amount, currency, exchangeRate)
      update.actual_paid_date = amount >= Number(current.amount) ? (input.date || format(new Date(), 'yyyy-MM-dd')) : null
    } else if (input.action === 'postpone') {
      if (!input.date) throw new Error('Выберите дату переноса')
      update.planned_date = input.date
      update.rescheduled_date = input.date
      update.comment = input.comment || current.comment
      update.status = 'planned'
    } else if (input.action === 'reject') {
      update.status = 'rejected'
      update.comment = input.comment || current.comment
    }

    const { error } = await db.from('finance_expenses').update(update).eq('id', expenseId)
    if (error) throw new Error(error.message)

    if (input.action === 'postpone' && input.applyToFuture && current.series_id && input.date) {
      const deltaDays = differenceInCalendarDays(parseISO(input.date), parseISO(current.planned_date))
      const futureResult = await db
        .from('finance_expenses')
        .select('id, planned_date')
        .eq('series_id', current.series_id)
        .gt('planned_date', current.planned_date)
        .in('status', ['planned', 'partially_paid', 'overdue'])

      if (futureResult.error) throw new Error(futureResult.error.message)

      for (const row of (futureResult.data || []) as Array<{ id: string; planned_date: string }>) {
        const nextDate = format(addDays(parseISO(row.planned_date), deltaDays), 'yyyy-MM-dd')
        await db
          .from('finance_expenses')
          .update({
            planned_date: nextDate,
            rescheduled_date: nextDate,
            updated_by: user.id,
          })
          .eq('id', row.id)
      }
    }

    await logFinanceAction(db, {
      event_type: 'expense',
      event_id: expenseId,
      action: input.action,
      previous_planned_date: current.planned_date,
      new_planned_date: input.action === 'postpone' ? input.date : null,
      amount: input.amount ?? null,
      comment: input.comment ?? null,
      performed_by: user.id,
      performed_via: 'crm',
    })

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить расход' }
  }
}

export async function updateFinanceIncome(
  invoiceId: string,
  input: { action: 'paid' | 'partial' | 'postpone' | 'reject'; amount?: number; date?: string; comment?: string }
) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    const currentResult = await db.from('invoices').select('*').eq('id', invoiceId).single()
    if (currentResult.error || !currentResult.data) throw new Error('Приход не найден')
    const current = currentResult.data as {
      amount: number | null
      paid_amount: number | null
      rescheduled_date: string | null
      due_date: string | null
      payment_date: string | null
    }
    const amount = Number(current.amount || 0)
    const remainingAmount = Math.max(0, amount - Number(current.paid_amount || 0))
    if (input.action === 'postpone' || input.action === 'reject') {
      throw new Error('Срок и статус инвойса рассчитываются автоматически по зафиксированным условиям оплаты')
    }
    const paymentAmount = Number(input.amount || (input.action === 'paid' ? remainingAmount : 0))
    if (paymentAmount <= 0 || paymentAmount > remainingAmount) throw new Error('Некорректная сумма оплаты')
    const paymentResult = await recordInvoicePayment({
      invoiceId,
      amount: paymentAmount,
      paidOn: input.date || format(new Date(), 'yyyy-MM-dd'),
      note: input.comment || 'Добавлено из финансового календаря',
    })
    if (!paymentResult.success) throw new Error(paymentResult.error || 'Не удалось сохранить оплату')

    await logFinanceAction(db, {
      event_type: 'income',
      event_id: invoiceId,
      action: input.action,
      previous_planned_date: current.rescheduled_date || current.due_date || current.payment_date,
      new_planned_date: null,
      amount: paymentAmount,
      comment: input.comment ?? null,
      performed_by: user.id,
      performed_via: 'crm',
    })

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    revalidatePath(ROUTES.INVOICES)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить приход' }
  }
}

export async function sendFinanceTelegramTestMessage(input?: { eventType?: FinanceEventType; eventId?: string }) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    if (!user.telegram_chat_id?.trim()) throw new Error('У пользователя не заполнен Telegram Chat ID')

    if (!input?.eventType || !input.eventId) {
      const response = await sendTelegramMessage(
        user.telegram_chat_id,
        'Тестовое сообщение из финансового плана CRM. Если вы видите это сообщение, Telegram-уведомления работают.'
      )
      if (!response.ok) throw new Error(response.error || 'Telegram не доставил сообщение')
      return { success: true }
    }

    let event: {
      eventType: FinanceEventType
      keyboardType: 'i' | 'e'
      id: string
      href: string
      plannedDate: string
      title: string
      amount: number
      currency: FinanceCurrency
    } | null = null

    if (input.eventType === 'income') {
      const { data, error } = await db
        .from('invoices')
        .select('id, machine_id, amount, paid_amount, status, payment_date, due_date, rescheduled_date, machine:machines(name)')
        .eq('id', input.eventId)
        .single()
      if (error || !data) throw new Error('Приход не найден')
      const invoice = data as {
        id: string
        machine_id: string | null
        amount: number | null
        paid_amount: number | null
        payment_date: string
        due_date: string | null
        rescheduled_date: string | null
        machine: Relation<{ name: string }>
      }
      const machine = relationOne(invoice.machine)
      const amount = Number(invoice.amount || 0) - Number(invoice.paid_amount || 0)
      event = {
        eventType: 'income',
        keyboardType: 'i',
        id: invoice.id,
        href: invoice.machine_id ? `${ROUTES.SALES_PLAN}/${invoice.machine_id}` : ROUTES.INVOICES,
        plannedDate: invoice.rescheduled_date || invoice.due_date || invoice.payment_date,
        title: machine?.name || 'Планируемый приход',
        amount,
        currency: 'EUR',
      }
    } else if (input.eventType === 'expense') {
      const { data, error } = await db
        .from('finance_expenses')
        .select('id, title, amount, paid_amount, currency, planned_date, counterparty')
        .eq('id', input.eventId)
        .single()
      if (error || !data) throw new Error('Расход не найден')
      const expense = data as {
        id: string
        title: string
        amount: number | null
        paid_amount: number | null
        currency: string | null
        planned_date: string
        counterparty: string | null
      }
      const amount = Number(expense.amount || 0) - Number(expense.paid_amount || 0)
      event = {
        eventType: 'expense',
        keyboardType: 'e',
        id: expense.id,
        href: ROUTES.FINANCE_CALENDAR,
        plannedDate: expense.planned_date,
        title: `${expense.title}${expense.counterparty ? ` · ${expense.counterparty}` : ''}`,
        amount,
        currency: (expense.currency || 'UAH') as FinanceCurrency,
      }
    }

    if (!event) throw new Error('Финансовое событие не найдено')
    if (!event.plannedDate) throw new Error('У события не заполнена дата')
    if (event.amount <= 0) throw new Error('По событию нет суммы к подтверждению')

    const text =
      `${event.eventType === 'income' ? 'Планируемый приход не подтвержден' : 'Планируемый расход не подтвержден'}\n\n` +
      `Событие: <b>${escapeHtml(event.title)}</b>\n` +
      `Дата: <b>${escapeHtml(event.plannedDate)}</b>\n` +
      `Сумма: <b>${escapeHtml(formatTelegramMoney(event.amount, event.currency))}</b>`

    const response = await sendTelegramMessage(user.telegram_chat_id, text, {
      replyMarkup: buildFinanceTelegramKeyboard(event.keyboardType, event.id, event.href),
    })

    if (!response.ok) throw new Error(response.error || 'Telegram не доставил сообщение')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отправить тестовое сообщение' }
  }
}

export async function saveFinanceBudgetLimits(input: Array<{ category: SupplyFinanceCategory; monthlyLimitUah: number | null }>) {
  try {
    const { db, user } = await requireFinanceAccess('manage')

    const rows = input
      .filter((item) => isSupplyFinanceCategory(item.category))
      .map((item) => ({
        category: item.category,
        monthly_limit_uah: item.monthlyLimitUah === null ? null : Number(item.monthlyLimitUah),
        updated_by: user.id,
      }))

    const { error } = await db
      .from('finance_budget_limits')
      .upsert(rows, { onConflict: 'category' })

    if (error) throw new Error(error.message)

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить нормы бюджета' }
  }
}

export async function saveFinanceCurrentBalance(amountUah: number) {
  try {
    const { db, user } = await requireFinanceAccess('manage')
    if (!Number.isFinite(Number(amountUah))) throw new Error('Введите корректный текущий остаток')

    const { error } = await db
      .from('finance_settings')
      .upsert({
        key: 'current_balance_uah',
        value_numeric: Number(amountUah),
        updated_by: user.id,
      }, { onConflict: 'key' })

    if (error) throw new Error(error.message)

    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить текущий остаток' }
  }
}
