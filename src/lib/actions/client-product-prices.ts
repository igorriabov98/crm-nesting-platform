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
const adjustmentSchema = z.object({
  clientId: z.string().uuid(),
  direction: z.enum(['increase', 'decrease']),
  percent: z.coerce.number().min(0.01, 'Процент должен быть не меньше 0,01').max(50, 'Процент не может превышать 50'),
  coatings: z.array(z.enum(COATING_OPTIONS)).min(1, 'Выберите хотя бы одно покрытие').max(4),
})
const adjustmentOrdersSchema = z.object({
  adjustmentId: z.string().uuid(),
  machineIds: z.array(z.string().uuid()).max(500),
})

type ActionDb = ClientPriceDb & {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
}

export type ClientPriceAdjustmentOrderCandidate = {
  machineId: string
  machineName: string
  beforeTotal: number
  afterTotal: number
  updatablePositions: number
  manualPricePositions: number
  invalidatesDiscount: boolean
}

function adminDb() {
  return createAdminClient() as unknown as ActionDb
}

async function loadAdjustmentCandidates(db: ActionDb, adjustmentId: string, clientId: string) {
  const [{ data: linesData, error: linesError }, { data: machinesData, error: machinesError }] = await Promise.all([
    db.from('client_price_adjustment_lines')
      .select('product_id, coating, old_price, new_price')
      .eq('adjustment_id', adjustmentId),
    db.from('machines')
      .select(`
        id, name, status, is_archived, actual_shipping_date,
        machine_items(id, product_id, coating, price, quantity, is_sample),
        machine_expenses(amount),
        invoices(id, cancelled_at),
        machine_discount_requests(id, status, discount_amount)
      `)
      .eq('client_id', clientId),
  ])
  if (linesError) throw new Error(linesError.message || 'Не удалось загрузить строки изменения прайса')
  if (machinesError) throw new Error(machinesError.message || 'Не удалось загрузить текущие заказы')

  const lineMap = new Map(((linesData || []) as Array<{ product_id: string; coating: string; old_price: number; new_price: number }>).map((line) => [
    `${line.product_id}:${line.coating}`,
    { oldPrice: Number(line.old_price), newPrice: Number(line.new_price) },
  ]))

  return ((machinesData || []) as Array<{
    id: string
    name: string
    status: string
    is_archived: boolean
    actual_shipping_date: string | null
    machine_items: Array<{ id: string; product_id: string | null; coating: string; price: number; quantity: number; is_sample: boolean }>
    machine_expenses: Array<{ amount: number }>
    invoices: Array<{ id: string; cancelled_at: string | null }>
    machine_discount_requests: Array<{ id: string; status: string; discount_amount: number }>
  }>).flatMap((machine): ClientPriceAdjustmentOrderCandidate[] => {
    if (machine.is_archived || machine.status === 'shipped' || machine.actual_shipping_date || machine.invoices.some((invoice) => !invoice.cancelled_at)) return []
    let updatablePositions = 0
    let manualPricePositions = 0
    let beforeGoods = 0
    let afterGoods = 0
    for (const item of machine.machine_items.filter((row) => !row.is_sample)) {
      const total = Number(item.price) * Number(item.quantity)
      beforeGoods += total
      const adjustment = item.product_id ? lineMap.get(`${item.product_id}:${item.coating}`) : null
      if (!adjustment) {
        afterGoods += total
      } else if (Number(item.price).toFixed(2) === adjustment.oldPrice.toFixed(2)) {
        updatablePositions += 1
        afterGoods += adjustment.newPrice * Number(item.quantity)
      } else {
        manualPricePositions += 1
        afterGoods += total
      }
    }
    if (updatablePositions === 0) return []
    const expenses = machine.machine_expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
    const approvedDiscount = machine.machine_discount_requests.find((request) => request.status === 'approved')
    return [{
      machineId: machine.id,
      machineName: machine.name,
      beforeTotal: Math.round((beforeGoods + expenses - Number(approvedDiscount?.discount_amount || 0)) * 100) / 100,
      afterTotal: Math.round((afterGoods + expenses) * 100) / 100,
      updatablePositions,
      manualPricePositions,
      invalidatesDiscount: machine.machine_discount_requests.some((request) => request.status === 'pending' || request.status === 'approved'),
    }]
  })
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

export async function adjustClientProductPrices(input: unknown) {
  try {
    const context = await requirePermission('client_prices', 'manage')
    const parsed = adjustmentSchema.parse(input)
    await requireOrderPriceManagement(parsed.clientId, context)
    const db = adminDb()
    const { data, error } = await db.rpc('fn_adjust_client_product_prices', {
      p_client_id: parsed.clientId,
      p_direction: parsed.direction,
      p_percent: parsed.percent,
      p_coatings: parsed.coatings,
      p_actor: context.user.id,
    })
    if (error) throw new Error(error.message || 'Не удалось изменить прайс')
    const result = data as { adjustmentId: string; affectedPrices: number }
    const candidates = await loadAdjustmentCandidates(db, result.adjustmentId, parsed.clientId)
    revalidatePath(ROUTES.SALES_PLAN_PRICES)
    revalidatePath(`${ROUTES.CLIENTS}/${parsed.clientId}`)
    return { success: true as const, data: { ...result, candidates }, error: null }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
  }
}

export async function applyClientPriceAdjustmentToOrders(input: unknown) {
  try {
    const context = await requirePermission('client_prices', 'manage')
    const parsed = adjustmentOrdersSchema.parse(input)
    const db = adminDb()
    const { data: adjustment, error: adjustmentError } = await db.from('client_price_adjustments')
      .select('client_id')
      .eq('id', parsed.adjustmentId)
      .single()
    if (adjustmentError || !adjustment) throw new Error('Операция изменения прайса не найдена')
    const clientId = String((adjustment as { client_id: string }).client_id)
    await requireOrderPriceManagement(clientId, context)
    const { data, error } = await db.rpc('fn_apply_client_price_adjustment_to_orders', {
      p_adjustment_id: parsed.adjustmentId,
      p_machine_ids: parsed.machineIds,
      p_actor: context.user.id,
    })
    if (error) throw new Error(error.message || 'Не удалось обновить выбранные заказы')
    revalidatePath(ROUTES.SALES_PLAN)
    for (const machineId of parsed.machineIds) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    return { success: true as const, data: data as { updatedPositions: number; skippedPositions: number; skipReasons: Record<string, number> }, error: null }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
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
