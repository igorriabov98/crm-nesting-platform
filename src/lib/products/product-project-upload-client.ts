'use client'

import { createClient } from '@/lib/supabase/client'
import {
  PRODUCT_PROJECT_FILE_MAX_COUNT,
  inferProductProjectFileKind,
  type DirectProductProjectUpload,
  validateProductProjectFile,
} from '@/lib/products/product-project-file-upload'

type SignedUploadResponse = {
  data?: { bucket: string; objectPath: string; token: string }
  error?: string
}

export async function uploadProductProjectCorrectionFiles(
  projectId: string,
  versionId: string,
  files: File[],
): Promise<DirectProductProjectUpload[]> {
  if (files.length > PRODUCT_PROJECT_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить не больше 10 файлов')
  }
  files.forEach((file) => validateProductProjectFile({ fileName: file.name, fileSize: file.size }))

  const results = await Promise.allSettled(files.map(async (file) => {
    const response = await fetch('/api/product-projects/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        versionId,
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
    const { error } = await createClient().storage.from(bucket).uploadToSignedUrl(
      objectPath,
      token,
      file,
      { contentType: file.type || 'application/octet-stream', upsert: false },
    )
    if (error) throw error

    return {
      objectPath,
      fileKind: inferProductProjectFileKind(file.name),
      fileName: file.name,
      mimeType: file.type || null,
      fileSize: file.size,
    } satisfies DirectProductProjectUpload
  }))

  const uploads = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) {
    await cleanupProductProjectCorrectionFiles(projectId, versionId, uploads)
    throw failure.reason
  }
  return uploads
}

export async function cleanupProductProjectCorrectionFiles(
  projectId: string,
  versionId: string,
  uploads: DirectProductProjectUpload[],
) {
  if (uploads.length === 0) return
  await fetch('/api/product-projects/upload-url', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      versionId,
      objectPaths: uploads.map((upload) => upload.objectPath),
    }),
  }).catch(() => undefined)
}
