'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ArchivePolicy, ArchiveRun, DriveArchiveConnection, FileArchiveDashboard } from '@/lib/file-archive/types'

const uuidSchema = z.string().uuid()

function resultError(error: unknown, fallback: string) {
  return { success: false as const, error: error instanceof Error ? error.message : fallback }
}

export async function getFileArchiveDashboard(): Promise<FileArchiveDashboard> {
  await requirePermission('file_archive_settings', 'view')
  const db = createAdminClient() as any
  const [connectionsResult, policiesResult, runsResult, assetsResult] = await Promise.all([
    db.from('file_archive_connections').select('id,email,display_name,status,root_folder_name,last_verified_at,last_error,connected_at').order('connected_at', { ascending: false }),
    db.from('file_archive_policies').select('key,label,category,enabled,enabled_at,retention_days,local_grace_days').order('label'),
    db.from('file_archive_runs').select('id,kind,status,cutoff_at,item_count,total_bytes,missing_relation_count,machine_count,category_summary,preview_hash,created_at,confirmed_at').or('item_count.gt.0,kind.eq.backfill').order('created_at', { ascending: false }).limit(12),
    db.from('file_archive_assets').select('state,size_bytes,copied_at,source_deleted_at,drive_connection_id').limit(10000),
  ])
  for (const query of [connectionsResult, policiesResult, runsResult, assetsResult]) {
    if (query.error) throw new Error(query.error.message)
  }

  const assets = (assetsResult.data || []) as Array<{
    state: string
    size_bytes: number | string
    copied_at: string | null
    source_deleted_at: string | null
    drive_connection_id: string | null
  }>
  const size = (value: number | string) => Number(value || 0)
  const connectionStats = new Map<string, { files: number; bytes: number }>()
  for (const asset of assets) {
    if (!asset.drive_connection_id || !['pending_delete', 'archived'].includes(asset.state)) continue
    const current = connectionStats.get(asset.drive_connection_id) || { files: 0, bytes: 0 }
    current.files += 1
    current.bytes += size(asset.size_bytes)
    connectionStats.set(asset.drive_connection_id, current)
  }

  const connections: DriveArchiveConnection[] = (connectionsResult.data || []).map((row: any) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    rootFolderName: row.root_folder_name,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    archivedFiles: connectionStats.get(row.id)?.files || 0,
    archivedBytes: connectionStats.get(row.id)?.bytes || 0,
  }))
  const policies: ArchivePolicy[] = (policiesResult.data || []).map((row: any) => ({
    key: row.key,
    label: row.label,
    category: row.category,
    enabled: row.enabled,
    enabledAt: row.enabled_at,
    retentionDays: row.retention_days,
    localGraceDays: row.local_grace_days,
  }))
  const runs: ArchiveRun[] = (runsResult.data || []).map((row: any) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    cutoffAt: row.cutoff_at,
    itemCount: row.item_count,
    totalBytes: Number(row.total_bytes || 0),
    missingRelationCount: row.missing_relation_count,
    machineCount: row.machine_count,
    categorySummary: Array.isArray(row.category_summary)
      ? row.category_summary.map((item: any) => ({
        category: String(item.category || 'Без категории'),
        count: Number(item.count || 0),
        bytes: Number(item.bytes || 0),
      }))
      : [],
    previewHash: row.preview_hash,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  }))

  const copiedDates = assets.map((asset) => asset.copied_at).filter((value): value is string => Boolean(value)).sort()
  return {
    connections,
    policies,
    runs,
    metrics: {
      trackedFiles: assets.length,
      archivedFiles: assets.filter((asset) => asset.state === 'archived').length,
      freedBytes: assets.filter((asset) => asset.source_deleted_at).reduce((total, asset) => total + size(asset.size_bytes), 0),
      pendingDeleteFiles: assets.filter((asset) => asset.state === 'pending_delete').length,
      pendingDeleteBytes: assets.filter((asset) => asset.state === 'pending_delete').reduce((total, asset) => total + size(asset.size_bytes), 0),
      queuedFiles: assets.filter((asset) => ['queued', 'copying'].includes(asset.state)).length,
      failedFiles: assets.filter((asset) => asset.state === 'failed').length,
      lastSuccessfulCopyAt: copiedDates.at(-1) || null,
    },
  }
}

export async function updateArchivePolicy(input: { key: string; enabled: boolean }) {
  try {
    const { userId } = await requirePermission('file_archive_settings', 'manage')
    const key = z.string().min(1).max(80).parse(input.key)
    const db = createAdminClient() as any
    const { data: current, error: loadError } = await db.from('file_archive_policies')
      .select('enabled').eq('key', key).maybeSingle()
    if (loadError || !current) throw new Error(loadError?.message || 'Политика не найдена')
    const payload: Record<string, unknown> = {
      enabled: input.enabled,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }
    if (input.enabled && !current.enabled) payload.enabled_at = new Date().toISOString()
    const { error } = await db.from('file_archive_policies').update(payload).eq('key', key)
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.ADMIN_FILE_ARCHIVE_SETTINGS)
    return { success: true as const }
  } catch (error) {
    return resultError(error, 'Не удалось обновить политику')
  }
}

export async function buildArchivePreview() {
  try {
    const { userId } = await requirePermission('file_archive_settings', 'manage')
    const { data, error } = await (createAdminClient() as any).rpc('file_archive_build_preview', {
      p_created_by: userId,
    })
    if (error || !data) throw new Error(error?.message || 'Не удалось создать предпросмотр')
    revalidatePath(ROUTES.ADMIN_FILE_ARCHIVE_SETTINGS)
    return { success: true as const, runId: data as string }
  } catch (error) {
    return resultError(error, 'Не удалось построить предпросмотр')
  }
}

export async function confirmArchivePreview(input: { runId: string; previewHash: string }) {
  try {
    const { userId } = await requirePermission('file_archive_settings', 'manage')
    const runId = uuidSchema.parse(input.runId)
    const db = createAdminClient() as any
    const { data: run, error: loadError } = await db.from('file_archive_runs')
      .select('status,preview_hash').eq('id', runId).maybeSingle()
    if (loadError || !run || run.status !== 'preview') throw new Error('Предпросмотр больше не доступен')
    if (!input.previewHash || run.preview_hash !== input.previewHash) {
      throw new Error('Набор предпросмотра изменился. Постройте его заново.')
    }
    const { data, error } = await db.rpc('file_archive_confirm_preview', {
      p_run_id: runId,
      p_confirmed_by: userId,
    })
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.ADMIN_FILE_ARCHIVE_SETTINGS)
    return { success: true as const, queued: Number(data || 0) }
  } catch (error) {
    return resultError(error, 'Не удалось подтвердить перенос')
  }
}

export async function retryFailedArchiveFiles() {
  try {
    await requirePermission('file_archive_settings', 'manage')
    const { error } = await (createAdminClient() as any).from('file_archive_assets').update({
      state: 'queued',
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('state', 'failed').lt('attempt_count', 8)
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.ADMIN_FILE_ARCHIVE_SETTINGS)
    return { success: true as const }
  } catch (error) {
    return resultError(error, 'Не удалось повторить задания')
  }
}
