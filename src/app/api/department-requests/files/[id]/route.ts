import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { canManageDepartmentRequestTarget, type DepartmentRequestTarget } from '@/lib/department-requests'

type AttachmentRow = {
  id: string
  storage_path: string
  request: {
    created_by: string
    target_department: DepartmentRequestTarget
    factory_id: string | null
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
        request:department_requests!department_request_attachments_request_id_fkey(
          created_by,
          target_department,
          factory_id
        )
      `)
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

    const attachment = data as unknown as AttachmentRow
    const request = attachment.request
    const departmentAllowed = request && canManageDepartmentRequestTarget({
      target: request.target_department,
      role: context.role,
      memberships: context.permissionDetails.memberships.map((membership) => ({
        departmentName: membership.departmentName,
      })),
    })
    const factoryAllowed = !request
      || request.target_department !== 'production'
      || ['financial_director', 'commercial_director', 'planning_director'].includes(context.role)
      || !request.factory_id
      || request.factory_id === context.factoryId
    if (!request || (request.created_by !== context.userId && (!departmentAllowed || !factoryAllowed))) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!attachment.storage_path.startsWith('department-requests/') || attachment.storage_path.includes('..')) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    }

    const { data: signed, error: signedError } = await admin.storage
      .from('department-request-files')
      .createSignedUrl(attachment.storage_path, 60)
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Не удалось открыть файл' }, { status: 500 })
    }
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Недостаточно прав' : 'Необходима авторизация' }, { status })
  }
}
