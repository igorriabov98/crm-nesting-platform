import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { MACHINE_CUTTING_BUCKET } from '@/lib/machine-cutting/files'
import { requireClientCommercialDocumentVisibility } from '@/lib/permissions/commercial-visibility'

type CuttingArchiveRow = {
  storage_path: string
  file_name: string
  mime_type: string | null
  machine: { client_id: string | null } | Array<{ client_id: string | null }> | null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requirePermission('machine_cutting', 'view')
    const { data, error } = await createAdminClient()
      .from('machine_cutting_archives')
      .select('storage_path,file_name,mime_type,machine:machines(client_id)')
      .eq('id', id)
      .maybeSingle()

    if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    const file = data as unknown as CuttingArchiveRow
    const machine = Array.isArray(file.machine) ? file.machine[0] : file.machine
    if (!machine?.client_id) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    await requireClientCommercialDocumentVisibility(machine.client_id, false)
    return resolveFileResponse({
      bucket: MACHINE_CUTTING_BUCKET,
      objectPath: file.storage_path,
      fileName: file.file_name,
      mimeType: file.mime_type,
      disposition: 'attachment',
    })
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}
