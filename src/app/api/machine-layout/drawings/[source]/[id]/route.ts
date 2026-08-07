import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { downloadFileBytes } from '@/lib/file-archive/resolver'

type FileRow = { file_path: string | null; file_name: string | null; mime_type: string | null }

function contentDisposition(fileName: string) {
  const normalized = fileName.replace(/[\r\n"]/g, '_').trim() || 'drawing.pdf'
  const asciiFallback = normalized.replace(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

export async function GET(_request: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params
  const context = await requirePermission('sales_plan', 'view')
  const admin = createAdminClient()
  const machineId = new URL(_request.url).searchParams.get('machineId')

  if (!hasPermission(context.permissions, 'nesting', 'view')) {
    if (!machineId) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const { data: assignedLayout } = await admin
      .from('machine_layout_requests')
      .select('id')
      .eq('machine_id', machineId)
      .eq('assigned_to', context.userId)
      .eq('status', 'requested')
      .contains('item_snapshot', [{ drawingFileSource: source, drawingFileId: id }])
      .limit(1)
      .maybeSingle()

    if (!assignedLayout) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  let filePath: string | null = null
  let fileName = 'drawing.pdf'
  let mimeType = 'application/octet-stream'
  let error: { message?: string } | null = null

  if (source === 'product') {
    const result = await admin
      .from('product_files')
      .select('file_path, file_name, mime_type')
      .eq('id', id)
      .single()
    const row = result.data as FileRow | null
    filePath = row?.file_path || null
    fileName = row?.file_name || fileName
    mimeType = row?.mime_type || mimeType
    error = result.error
  } else if (source === 'project') {
    const result = await admin
      .from('product_project_files')
      .select('file_path, file_name, mime_type')
      .eq('id', id)
      .single()
    const row = result.data as FileRow | null
    filePath = row?.file_path || null
    fileName = row?.file_name || fileName
    mimeType = row?.mime_type || mimeType
    error = result.error
  } else {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  if (error || !filePath) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  let file: Buffer
  try {
    file = await downloadFileBytes('product-files', filePath)
  } catch {
    return NextResponse.json({ error: 'Cannot download file' }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': String(file.byteLength),
      'Content-Disposition': contentDisposition(fileName),
      'Cache-Control': 'private, no-store',
    },
  })
}
