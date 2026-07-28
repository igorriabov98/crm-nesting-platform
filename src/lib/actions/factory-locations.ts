'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'

const locationSchema = z.object({
  id: z.string().uuid(),
  city: z.string().trim().min(1, 'Укажите город').max(160),
  address: z.string().trim().max(300).nullable().optional(),
})

export async function updateFactoryLocation(input: z.input<typeof locationSchema>) {
  try {
    const parsed = locationSchema.parse(input)
    await requirePermission('company_settings', 'manage')
    const admin = createAdminClient() as unknown as {
      from: (table: string) => { update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }> } }
    }
    const { error } = await admin.from('factories').update({
      city: parsed.city.replace(/\s+/g, ' '),
      address: parsed.address?.replace(/\s+/g, ' ') || null,
    }).eq('id', parsed.id)
    if (error) throw new Error(error.message || 'Не удалось сохранить площадку')
    revalidatePath(ROUTES.ADMIN_FACTORY_SETTINGS)
    revalidatePath(ROUTES.SUPPLY_TRANSPORT)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
