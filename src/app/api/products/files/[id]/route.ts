import { NextResponse } from 'next/server'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase } = await requirePermission('products', 'view')

    const { data, error } = await supabase
      .from('product_files')
      .select('file_path')
      .eq('id', id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    const file = data as { file_path: string }

    const { data: signed, error: signedError } = await supabase.storage
      .from('product-files')
      .createSignedUrl(file.file_path, 60)

    if (signedError || !signed?.signedUrl) return NextResponse.json({ error: 'Cannot open file' }, { status: 500 })
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    const status = error instanceof PermissionDeniedError ? 403 : 401
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}
