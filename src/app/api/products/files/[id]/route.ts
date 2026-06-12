import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
}
