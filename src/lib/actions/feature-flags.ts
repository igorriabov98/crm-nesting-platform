'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { FEATURE_FLAG_KEYS } from '@/lib/feature-flags/definitions'
import { requireFeatureFlagAdministrator, setFeatureFlagEnabled } from '@/lib/feature-flags/admin'

const updateFeatureFlagSchema = z.object({
  key: z.enum(FEATURE_FLAG_KEYS),
  enabled: z.boolean(),
})

export async function updateFeatureFlag(input: unknown) {
  try {
    const { userId } = await requireFeatureFlagAdministrator()
    const parsed = updateFeatureFlagSchema.parse(input)
    await setFeatureFlagEnabled(parsed.key, parsed.enabled, userId)
    revalidatePath(ROUTES.ADMIN_FEATURE_FLAGS)
    return { success: true as const }
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось изменить фичефлаг',
    }
  }
}
