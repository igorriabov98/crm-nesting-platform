import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { MACHINE_CUTTING_BUCKET } from '@/lib/machine-cutting/files'

type CuttingArchiveRow = {
  storage_path: string
  file_name: string
  mime_type: string | null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('machine_cutting', 'view')
  const { data, error } = await createAdminClient()
    .from('machine_cutting_archives')
    .select('storage_path,file_name,mime_type')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const file = data as CuttingArchiveRow
  return resolveFileResponse({
    bucket: MACHINE_CUTTING_BUCKET,
    objectPath: file.storage_path,
    fileName: file.file_name,
    mimeType: file.mime_type,
    disposition: 'attachment',
  })
}
