import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { driveFetch, type DriveConnectionRow } from './drive'

type TestConnection = DriveConnectionRow & {
  root_folder_id: string | null
  root_folder_name: string
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const TEST_BUCKET = 'product-files'

async function createDriveFolder(
  connection: TestConnection,
  name: string,
  appProperties: Record<string, string>,
  parentId?: string,
) {
  const response = await driveFetch(connection, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties,
    }),
  })
  const payload = await response.json() as { id?: string; error?: { message?: string } }
  if (!response.ok || !payload.id) throw new Error(payload.error?.message || `Drive folder create: HTTP ${response.status}`)
  return payload.id
}

async function ensureRootFolder(connection: TestConnection) {
  if (connection.root_folder_id) {
    const check = await driveFetch(
      connection,
      `${DRIVE_API}/files/${encodeURIComponent(connection.root_folder_id)}?fields=id,mimeType,trashed`,
    )
    if (check.ok) return connection.root_folder_id
  }

  const query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='crmFolderKey' and value='root' }"
  const search = await driveFetch(
    connection,
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)&pageSize=1`,
  )
  const searchPayload = await search.json() as { files?: Array<{ id: string }> }
  if (!search.ok) throw new Error(`Drive folder lookup: HTTP ${search.status}`)
  const rootFolderId = searchPayload.files?.[0]?.id || await createDriveFolder(
    connection,
    connection.root_folder_name,
    { crmFolderKey: 'root' },
  )
  const { error } = await (createAdminClient() as any).from('file_archive_connections')
    .update({ root_folder_id: rootFolderId, last_verified_at: new Date().toISOString(), last_error: null })
    .eq('id', connection.id)
  if (error) throw new Error(error.message)
  return rootFolderId
}

async function uploadDriveFixture(
  connection: TestConnection,
  folderId: string,
  runId: string,
  fileName: string,
  bytes: Uint8Array,
) {
  const session = await driveFetch(
    connection,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,size,name`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-upload-content-type': 'text/plain; charset=utf-8',
        'x-upload-content-length': String(bytes.byteLength),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
        appProperties: { crmArchiveTestRun: runId },
      }),
    },
  )
  const uploadUrl = session.headers.get('location')
  if (!session.ok || !uploadUrl) throw new Error(`Drive upload session: HTTP ${session.status}`)
  const uploadBody = new Uint8Array(bytes).buffer
  const upload = await driveFetch(connection, uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(bytes.byteLength),
    },
    body: uploadBody,
  })
  const payload = await upload.json() as { id?: string; size?: string; error?: { message?: string } }
  if (!upload.ok || !payload.id) throw new Error(payload.error?.message || `Drive upload: HTTP ${upload.status}`)
  if (Number(payload.size || 0) !== bytes.byteLength) throw new Error('Drive вернул другой размер тестового файла')
  return payload.id
}

export async function executeFileArchiveSelfTest() {
  const startedAt = Date.now()
  const runId = randomUUID()
  const fileName = `crm-archive-test-${runId.slice(0, 8)}.txt`
  const storagePath = `file-archive-tests/${runId}/${fileName}`
  const fixture = new TextEncoder().encode(`CRM file archive self-test\n${runId}\n`)
  const steps: string[] = []
  const cleanupErrors: string[] = []
  const admin = createAdminClient()
  const db = admin as any
  let connection: TestConnection | null = null
  let driveFolderId: string | null = null
  let driveFileId: string | null = null
  let failure: Error | null = null

  try {
    const { data, error } = await db.from('file_archive_connections').select(
      'id,email,status,access_token_vault_id,refresh_token_vault_id,token_expires_at,root_folder_id,root_folder_name',
    ).eq('status', 'active').maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Подключите активный Google Drive')
    connection = data as TestConnection
    steps.push('Активное Drive-подключение найдено')

    const { error: uploadError } = await admin.storage.from(TEST_BUCKET).upload(storagePath, fixture, {
      contentType: 'text/plain; charset=utf-8',
      upsert: false,
    })
    if (uploadError) throw new Error(`Supabase upload: ${uploadError.message}`)
    steps.push('Тестовый файл записан в Supabase Storage')

    const { data: stored, error: downloadError } = await admin.storage.from(TEST_BUCKET).download(storagePath)
    if (downloadError || !stored) throw new Error(`Supabase read: ${downloadError?.message || 'файл отсутствует'}`)
    const storedBytes = new Uint8Array(await stored.arrayBuffer())
    if (storedBytes.byteLength !== fixture.byteLength || !storedBytes.every((value, index) => value === fixture[index])) {
      throw new Error('Содержимое тестового файла Supabase не совпало')
    }
    steps.push('Чтение из Supabase проверено')

    const rootFolderId = await ensureRootFolder(connection)
    steps.push('Корневая папка CRM Archive доступна')
    driveFolderId = await createDriveFolder(
      connection,
      `Системный тест ${runId.slice(0, 8)}`,
      { crmArchiveTestRun: runId },
      rootFolderId,
    )
    steps.push('Временная тестовая папка Drive создана')

    driveFileId = await uploadDriveFixture(connection, driveFolderId, runId, fileName, fixture)
    steps.push('Файл загружен в Drive и размер проверен')
    const driveRead = await driveFetch(
      connection,
      `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?alt=media`,
    )
    if (!driveRead.ok) throw new Error(`Drive read: HTTP ${driveRead.status}`)
    const driveBytes = new Uint8Array(await driveRead.arrayBuffer())
    if (driveBytes.byteLength !== fixture.byteLength || !driveBytes.every((value, index) => value === fixture[index])) {
      throw new Error('Содержимое тестового файла Drive не совпало')
    }
    steps.push('Чтение из Drive и содержимое проверены')
  } catch (error) {
    failure = error instanceof Error ? error : new Error('Неизвестная ошибка теста архива')
  } finally {
    if (connection && driveFileId) {
      const response = await driveFetch(
        connection,
        `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}`,
        { method: 'DELETE' },
      ).catch(() => null)
      if (!response || (!response.ok && response.status !== 404)) cleanupErrors.push('не удалён тестовый файл Drive')
      else steps.push('Тестовый файл Drive удалён')
    }
    if (connection && driveFolderId) {
      const response = await driveFetch(
        connection,
        `${DRIVE_API}/files/${encodeURIComponent(driveFolderId)}`,
        { method: 'DELETE' },
      ).catch(() => null)
      if (!response || (!response.ok && response.status !== 404)) cleanupErrors.push('не удалена тестовая папка Drive')
      else steps.push('Тестовая папка Drive удалена')
    }
    const { error } = await admin.storage.from(TEST_BUCKET).remove([storagePath])
    if (error) cleanupErrors.push(`не удалён тестовый файл Supabase: ${error.message}`)
    else steps.push('Тестовый файл Supabase удалён')
  }

  if (cleanupErrors.length > 0) {
    failure = new Error([failure?.message, ...cleanupErrors].filter(Boolean).join('; '))
  }
  return {
    success: !failure,
    error: failure?.message || null,
    connectionEmail: connection?.email || null,
    durationMs: Date.now() - startedAt,
    steps,
  }
}
