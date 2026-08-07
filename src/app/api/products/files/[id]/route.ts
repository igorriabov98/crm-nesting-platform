import { NextResponse } from 'next/server'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase } = await requirePermission('products', 'view')

    const { data, error } = await supabase
      .from('product_files')
      .select('file_path,file_name,mime_type')
      .eq('id', id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const file = data as { file_path: string; file_name: string; mime_type: string | null }
    try {
      return await resolveFileResponse({ bucket: 'product-files', objectPath: file.file_path, fileName: file.file_name, mimeType: file.mime_type })
    } catch {
      return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
    }
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}
