'use client'

import { createClient } from '@/lib/supabase/client'

export async function uploadProNestPdf(requestId: string, sourceId: string, file: File) {
  const response = await fetch('/api/pronest/upload-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, sourceId, fileName: file.name, size: file.size }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.data) throw new Error(payload.error || 'Не удалось подготовить PDF')
  const { bucket, objectPath, token } = payload.data as { bucket: string; objectPath: string; token: string }
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const { error } = await createClient().storage.from(bucket).uploadToSignedUrl(objectPath, token, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return { objectPath, sha256, fileSize: file.size, fileName: file.name }
}
