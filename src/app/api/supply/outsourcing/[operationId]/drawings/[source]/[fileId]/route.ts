import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { downloadFileBytes } from '@/lib/file-archive/resolver'

type FileRow = {
  id: string
  product_id?: string | null
  version_id?: string | null
  file_path: string | null
  file_name: string | null
  mime_type: string | null
}

function contentDisposition(fileName: string) {
  const normalized = fileName.replace(/[\r\n"]/g, '_').trim() || 'drawing.pdf'
  const asciiFallback = normalized.replace(/[^\x20-\x7E]/g, '_')
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string; source: string; fileId: string }> },
) {
  try {
    const { operationId, source, fileId } = await params
    await requirePermission('supply_transport', 'view')
    const admin = createAdminClient()

    if (source !== 'product' && source !== 'project') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const fileResult = source === 'product'
      ? await admin
        .from('product_files')
        .select('id, product_id, file_path, file_name, mime_type')
        .eq('id', fileId)
        .maybeSingle()
      : await admin
        .from('product_project_files')
        .select('id, version_id, file_path, file_name, mime_type')
        .eq('id', fileId)
        .maybeSingle()
    const file = fileResult.data as FileRow | null
    if (fileResult.error || !file?.file_path) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const { data: linksData, error: linksError } = await admin
      .from('machine_outsourcing_operation_items')
      .select('machine_item_id')
      .eq('operation_id', operationId)
    if (linksError) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const links = (linksData || []) as Array<{ machine_item_id: string }>
    const machineItemIds = links.map((link) => link.machine_item_id)
    if (machineItemIds.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const { data: itemsData, error: itemsError } = await admin
      .from('machine_items')
      .select('product_id, product_project_version_id')
      .in('id', machineItemIds)
    if (itemsError) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const items = (itemsData || []) as Array<{
      product_id: string | null
      product_project_version_id: string | null
    }>
    const belongsToRequest = source === 'product'
      ? Boolean(file.product_id) && items.some((item) => item.product_id === file.product_id)
      : Boolean(file.version_id) && items.some((item) => item.product_project_version_id === file.version_id)
    if (!belongsToRequest) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    let storedFile: Buffer
    try {
      storedFile = await downloadFileBytes('product-files', file.file_path)
    } catch {
      return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
    }

    return new NextResponse(new Uint8Array(storedFile), {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': String(storedFile.byteLength),
        'Content-Disposition': contentDisposition(file.file_name || 'drawing.pdf'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}
