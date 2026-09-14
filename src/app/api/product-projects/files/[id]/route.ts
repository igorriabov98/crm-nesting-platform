import { NextResponse } from 'next/server'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireClientDocumentAccess } from '@/lib/permissions/commercial-visibility'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requirePermission('product_projects', 'view')

    const { data, error } = await createAdminClient()
      .from('product_project_files')
      .select('file_path,file_name,mime_type,project:product_projects(client_id)')
      .eq('id', id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const file = data as unknown as {
      file_path: string
      file_name: string
      mime_type: string | null
      project: { client_id: string | null } | Array<{ client_id: string | null }> | null
    }
    const project = Array.isArray(file.project) ? file.project[0] : file.project
    if (!project?.client_id) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    await requireClientDocumentAccess(project.client_id, {
      resourceKey: 'product_projects',
      operation: 'view',
      includesPrices: false,
    })
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
