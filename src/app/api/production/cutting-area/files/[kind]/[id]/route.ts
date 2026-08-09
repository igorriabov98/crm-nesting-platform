import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFileResponse } from '@/lib/file-archive/resolver'

/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic file source types are narrowed below. */

const paramsSchema = z.object({
  kind: z.enum(['product','project','production_drawing']),
  id: z.string().uuid(),
  machineId: z.string().uuid(),
})

type FileSource = { objectPath: string; fileName: string; mimeType: string | null; bucket: string; versionColumn: 'product_version_id' | 'product_project_version_id'; versionId: string }

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const permission = await requirePermission('production_cutting_area', 'view')
  const routeParams = await params
  const parsed = paramsSchema.safeParse({ ...routeParams, machineId: request.nextUrl.searchParams.get('machineId') })
  if (!parsed.success) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const db = createAdminClient() as any
  const machine = await db.from('machines').select('factory_id').eq('id', parsed.data.machineId).maybeSingle()
  const isDirector = ['financial_director','commercial_director','planning_director'].includes(permission.role)
  if (machine.error || !machine.data || (!isDirector && permission.factoryId !== machine.data.factory_id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  let source: FileSource | null = null

  if (parsed.data.kind === 'product') {
    const { data } = await db.from('product_files').select('file_path,file_name,mime_type,file_kind,product_version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.product_version_id && ['drawing','step'].includes(data.file_kind)) source = { objectPath: data.file_path, fileName: data.file_name, mimeType: data.mime_type, bucket: 'product-files', versionColumn: 'product_version_id', versionId: data.product_version_id }
  } else if (parsed.data.kind === 'project') {
    const { data } = await db.from('product_project_files').select('file_path,file_name,mime_type,file_kind,version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.version_id && data.file_kind !== 'photo') source = { objectPath: data.file_path, fileName: data.file_name, mimeType: data.mime_type, bucket: 'product-files', versionColumn: 'product_project_version_id', versionId: data.version_id }
  } else {
    const { data } = await db.from('product_production_drawings').select('file_path,file_name,mime_type,product_version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.product_version_id) source = { objectPath: data.file_path, fileName: data.file_name, mimeType: data.mime_type, bucket: 'product-production-drawings', versionColumn: 'product_version_id', versionId: data.product_version_id }
  }
  if (!source) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

  const { data: item, error } = await db.from('machine_items').select('id')
    .eq('machine_id', parsed.data.machineId).eq('is_sample', false)
    .eq(source.versionColumn, source.versionId).limit(1).maybeSingle()
  if (error || !item) return NextResponse.json({ error: 'Файл не принадлежит этому заказу' }, { status: 403 })
  return resolveFileResponse({ bucket: source.bucket, objectPath: source.objectPath, fileName: source.fileName, mimeType: source.mimeType, disposition: 'attachment' })
}
