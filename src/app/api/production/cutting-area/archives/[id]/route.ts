import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFileResponse } from '@/lib/file-archive/resolver'
import { MACHINE_CUTTING_BUCKET } from '@/lib/machine-cutting/files'

/* eslint-disable @typescript-eslint/no-explicit-any -- Migration types are generated after deployment. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permission = await requirePermission('production_cutting_area', 'view')
  const { id: rawId } = await params
  const parsed = z.object({ id: z.string().uuid(), machineId: z.string().uuid() }).safeParse({ id: rawId, machineId: request.nextUrl.searchParams.get('machineId') })
  if (!parsed.success) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const db = createAdminClient() as any
  const machine = await db.from('machines').select('factory_id').eq('id', parsed.data.machineId).maybeSingle()
  const isDirector = ['financial_director','commercial_director','planning_director'].includes(permission.role)
  if (machine.error || !machine.data || (!isDirector && permission.factoryId !== machine.data.factory_id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const { data, error } = await db.from('machine_cutting_archives')
    .select('machine_id,storage_path,file_name,mime_type')
    .eq('id', parsed.data.id).eq('machine_id', parsed.data.machineId).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  return resolveFileResponse({ bucket: MACHINE_CUTTING_BUCKET, objectPath: data.storage_path, fileName: data.file_name, mimeType: data.mime_type, disposition: 'attachment' })
}
