'use client'

import { createClient } from '@/lib/supabase/client'
import type { DirectMachineCuttingUpload } from '@/lib/machine-cutting/files'

type SignedUploadResponse = {
  data?: {
    bucket: string
    completionId: string | null
    objectPath: string
    token: string
  }
  error?: string
  file?: string | null
  code?: string
  message?: string
  retryable?: boolean
}

export class MachineCuttingUploadError extends Error {
  readonly file: string
  readonly code: string
  readonly retryable: boolean

  constructor(file: string, input?: Pick<SignedUploadResponse, 'code' | 'message' | 'error' | 'retryable'>) {
    super(input?.message || input?.error || 'Не удалось загрузить архив')
    this.name = 'MachineCuttingUploadError'
    this.file = file
    this.code = input?.code || 'upload_failed'
    this.retryable = input?.retryable !== false
  }
}

export async function cleanupDirectMachineCuttingUpload(
  machineId: string,
  upload: Pick<DirectMachineCuttingUpload, 'requestId' | 'completionId' | 'objectPath'>,
) {
  await fetch('/api/machine-cutting/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, requestId: upload.requestId, completionId: upload.completionId, objectPath: upload.objectPath }),
  }).catch(() => undefined)
}

export async function uploadMachineCuttingFileDirect(machineId: string, requestId: string, file: File): Promise<DirectMachineCuttingUpload> {
  const response = await fetch('/api/machine-cutting/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machineId,
      requestId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })
  const payload = await response.json() as SignedUploadResponse
  if (!response.ok || !payload.data) {
    throw new MachineCuttingUploadError(file.name, payload)
  }

  const { bucket, completionId, objectPath, token } = payload.data
  const upload: DirectMachineCuttingUpload = {
    requestId,
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
    throw new MachineCuttingUploadError(file.name, {
      code: 'storage_upload_failed',
      message: error.message,
      retryable: true,
    })
  }
  return upload
}
