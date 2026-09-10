'use client'

import { createClient } from '@/lib/supabase/client'
import type {
  ClientFasteningFileType,
  DirectClientFasteningUpload,
} from '@/lib/products/product-client-fastening'

type SignedUploadResponse = {
  data?: {
    bucket: string
    objectPath: string
    token: string
  }
  error?: string
}

export async function uploadClientFasteningFileDirect(input: {
  productId: string
  productVersionId: string
  clientId: string
  fasteningType: ClientFasteningFileType
  file: File
}): Promise<DirectClientFasteningUpload> {
  const response = await fetch('/api/products/client-fastening/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: input.productId,
      productVersionId: input.productVersionId,
      clientId: input.clientId,
      fasteningType: input.fasteningType,
      fileName: input.file.name,
      contentType: input.file.type || 'application/octet-stream',
      size: input.file.size,
    }),
  })
  const payload = await response.json() as SignedUploadResponse
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Не удалось подготовить загрузку файла таблички')
  }

  const { bucket, objectPath, token } = payload.data
  const { error } = await createClient().storage
    .from(bucket)
    .uploadToSignedUrl(objectPath, token, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    })
  if (error) throw error

  return {
    objectPath,
    fasteningType: input.fasteningType,
    fileName: input.file.name,
    mimeType: input.file.type || null,
    fileSize: input.file.size,
  }
}

export async function cleanupClientFasteningUploads(input: {
  productId: string
  productVersionId: string
  clientId: string
  uploads: DirectClientFasteningUpload[]
}) {
  if (input.uploads.length === 0) return
  await fetch('/api/products/client-fastening/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: input.productId,
      productVersionId: input.productVersionId,
      clientId: input.clientId,
      objectPaths: input.uploads.map((upload) => upload.objectPath),
    }),
  }).catch(() => undefined)
}
