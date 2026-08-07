/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/permissions/server'
import { fetchAndCacheAttachment } from '@/lib/mail/attachments'
import { resolveFileResponse } from '@/lib/file-archive/resolver'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase } = await requireAnyPermission([
      { resourceKey: 'mail', operation: 'view' },
      { resourceKey: 'product_projects', operation: 'view' },
      { resourceKey: 'department_requests', operation: 'view' },
    ])
    const { data } = await (supabase as any).from('mail_attachments')
      .select('id,storage_path,file_name,mime_type')
      .eq('id', id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Вложение недоступно' }, { status: 404 })
    if (data.storage_path) {
      return await resolveFileResponse({
        bucket: 'mail-project-attachments', objectPath: data.storage_path,
        fileName: data.file_name, mimeType: data.mime_type, disposition: 'attachment',
      })
    }
    const { bytes, attachment } = await fetchAndCacheAttachment(id)
    return new NextResponse(bytes, {
      headers: {
        'content-type': attachment.mime_type,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
        'cache-control': 'private, max-age=300',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось загрузить вложение' }, { status: 500 })
  }
}
