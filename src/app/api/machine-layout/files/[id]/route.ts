import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'

type LayoutFileRow = { pdf_file_path: string | null; pdf_file_name: string | null; pdf_mime_type: string | null }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('nesting', 'view')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('machine_layout_requests')
    .select('pdf_file_path,pdf_file_name,pdf_mime_type')
    .eq('id', id)
    .single()

  const filePath = ((data as LayoutFileRow | null)?.pdf_file_path || null)
  if (error || !filePath) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const file = data as LayoutFileRow
  return resolveFileResponse({ bucket: 'product-files', objectPath: filePath, fileName: file.pdf_file_name, mimeType: file.pdf_mime_type })
}
