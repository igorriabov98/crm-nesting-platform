import { createElement, type ComponentType } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDocumentData, getInvoiceDocumentData, type DocumentData } from '@/lib/actions/document-generation'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { requireAnyCompanyRecordAccess } from '@/lib/permissions/company-scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { AuthRequiredError } from '@/lib/auth/current-user'
import { SpecificationDocument } from '@/lib/pdf/SpecificationDocument'
import { OrderSpecificationDocument } from '@/lib/pdf/OrderSpecificationDocument'
import { InvoiceDocument } from '@/lib/pdf/InvoiceDocument'
import { PackingListDocument } from '@/lib/pdf/PackingListDocument'
import { QualityControlDocument } from '@/lib/pdf/QualityControlDocument'

export const runtime = 'nodejs'

const requestSchema = z.object({
  machineId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  type: z.enum(['specification', 'order_specification', 'invoice', 'packing_list', 'quality_control', 'all']),
})

type DocumentType = z.infer<typeof requestSchema>['type']
type PdfComponent = ComponentType<{ data: DocumentData }>
type InvoiceDocumentRecord = {
  id: string
  machine_id: string
  machine: { client_id: string | null } | Array<{ client_id: string | null }> | null
}

const singleDocuments: Record<Exclude<DocumentType, 'all'>, { component: PdfComponent; fileBase: string }> = {
  specification: { component: SpecificationDocument, fileBase: 'Specification' },
  order_specification: { component: OrderSpecificationDocument, fileBase: 'OrderSpecification' },
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

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = requestSchema.parse(body)
    if (parsed.type !== 'invoice') await requirePermission('sales_plan', 'view')

    let invoice: InvoiceDocumentRecord | null = null
    if (parsed.type === 'invoice' || parsed.type === 'all') {
      let query = trustedDb(createAdminClient())
        .from('invoices')
        .select('id, machine_id, machine:machines(client_id)')
      query = parsed.invoiceId
        ? query.eq('id', parsed.invoiceId)
        : query.eq('machine_id', parsed.machineId).neq('status', 'cancelled')
      const { data: invoiceData, error: invoiceError } = await query
        .order('invoice_revision', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (invoiceError || !invoiceData) throw new Error(invoiceError?.message || 'Инвойс ещё не выставлен')
      invoice = invoiceData as unknown as InvoiceDocumentRecord
      const machine = relationOne(invoice.machine)
      await requireAnyCompanyRecordAccess([
        { resourceKey: 'invoices', operation: 'view' },
        { resourceKey: 'client_payments', operation: 'view' },
      ], machine?.client_id)
    }
    const data = invoice
      ? await getInvoiceDocumentData(invoice.id)
      : await getDocumentData(parsed.machineId)
    const number = safeFilePart(data.machine.invoice_number || data.machine.specification_number || data.machine.id)

    if (parsed.type === 'all') {
      const [specBuffer, orderSpecBuffer, invoiceBuffer, packingBuffer, qualityBuffer] = await Promise.all([
        renderPdf(SpecificationDocument, data),
        renderPdf(OrderSpecificationDocument, data),
        renderPdf(InvoiceDocument, data),
        renderPdf(PackingListDocument, data),
        renderPdf(QualityControlDocument, data),
      ])
      const zip = new JSZip()
      zip.file('Specification.pdf', specBuffer)
      zip.file('OrderSpecification.pdf', orderSpecBuffer)
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
