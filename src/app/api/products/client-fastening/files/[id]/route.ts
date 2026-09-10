import { NextResponse } from 'next/server'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requirePermission('products', 'view')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('product_version_client_fastening_files')
      .select('file_path,file_name,mime_type')
      .eq('id', id)
      .single()
    if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

    return await resolveFileResponse({
      bucket: 'product-files',
      objectPath: data.file_path,
      fileName: data.file_name,
      mimeType: data.mime_type,
      disposition: 'attachment',
    })
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Файл недоступен' }, { status: 401 })
  }
}
