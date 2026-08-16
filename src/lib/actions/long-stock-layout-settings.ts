'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import {
  parseLongStockLayoutSettingsInput,
  type LongStockLayoutCategorySettings,
  type LongStockLayoutSettingsAuditEntry,
  type LongStockLayoutSettingsInput,
  type LongStockLayoutSettingsSnapshot,
} from '@/lib/long-stock-layout-settings'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import { createAdminClient } from '@/lib/supabase/admin'

type SettingsPageData = {
  snapshot: LongStockLayoutSettingsSnapshot
  audit: LongStockLayoutSettingsAuditEntry[]
}

async function requireLayoutSettingsAdmin(operation: PermissionOperation) {
  const context = await requirePermission('long_stock_layout_settings', operation)
  if (!context.permissionDetails.isAdminPosition) {
    throw new PermissionDeniedError('long_stock_layout_settings', operation)
  }
  return context
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Настройки раскладки хлыстов имеют неверный формат')
  }
  return value as Record<string, any>
}

function asNumber(value: unknown, field: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Поле ${field} имеет неверный формат`)
  return parsed
}

function mapSnapshot(value: unknown): LongStockLayoutSettingsSnapshot {
  const row = asRecord(value)
  const rawCategories = Array.isArray(row.categories) ? row.categories : []
  const categories = rawCategories.map((rawCategory): LongStockLayoutCategorySettings => {
    const category = asRecord(rawCategory)
    return {
      key: category.key,
      materialCategory: category.material_category,
      knifeBevelCount: category.knife_bevel_count === null
        ? null
        : asNumber(category.knife_bevel_count, 'knife_bevel_count') as 1 | 2,
      minimumUsefulLengthMm: asNumber(category.minimum_useful_length_mm, 'minimum_useful_length_mm'),
      standardLengths: Array.isArray(category.standard_lengths)
        ? category.standard_lengths.map((item: unknown) => asNumber(item, 'standard_lengths'))
        : [],
      nonstandardLengths: Array.isArray(category.nonstandard_lengths)
        ? category.nonstandard_lengths.map((item: unknown) => asNumber(item, 'nonstandard_lengths'))
        : [],
    }
  })
  const parsed = parseLongStockLayoutSettingsInput({
    kerfMm: asNumber(row.kerf_mm, 'kerf_mm'),
    endTrimMm: asNumber(row.end_trim_mm, 'end_trim_mm'),
    optimizationHintThresholdPercent: asNumber(
      row.optimization_hint_threshold_percent,
      'optimization_hint_threshold_percent',
    ),
    categories,
  })
  const categoryMetadata = new Map(categories.map((category) => [category.key, category]))
  return {
    ...parsed,
    schemaVersion: asNumber(row.schema_version, 'schema_version') as 1,
    revision: asNumber(row.revision, 'revision'),
    categories: parsed.categories.map((category) => ({
      ...category,
      materialCategory: categoryMetadata.get(category.key)!.materialCategory,
      knifeBevelCount: categoryMetadata.get(category.key)!.knifeBevelCount,
    })),
  }
}

function toDatabaseConfiguration(settings: LongStockLayoutSettingsInput) {
  return {
    kerf_mm: settings.kerfMm,
    end_trim_mm: settings.endTrimMm,
    optimization_hint_threshold_percent: settings.optimizationHintThresholdPercent,
    categories: settings.categories.map((category) => ({
      key: category.key,
      minimum_useful_length_mm: category.minimumUsefulLengthMm,
      standard_lengths: category.standardLengths,
      nonstandard_lengths: category.nonstandardLengths,
    })),
  }
}

export async function getLongStockLayoutSettings(): Promise<SettingsPageData> {
  await requireLayoutSettingsAdmin('view')
  const db = createAdminClient() as any
  const [snapshotResult, auditResult] = await Promise.all([
    db.rpc('fn_get_long_stock_layout_settings_snapshot'),
    db.from('long_stock_layout_settings_audit')
      .select('id,changed_by,changed_at,revision_from,revision_to,changed_fields,previous_value,new_value')
      .order('changed_at', { ascending: false })
      .limit(20),
  ])
  if (snapshotResult.error || !snapshotResult.data) {
    throw new Error(snapshotResult.error?.message || 'Настройки раскладки хлыстов не найдены')
  }
  if (auditResult.error) throw new Error(auditResult.error.message)

  const auditRows = auditResult.data || []
  const actorIds = Array.from(new Set(auditRows.map((row: any) => row.changed_by).filter(Boolean)))
  const actorsResult = actorIds.length
    ? await db.from('users').select('id,full_name').in('id', actorIds)
    : { data: [], error: null }
  if (actorsResult.error) throw new Error(actorsResult.error.message)
  const actorNames = new Map((actorsResult.data || []).map((user: any) => [user.id, user.full_name]))

  return {
    snapshot: mapSnapshot(snapshotResult.data),
    audit: auditRows.map((row: any): LongStockLayoutSettingsAuditEntry => ({
      id: row.id,
      changedAt: row.changed_at,
      changedBy: String(actorNames.get(row.changed_by) || 'Пользователь удалён'),
      revisionFrom: Number(row.revision_from),
      revisionTo: Number(row.revision_to),
      changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
      previousValue: mapSnapshot(row.previous_value),
      newValue: mapSnapshot(row.new_value),
    })),
  }
}

export async function updateLongStockLayoutSettings(input: {
  expectedRevision: number
  settings: LongStockLayoutSettingsInput
}) {
  try {
    const { userId } = await requireLayoutSettingsAdmin('manage')
    const expectedRevision = Number(input.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
      throw new Error('Неверная ревизия настроек')
    }
    const settings = parseLongStockLayoutSettingsInput(input.settings)
    const { data, error } = await (createAdminClient() as any).rpc(
      'fn_update_long_stock_layout_settings',
      {
        p_configuration: toDatabaseConfiguration(settings),
        p_expected_revision: expectedRevision,
        p_changed_by: userId,
      },
    )
    if (error || !data) throw new Error(error?.message || 'Не удалось сохранить настройки')
    revalidatePath(ROUTES.ADMIN_LONG_STOCK_LAYOUT_SETTINGS)
    return { success: true as const, data: mapSnapshot(data) }
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось сохранить настройки раскладки хлыстов',
    }
  }
}
