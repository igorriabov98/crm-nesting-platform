'use client'

import { createClient } from '@/lib/supabase/client'
import type { DepartmentRequestAttachmentPhase } from '@/lib/department-requests'
import {
  DEPARTMENT_REQUEST_FILE_MAX_COUNT,
  type DepartmentRequestDirectUpload,
  validateDepartmentRequestFile,
} from '@/lib/department-request-files'

type SignedUploadResponse = {
  data?: {
    bucket: string
    objectPath: string
    token: string
  }
  error?: string
}

export async function uploadDepartmentRequestFiles(
  requestId: string,
  phase: DepartmentRequestAttachmentPhase,
  files: File[],
): Promise<DepartmentRequestDirectUpload[]> {
  if (files.length > DEPARTMENT_REQUEST_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить не больше 10 файлов')
  }
  files.forEach((file) => validateDepartmentRequestFile({ fileName: file.name, fileSize: file.size }))

  const results = await Promise.allSettled(files.map(async (file) => {
      const response = await fetch('/api/department-requests/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          phase,
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
        fileName: file.name,
        mimeType: file.type || null,
        fileSize: file.size,
      } satisfies DepartmentRequestDirectUpload
  }))
  const uploads = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) {
    await cleanupDepartmentRequestUploads(requestId, phase, uploads)
    throw failure.reason
  }
  return uploads
}

export async function cleanupDepartmentRequestUploads(
  requestId: string,
  phase: DepartmentRequestAttachmentPhase,
  uploads: DepartmentRequestDirectUpload[],
) {
  if (uploads.length === 0) return
  await fetch('/api/department-requests/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId,
      phase,
      objectPaths: uploads.map((upload) => upload.objectPath),
    }),
  }).catch(() => undefined)
}
