import 'server-only'

import { getCurrentUserContext } from '@/lib/auth/current-user'
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagKey } from '@/lib/feature-flags/definitions'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'

type DbError = { message: string } | null
type FlagDbRow = {
  key: string
  enabled: boolean
  updated_by: string | null
  updated_at: string
}
type AuditDbRow = {
  id: string
  flag_key: string
  old_enabled: boolean | null
  new_enabled: boolean
  changed_by: string | null
  changed_at: string
}
type UserDbRow = { id: string; full_name: string | null; email: string }

interface FeatureFlagAdminDb {
  from(table: 'feature_flags'): {
    select(columns: string): PromiseLike<{ data: FlagDbRow[] | null; error: DbError }>
    upsert(
      value: { key: FeatureFlagKey; enabled: boolean; updated_by: string },
      options: { onConflict: 'key' },
    ): PromiseLike<{ error: DbError }>
  }
  from(table: 'feature_flag_audit_log'): {
    select(columns: string): {
      order(column: 'changed_at', options: { ascending: false }): {
        limit(count: number): PromiseLike<{ data: AuditDbRow[] | null; error: DbError }>
      }
    }
  }
  from(table: 'users'): {
    select(columns: string): {
      in(column: 'id', values: string[]): PromiseLike<{ data: UserDbRow[] | null; error: DbError }>
    }
  }
}

function featureFlagAdminDb() {
  return createAdminClient() as unknown as FeatureFlagAdminDb
}

export type FeatureFlagAdminRow = {
  key: FeatureFlagKey
  label: string
  description: string
  enabled: boolean
  updatedAt: string | null
  updatedByName: string | null
}

export type FeatureFlagAuditRow = {
  id: string
  flagKey: string
  oldEnabled: boolean | null
  newEnabled: boolean
  changedAt: string
  changedByName: string | null
}

export type FeatureFlagAdminDashboard = {
  flags: FeatureFlagAdminRow[]
  audit: FeatureFlagAuditRow[]
}

export async function requireFeatureFlagAdministrator() {
  const context = await getCurrentUserContext()
  const permissionDetails = await getCurrentUserPermissions(context.userId)
  if (!permissionDetails.isAdminPosition) {
    throw new Error('Управление фичефлагами доступно только администратору CRM')
  }
  return context
}

export async function getFeatureFlagAdminDashboard(): Promise<FeatureFlagAdminDashboard> {
  await requireFeatureFlagAdministrator()
  const db = featureFlagAdminDb()
  const [flagsResult, auditResult] = await Promise.all([
    db.from('feature_flags').select('key, enabled, updated_by, updated_at'),
    db
      .from('feature_flag_audit_log')
      .select('id, flag_key, old_enabled, new_enabled, changed_by, changed_at')
      .order('changed_at', { ascending: false })
      .limit(50),
  ])
  if (flagsResult.error) throw new Error(flagsResult.error.message)
  if (auditResult.error) throw new Error(auditResult.error.message)

  const flagRows = flagsResult.data || []
  const auditRows = auditResult.data || []
  const userIds = Array.from(new Set([
    ...flagRows.map((row) => row.updated_by),
    ...auditRows.map((row) => row.changed_by),
  ].filter((value): value is string => Boolean(value))))
  const usersResult = userIds.length > 0
    ? await db.from('users').select('id, full_name, email').in('id', userIds)
    : { data: [], error: null }
  if (usersResult.error) throw new Error(usersResult.error.message)

  const userNames = new Map(
    (usersResult.data || []).map((user) => [user.id, user.full_name || user.email]),
  )
  const flagsByKey = new Map(flagRows.map((row) => [row.key, row]))

  return {
    flags: FEATURE_FLAG_DEFINITIONS.map((definition) => {
      const row = flagsByKey.get(definition.key)
      return {
        ...definition,
        enabled: row?.enabled === true,
        updatedAt: row?.updated_at || null,
        updatedByName: row?.updated_by ? userNames.get(row.updated_by) || null : null,
      }
    }),
    audit: auditRows.map((row) => ({
      id: row.id,
      flagKey: row.flag_key,
      oldEnabled: row.old_enabled,
      newEnabled: row.new_enabled,
      changedAt: row.changed_at,
      changedByName: row.changed_by ? userNames.get(row.changed_by) || null : null,
    })),
  }
}

export async function setFeatureFlagEnabled(
  key: FeatureFlagKey,
  enabled: boolean,
  updatedBy: string,
) {
  const { error } = await featureFlagAdminDb()
    .from('feature_flags')
    .upsert({ key, enabled, updated_by: updatedBy }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}
