'use client'

import { createClient } from '@/lib/supabase/client'
import type { DirectProductUpload, ProductUploadFileKind } from '@/lib/products/product-file-upload'

type SignedUploadResponse = {
  data?: {
    bucket: string
    objectPath: string
    token: string
  }
  error?: string
}

export async function uploadProductFileDirect(
  productId: string,
  fileKind: ProductUploadFileKind,
  file: File,
): Promise<DirectProductUpload> {
  const response = await fetch('/api/products/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      fileKind,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })
  const payload = await response.json() as SignedUploadResponse
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Не удалось подготовить загрузку файла')
  }

  const { bucket, objectPath, token } = payload.data
  const { error } = await createClient().storage
    .from(bucket)
    .uploadToSignedUrl(objectPath, token, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (error) throw error

  return {
    objectPath,
    fileKind,
    fileName: file.name,
    mimeType: file.type || null,
    fileSize: file.size,
  }
}

export async function cleanupDirectProductUploads(productId: string, uploads: DirectProductUpload[]) {
  if (uploads.length === 0) return
  await fetch('/api/products/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      objectPaths: uploads.map((upload) => upload.objectPath),
    }),
  }).catch(() => undefined)
}
