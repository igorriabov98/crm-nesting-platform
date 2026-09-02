import 'server-only'

import ExcelJS from 'exceljs'
import {
  SHIPMENT_REPORT_COLUMNS,
  type ShipmentReportFilters,
  type ShipmentReportRow,
} from '@/lib/reports/shipment-report-core'

function excelDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function optionalNumber(value: number | null) {
  return value === null ? '—' : value
}

export async function buildShipmentReportXlsx(
  rows: readonly ShipmentReportRow[],
  filters: ShipmentReportFilters,
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CRM Завода'
  workbook.created = new Date()
  workbook.modified = new Date()

  const worksheet = workbook.addWorksheet('Отчёт отгрузок', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  })

  worksheet.columns = [
    { key: 'client', width: 28 },
    { key: 'orderNumber', width: 20 },
    { key: 'invoiceAmount', width: 18 },
    { key: 'actualShippingDate', width: 17 },
    { key: 'customsClearanceDate', width: 17 },
    { key: 'deliveryToClientDate', width: 24 },
    { key: 'freightCost', width: 29 },
    { key: 'paidAmount', width: 27 },
    { key: 'invoiceDate', width: 24 },
  ]

  worksheet.addRow(SHIPMENT_REPORT_COLUMNS.map((column) => column.label))
  for (const row of rows) {
    worksheet.addRow([
      row.client || '—',
      row.orderNumber || '—',
      optionalNumber(row.invoiceAmount),
      excelDate(row.actualShippingDate),
      excelDate(row.customsClearanceDate),
      excelDate(row.deliveryToClientDate),
      optionalNumber(row.freightCost),
      optionalNumber(row.paidAmount),
      excelDate(row.invoiceDate),
    ])
  }

  const header = worksheet.getRow(1)
  header.height = 30
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { vertical: 'middle', wrapText: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } }

  worksheet.autoFilter = { from: 'A1', to: `I${Math.max(rows.length + 1, 1)}` }
  worksheet.getColumn(3).numFmt = '€ #,##0.00'
  worksheet.getColumn(7).numFmt = '€ #,##0.00'
  worksheet.getColumn(8).numFmt = '€ #,##0.00'
  for (const column of [4, 5, 6, 9]) worksheet.getColumn(column).numFmt = 'dd.mm.yyyy'

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'middle' }
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
    })
  })

  worksheet.headerFooter.oddFooter = `Отчёт отгрузок · ${filters.month}`
  return workbook.xlsx.writeBuffer()
}
