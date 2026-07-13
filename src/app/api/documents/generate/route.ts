import { createElement, type ComponentType } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDocumentData, type DocumentData } from '@/lib/actions/document-generation'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { AuthRequiredError } from '@/lib/auth/current-user'
import { SpecificationDocument } from '@/lib/pdf/SpecificationDocument'
import { InvoiceDocument } from '@/lib/pdf/InvoiceDocument'
import { PackingListDocument } from '@/lib/pdf/PackingListDocument'
import { QualityControlDocument } from '@/lib/pdf/QualityControlDocument'

export const runtime = 'nodejs'

const requestSchema = z.object({
  machineId: z.string().uuid(),
  type: z.enum(['specification', 'invoice', 'packing_list', 'quality_control', 'all']),
})

type DocumentType = z.infer<typeof requestSchema>['type']
type PdfComponent = ComponentType<{ data: DocumentData }>

const singleDocuments: Record<Exclude<DocumentType, 'all'>, { component: PdfComponent; fileBase: string }> = {
  specification: { component: SpecificationDocument, fileBase: 'Specification' },
  invoice: { component: InvoiceDocument, fileBase: 'Invoice' },
  packing_list: { component: PackingListDocument, fileBase: 'PackingList' },
  quality_control: { component: QualityControlDocument, fileBase: 'QualityControl' },
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'document'
}

function attachmentHeaders(contentType: string, fileName: string) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${safeFilePart(fileName)}"`,
  }
}

async function renderPdf(component: PdfComponent, data: DocumentData) {
  const element = createElement(component, { data }) as Parameters<typeof renderToBuffer>[0]
  return renderToBuffer(element)
}

function bufferBody(buffer: Buffer) {
  return new Uint8Array(buffer)
}

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join(', ')
  }
  if (error instanceof Error) return error.message
  return 'Не удалось сгенерировать документы'
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = requestSchema.parse(body)
    await requirePermission('sales_plan', 'view')
    if (parsed.type === 'invoice' || parsed.type === 'all') {
      await requirePermission('invoices', 'view')
    }
    const data = await getDocumentData(parsed.machineId)
    const number = safeFilePart(data.machine.specification_number || data.machine.id)

    if (parsed.type === 'all') {
      const [specBuffer, invoiceBuffer, packingBuffer, qualityBuffer] = await Promise.all([
        renderPdf(SpecificationDocument, data),
        renderPdf(InvoiceDocument, data),
        renderPdf(PackingListDocument, data),
        renderPdf(QualityControlDocument, data),
      ])
      const zip = new JSZip()
      zip.file('Specification.pdf', specBuffer)
      zip.file('Invoice.pdf', invoiceBuffer)
      zip.file('PackingList.pdf', packingBuffer)
      zip.file('QualityControl.pdf', qualityBuffer)
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      return new NextResponse(bufferBody(zipBuffer), {
        headers: attachmentHeaders('application/zip', `Documents_${number}.zip`),
      })
    }

    const definition = singleDocuments[parsed.type]
    const pdfBuffer = await renderPdf(definition.component, data)

    return new NextResponse(bufferBody(pdfBuffer), {
      headers: attachmentHeaders('application/pdf', `${definition.fileBase}_${number}.pdf`),
    })
  } catch (error) {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof AuthRequiredError
          ? 401
          : 500
    return NextResponse.json({ error: errorMessage(error) }, { status })
  }
}
