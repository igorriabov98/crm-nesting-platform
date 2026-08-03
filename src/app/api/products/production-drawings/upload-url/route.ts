import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { PermissionDeniedError } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProductProductionDrawingAccess } from '@/lib/products/product-production-drawing-access'
import {
  PRODUCT_PRODUCTION_DRAWING_BUCKET,
  productProductionDrawingUploadPrefix,
  validateProductProductionDrawingFile,
} from '@/lib/products/product-production-drawing'
import type { ProductProductionDrawing } from '@/lib/types'

export const dynamic = 'force-dynamic'

const uploadSchema = z.object({
  productId: z.string().uuid(),
  productVersionId: z.string().uuid(),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).nullable().optional(),
  size: z.number().int().positive(),
})

const cleanupSchema = z.object({
  productId: z.string().uuid(),
  productVersionId: z.string().uuid(),
  objectPaths: z.array(z.string().min(1)).min(1).max(10),
})

async function requireOwnedVersion(productId: string, productVersionId: string, currentOnly: boolean) {
  const context = await requireProductProductionDrawingAccess('manage')
  const admin = createAdminClient()
  let query = admin
    .from('product_versions')
    .select('id')
    .eq('id', productVersionId)
    .eq('product_id', productId)
  if (currentOnly) query = query.eq('status', 'current')
  const { data, error } = await query.maybeSingle()
  if (error || !data) {
    throw new Error(currentOnly
      ? 'Изменять комплект можно только у текущей версии изделия'
      : 'Версия изделия не найдена')
  }
  return { context, admin }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PermissionDeniedError) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  if (error instanceof AuthRequiredError || error instanceof UserProfileMissingError || error instanceof UserInactiveError) {
    return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 })
  }
  const message = error instanceof Error ? error.message : fallback
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const input = uploadSchema.parse(await request.json())
    validateProductProductionDrawingFile({
      fileName: input.fileName,
      fileSize: input.size,
      mimeType: input.contentType,
    })
    const { admin } = await requireOwnedVersion(input.productId, input.productVersionId, true)
    const objectPath = `${productProductionDrawingUploadPrefix(input.productId, input.productVersionId)}${Date.now()}-${randomUUID()}.pdf`
    const { data, error } = await admin.storage
      .from(PRODUCT_PRODUCTION_DRAWING_BUCKET)
      .createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось подготовить загрузку файла')

    return NextResponse.json({
      data: {
        bucket: PRODUCT_PRODUCTION_DRAWING_BUCKET,
        objectPath,
        token: data.token,
      },
    })
  } catch (error) {
    return errorResponse(error, 'Не удалось подготовить загрузку файла')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const input = cleanupSchema.parse(await request.json())
    // Cleanup is allowed after a concurrent version switch, but only for
    // unregistered objects under a version that still belongs to this product.
    const { admin } = await requireOwnedVersion(input.productId, input.productVersionId, false)
    const prefix = productProductionDrawingUploadPrefix(input.productId, input.productVersionId)
    if (input.objectPaths.some((path) => !path.startsWith(prefix) || path.includes('..') || !path.endsWith('.pdf'))) {
      throw new Error('Некорректный путь комплектного чертежа')
    }

    const { data: registered, error: registeredError } = await admin
      .from('product_production_drawings')
      .select('file_path')
      .in('file_path', input.objectPaths)
    if (registeredError) throw registeredError
    const registeredRows = (registered || []) as Array<Pick<ProductProductionDrawing, 'file_path'>>
    const registeredPaths = new Set(registeredRows.map((drawing) => drawing.file_path))
    const removablePaths = input.objectPaths.filter((path) => !registeredPaths.has(path))
    if (removablePaths.length > 0) {
      const { error } = await admin.storage.from(PRODUCT_PRODUCTION_DRAWING_BUCKET).remove(removablePaths)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Не удалось очистить загрузку')
  }
}
