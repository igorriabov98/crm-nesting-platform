'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProductProductionDrawingAccess } from '@/lib/products/product-production-drawing-access'
import {
  PRODUCT_PRODUCTION_DRAWING_BUCKET,
  validateDirectProductProductionDrawingUploads,
  validateProductProductionDrawingFile,
  type DirectProductProductionDrawingUpload,
} from '@/lib/products/product-production-drawing'
import type { ProductProductionDrawing } from '@/lib/types'

const uuidSchema = z.string().uuid()

type DbError = { message?: string; details?: string; hint?: string; code?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  maybeSingle: () => Promise<LooseDbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

function dbFrom(supabase: unknown): LooseDb {
  return supabase as LooseDb
}

export type ProductProductionDrawingDto = Pick<
  ProductProductionDrawing,
  'id' | 'product_version_id' | 'file_name' | 'file_size' | 'created_at'
>

type ActionResult<T> = {
  success: boolean
  data: T | null
  error: string | null
}

function toDto(row: ProductProductionDrawing): ProductProductionDrawingDto {
  return {
    id: row.id,
    product_version_id: row.product_version_id,
    file_name: row.file_name,
    file_size: row.file_size,
    created_at: row.created_at,
  }
}

function revalidateProduct(productId: string) {
  revalidatePath(ROUTES.PRODUCTS)
  revalidatePath(`${ROUTES.PRODUCTS}/${productId}`)
}

async function assertStoredPdfSignature(
  admin: ReturnType<typeof createAdminClient>,
  objectPath: string,
  fileName: string,
) {
  const { data: signed, error } = await admin.storage
    .from(PRODUCT_PRODUCTION_DRAWING_BUCKET)
    .createSignedUrl(objectPath, 60)
  if (error || !signed?.signedUrl) throw new Error(error?.message || `Не удалось проверить файл ${fileName}`)

  const response = await fetch(signed.signedUrl, {
    cache: 'no-store',
    headers: { Range: 'bytes=0-4' },
  })
  if (!response.ok || !response.body) throw new Error(`Не удалось проверить формат файла ${fileName}`)

  const reader = response.body.getReader()
  const signature = new Uint8Array(5)
  let offset = 0
  try {
    while (offset < signature.length) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const remaining = signature.length - offset
      signature.set(value.subarray(0, remaining), offset)
      offset += Math.min(value.length, remaining)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (offset !== signature.length || new TextDecoder().decode(signature) !== '%PDF-') {
    throw new Error(`Файл ${fileName} не является PDF-документом`)
  }
}

async function requireOwnedVersion(
  productId: string,
  productVersionId: string,
  options: { currentOnly?: boolean } = {},
) {
  uuidSchema.parse(productId)
  uuidSchema.parse(productVersionId)

  const admin = createAdminClient()
  const db = dbFrom(admin)
  let query = db
    .from('product_versions')
    .select('id, product_id, status')
    .eq('id', productVersionId)
    .eq('product_id', productId)

  if (options.currentOnly) query = query.eq('status', 'current')
  const { data, error } = await query.maybeSingle()
  if (error || !data) {
    throw new Error(options.currentOnly
      ? 'Изменять комплект можно только у текущей версии изделия'
      : 'Версия изделия не найдена')
  }
  return { admin, version: data }
}

export async function getProductProductionDrawings(
  productId: string,
): Promise<ActionResult<ProductProductionDrawingDto[]>> {
  try {
    await requireProductProductionDrawingAccess('view')
    uuidSchema.parse(productId)
    const admin = createAdminClient()
    const db = dbFrom(admin)
    const { data: versions, error: versionsError } = await db
      .from('product_versions')
      .select('id')
      .eq('product_id', productId)
    if (versionsError) throw versionsError

    const versionRows = (versions || []) as Array<{ id: string }>
    const versionIds = versionRows.map((version) => version.id)
    if (versionIds.length === 0) return { success: true, data: [], error: null }

    const { data, error } = await db
      .from('product_production_drawings')
      .select('id, product_version_id, file_name, file_size, created_at')
      .in('product_version_id', versionIds)
      .order('created_at', { ascending: false })
    if (error) throw error

    return {
      success: true,
      data: ((data || []) as ProductProductionDrawingDto[]),
      error: null,
    }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function registerProductProductionDrawings(
  productId: string,
  productVersionId: string,
  uploads: DirectProductProductionDrawingUpload[],
): Promise<ActionResult<ProductProductionDrawingDto[]>> {
  try {
    const context = await requireProductProductionDrawingAccess('manage')
    const normalizedUploads = validateDirectProductProductionDrawingUploads(productId, productVersionId, uploads)
    const { admin } = await requireOwnedVersion(productId, productVersionId, { currentOnly: true })
    const db = dbFrom(admin)

    const rows = await Promise.all(normalizedUploads.map(async (upload) => {
      const { data: info, error } = await admin.storage
        .from(PRODUCT_PRODUCTION_DRAWING_BUCKET)
        .info(upload.objectPath)
      if (error || !info) throw new Error(error?.message || `Файл ${upload.fileName} не найден в хранилище`)

      const actualSize = Number(info.size || 0)
      validateProductProductionDrawingFile({
        fileName: upload.fileName,
        fileSize: actualSize,
        mimeType: info.contentType || upload.mimeType,
      })
      if (actualSize !== upload.fileSize) throw new Error(`Размер файла ${upload.fileName} не совпадает с загруженным`)
      await assertStoredPdfSignature(admin, upload.objectPath, upload.fileName)

      return {
        product_version_id: productVersionId,
        file_name: upload.fileName,
        file_path: upload.objectPath,
        mime_type: 'application/pdf' as const,
        file_size: actualSize,
        uploaded_by: context.user.id,
      }
    }))

    const { data, error } = await db
      .from('product_production_drawings')
      .insert(rows)
      .select('*')
    if (error) throw error

    revalidateProduct(productId)
    return {
      success: true,
      data: ((data || []) as ProductProductionDrawing[]).map(toDto),
      error: null,
    }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function deleteProductProductionDrawing(
  productId: string,
  productVersionId: string,
  drawingId: string,
): Promise<ActionResult<null>> {
  try {
    await requireProductProductionDrawingAccess('manage')
    uuidSchema.parse(drawingId)
    const { admin } = await requireOwnedVersion(productId, productVersionId, { currentOnly: true })
    const db = dbFrom(admin)
    const { data, error } = await db
      .from('product_production_drawings')
      .select('*')
      .eq('id', drawingId)
      .eq('product_version_id', productVersionId)
      .maybeSingle()
    if (error || !data) throw new Error('Комплектный чертёж не найден')

    const drawing = data as ProductProductionDrawing
    const { error: deleteError } = await db
      .from('product_production_drawings')
      .delete()
      .eq('id', drawing.id)
      .eq('product_version_id', productVersionId)
    if (deleteError) throw deleteError

    // The database row is removed first so a transient storage error cannot expose
    // a broken download entry. A failed object cleanup only leaves a private orphan.
    await admin.storage.from(PRODUCT_PRODUCTION_DRAWING_BUCKET).remove([drawing.file_path]).catch(() => undefined)
    revalidateProduct(productId)
    return { success: true, data: null, error: null }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}
