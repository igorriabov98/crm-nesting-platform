import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import type { DepartmentRequestTarget } from '@/lib/department-requests'
import { hasPermission } from '@/lib/permissions/resources'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { requireClientCommercialDocumentVisibility } from '@/lib/permissions/commercial-visibility'

type AttachmentRow = {
  id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  request: {
    created_by: string
    target_department: DepartmentRequestTarget
    factory_id: string | null
    machine: { client_id: string | null } | Array<{ client_id: string | null }> | null
  } | null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const context = await requirePermission('department_requests', 'view')
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('department_request_attachments')
      .select(`
        id,
        storage_path,
        file_name,
        mime_type,
        request:department_requests!department_request_attachments_request_id_fkey(
          created_by,
          target_department,
          factory_id,
          machine:machines(client_id)
        )
      `)
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

    const attachment = data as unknown as AttachmentRow
    const request = attachment.request
    const canManage = hasPermission(context.permissions, 'department_requests', 'manage')
    if (!request || (request.created_by !== context.userId && !canManage)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    const machine = Array.isArray(request.machine) ? request.machine[0] : request.machine
    if (machine?.client_id) await requireClientCommercialDocumentVisibility(machine.client_id, false)
    if (!attachment.storage_path.startsWith('department-requests/') || attachment.storage_path.includes('..')) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    }

    try {
      return await resolveFileResponse({
        bucket: 'department-request-files', objectPath: attachment.storage_path,
        fileName: attachment.file_name, mimeType: attachment.mime_type,
      })
    } catch {
      return NextResponse.json({ error: 'Не удалось открыть файл' }, { status: 500 })
    }
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Недостаточно прав' : 'Необходима авторизация' }, { status })
  }
}
