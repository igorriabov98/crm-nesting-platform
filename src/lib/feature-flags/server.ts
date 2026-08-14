import 'server-only'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { FeatureFlagKey } from '@/lib/feature-flags/definitions'
import { readFeatureFlagSafely } from '@/lib/feature-flags/resolve'

type FlagReadDb = {
  from(table: 'feature_flags'): {
    select(columns: 'enabled'): {
      eq(column: 'key', key: FeatureFlagKey): {
        maybeSingle(): PromiseLike<{
          data: { enabled: boolean } | null
          error: { message: string } | null
        }>
      }
    }
  }
}

const readFeatureFlagForRequest = cache(async (key: FeatureFlagKey): Promise<boolean> => {
  return readFeatureFlagSafely(async () => {
    const db = createAdminClient() as unknown as FlagReadDb
    const { data, error } = await db
      .from('feature_flags')
      .select('enabled')
      .eq('key', key)
      .maybeSingle()

    return { data, error }
  })
})

export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  return readFeatureFlagForRequest(key)
}
