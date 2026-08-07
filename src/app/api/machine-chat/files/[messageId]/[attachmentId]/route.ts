import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decodeMachineChatBody } from '@/lib/machine-chat-attachments'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import { resolveFileResponse } from '@/lib/file-archive/resolver'

type MachineRelation = { id: string; factory_id: string | null }
type MessageFileRow = {
  id: string
  machine_id: string
  body: string
  machine?: MachineRelation | MachineRelation[] | null
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  try {
    const { messageId, attachmentId } = await params
    const { role, factoryId } = await requirePermission('sales_plan', 'view')
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('machine_chat_messages')
      .select('id, machine_id, body, machine:machines(id, factory_id)')
      .eq('id', messageId)
      .single()

    if (error || !data) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const message = data as MessageFileRow
    const machine = relationOne(message.machine)
    if (
      role === 'production_manager' &&
      machine?.factory_id &&
      machine.factory_id !== factoryId
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const attachment = decodeMachineChatBody(message.body).attachments.find((item) => item.id === attachmentId)
    if (!attachment || !attachment.path.startsWith(`machine-chat/${message.machine_id}/`)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    try {
      return await resolveFileResponse({
        bucket: 'product-files', objectPath: attachment.path, fileName: attachment.fileName, mimeType: attachment.mimeType,
      })
    } catch {
      return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
    }
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}
