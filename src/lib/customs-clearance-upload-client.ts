'use client'

import { createClient } from '@/lib/supabase/client'
import {
  CUSTOMS_CLEARANCE_FILE_MAX_COUNT,
  type CustomsClearanceDirectUpload,
  validateCustomsClearanceFile,
} from '@/lib/customs-clearance-files'

type SignedUploadResponse = {
  data?: { bucket: string; objectPath: string; token: string; contentType: string }
  error?: string
}

export async function uploadCustomsClearanceFiles(machineId: string, files: File[]) {
  if (files.length < 1 || files.length > CUSTOMS_CLEARANCE_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить от 1 до 10 файлов')
  }
  const validated = files.map((file) => validateCustomsClearanceFile({
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type || null,
  }))

  const results = await Promise.allSettled(files.map(async (file, index) => {
    const response = await fetch('/api/customs-clearance/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineId,
        fileName: file.name,
        contentType: file.type || validated[index].mimeType,
        size: file.size,
      }),
    })
    const payload = await response.json() as SignedUploadResponse
    if (!response.ok || !payload.data) throw new Error(payload.error || 'Не удалось подготовить загрузку файла')

    const { bucket, objectPath, token, contentType } = payload.data
    const { error } = await createClient().storage
      .from(bucket)
      .uploadToSignedUrl(objectPath, token, file, { contentType, upsert: false })
    if (error) throw error
    return {
      objectPath,
      fileName: file.name,
      mimeType: contentType,
      fileSize: file.size,
    } satisfies CustomsClearanceDirectUpload
  }))

  const uploads = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) {
    await cleanupCustomsClearanceUploads(machineId, uploads)
    throw failure.reason
  }
  return uploads
}

export async function cleanupCustomsClearanceUploads(
  machineId: string,
  uploads: CustomsClearanceDirectUpload[],
) {
  if (uploads.length === 0) return
  await fetch('/api/customs-clearance/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, objectPaths: uploads.map((upload) => upload.objectPath) }),
  }).catch(() => undefined)
}
