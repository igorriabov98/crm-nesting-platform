import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { calculateProNestPosition, expandProNestSheets, parseProNestPages, suggestProNestRectangle, validateProNestForPosition, validateProNestLayouts, type ProNestPage } from './report'

function samplePage(): ProNestPage {
  const rows: Array<[string,string,number,number,number]> = [
    ['Раскрой:', '1 из 2', 430, 470, 151], ['Резка — количество раз:', '2', 370, 470, 140],
    ['Материал:', 'SS 4,00 mm', 120, 167, 129], ['Размер листа:', '1250,00 × 2500,00 mm', 107, 167, 108],
    ['Размер раскроя:', '1224,93 × 649,08 mm', 98, 167, 97], ['Вес листа:', '98,13 kg', 680, 729, 119],
    ['Коэффициент фактического использования площади:', '18,77%', 70, 276, 75],
    ['Коэффициент использования обрезки:', '75,90%', 579, 729, 151],
    ['Базовый пропил:', '2,00 mm', 406, 476, 119], ['Общая длина разреза:', '50433,22 mm', 385, 476, 97],
    ['Время производства:', '1:25:44', 390, 476, 108],
  ]
  return { page: 1, width: 842, height: 596, method: 'text', items: rows.flatMap(([label,value,x1,x2,y]) => [{ text: label, x: x1, y }, { text: value, x: x2, y }]) }
}

test('coordinate fields, repeated layout and individual sheet balance', () => {
  const page = samplePage()
  const second = { ...page, page: 2, items: page.items.map(row => ({ ...row, text: row.text === '1 из 2' ? '2 из 2' : row.text })) }
  const report = parseProNestPages([page, second])
  assert.deepEqual(report.issues, [])
  assert.equal(report.layouts[0].sheetWeightKg, 98.13)
  assert.equal(report.layouts[0].productionSeconds, 5144)
  const sheets = expandProNestSheets(report.layouts)
  assert.equal(sheets.length, 4)
  assert.equal(validateProNestForPosition(report, { quantity: 4, sheetSize: '1250x2500', thicknessMm: 4, materialConfirmed: true }).length, 0)
  assert.ok(validateProNestForPosition(report, { quantity: 3, sheetSize: '1250x2500', thicknessMm: 4, materialConfirmed: true }).length > 0)
  const proposal = suggestProNestRectangle(report.layouts[0])
  assert.ok(proposal)
  assert.equal(proposal.rectangle.lengthMm, 1850.92)
  sheets[0].decision = 'preserve'
  sheets[0].remnants = [proposal.rectangle]
  const totals = calculateProNestPosition(sheets)
  assert.equal(totals.sourceWeightKg, 392.52)
  assert.equal(totals.enteredSeconds, 20576)
  assert.equal(totals.actualSeconds, 25720)
  assert.ok(totals.metalScrapKg > 0)
  sheets[0].remnants = [{ lengthMm: 1250, widthMm: 2400 }]
  assert.throws(() => calculateProNestPosition(sheets), /баланс|остатк/i)
})

test('OCR column lines retain source uncertainty and parse a scanned ProNest footer', () => {
  const lines = [
    'Раскрой: 1133', 'Резка — количество раз: 1', 'Материал: $$ 4,00 тт',
    'Размер листа: 1250,00 х 2500,00 тт', 'Размер раскроя: 1243,35 x 2494,85 mm',
    'Вес листа: 98,13 kg', 'Коэффициент фактического использования площади: 93,76',
    'Коэффициент использования обрезки: 93,76%', 'Базовый пропил: 2,00 тт',
    'Общая длина разреза: 33349,14 mm', 'Время производства: 0:29:17',
  ]
  const report = parseProNestPages([{ page: 1, width: 2340, height: 1655, method: 'ocr', items: lines.map((text, index) => ({ text, x: index % 3 * 800, y: 1200 + index * 20, confidence: 85 })) }])
  assert.equal(report.layouts.length, 1)
  assert.equal(report.layouts[0].material, 'SS 4,00 mm')
  assert.equal(report.layouts[0].reviewRequired, true)
})

test('English ProNest labels use the same sheet accounting', () => {
  const replacements: Record<string,string> = {
    'Раскрой:': 'Nest:', 'Резка — количество раз:': 'Times cut:', 'Материал:': 'Material:',
    'Размер листа:': 'Sheet size:', 'Размер раскроя:': 'Crop size:', 'Вес листа:': 'Sheet weight:',
    'Коэффициент фактического использования площади:': 'Actual utilization:',
    'Коэффициент использования обрезки:': 'Crop utilization:', 'Базовый пропил:': 'Base kerf:',
    'Общая длина разреза:': 'Total cut length:', 'Время производства:': 'Production time:',
    '1 из 2': '1 of 1',
  }
  const page = samplePage()
  const english = { ...page, items: page.items.map(item => ({ ...item, text: replacements[item.text] || item.text })) }
  const report = parseProNestPages([english])
  assert.deepEqual(report.issues, [])
  assert.equal(report.layouts[0].timesCut, 2)
  assert.equal(expandProNestSheets(report.layouts).length, 2)
})

