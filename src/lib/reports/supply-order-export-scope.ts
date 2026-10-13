import { z } from 'zod'

import type { SupplyOrderExportScope } from '@/lib/reports/supply-date-order-selection'

const dateSchema = z.string().date()

export class InvalidSupplyOrderExportScopeError extends Error {}

export function parseSupplyOrderExportScope(params: URLSearchParams): SupplyOrderExportScope {
  const keys = ['date', 'from', 'to', 'machine'] as const
  if (keys.some((key) => params.getAll(key).length > 1)) {
    throw new InvalidSupplyOrderExportScopeError('Укажите один способ формирования заказа')
  }
  const date = params.get('date')
  const from = params.get('from')
  const to = params.get('to')
  const machine = params.get('machine')
  const modes = Number(date !== null) + Number(from !== null || to !== null) + Number(machine !== null)
  if (modes !== 1) throw new InvalidSupplyOrderExportScopeError('Укажите одну дату, период или заказ клиента')
  if (date !== null) return { kind: 'date', dateKey: z.union([z.literal('no_supply_date'), dateSchema]).parse(date) }
  if (machine !== null) return { kind: 'machine', machineId: z.string().uuid().parse(machine) }
  const validFrom = dateSchema.parse(from)
  const validTo = dateSchema.parse(to)
  if (validFrom > validTo) throw new InvalidSupplyOrderExportScopeError('Дата начала периода позже даты окончания')
  return { kind: 'period', from: validFrom, to: validTo }
}
