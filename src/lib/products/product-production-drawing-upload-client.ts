'use client'

import { createClient } from '@/lib/supabase/client'
import type { DirectProductProductionDrawingUpload } from '@/lib/products/product-production-drawing'

type SignedUploadResponse = {
  data?: {
    bucket: string
    objectPath: string
    token: string
  }
  error?: string
}

export async function uploadProductProductionDrawingDirect(
  productId: string,
  productVersionId: string,
  file: File,
): Promise<DirectProductProductionDrawingUpload> {
  const response = await fetch('/api/products/production-drawings/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      productVersionId,
      fileName: file.name,
      contentType: file.type || null,
      size: file.size,
    }),
  })
  const payload = await response.json() as SignedUploadResponse
  if (!response.ok || !payload.data) throw new Error(payload.error || 'Не удалось подготовить загрузку файла')

  const { bucket, objectPath, token } = payload.data
  const { error } = await createClient().storage
    .from(bucket)
    .uploadToSignedUrl(objectPath, token, file, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (error) throw error

  return {
    objectPath,
    fileName: file.name,
    mimeType: 'application/pdf',
    fileSize: file.size,
  }
}

export async function cleanupProductProductionDrawingUploads(
  productId: string,
  productVersionId: string,
  uploads: DirectProductProductionDrawingUpload[],
) {
  if (uploads.length === 0) return
  await fetch('/api/products/production-drawings/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      productVersionId,
      objectPaths: uploads.map((upload) => upload.objectPath),
    }),
  }).catch(() => undefined)
}
