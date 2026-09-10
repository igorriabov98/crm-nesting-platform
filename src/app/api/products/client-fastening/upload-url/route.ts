import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import {
  clientFasteningUploadPrefix,
  validateClientFasteningFile,
  type ClientFasteningFileType,
} from '@/lib/products/product-client-fastening'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const id = z.string().uuid()
const uploadSchema = z.object({
  productId: id,
  productVersionId: id,
  clientId: id,
  fasteningType: z.enum(['metal_plate', 'a4_plate']),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int().positive(),
})
const cleanupSchema = z.object({
  productId: id,
  productVersionId: id,
  clientId: id,
  objectPaths: z.array(z.string().min(1)).min(1).max(2),
})

async function assertUploadScope(input: {
  productId: string
  productVersionId: string
  clientId: string
}) {
  await requirePermission('products', 'manage')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const [{ data: version, error: versionError }, { data: client, error: clientError }] = await Promise.all([
    admin
      .from('product_versions')
      .select('id')
      .eq('id', input.productVersionId)
      .eq('product_id', input.productId)
      .eq('status', 'current')
      .single(),
    admin.from('clients').select('id').eq('id', input.clientId).single(),
  ])
  if (versionError || !version) throw new Error('Текущая версия изделия не найдена')
  if (clientError || !client) throw new Error('Клиент не найден')
  return admin
}

export async function POST(request: NextRequest) {
  try {
    const input = uploadSchema.parse(await request.json())
    const { extension } = validateClientFasteningFile({
      fasteningType: input.fasteningType as ClientFasteningFileType,
      fileName: input.fileName,
      fileSize: input.size,
    })
    const admin = await assertUploadScope(input)
    const prefix = clientFasteningUploadPrefix(
      input.productId,
      input.productVersionId,
      input.clientId,
      input.fasteningType as ClientFasteningFileType,
    )
    const objectPath = `${prefix}${Date.now()}-${randomUUID()}${extension}`
    const { data, error } = await admin.storage.from('product-files').createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')

    return NextResponse.json({
      data: { bucket: 'product-files', objectPath, token: data.token },
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
    const admin = await assertUploadScope(input)
    const rootPrefix = `products/${input.productId}/versions/${input.productVersionId}/clients/${input.clientId}/`
    if (input.objectPaths.some((path) => !path.startsWith(rootPrefix) || path.includes('..'))) {
      throw new Error('Некорректный путь файла таблички')
    }
    const { error } = await admin.storage.from('product-files').remove(input.objectPaths)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось очистить загрузку' },
      { status: 400 },
    )
  }
}
