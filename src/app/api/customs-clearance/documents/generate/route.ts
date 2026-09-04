import { createElement, type ComponentType } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getTrustedDocumentData, type DocumentData } from '@/lib/actions/document-generation'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { assertFactoryAccess } from '@/lib/permissions/factory-scope'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { SpecificationDocument } from '@/lib/pdf/SpecificationDocument'
import { InvoiceDocument } from '@/lib/pdf/InvoiceDocument'
import { PackingListDocument } from '@/lib/pdf/PackingListDocument'

export const runtime = 'nodejs'

const requestSchema = z.object({
  machineId: z.string().uuid(),
  type: z.enum(['invoice', 'specification', 'packing_list']),
})
type PdfComponent = ComponentType<{ data: DocumentData }>

const definitions: Record<z.infer<typeof requestSchema>['type'], { component: PdfComponent; fileBase: string }> = {
  invoice: { component: InvoiceDocument, fileBase: 'CustomsInvoice' },
  specification: { component: SpecificationDocument, fileBase: 'Specification' },
  packing_list: { component: PackingListDocument, fileBase: 'PackingList' },
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'document'
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json().catch(() => null))
    const context = await requirePermission('customs_clearance', 'view')
    const { data: machineData, error } = await trustedDb(createAdminClient())
      .from('machines')
      .select('factory_id')
      .eq('id', input.machineId)
      .maybeSingle()
    if (error || !machineData) throw new Error('Машина не найдена')
    const machine = machineData as { factory_id: string | null }
    assertFactoryAccess(context, 'customs_clearance', 'view', machine.factory_id)

    // This loader reads the order snapshot only. It never creates or updates an
    // invoice, payment schedule or any record in the financial module.
    const data = await getTrustedDocumentData(input.machineId)
    const definition = definitions[input.type]
    const element = createElement(definition.component, { data }) as Parameters<typeof renderToBuffer>[0]
    const buffer = await renderToBuffer(element)
    const number = safeFilePart(data.machine.specification_number || data.machine.id)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${definition.fileBase}_${number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof AuthRequiredError
          || error instanceof UserProfileMissingError
          || error instanceof UserInactiveError
          ? 401
          : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось сформировать документ' },
      { status },
    )
  }
}
