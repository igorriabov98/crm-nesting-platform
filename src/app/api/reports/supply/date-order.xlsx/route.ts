import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'

import { getSupplyOrderAggregates } from '@/lib/actions/supply-orders'
import { AuthRequiredError } from '@/lib/auth/current-user'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import {
  buildSupplyDateOrderReport,
  supplyDateOrderFilename,
} from '@/lib/reports/supply-date-order-report'
import { buildSupplyDateOrderXlsx } from '@/lib/reports/supply-date-order-xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({
  date: z.union([z.literal('no_supply_date'), z.string().date()]),
  factory: z.string().uuid().nullable(),
})

export async function GET(request: Request) {
  try {
    await requirePermission('supply_orders', 'view')
    const url = new URL(request.url)
    const params = paramsSchema.parse({
      date: url.searchParams.get('date'),
      factory: url.searchParams.get('factory'),
    })
    const result = await getSupplyOrderAggregates(params.factory)
    if (result.error) throw new Error(result.error)

    const report = buildSupplyDateOrderReport(result.data || [], params.date)
    if (report.rows.length === 0) {
      return NextResponse.json(
        { error: 'На эту дату нет материалов, которые ещё не заказаны' },
        { status: 409 },
      )
    }

    const buffer = await buildSupplyDateOrderXlsx(report)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${supplyDateOrderFilename(params.date)}"`,
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
      return NextResponse.json({ error: 'Некорректная дата или завод' }, { status: 400 })
    }
    console.error('Supply date order XLSX error:', error)
    return NextResponse.json({ error: 'Не удалось сформировать Excel-файл' }, { status: 500 })
  }
}
