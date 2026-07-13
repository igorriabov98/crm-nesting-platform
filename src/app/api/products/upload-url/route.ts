import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  productUploadPrefix,
  validateProductUploadRequest,
  type ProductUploadFileKind,
} from '@/lib/products/product-file-upload'

export const dynamic = 'force-dynamic'

const productUploadSchema = z.object({
  productId: z.string().uuid(),
  fileKind: z.enum(['drawing', 'step', 'pdf', 'photo', 'other']),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int().positive(),
})

const cleanupSchema = z.object({
  productId: z.string().uuid(),
  objectPaths: z.array(z.string().min(1)).min(1).max(10),
})

async function assertProductExists(productId: string) {
  const { supabase: db } = await requirePermission('products', 'manage')
  const { data, error } = await db.from('products').select('id').eq('id', productId).single()
  if (error || !data) throw new Error('Изделие не найдено')
}

export async function POST(request: NextRequest) {
  try {
    const input = productUploadSchema.parse(await request.json())
    await assertProductExists(input.productId)
    const { extension } = validateProductUploadRequest({
      fileKind: input.fileKind as ProductUploadFileKind,
      fileName: input.fileName,
      fileSize: input.size,
    })
    const objectPath = `${productUploadPrefix(input.productId)}${Date.now()}-${randomUUID()}${extension}`
    const adminSupabase = createAdminClient()
    const { data, error } = await adminSupabase.storage
      .from('product-files')
      .createSignedUploadUrl(objectPath)

    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')
    return NextResponse.json({
      data: {
        bucket: 'product-files',
        objectPath,
        token: data.token,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось подготовить загрузку' },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const input = cleanupSchema.parse(await request.json())
    await assertProductExists(input.productId)
    const prefix = productUploadPrefix(input.productId)
    const objectPaths = input.objectPaths.filter((path) => path.startsWith(prefix) && !path.includes('..'))
    if (objectPaths.length !== input.objectPaths.length) throw new Error('Некорректный путь файла')

    const { error } = await createAdminClient().storage.from('product-files').remove(objectPaths)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось очистить загрузку' },
      { status: 400 },
    )
  }
}