test('title page is excluded, duplicate layouts and incompatible sheet geometry are rejected', () => {
  const first = samplePage()
  const title: ProNestPage = { page: 1, width: 842, height: 596, method: 'text', items: [{ text: 'Отчёт ProNest', x: 30, y: 30 }] }
  const layout = { ...first, page: 2 }
  const second = { ...first, page: 3, items: first.items.map(row => ({ ...row, text: row.text === '1 из 2' ? '2 из 2' : row.text })) }
  const complete = parseProNestPages([title, layout, second])
  assert.deepEqual(complete.extraPages, [1])
  assert.equal(expandProNestSheets(complete.layouts).length, 4)
  assert.ok(parseProNestPages([layout, layout]).issues.some(issue => issue.includes('Нумерация')))
  assert.ok(validateProNestForPosition(complete, { quantity: 4, sheetSize: '1250x2500', thicknessMm: 3, materialConfirmed: false }).length >= 2)
  const badCrop = structuredClone(complete)
  badCrop.layouts[0].cropWidthMm = 2400
  badCrop.layouts[0].cropLengthMm = 2400
  assert.ok(validateProNestLayouts(badCrop.layouts).some(issue => issue.includes('размеры')))
})

test('total waste is weighted by remaining metal and negative metal scrap is rejected', () => {
  const first = samplePage()
  const second = { ...first, page: 2, items: first.items.map(row => ({ ...row, text: row.text === '1 из 2' ? '2 из 2' : row.text })) }
  const sheets = expandProNestSheets(parseProNestPages([first, second]).layouts)
  const proposal = suggestProNestRectangle(sheets[0].source)!
  sheets[0].decision = 'preserve'
  sheets[0].remnants = [proposal.rectangle]
  const result = calculateProNestPosition(sheets)
  const average = result.rows.reduce((sum, row) => sum + row.wastePercent, 0) / result.rows.length
  assert.ok(Math.abs(result.wastePercent - average) > 0.01)
  assert.equal(result.wastePercent, (result.metalScrapKg + result.kerfKg) / result.wasteBasisKg * 100)
  sheets[0].usefulWeightKg = sheets[0].source.sheetWeightKg
  assert.throws(() => calculateProNestPosition(sheets), /баланс/i)
})

for (const [name, expectedPages, expectedSheets, expectedWeightKg, expectedSeconds] of [
  ['Шаке 23 листы 1250х2500х4.pdf', 3, 3, 294.39, 14067],
  ['Шаке 23 листы 1250х2500х3.pdf', 2, 2, 147.18, 3604],
] as const) {
  const path = `/Users/igorrabov/Downloads/${name}`
  test(`reference ProNest PDF ${name}`, { skip: !existsSync(path) }, async () => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, disableFontFace: true }).promise
    try {
      assert.equal(pdf.numPages, expectedPages)
      const pages: ProNestPage[] = []
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        pages.push({ page: index, width: page.view[2], height: page.view[3], method: 'text', items: content.items.flatMap(item => 'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }] : []) })
      }
      const report = parseProNestPages(pages)
      assert.deepEqual(report.issues, [])
      assert.equal(report.layouts.length, expectedPages)
      const result = calculateProNestPosition(expandProNestSheets(report.layouts))
      assert.equal(result.sourceWeightKg, expectedWeightKg)
      assert.equal(result.enteredSeconds, expectedSeconds)
      assert.equal(expandProNestSheets(report.layouts).length, expectedSheets)
      if (name.endsWith('х4.pdf')) {
        assert.equal(Math.round(report.layouts.reduce((sum, row) => sum + row.sheetWeightKg * row.actualUtilizationPercent / 100 * row.timesCut, 0) * 1000) / 1000, 197.604)
        assert.equal(result.usefulKg, 197.604)
        assert.equal(result.actualSeconds, 17584)
      }
    } finally { await pdf.destroy() }
  })
}

test('locally rendered raster copy of the three-page report', { skip: !existsSync('/tmp/pronest-all-1.png') }, async () => {
  const { createWorker } = await import('tesseract.js')
  const { default: sharp } = await import('sharp')
  const worker = await createWorker('rus+eng', 1, { langPath: `${process.cwd()}/public/pronest`, corePath: `${process.cwd()}/public/pronest`, cachePath: '/tmp/pronest-tess-cache', gzip: true })
  const pages: ProNestPage[] = []
  try {
    for (let page = 1; page <= 3; page++) {
      const input = `/tmp/pronest-all-${page}.png`
      const { width = 0, height = 0 } = await sharp(input).metadata()
      const items: ProNestPage['items'] = []
      for (const [left, right] of [[0, 0.35], [0.35, 0.65], [0.65, 1]]) {
        const x = Math.floor(width * left), y = Math.floor(height * 0.68)
        const crop = await sharp(input).extract({ left: x, top: y, width: Math.ceil(width * right) - x, height: Math.ceil(height * 0.28) }).png().toBuffer()
        const result = await worker.recognize(crop, {}, { blocks: true, text: true })
        items.push(...(result.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({ text: line.text.trim(), x: line.bbox.x0 + x, y: line.bbox.y0 + y, confidence: line.confidence })))).filter(row => row.text))
      }
      pages.push({ page, width, height, method: 'ocr', items })
    }
    const result = parseProNestPages(pages)
    assert.equal(result.layouts.length, 3, JSON.stringify({ result, texts: pages.map(page => page.items.map(item => item.text)) }))
    assert.deepEqual(result.issues, [])
  } finally { await worker.terminate() }
})
