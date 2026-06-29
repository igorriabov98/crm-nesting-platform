'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { hasPermission } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import {
  clientProductPriceLookupToRecord,
  fetchClientPriceClientOptions,
  fetchClientPriceProductRows,
  loadClientProductPriceLookup,
  writeClientProductPrice,
  type ClientPriceDb,
} from '@/lib/client-prices/server'
import { getErrorMessage } from '@/lib/utils/get-error-message'

const priceInputSchema = z.object({
  clientId: z.string().uuid(),
  productId: z.string().uuid(),
  coating: z.enum(['none', 'zinc', 'powder_coating']),
  priceEur: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
})

const productPriceLookupSchema = z.object({
  clientId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).max(1000),
})

function adminDb() {
  return createAdminClient() as unknown as ClientPriceDb
}

export async function getClientPricesPageData(selectedClientId?: string | null) {
  try {
    const context = await requirePermission('client_prices', 'view')
    const db = adminDb()
    const clients = await fetchClientPriceClientOptions(db)
    const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null
    const rows = await fetchClientPriceProductRows(db, selectedClient?.id || null)

    return {
      data: {
        clients,
        selectedClientId: selectedClient?.id || null,
        rows,
        canManage: hasPermission(context.permissionDetails.permissions, 'client_prices', 'manage'),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getClientPricesForClient(clientId: string) {
  try {
    const context = await requirePermission('client_prices', 'view')
    const parsedClientId = z.string().uuid().parse(clientId)
    const rows = await fetchClientPriceProductRows(adminDb(), parsedClientId)

    return {
      data: {
        rows,
        canManage: hasPermission(context.permissionDetails.permissions, 'client_prices', 'manage'),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function saveClientProductPrice(input: unknown) {
  try {
    const context = await requirePermission('client_prices', 'manage')
    const parsed = priceInputSchema.parse(input)
    const row = await writeClientProductPrice(adminDb(), {
      clientId: parsed.clientId,
      productId: parsed.productId,
      coating: parsed.coating,
      priceEur: parsed.priceEur,
      userId: context.user.id,
    })

    revalidatePath(ROUTES.SALES_PLAN_PRICES)
    revalidatePath(`${ROUTES.CLIENTS}/${parsed.clientId}`)
    revalidatePath(ROUTES.SALES_PLAN_NEW)

    return { success: true, price: row, error: null }
  } catch (error) {
    return { success: false, price: null, error: getErrorMessage(error) }
  }
}

export async function getOrderClientProductPrices(clientId: string, productIds: string[]) {
  try {
    await requirePermission('sales_plan', 'manage')
    const parsed = productPriceLookupSchema.parse({ clientId, productIds })
    const lookup = await loadClientProductPriceLookup(adminDb(), parsed.clientId, parsed.productIds)
    return { data: clientProductPriceLookupToRecord(lookup), error: null }
  } catch (error) {
    return { data: {}, error: getErrorMessage(error) }
  }
}
