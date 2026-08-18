import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { canAccessFactory } from '@/lib/permissions/factory-scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { parseLongStockCuttingPlanPdfMetadata } from '@/lib/long-stock-cutting-plan-pdf'

/* eslint-disable @typescript-eslint/no-explicit-any -- Long-stock tables are generated after migrations are applied. */

const inputSchema = z.object({
  versionId: z.string().uuid(),
  machineId: z.string().uuid(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const permission = await requirePermission('production_cutting_area', 'view')
  const routeParams = await params
  const parsed = inputSchema.safeParse({
    versionId: routeParams.versionId,
    machineId: request.nextUrl.searchParams.get('machineId'),
  })
  if (!parsed.success) return NextResponse.json({ error: 'Карта раскроя не найдена' }, { status: 404 })

  const db = createAdminClient() as any
  const machineResult = await db.from('machines')
    .select('id,factory_id')
    .eq('id', parsed.data.machineId)
    .maybeSingle()
  if (machineResult.error || !machineResult.data
    || !canAccessFactory(permission, 'production_cutting_area', 'view', machineResult.data.factory_id)) {
    return NextResponse.json({ error: 'Карта раскроя не найдена' }, { status: 404 })
  }

  const versionResult = await db.from('long_stock_cutting_plan_versions')
    .select('id,plan_id,status,pdf_metadata')
    .eq('id', parsed.data.versionId)
    .maybeSingle()
  if (versionResult.error || !versionResult.data) {
    return NextResponse.json({ error: 'Карта раскроя не найдена' }, { status: 404 })
  }
  const version = versionResult.data
  const itemsResult = await db.from('long_stock_cutting_plan_items')
    .select('request_id')
    .eq('plan_id', version.plan_id)
  if (itemsResult.error || !itemsResult.data?.length) {
    return NextResponse.json({ error: 'Карта раскроя не найдена' }, { status: 404 })
  }
  const requestIds = Array.from(new Set(itemsResult.data.map((item: any) => item.request_id)))
  const requestsResult = await db.from('technologist_requests')
    .select('id')
    .in('id', requestIds)
    .eq('machine_id', parsed.data.machineId)
  if (requestsResult.error || requestsResult.data?.length !== requestIds.length) {
    return NextResponse.json({ error: 'Карта раскроя не принадлежит этому заказу' }, { status: 403 })
  }
  if (version.status === 'invalid') {
    return NextResponse.json({ error: 'Требуется пересчёт карты раскроя' }, { status: 409 })
  }
  if (version.status !== 'approved') {
    return NextResponse.json({ error: 'Карта раскроя ещё не утверждена' }, { status: 404 })
  }

  const metadata = parseLongStockCuttingPlanPdfMetadata(version.pdf_metadata, {
    planId: version.plan_id,
    versionId: version.id,
  })
  if (!metadata) return NextResponse.json({ error: 'PDF карты раскроя не найден' }, { status: 404 })

  return resolveFileResponse({
    bucket: metadata.bucket_id,
    objectPath: metadata.object_path,
    fileName: metadata.file_name,
    mimeType: metadata.mime_type,
    disposition: 'inline',
  })
}
