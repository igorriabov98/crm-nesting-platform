import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { parseLongStockCuttingPlanPdfMetadata } from '@/lib/long-stock-cutting-plan-pdf'
import { PermissionDeniedError } from '@/lib/permissions/server'
import { TechnologistRequestAccessError, requireTechnologistRequestAccess } from '@/lib/technologist-request-access'

/* eslint-disable @typescript-eslint/no-explicit-any -- long-stock tables are migration-backed */

const paramsSchema = z.object({
  requestId: z.string().uuid(),
  versionId: z.string().uuid(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string; versionId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Раскладка не найдена' }, { status: 404 })
    }

    const access = await requireTechnologistRequestAccess(parsed.data.requestId, {
      workflowOperation: 'view',
      inventoryOperation: 'view',
    })
    const db = access.admin as any
    const versionResult = await db
      .from('long_stock_cutting_plan_versions')
      .select('id,plan_id,status,pdf_metadata')
      .eq('id', parsed.data.versionId)
      .maybeSingle()
    if (versionResult.error) throw new Error(versionResult.error.message || 'Не удалось прочитать раскладку')
    if (!versionResult.data) {
      return NextResponse.json({ error: 'Раскладка не найдена' }, { status: 404 })
    }

    const version = versionResult.data
    const itemsResult = await db
      .from('long_stock_cutting_plan_items')
      .select('request_id')
      .eq('plan_id', version.plan_id)
    if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось проверить состав раскладки')

    const planRequestIds = new Set<string>(
      (itemsResult.data || []).map((item: { request_id: string }) => item.request_id),
    )
    let belongsToRequest = planRequestIds.has(parsed.data.requestId)
    if (!belongsToRequest && planRequestIds.size > 0) {
      const [sourceRevisions, replacementRevisions] = await Promise.all([
        db.from('supply_position_revisions')
          .select('replacement_request_id')
          .eq('source_request_id', parsed.data.requestId)
          .not('replacement_request_id', 'is', null),
        db.from('supply_position_revisions')
          .select('source_request_id')
          .eq('replacement_request_id', parsed.data.requestId),
      ])
      if (sourceRevisions.error || replacementRevisions.error) {
        throw new Error(sourceRevisions.error?.message || replacementRevisions.error?.message || 'Не удалось проверить связь раскладки')
      }
      belongsToRequest = [
        ...(sourceRevisions.data || []).map((row: { replacement_request_id: string }) => row.replacement_request_id),
        ...(replacementRevisions.data || []).map((row: { source_request_id: string }) => row.source_request_id),
      ].some((requestId) => planRequestIds.has(requestId))
    }
    if (!belongsToRequest) {
      return NextResponse.json({ error: 'Раскладка не принадлежит этой заявке' }, { status: 403 })
    }

    if (version.status === 'invalid') {
      return NextResponse.json({ error: 'Раскладка устарела. Требуется пересчёт' }, { status: 409 })
    }
    if (version.status !== 'approved') {
      return NextResponse.json({ error: 'Раскладка ещё не утверждена' }, { status: 409 })
    }

    const metadata = parseLongStockCuttingPlanPdfMetadata(version.pdf_metadata, {
      planId: version.plan_id,
      versionId: version.id,
    })
    if (!metadata) {
      return NextResponse.json({ error: 'PDF утверждённой раскладки не найден' }, { status: 404 })
    }

    return resolveFileResponse({
      bucket: metadata.bucket_id,
      objectPath: metadata.object_path,
      fileName: metadata.file_name,
      mimeType: metadata.mime_type,
      disposition: 'inline',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось открыть раскладку'
    if (error instanceof TechnologistRequestAccessError) {
      return NextResponse.json({ error: message, code: error.code }, { status: error.status })
    }
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: message, code: 'access_denied' }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
