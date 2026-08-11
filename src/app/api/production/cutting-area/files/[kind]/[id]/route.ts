import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { canAccessFactory } from '@/lib/permissions/factory-scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import {
  isCuttingAreaFileForItem,
  type CuttingAreaFileBinding,
  type CuttingAreaItemFileBinding,
} from '@/lib/production-cutting-area/files'

/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic file source types are narrowed below. */

const paramsSchema = z.object({
  kind: z.enum(['product','project','production_drawing']),
  id: z.string().uuid(),
  machineId: z.string().uuid(),
})

type FileSource = {
  objectPath: string
  fileName: string
  mimeType: string | null
  bucket: string
  binding: CuttingAreaFileBinding
}

async function loadItemBindings(db: any, machineId: string): Promise<CuttingAreaItemFileBinding[]> {
  const itemResult = await db.from('machine_items')
    .select('product_id,product_version_id,product_project_id,product_project_version_id')
    .eq('machine_id', machineId)
    .eq('is_sample', false)
  if (itemResult.error) throw new Error(itemResult.error.message)
  const items = itemResult.data || []
  const missingProductIds = Array.from(new Set(items.filter((item: any) => item.product_id && !item.product_version_id).map((item: any) => item.product_id))) as string[]
  const missingProjectIds = Array.from(new Set(items.filter((item: any) => item.product_project_id && !item.product_project_version_id).map((item: any) => item.product_project_id))) as string[]
  const [versionResult, projectResult] = await Promise.all([
    missingProductIds.length ? db.from('product_versions').select('id,product_id').in('product_id', missingProductIds).eq('status', 'current') : { data: [], error: null },
    missingProjectIds.length ? db.from('product_projects').select('id,approved_version_id').in('id', missingProjectIds) : { data: [], error: null },
  ])
  if (versionResult.error) throw new Error(versionResult.error.message)
  if (projectResult.error) throw new Error(projectResult.error.message)
  const currentVersionByProduct = new Map((versionResult.data || []).map((version: any) => [version.product_id, version.id]))
  const approvedVersionByProject = new Map((projectResult.data || []).map((project: any) => [project.id, project.approved_version_id]))
  return items.map((item: any): CuttingAreaItemFileBinding => ({
    productId: item.product_id || null,
    productVersionId: item.product_version_id || currentVersionByProduct.get(item.product_id) || null,
    productProjectId: item.product_project_id || null,
    productProjectVersionId: item.product_project_version_id || approvedVersionByProject.get(item.product_project_id) || null,
  }))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const permission = await requirePermission('production_cutting_area', 'view')
  const routeParams = await params
  const parsed = paramsSchema.safeParse({ ...routeParams, machineId: request.nextUrl.searchParams.get('machineId') })
  if (!parsed.success) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const db = createAdminClient() as any
  const machine = await db.from('machines').select('factory_id').eq('id', parsed.data.machineId).maybeSingle()
  if (machine.error || !machine.data || !canAccessFactory(permission, 'production_cutting_area', 'view', machine.data.factory_id)) {
    return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  }
  let source: FileSource | null = null

  if (parsed.data.kind === 'product') {
    const { data } = await db.from('product_files').select('file_path,file_name,mime_type,file_kind,product_id,product_version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.product_id && ['drawing','step','pdf'].includes(data.file_kind)) source = {
      objectPath: data.file_path,
      fileName: data.file_name,
      mimeType: data.mime_type,
      bucket: 'product-files',
      binding: { kind: 'product', productId: data.product_id, productVersionId: data.product_version_id, fileKind: data.file_kind },
    }
  } else if (parsed.data.kind === 'project') {
    const { data } = await db.from('product_project_files').select('file_path,file_name,mime_type,file_kind,project_id,version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.project_id && data.file_kind !== 'photo') source = {
      objectPath: data.file_path,
      fileName: data.file_name,
      mimeType: data.mime_type,
      bucket: 'product-files',
      binding: { kind: 'project', productProjectId: data.project_id, productProjectVersionId: data.version_id, fileKind: data.file_kind },
    }
  } else {
    const { data } = await db.from('product_production_drawings').select('file_path,file_name,mime_type,product_version_id').eq('id', parsed.data.id).maybeSingle()
    if (data?.product_version_id) source = {
      objectPath: data.file_path,
      fileName: data.file_name,
      mimeType: data.mime_type,
      bucket: 'product-production-drawings',
      binding: { kind: 'production_drawing', productVersionId: data.product_version_id, fileKind: 'pdf' },
    }
  }
  if (!source) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

  const itemBindings = await loadItemBindings(db, parsed.data.machineId)
  if (!itemBindings.some((item) => isCuttingAreaFileForItem(item, source.binding))) {
    return NextResponse.json({ error: 'Файл не принадлежит этому заказу' }, { status: 403 })
  }
  return resolveFileResponse({ bucket: source.bucket, objectPath: source.objectPath, fileName: source.fileName, mimeType: source.mimeType, disposition: 'attachment' })
}
