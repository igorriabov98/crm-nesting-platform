'use client'

import type { ProNestPage, PageTextItem } from '@/lib/pronest/report'
import { PRONEST_MAX_BYTES, PRONEST_MAX_PAGES, parseProNestPages } from '@/lib/pronest/report'

export async function readProNestPdf(
  file: File,
  progress: (done: number, total: number, method: 'text' | 'ocr') => void,
  signal: AbortSignal,
  rotations: Record<number, number> = {},
) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Выберите PDF-файл')
  if (file.size <= 0 || file.size > PRONEST_MAX_BYTES) throw new Error('PDF должен быть не больше 50 МБ')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pronest/pdf.worker.min.mjs'
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  if (pdf.numPages > PRONEST_MAX_PAGES) {
    await pdf.destroy()
    throw new Error('Отчёт должен содержать не больше 100 страниц')
  }
  const pages: ProNestPage[] = []
  let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null
  const stopWorker = () => { void worker?.terminate() }
  signal.addEventListener('abort', stopWorker, { once: true })
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      if (signal.aborted) throw new Error('Распознавание отменено')
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      const items: PageTextItem[] = content.items.flatMap(item => 'str' in item && item.str.trim()
        ? [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }] : [])
      const textPage: ProNestPage = { page: index, width: page.view[2], height: page.view[3], method: 'text', items }
      const textResult = parseProNestPages([textPage])
      if (textResult.layouts.length) {
        pages.push(textPage)
        progress(index, pdf.numPages, 'text')
        continue
      }
      if (!worker) {
        const { createWorker } = await import('tesseract.js')
        worker = await createWorker('rus+eng', 1, {
          workerPath: '/pronest/worker.min.js', corePath: '/pronest', langPath: '/pronest',
          gzip: true, workerBlobURL: false,
        })
      }
      const viewport = page.getViewport({ scale: 2, rotation: rotations[index] || 0 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось подготовить скан для распознавания')
      await page.render({ canvasContext: context, canvas, viewport }).promise
      // ProNest's three metadata columns share row coordinates. OCR of the
      // whole page merges them into one line, so recognize the footer columns
      // separately and preserve their original positions.
      const ocrItems: PageTextItem[] = []
      for (const [left, right] of [[0, 0.35], [0.35, 0.65], [0.65, 1]]) {
        if (signal.aborted) throw new Error('Распознавание отменено')
        const x = Math.floor(canvas.width * left)
        const y = Math.floor(canvas.height * 0.68)
        const width = Math.ceil(canvas.width * right) - x
        const height = Math.ceil(canvas.height * 0.28)
        const cropped = document.createElement('canvas')
        cropped.width = width
        cropped.height = height
        cropped.getContext('2d')?.drawImage(canvas, x, y, width, height, 0, 0, width, height)
        const result = await worker.recognize(cropped, {}, { blocks: true, text: true })
        ocrItems.push(...(result.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({
          text: line.text.trim(), x: line.bbox.x0 + x, y: line.bbox.y0 + y, confidence: line.confidence,
        })))).filter(item => item.text))
      }
      pages.push({ page: index, width: viewport.width, height: viewport.height, method: 'ocr', items: ocrItems })
      progress(index, pdf.numPages, 'ocr')
    }
  } finally {
    signal.removeEventListener('abort', stopWorker)
    await worker?.terminate().catch(() => undefined)
    await pdf.destroy()
  }
  return parseProNestPages(pages)
}
