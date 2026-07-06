import { NextResponse } from 'next/server'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'

type FilePathRow = { file_path: string | null }

export async function GET(_request: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params
  await getCurrentUserContext()
  const admin = createAdminClient()

  let filePath: string | null = null
  let error: { message?: string } | null = null

  if (source === 'product') {
    const result = await admin
      .from('product_files')
      .select('file_path')
      .eq('id', id)
      .single()
    filePath = ((result.data as FilePathRow | null)?.file_path || null)
    error = result.error
  } else if (source === 'project') {
    const result = await admin
      .from('product_project_files')
      .select('file_path')
      .eq('id', id)
      .single()
    filePath = ((result.data as FilePathRow | null)?.file_path || null)
    error = result.error
  } else {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  if (error || !filePath) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const { data: signed, error: signedError } = await admin.storage
    .from('product-files')
    .createSignedUrl(filePath, 60)

  if (signedError || !signed?.signedUrl) return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
