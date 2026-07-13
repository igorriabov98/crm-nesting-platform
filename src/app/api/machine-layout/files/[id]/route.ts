import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'

type LayoutFileRow = { pdf_file_path: string | null }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('nesting', 'view')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('machine_layout_requests')
    .select('pdf_file_path')
    .eq('id', id)
    .single()

  const filePath = ((data as LayoutFileRow | null)?.pdf_file_path || null)
  if (error || !filePath) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const { data: signed, error: signedError } = await admin.storage
    .from('product-files')
    .createSignedUrl(filePath, 60)

  if (signedError || !signed?.signedUrl) return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
