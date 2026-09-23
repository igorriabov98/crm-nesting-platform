import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { buildSheetImportTemplate, parseSheetImportXlsx } from './sheet-import-xlsx'
import { SHEET_IMPORT_HEADERS } from './sheet-import-types'

async function file(rows: ExcelJS.CellValue[][], mutate?: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Импорт')
  sheet.addRow([...SHEET_IMPORT_HEADERS]); rows.forEach(row => sheet.addRow(row)); mutate?.(sheet)
  return Buffer.from(await book.xlsx.writeBuffer())
}
const row: ExcelJS.CellValue[] = ['Лист', 'S235', 2, 1250, 2500, 10, null, null, 'Начальный перенос']

test('template has empty input, instructions, typed catalogue and frozen header', async () => {
  const bytes = await buildSheetImportTemplate({ grades: [{ name: 'S235', density: 7.85 }], suppliers: [{ name: 'Поставщик А' }] })
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  assert.deepEqual(book.worksheets.map(s => s.name), ['Импорт', 'Инструкция', 'Справочники'])
  const input = book.getWorksheet('Импорт')!
  assert.deepEqual((input.getRow(1).values as ExcelJS.CellValue[]).slice(1), [...SHEET_IMPORT_HEADERS])
  assert.equal(input.getRow(2).hasValues, false)
  assert.equal(input.views[0].state, 'frozen')
  assert.equal(book.getWorksheet('Справочники')!.getCell('B2').value, 7.85)
  assert.match(String(book.getWorksheet('Инструкция')!.getCell('B9').value), /Новая марка/)
  const parsed = await parseSheetImportXlsx(bytes, 'template.xlsx')
  assert.equal(parsed.rows.length, 0); assert.match(parsed.errors[0].message, /Нет строк/)
})

test('parses comma decimals, numeric grade names, blank rows and optional supplier', async () => {
  const parsed = await parseSheetImportXlsx(await file([[], ['  Лист  рифленный ', 235, '1,5', 1000, 2000, 2, '7,85', '', '  Перенос  остатков  '], row]), 'stock.xlsx')
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rows[0].row, 3)
  assert.deepEqual(parsed.rows[0], { row: 3, material: 'Лист рифленный', grade: '235', thickness: 1.5, width: 1000, length: 2000, quantity: 2, density: 7.85, supplier: null, comment: 'Перенос остатков' })
  assert.equal(parsed.rows[1].density, null)
})

test('zero rows are skipped, negative/fractional quantities and missing dimensions block', async () => {
  const parsed = await parseSheetImportXlsx(await file([
    [...row.slice(0,5),0], [...row.slice(0,5),-1], [...row.slice(0,5),1.5], ['Лист','S235',null,1000,2000,1], row,
  ]), 'stock.xlsx')
  assert.deepEqual(parsed.skippedRows, [2]); assert.equal(parsed.errors.length, 3); assert.equal(parsed.rows.length, 1)
})

for (const [label, value] of [
  ['formula', { formula: '1+1', result: 2 }], ['Excel error', { error: '#N/A' }], ['text formula', '=1+1'], ['date', new Date()],
] as const) {
  test(`rejects ${label} even on a zero quantity row`, async () => {
    const parsed = await parseSheetImportXlsx(await file([[...row.slice(0,5),0,value as ExcelJS.CellValue]]), 'stock.xlsx')
    assert.equal(parsed.errors.length,1); assert.equal(parsed.skippedRows.length,0)
  })
}

test('rejects merged cells, extra data, invalid headers and formats', async () => {
  assert.equal((await parseSheetImportXlsx(await file([row], s => s.mergeCells('A2:B2')), 'a.xlsx')).errors.length,1)
  assert.equal((await parseSheetImportXlsx(await file([[...row,'unexpected']]), 'a.xlsx')).errors.length,1)
  await assert.rejects(parseSheetImportXlsx(await file([row], s => { s.getCell('A1').value='Unknown' }), 'a.xlsx'), /Колонка 1/)
  await assert.rejects(parseSheetImportXlsx(Buffer.alloc(1), 'a.xls'), /\.xlsx/)
  await assert.rejects(parseSheetImportXlsx(Buffer.alloc(3*1024*1024+1), 'a.xlsx'), /3 МБ/)
  await assert.rejects(parseSheetImportXlsx(Buffer.from('garbage'), 'a.xlsx'), /не является/)
})

test('2000 rows accepted; 2001 rows blocked; compressed expansion bounded', async () => {
  const good = await file(Array.from({length:2000}, () => row))
  assert.equal((await parseSheetImportXlsx(good,'a.xlsx')).rows.length,2000)
  await assert.rejects(parseSheetImportXlsx(await file(Array.from({length:2001}, () => row)),'a.xlsx'), /2 000/)
  const bad = Buffer.from(good)
  const directory = bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))
  bad.writeUInt32LE(40*1024*1024,directory+24)
  await assert.rejects(parseSheetImportXlsx(bad,'a.xlsx'), /распаковки/)
})
