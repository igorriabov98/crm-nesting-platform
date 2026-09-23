import ExcelJS from 'exceljs'
import { SHEET_IMPORT_HEADERS, SHEET_IMPORT_MAX_BYTES, SHEET_IMPORT_MAX_ROWS,
  type SheetImportCatalog, type SheetImportIssue, type SheetImportRow } from './sheet-import-types'

const clean = (value: string) => value.trim().replace(/\s+/gu, ' ')

// Bound decompression before handing the archive to ExcelJS. ZIP64 and encrypted
// workbooks are outside this small, plain .xlsx template's contract.
function validateArchive(buffer: Buffer) {
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('Файл не является книгой .xlsx')
  const entries = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  let expanded = 0
  if (entries > 500 || buffer.readUInt16LE(end + 4) !== 0) throw new Error('Слишком сложная книга Excel')
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Повреждённый файл .xlsx')
    expanded += buffer.readUInt32LE(offset + 24)
    if (expanded > 30 * 1024 * 1024 || (buffer.readUInt16LE(offset + 8) & 1)) {
      throw new Error('Книга слишком велика после распаковки или защищена паролем')
    }
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
  }
}

function scalar(cell: ExcelJS.Cell): string | number | null {
  const value = cell.value
  if (value === null || value === undefined) return null
  if (cell.isMerged) throw new Error('Объединённые ячейки недопустимы')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Некорректное число')
    return value
  }
  if (typeof value === 'string') {
    const result = clean(value)
    if (/^(?:=|#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!))/.test(result)) {
      throw new Error('Формулы и ошибки Excel недопустимы; вставьте значения')
    }
    return result || null
  }
  throw new Error('Допустимы только текст и числа, без формул, дат и ошибок Excel')
}

function numeric(value: string | number | null, optional = false) {
  if (value === null && optional) return null
  if (value === null) throw new Error('Заполните число')
  const text = String(value).replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Введите неотрицательное число')
  const number = Number(text)
  if (!Number.isFinite(number) || number > 1_000_000_000) throw new Error('Число слишком велико')
  return number
}

export async function parseSheetImportXlsx(buffer: Buffer, fileName: string) {
  if (!/\.xlsx$/i.test(fileName)) throw new Error('Выберите файл .xlsx')
  if (!buffer.length || buffer.length > SHEET_IMPORT_MAX_BYTES) throw new Error('Размер файла должен быть от 1 байта до 3 МБ')
  validateArchive(buffer)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer) } catch { throw new Error('Не удалось прочитать книгу .xlsx') }
  const sheet = workbook.getWorksheet('Импорт')
  if (!sheet) throw new Error('В книге отсутствует лист «Импорт». Скачайте шаблон CRM')
  SHEET_IMPORT_HEADERS.forEach((header, index) => {
    if (scalar(sheet.getCell(1, index + 1)) !== header) throw new Error(`Колонка ${index + 1}: ожидается «${header}»`)
  })
  const rows: SheetImportRow[] = []
  const errors: SheetImportIssue[] = []
  const skippedRows: number[] = []
  let filled = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    // Styles without values are not input rows.
    if (!row.hasValues) return
    filled++
    if (filled > SHEET_IMPORT_MAX_ROWS) return
    try {
      if (row.cellCount > 9 && row.values && (row.values as ExcelJS.CellValue[]).slice(10).some(v => v !== null && v !== undefined && v !== '')) {
        throw new Error('Данные за пределами колонок шаблона')
      }
      const values = SHEET_IMPORT_HEADERS.map((header, index) => {
        try { return scalar(row.getCell(index + 1)) } catch (error) { throw new Error(`${header}: ${(error as Error).message}`) }
      })
      if (values.every(value => value === null)) return
      const quantity = numeric(values[5])!
      if (!Number.isSafeInteger(quantity)) throw new Error('Количество к приходу должно быть целым числом')
      if (quantity === 0) { skippedRows.push(rowNumber); return }
      const material = values[0] === null ? '' : String(values[0])
      const grade = values[1] === null ? '' : String(values[1])
      if (!material || !grade) throw new Error('Заполните вид листа и марку стали')
      if (material.length > 200 || grade.length > 200) throw new Error('Название не должно превышать 200 символов')
      const dimensions = values.slice(2, 5).map(v => numeric(v)!)
      if (dimensions.some(v => v <= 0 || v > 1_000_000)) throw new Error('Толщина и размеры должны быть больше нуля и не превышать 1 000 000 мм')
      const density = numeric(values[6], true)
      if (density !== null && (density <= 0 || density > 30)) throw new Error('Плотность должна быть больше нуля и не превышать 30 г/см³')
      const supplier = values[7] === null ? null : String(values[7])
      const comment = values[8] === null ? null : String(values[8])
      if ((supplier?.length ?? 0) > 200 || (comment?.length ?? 0) > 1000) throw new Error('Поставщик: до 200 символов; комментарий: до 1000')
      rows.push({ row: rowNumber, material, grade, thickness: dimensions[0], width: dimensions[1], length: dimensions[2], quantity, density, supplier, comment })
    } catch (error) { errors.push({ row: rowNumber, message: (error as Error).message }) }
  })
  if (filled > SHEET_IMPORT_MAX_ROWS) throw new Error('В файле допускается не более 2 000 заполненных строк')
  if (!rows.length && !errors.length) errors.push({ row: 0, message: 'Нет строк с положительным количеством к приходу' })
  return { rows, errors, skippedRows }
}

