import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { PermissionDeniedError } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProductProductionDrawingAccess } from '@/lib/products/product-production-drawing-access'
import { PRODUCT_PRODUCTION_DRAWING_BUCKET } from '@/lib/products/product-production-drawing'
import type { ProductProductionDrawing } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    z.string().uuid().parse(id)
    await requireProductProductionDrawingAccess('view')
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('product_production_drawings')
      .select('file_path, product_version_id')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    const drawing = data as Pick<ProductProductionDrawing, 'file_path' | 'product_version_id'>

    const { data: version, error: versionError } = await admin
      .from('product_versions')
      .select('id')
      .eq('id', drawing.product_version_id)
      .maybeSingle()
    if (versionError || !version) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

    const { data: signed, error: signedError } = await admin.storage
      .from(PRODUCT_PRODUCTION_DRAWING_BUCKET)
      .createSignedUrl(drawing.file_path, 60)
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Не удалось открыть файл' }, { status: 500 })
    }
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    if (error instanceof AuthRequiredError || error instanceof UserProfileMissingError || error instanceof UserInactiveError) {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Некорректный идентификатор файла' }, { status: 400 })
  }
}
