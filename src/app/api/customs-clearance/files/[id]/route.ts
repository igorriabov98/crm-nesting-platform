import { NextResponse } from 'next/server'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { assertFactoryAccess } from '@/lib/permissions/factory-scope'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'

type DocumentRow = {
  storage_path: string
  file_name: string
  mime_type: string
  machine: { factory_id: string | null } | Array<{ factory_id: string | null }> | null
}

function relationOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requirePermission('customs_clearance', 'view')
    const { id } = await params
    const { data, error } = await trustedDb(createAdminClient())
      .from('machine_customs_documents')
      .select('storage_path, file_name, mime_type, machine:machines(factory_id)')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
    const document = data as DocumentRow
    const machine = relationOne(document.machine)
    assertFactoryAccess(context, 'customs_clearance', 'view', machine?.factory_id)
    if (!document.storage_path.startsWith('customs-clearance/') || document.storage_path.includes('..')) {
      return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
    }
    const download = new URL(request.url).searchParams.get('download') === '1'
    try {
      return await resolveFileResponse({
        bucket: 'customs-clearance-files',
        objectPath: document.storage_path,
        fileName: document.file_name,
        mimeType: document.mime_type,
        disposition: download ? 'attachment' : 'inline',
      })
    } catch {
      return NextResponse.json({ error: 'Не удалось открыть документ' }, { status: 500 })
    }
  } catch (error) {
    const status = error instanceof PermissionDeniedError
      ? 403
      : error instanceof AuthRequiredError
        || error instanceof UserProfileMissingError
        || error instanceof UserInactiveError
        ? 401
        : 500
    return NextResponse.json(
      {
        error: status === 403
          ? 'Недостаточно прав'
          : status === 401
            ? 'Необходима авторизация'
            : 'Не удалось открыть документ',
      },
      { status },
    )
  }
}