export async function buildSheetImportTemplate(catalog: SheetImportCatalog) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CRM Завода'
  const sheet = workbook.addWorksheet('Импорт', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = SHEET_IMPORT_HEADERS.map((header, i) => ({ header, width: [25, 24, 16, 16, 16, 23, 20, 30, 40][i] }))
  sheet.autoFilter = 'A1:I2001'
  sheet.getRow(1).height = 44
  sheet.getColumn(2).numFmt = '@'
  for (let i = 3; i <= 7; i++) sheet.getColumn(i).numFmt = i === 6 ? '0' : '0.###'
  for (let row = 2; row <= 201; row++) {
    sheet.getRow(row).height = 23
    for (let col = 3; col <= 7; col++) {
      sheet.getCell(row, col).dataValidation = { type: col === 6 ? 'whole' : 'decimal', operator: col === 6 ? 'greaterThanOrEqual' : 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Проверьте число', error: col === 6 ? 'Введите целое число от нуля' : 'Введите положительное число' }
    }
  }
  const instructions = workbook.addWorksheet('Инструкция')
  instructions.columns = [{ width: 31 }, { width: 95 }]
  instructions.addRows([
    ['Импорт листового металла', 'Основной склад'],
    ['Порядок загрузки', 'Заполните лист «Импорт». В CRM выберите один завод для всего файла, проверьте строки и подтвердите приход.'],
    ['Количество', 'Количество прибавляется к остатку. Целые листы: 1, 2, 3… Ноль пропускается. Брони сохраняются.'],
    ['Новая марка стали', 'Укажите плотность в г/см³. Для существующей марки используется справочник CRM. Названия 235 и S235 считаются разными.'],
    ['Поставщик', 'Можно оставить пустым. Если указан, название должно совпадать с активным поставщиком CRM.'],
    ['Формат', 'Только значения, без формул и объединённых ячеек. Размеры в мм. Допустима десятичная запятая. До 2 000 строк и 3 МБ.'],
    ['Повторный импорт', 'CRM покажет предыдущий импорт. Повторное пополнение требует отдельного подтверждения нового прихода.'],
    ['Вес', 'Расчётный вес определяется в CRM по размерам, толщине и плотности стали.'],
    ['Пример (не импортируется)', 'Лист | Новая марка | 2 | 1250 | 2500 | 10 | 7,85 | (пусто) | Перенос остатков'],
    ['Пример рифлёного листа', 'Лист рифленный | Новая марка | 3 | 1500 | 6000 | 2 | 7,85 | (пусто) | Перенос остатков'],
  ])
  instructions.eachRow((row, i) => { row.height = i === 1 ? 32 : 45; row.alignment = { vertical: 'middle', wrapText: true } })
  const reference = workbook.addWorksheet('Справочники', { views: [{ state: 'frozen', ySplit: 1 }] })
  reference.columns = [{ header: 'Марка стали', width: 30 }, { header: 'Плотность, г/см³', width: 23 }, { width: 4 }, { header: 'Поставщик', width: 48 }]
  for (let i = 0; i < Math.max(catalog.grades.length, catalog.suppliers.length); i++) {
    const grade = catalog.grades[i]?.name ?? null
    const supplier = catalog.suppliers[i]?.name ?? null
    const row = reference.addRow([grade, catalog.grades[i]?.density ?? null, null, supplier])
    row.alignment = { wrapText: true, vertical: 'middle' }
    row.height = Math.max(23, 16 * Math.max(Math.ceil((grade?.length ?? 0) / 27), Math.ceil((supplier?.length ?? 0) / 44)))
  }
  reference.getColumn(1).numFmt = '@'
  reference.getColumn(2).numFmt = '0.###'
  reference.getRow(1).height = 32
  for (const tab of workbook.worksheets) {
    tab.eachRow(row => row.eachCell(cell => { cell.font = { name: 'Arial', size: 11 }; cell.alignment = { ...cell.alignment, vertical: 'middle' } }))
    tab.getRow(1).eachCell(cell => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
