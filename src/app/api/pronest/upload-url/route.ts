import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTechnologistRequestAccess } from '@/lib/technologist-request-access'
import { PRONEST_MAX_BYTES } from '@/lib/pronest/report'

export const dynamic = 'force-dynamic'

const inputSchema = z.object({ requestId: z.string().uuid(), sourceId: z.string().uuid(), fileName: z.string().min(1).max(240), size: z.number().int().positive().max(PRONEST_MAX_BYTES) })

export async function POST(request: NextRequest) {
  try {
    const input = inputSchema.parse(await request.json())
    if (!/\.pdf$/i.test(input.fileName)) throw new Error('Выберите PDF-файл')
    await requireTechnologistRequestAccess(input.requestId, { workflowOperation: 'manage', inventoryOperation: 'manage', allowedStatuses: ['stock_checked'] })
    const admin = createAdminClient()
    const { data: sheet, error: sheetError } = await admin.from('request_sheet_metal').select('id').eq('id', input.sourceId).eq('request_id', input.requestId).maybeSingle()
    if (sheetError || !sheet) throw new Error('Листовая позиция не относится к заявке')
    const objectPath = `pronest/${input.requestId}/${input.sourceId}/${randomUUID()}.pdf`
    const { data, error } = await admin.storage.from('nesting-files').createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось подготовить загрузку PDF')
    return NextResponse.json({ data: { bucket: 'nesting-files', objectPath, token: data.token } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось подготовить загрузку PDF' }, { status: 400 })
  }
}
