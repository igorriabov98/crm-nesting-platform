import type { ActiveMaterialCategory } from '@/lib/constants/procurement'

export const SUPPLY_POSITION_TABLES = [
  'request_sheet_metal',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_paint',
  'request_components',
  'request_mesh',
  'request_chain_cord',
] as const

export type SupplyPositionTable = typeof SUPPLY_POSITION_TABLES[number]

export type SupplyPositionRef = {
  requestItemTable: SupplyPositionTable
  requestItemId: string
}

export type SupplyPositionRevisionStatus = 'requested' | 'editing' | 'stock_check' | 'submitted'

export type SupplyPositionRevisionSummary = {
  id: string
  source_request_item_table: SupplyPositionTable
  source_request_item_id: string
  category: ActiveMaterialCategory
  status: SupplyPositionRevisionStatus
  reason: string
  department_request_id: string
  replacement_request_id: string | null
  replacement_request_item_id: string | null
}

export type SupplyPositionReturnBlockerCode =
  | 'POSITION_CLOSED'
  | 'RECEIPT_EXISTS'
  | 'TRANSPORT_STARTED'
  | 'FINANCE_PAID'
  | 'FINANCE_SHARED'
  | 'FINANCE_AMBIGUOUS'
  | 'RETURN_ALREADY_OPEN'

export type SupplyPositionReturnBlocker = {
  code: SupplyPositionReturnBlockerCode
  message: string
}

export type SupplyPositionReturnPreview = {
  eligible: boolean
  mode: 'standard' | 'long_stock_recalculation'
  blockers: SupplyPositionReturnBlocker[]
  requires_external_order_confirmation: boolean
  existing_revision_id: string | null
  existing_department_request_id: string | null
  request_id: string
  machine_id: string
  impacts: {
    schedules_to_cancel: number
    reservations_to_release: number
    trips_to_detach: number
    finance_expenses_to_reject: number
  }
}

export const SUPPLY_POSITION_RETURN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_POSITION_REF: 'Недопустимая категория позиции',
  POSITION_NOT_FOUND: 'Позиция снабжения не найдена',
  POSITION_CLOSED: 'Полученную или отменённую позицию вернуть нельзя',
  RECEIPT_EXISTS: 'По позиции уже есть приёмка или фактическое распределение',
  TRANSPORT_STARTED: 'Связанный рейс уже отправлен или завершён',
  FINANCE_PAID: 'Связанный расход уже частично или полностью оплачен',
  FINANCE_SHARED: 'Финансовый расход объединяет эту позицию с другими',
  FINANCE_AMBIGUOUS: 'Финансовую связь старых данных нельзя определить однозначно',
  RETURN_ALREADY_OPEN: 'Позиция уже возвращена технологу',
  EXTERNAL_ORDER_CONFIRMATION_REQUIRED: 'Подтвердите отмену внешнего заказа поставщику',
  REVISION_FORBIDDEN: 'Исправить позицию может назначенный технолог или руководитель',
  REVISION_STRUCTURE_LOCKED: 'В корректирующей заявке должна остаться ровно одна позиция',
  REVISION_CATEGORY_LOCKED: 'Категорию корректирующей позиции менять нельзя',
  STOCK_CHECK_REQUIRED: 'Сначала выполните повторную проверку и резервирование склада',
}

export function isSupplyPositionTable(value: string): value is SupplyPositionTable {
  return (SUPPLY_POSITION_TABLES as readonly string[]).includes(value)
}

export function supplyPositionRevisionKey(table: string, id: string) {
  return `${table}:${id}`
}

export function supplyPositionReturnError(error: { message?: string } | null | undefined, fallback: string) {
  const raw = String(error?.message || '').trim()
  const match = raw.match(/\[([A-Z_]+)]\s*(.*)/)
  if (!match) return { code: null, message: raw || fallback }
  return {
    code: match[1],
    message: match[2] || SUPPLY_POSITION_RETURN_ERROR_MESSAGES[match[1]] || fallback,
  }
}
