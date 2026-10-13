import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'

import { getSupplyOrderAggregates } from '@/lib/actions/supply-orders'
import { AuthRequiredError } from '@/lib/auth/current-user'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import {
  buildSupplyOrderExportReport,
  supplyOrderExportFilename,
} from '@/lib/reports/supply-date-order-report'
import { buildSupplyDateOrderXlsx } from '@/lib/reports/supply-date-order-xlsx'
import { MATERIAL_CATEGORIES } from '@/lib/constants/procurement'
import type { MaterialCategory } from '@/lib/types'
import {
  getSupplyOrderExportMachines,
  getSupplyOrderExportOptions,
  STEEL_TYPE_CATEGORIES,
  type SupplyDateOrderSelection,
  type SupplyOrderExportScope,
} from '@/lib/reports/supply-date-order-selection'
import { InvalidSupplyOrderExportScopeError, parseSupplyOrderExportScope } from '@/lib/reports/supply-order-export-scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const factorySchema = z.string().uuid().nullable()

export async function GET(request: Request) {
  try {
    await requirePermission('supply_orders', 'view')
    const url = new URL(request.url)
    const scope = parseSupplyOrderExportScope(url.searchParams)
    if (url.searchParams.getAll('factory').length > 1) throw new InvalidSelectionError('Укажите один завод')
    const factory = factorySchema.parse(url.searchParams.get('factory'))
    const result = await getSupplyOrderAggregates(factory)
    if (result.error) throw new Error(result.error)
    const aggregates = result.data || []
    if (scope.kind === 'machine' && !getSupplyOrderExportMachines(aggregates)
      .some((machine) => machine.id === scope.machineId)) {
      return NextResponse.json({ error: 'Заказ клиента не найден среди доступных потребностей' }, { status: 404 })
    }

    const selection = readSelection(url.searchParams, aggregates, scope)
    const report = buildSupplyOrderExportReport(aggregates, scope, selection)
    if (report.rows.length === 0) {
      return NextResponse.json(
        { error: 'По выбранным условиям нет материалов, которые ещё не заказаны' },
        { status: 409 },
      )
    }

    const buffer = await buildSupplyDateOrderXlsx(report)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${supplyOrderExportFilename(scope)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 })
    }
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Некорректная дата, период, заказ или завод' }, { status: 400 })
    }
    if (error instanceof InvalidSelectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof InvalidSupplyOrderExportScopeError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Supply date order XLSX error:', error)
    return NextResponse.json({ error: 'Не удалось сформировать Excel-файл' }, { status: 500 })
  }
}

class InvalidSelectionError extends Error {}

function readSelection(
  params: URLSearchParams,
  aggregates: NonNullable<Awaited<ReturnType<typeof getSupplyOrderAggregates>>['data']>,
  scope: SupplyOrderExportScope,
): SupplyDateOrderSelection | null {
  const categories = params.getAll('category')
  const steelKeys = [...params.keys()].filter((key) => key.startsWith('steel_type.'))
  if (categories.length === 0 && steelKeys.length === 0) return null
  if (categories.length === 0 || categories.length > MATERIAL_CATEGORIES.length) {
    throw new InvalidSelectionError('Выберите хотя бы одну категорию')
  }
  const allowedOptions = new Map(getSupplyOrderExportOptions(aggregates, scope)
    .map((option) => [option.category, option]))
  const selectedCategories = [...new Set(categories)] as MaterialCategory[]
  if (selectedCategories.length !== categories.length || selectedCategories.some((category) => (
    !MATERIAL_CATEGORIES.includes(category) || !allowedOptions.has(category)
  ))) throw new InvalidSelectionError('Некорректная категория материалов')

  const steelTypes: SupplyDateOrderSelection['steelTypes'] = {}
  for (const category of selectedCategories) {
    if (!STEEL_TYPE_CATEGORIES.includes(category)) continue
    const selected = params.getAll(`steel_type.${category}`)
    const allowed = new Set(allowedOptions.get(category)?.steelTypes || [])
    if (selected.length === 0 || selected.length > allowed.size
      || new Set(selected).size !== selected.length
      || selected.some((name) => !allowed.has(name))) {
      throw new InvalidSelectionError(`Выберите тип стали для категории «${category}»`)
    }
    steelTypes[category] = selected
  }
  if (steelKeys.some((key) => !STEEL_TYPE_CATEGORIES.includes(key.slice('steel_type.'.length) as MaterialCategory)
    || !selectedCategories.includes(key.slice('steel_type.'.length) as MaterialCategory))) {
    throw new InvalidSelectionError('Некорректный выбор типа стали')
  }
  return { categories: selectedCategories, steelTypes }
}
