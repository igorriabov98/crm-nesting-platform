'use client'

import { createClient } from '@/lib/supabase/client'
import type { DirectMachineCuttingUpload } from '@/lib/machine-cutting/files'

type SignedUploadResponse = {
  data?: {
    bucket: string
    completionId: string
    objectPath: string
    token: string
  }
  error?: string
}

export async function cleanupDirectMachineCuttingUpload(
  machineId: string,
  upload: Pick<DirectMachineCuttingUpload, 'completionId' | 'objectPath'>,
) {
  await fetch('/api/machine-cutting/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, completionId: upload.completionId, objectPath: upload.objectPath }),
  }).catch(() => undefined)
}

export async function uploadMachineCuttingFileDirect(machineId: string, file: File): Promise<DirectMachineCuttingUpload> {
  const response = await fetch('/api/machine-cutting/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machineId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })
  const payload = await response.json() as SignedUploadResponse
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || 'Не удалось подготовить загрузку архива')
  }

  const { bucket, completionId, objectPath, token } = payload.data
  const upload: DirectMachineCuttingUpload = {
    completionId,
    objectPath,
    fileName: file.name,
    mimeType: file.type || null,
    fileSize: file.size,
  }
  const { error } = await createClient().storage.from(bucket).uploadToSignedUrl(objectPath, token, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) {
    await cleanupDirectMachineCuttingUpload(machineId, upload)
    throw error
  }
  return upload
}
