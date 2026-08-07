import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { driveFetch, type DriveConnectionRow } from './drive'

type ResolveFileInput = {
  bucket: string
  objectPath: string
  fileName?: string | null
  mimeType?: string | null
  disposition?: 'inline' | 'attachment'
}

type ArchiveAssetRow = {
  state: string
  drive_file_id: string | null
  drive_connection_id: string | null
  connection: DriveConnectionRow | DriveConnectionRow[] | null
}

function relationOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null
}

function contentDisposition(kind: 'inline' | 'attachment', fileName: string) {
  const normalized = fileName.replace(/[\r\n"]/g, '_').trim() || 'file'
  const ascii = normalized.replace(/[^\x20-\x7E]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

async function loadArchiveAsset(bucket: string, objectPath: string) {
  const { data, error } = await (createAdminClient() as any)
    .from('file_archive_assets')
    .select(`state,drive_file_id,drive_connection_id,connection:file_archive_connections!file_archive_assets_drive_connection_id_fkey(
      id,email,access_token_vault_id,refresh_token_vault_id,token_expires_at
    )`)
    .eq('bucket_id', bucket)
    .eq('object_path', objectPath)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data || null) as ArchiveAssetRow | null
}

async function driveResponse(asset: ArchiveAssetRow, input: ResolveFileInput) {
  const connection = relationOne(asset.connection)
  if (!connection || !asset.drive_file_id) return null
  const response = await driveFetch(
    connection,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`,
  )
  if (!response.ok || !response.body) throw new Error(`Google Drive: HTTP ${response.status}`)
  return new NextResponse(response.body, {
    headers: {
      'content-type': input.mimeType || response.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': contentDisposition(input.disposition || 'inline', input.fileName || 'file'),
      'cache-control': 'private, no-store',
      ...(response.headers.get('content-length') ? { 'content-length': response.headers.get('content-length')! } : {}),
    },
  })
}

export async function resolveFileResponse(input: ResolveFileInput) {
  const asset = await loadArchiveAsset(input.bucket, input.objectPath)
  if (asset?.state === 'archived') {
    const archived = await driveResponse(asset, input)
    if (archived) return archived
  }

  const admin = createAdminClient()
  const { data: signed, error } = await admin.storage.from(input.bucket).createSignedUrl(input.objectPath, 60)
  if (!error && signed?.signedUrl) {
    if (input.disposition === 'attachment') {
      const response = await fetch(signed.signedUrl, { cache: 'no-store' })
      if (response.ok && response.body) {
        return new NextResponse(response.body, {
          headers: {
            'content-type': input.mimeType || response.headers.get('content-type') || 'application/octet-stream',
            'content-disposition': contentDisposition('attachment', input.fileName || 'file'),
            'cache-control': 'private, no-store',
            ...(response.headers.get('content-length') ? { 'content-length': response.headers.get('content-length')! } : {}),
          },
        })
      }
    } else {
      return NextResponse.redirect(signed.signedUrl)
    }
  }

  if (asset?.drive_file_id) {
    const archived = await driveResponse(asset, input)
    if (archived) return archived
  }
  throw new Error(error?.message || 'Файл недоступен ни в одном хранилище')
}

export async function downloadFileBytes(bucket: string, objectPath: string) {
  const asset = await loadArchiveAsset(bucket, objectPath)
  if (asset?.state === 'archived' && asset.drive_file_id) {
    const connection = relationOne(asset.connection)
    if (!connection) throw new Error('Подключение Google Drive не найдено')
    const response = await driveFetch(connection, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`)
    if (!response.ok) throw new Error(`Google Drive: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const { data, error } = await createAdminClient().storage.from(bucket).download(objectPath)
  if (!error && data) return Buffer.from(await data.arrayBuffer())
  if (asset?.drive_file_id) {
    const connection = relationOne(asset.connection)
    if (!connection) throw new Error('Подключение Google Drive не найдено')
    const response = await driveFetch(connection, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`)
    if (response.ok) return Buffer.from(await response.arrayBuffer())
  }
  throw new Error(error?.message || 'Файл недоступен')
}

export async function removeFileObject(bucket: string, objectPath: string) {
  const admin = createAdminClient()
  const asset = await loadArchiveAsset(bucket, objectPath)
  if (asset?.drive_file_id) {
    const connection = relationOne(asset.connection)
    if (!connection) throw new Error('Подключение Google Drive не найдено')
    const response = await driveFetch(
      connection,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}`,
      { method: 'DELETE' },
    )
    if (!response.ok && response.status !== 404) throw new Error(`Google Drive: HTTP ${response.status}`)
  }
  const { error } = await admin.storage.from(bucket).remove([objectPath])
  if (error && asset?.state !== 'archived') throw new Error(error.message)
  if (asset) {
    const { error: registryError } = await (admin as any).from('file_archive_assets')
      .delete().eq('bucket_id', bucket).eq('object_path', objectPath)
    if (registryError) throw new Error(registryError.message)
  }
}
