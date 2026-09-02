import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

import { AuthRequiredError } from '@/lib/auth/current-user'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { buildShipmentReportXlsx } from '@/lib/reports/shipment-report-xlsx'
import { loadShipmentReport, parseShipmentReportFilters } from '@/lib/reports/shipment-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requirePermission('complex_reports', 'view')
    const url = new URL(request.url)
    const filters = parseShipmentReportFilters({
      month: url.searchParams.get('month'),
      basis: url.searchParams.get('basis'),
      factoryId: url.searchParams.get('factoryId'),
    })
    const rows = await loadShipmentReport(filters)
    const buffer = await buildShipmentReportXlsx(rows, filters)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="shipment-report-${filters.month}.xlsx"`,
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
      return NextResponse.json({ error: 'Некорректные параметры отчёта' }, { status: 400 })
    }
    console.error('Shipment report XLSX error:', error)
    return NextResponse.json({ error: 'Не удалось сформировать Excel-отчёт' }, { status: 500 })
  }
}
