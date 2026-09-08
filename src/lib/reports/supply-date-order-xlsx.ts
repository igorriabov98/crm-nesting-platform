import 'server-only'

import ExcelJS from 'exceljs'

import type { SupplyDateOrderReport } from '@/lib/reports/supply-date-order-report'

const COLUMN_HEADERS = [
  '№',
  'Категория',
  'Материал',
  'Характеристики',
  'Состав закупки',
  'Длина хлыста, мм',
  'Кол-во хлыстов к заказу, шт.',
  'Количество к заказу',
  'Ед.',
  'Вес, кг',
  'Поставщик',
  'Для машин',
] as const

const BORDER_COLOR = 'FFDCE3EA'
const HEADER_COLOR = 'FF1B3A6B'
const MUTED_COLOR = 'FF64748B'
const TEXT_COLOR = 'FF0F172A'
const ALT_ROW_COLOR = 'FFF8FAFC'

export async function buildSupplyDateOrderXlsx(
  report: SupplyDateOrderReport,
  generatedAt = new Date(),
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CRM Завода'
  workbook.created = generatedAt
  workbook.modified = generatedAt

  const worksheet = workbook.addWorksheet(sheetName(report.dateKey), {
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    properties: { defaultRowHeight: 21 },
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  })

  worksheet.columns = [
    { key: 'index', width: 6 },
    { key: 'category', width: 18 },
    { key: 'material', width: 24 },
    { key: 'characteristics', width: 38 },
    { key: 'purchaseComposition', width: 28 },
    { key: 'barLengthMm', width: 20 },
    { key: 'barCount', width: 27 },
    { key: 'quantity', width: 21 },
    { key: 'unit', width: 8 },
    { key: 'weightKg', width: 14 },
    { key: 'supplier', width: 22 },
    { key: 'machines', width: 28 },
  ]

  worksheet.getCell('A1').value = 'Заказ материалов'
  worksheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: HEADER_COLOR } }
  worksheet.getRow(1).height = 26

  worksheet.getCell('A2').value = 'Только материалы и остатки, которые ещё не заказаны.'
  worksheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: MUTED_COLOR } }

  setMetaPair(worksheet, 'B3', 'C3', 'Дата поставки', report.dateLabel)
  setMetaPair(worksheet, 'E3', 'F3', 'Завод', report.factoryLabel)
  setMetaPair(worksheet, 'H3', 'I3', 'Позиций', report.rows.length)
  setMetaPair(worksheet, 'B4', 'C4', 'Сформировано', formatGeneratedAt(generatedAt))

  const knownWeight = report.rows.reduce((sum, row) => sum + (row.weightKg || 0), 0)
  const unknownWeightCount = report.rows.filter((row) => row.weightKg === null).length
  const weightSummary = unknownWeightCount === 0
    ? knownWeight
    : knownWeight > 0
      ? `${formatNumber(knownWeight)} кг; без расчёта: ${unknownWeightCount}`
      : `Не рассчитан для ${unknownWeightCount}`
  setMetaPair(worksheet, 'E4', 'F4', 'Расчётный вес, кг', weightSummary)

  worksheet.getRow(5).height = 8
  for (let column = 1; column <= COLUMN_HEADERS.length; column += 1) {
    worksheet.getRow(5).getCell(column).border = {
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
    }
  }

  worksheet.addRow(COLUMN_HEADERS)
  const header = worksheet.getRow(6)
  header.height = 48
  header.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } }
  header.eachCell((cell) => {
    cell.border = {
      right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
    }
  })

  for (const [index, reportRow] of report.rows.entries()) {
    const row = worksheet.addRow([
      index + 1,
      reportRow.category,
      reportRow.material,
      reportRow.characteristics || '—',
      reportRow.purchaseComposition || '—',
      reportRow.barLengthMm ?? '—',
      reportRow.barCount ?? '—',
      reportRow.quantity,
      reportRow.unit,
      reportRow.weightKg ?? '—',
      reportRow.supplier,
      reportRow.machines,
    ])
    row.height = 42
    row.font = { name: 'Arial', size: 10, color: { argb: TEXT_COLOR } }
    row.alignment = { vertical: 'top', wrapText: true }
    if (index % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_COLOR } }
    }
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      }
    })
  }

  const lastRow = Math.max(worksheet.rowCount, 6)
  worksheet.autoFilter = { from: 'A6', to: `L${lastRow}` }
  worksheet.getColumn(1).alignment = { horizontal: 'center', vertical: 'top' }
  worksheet.getColumn(6).alignment = { horizontal: 'right', vertical: 'top' }
  worksheet.getColumn(6).numFmt = '#,##0'
  worksheet.getColumn(7).alignment = { horizontal: 'right', vertical: 'top' }
  worksheet.getColumn(7).numFmt = '#,##0'
  worksheet.getColumn(8).alignment = { horizontal: 'right', vertical: 'top' }
  worksheet.getColumn(8).numFmt = '#,##0.###'
  worksheet.getColumn(9).alignment = { horizontal: 'center', vertical: 'top' }
  worksheet.getColumn(10).alignment = { horizontal: 'right', vertical: 'top' }
  worksheet.getColumn(10).numFmt = '#,##0.###'
  worksheet.pageSetup.printTitlesRow = '6:6'
  worksheet.headerFooter.oddFooter = `Заказ материалов · ${report.dateLabel}`

  return workbook.xlsx.writeBuffer()
}

function setMetaPair(
  worksheet: ExcelJS.Worksheet,
  labelCell: string,
  valueCell: string,
  label: string,
  value: string | number,
) {
  const labelTarget = worksheet.getCell(labelCell)
  labelTarget.value = label
  labelTarget.font = { name: 'Arial', size: 10, bold: true, color: { argb: MUTED_COLOR } }
  const valueTarget = worksheet.getCell(valueCell)
  valueTarget.value = value
  valueTarget.font = { name: 'Arial', size: 10, bold: true, color: { argb: TEXT_COLOR } }
  valueTarget.alignment = { vertical: 'middle', wrapText: true }
}

function formatGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Kyiv',
  }).format(value)
}

function sheetName(dateKey: string) {
  if (dateKey === 'no_supply_date') return 'Заказ без даты'
  const [year, month, day] = dateKey.split('-')
  return `Заказ ${day}.${month}.${year}`.slice(0, 31)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}
