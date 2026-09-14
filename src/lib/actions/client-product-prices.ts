'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { COATING_OPTIONS } from '@/lib/constants/coatings'
import { ROUTES } from '@/lib/constants/routes'
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
import { getCommercialVisibilityForClients, requireOrderPriceManagement, requireOrderPriceView } from '@/lib/permissions/commercial-visibility'

const priceInputSchema = z.object({
  clientId: z.string().uuid(),
  productId: z.string().uuid(),
  coating: z.enum(COATING_OPTIONS),
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
    const allClients = await fetchClientPriceClientOptions(db)
    const visibility = await getCommercialVisibilityForClients(allClients.map((client) => client.id), context)
    const clients = allClients
      .filter((client) => visibility.get(client.id)?.canViewOrderPrices)
      .map((client) => ({ ...client, name: visibility.get(client.id)?.displayName || 'КЛИЕНТ' }))
    const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null
    const rows = await fetchClientPriceProductRows(db, selectedClient?.id || null)

    return {
      data: {
        clients,
        selectedClientId: selectedClient?.id || null,
        rows,
        canManage: selectedClient ? visibility.get(selectedClient.id)?.canManageOrderPrices === true : false,
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
    const visibility = await requireOrderPriceView(parsedClientId, context)
    const rows = await fetchClientPriceProductRows(adminDb(), parsedClientId)

    return {
      data: {
        rows,
        canManage: visibility.canManageOrderPrices,
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
    await requireOrderPriceManagement(parsed.clientId, context)
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
    const context = await requirePermission('sales_plan', 'manage')
    const parsed = productPriceLookupSchema.parse({ clientId, productIds })
    await requireOrderPriceManagement(parsed.clientId, context)
    const lookup = await loadClientProductPriceLookup(adminDb(), parsed.clientId, parsed.productIds)
    return { data: clientProductPriceLookupToRecord(lookup), error: null }
  } catch (error) {
    return { data: {}, error: getErrorMessage(error) }
  }
}
