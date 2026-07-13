import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'

type FileRow = { file_path: string | null; file_name: string | null; mime_type: string | null }

function contentDisposition(fileName: string) {
  const normalized = fileName.replace(/[\r\n"]/g, '_').trim() || 'drawing.pdf'
  const asciiFallback = normalized.replace(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

export async function GET(_request: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params
  await requirePermission('nesting', 'view')
  const admin = createAdminClient()

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

  const { data: file, error: downloadError } = await admin.storage
    .from('product-files')
    .download(filePath)

  if (downloadError || !file) return NextResponse.json({ error: 'Cannot download file' }, { status: 500 })
  return new NextResponse(file, {
    headers: {
      'Content-Type': mimeType || file.type || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': contentDisposition(fileName),
      'Cache-Control': 'private, no-store',
    },
  })
}
