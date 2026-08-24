'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase generated types are updated only after this migration is applied. */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserPermissions, requirePermission } from '@/lib/permissions/server'
import { hasResourcePermission } from '@/lib/permissions/resources'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import {
  METAL_SCRAP_PAGE_SIZE,
  METAL_SCRAP_STATUSES,
  type MetalScrapStatus,
  normalizeMetalScrapPage,
  normalizeMetalScrapStatus,
} from '@/lib/metal-scrap'
import { getErrorMessage } from '@/lib/utils/get-error-message'

function db() { return createAdminClient() as any }

export async function getFutureDetailingPage(factoryId?: string, page = 0) {
  try {
    const { userId } = await requirePermission('future_detailing', 'view')
    const permissions = await getCurrentUserPermissions(userId)
    const canManage = hasResourcePermission(null, permissions.permissions, 'future_detailing', 'manage')
    const client = db()
    const factories = await client.from('factories').select('id,name').order('name')
    const selectedFactory = factoryId || factories.data?.[0]?.id
    const batches = client.from('future_detailing_batches').select('id,request_id,machine_id,factory_id,created_by,status,confirmation_due_date,confirmed_at,machines(name),users!future_detailing_batches_created_by_fkey(full_name)', { count: 'exact' }).eq('factory_id', selectedFactory).order('created_at', { ascending: false }).range(Math.max(0, page) * 20, Math.max(0, page) * 20 + 19)
    const batchResult = await batches
    const ids = (batchResult.data || []).map((batch: any) => batch.id)
    const items = ids.length ? await client.from('future_detailing_items').select('id,batch_id,part_id,planned_quantity,actual_quantity,status,variance_reason,detailing_parts(name,drawing_number,unit_weight_kg)').in('batch_id', ids).order('created_at') : { data: [] }
    return { data: { factories: factories.data || [], selectedFactory, canManage, batches: (batchResult.data || []).map((batch: any) => ({ ...batch, isOwner: batch.created_by === userId && canManage, items: (items.data || []).filter((item: any) => item.batch_id === batch.id) })), total: batchResult.count || 0 }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function confirmFutureDetailing(batchId: string, items: Array<{ itemId: string; actualQuantity: number; reason?: string }>) {
  try {
    const parsed = z.object({ batchId: z.string().uuid(), items: z.array(z.object({ itemId: z.string().uuid(), actualQuantity: z.coerce.number().int().nonnegative(), reason: z.string().trim().optional() })).min(1) }).parse({ batchId, items })
    const { supabase, userId } = await requirePermission('future_detailing', 'manage')
    const { error } = await (supabase as any).rpc('fn_confirm_future_detailing', { p_batch_id: parsed.batchId, p_actor: userId, p_items: parsed.items })
    if (error) throw error
    revalidatePath(ROUTES.INVENTORY_FUTURE_DETAILING); revalidatePath(ROUTES.INVENTORY_DETAILING); revalidatePath(ROUTES.TASKS)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function correctFutureDetailingPlan(batchId: string, items: Array<{ itemId: string; quantity: number }>, reason: string) {
  try {
    const parsed = z.object({ batchId: z.string().uuid(), items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().positive() })).min(1), reason: z.string().trim().min(1) }).parse({ batchId, items, reason })
    const { supabase, userId } = await requirePermission('future_detailing', 'manage')
    const { error } = await (supabase as any).rpc('fn_correct_future_detailing_plan', { p_batch_id: parsed.batchId, p_items: parsed.items, p_reason: parsed.reason, p_actor: userId })
    if (error) throw error
    revalidatePath(ROUTES.INVENTORY_FUTURE_DETAILING)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function getMetalScrapPage(factoryId?: string, status = 'available', page = 0) {
  try {
    const { userId } = await requirePermission('metal_scrap', 'view')
    const permissions = await getCurrentUserPermissions(userId)
    const canManageScrap = hasResourcePermission(null, permissions.permissions, 'metal_scrap', 'manage')
    const canManageSales = hasResourcePermission(null, permissions.permissions, 'metal_scrap_sales', 'manage')
    const client = db()
    const factories = await client.from('factories').select('id,name').order('name')
    const selectedFactory = factoryId || factories.data?.[0]?.id
    const safeStatus = normalizeMetalScrapStatus(status)
    const safePage = normalizeMetalScrapPage(page)
    const pagesByStatus = Object.fromEntries(METAL_SCRAP_STATUSES.map((lotStatus) => [
      lotStatus,
      lotStatus === safeStatus ? safePage : 0,
    ])) as Record<MetalScrapStatus, number>

    const [lotResults, sales, aggregates] = await Promise.all([
      Promise.all(METAL_SCRAP_STATUSES.map((lotStatus) => {
        const lotPage = pagesByStatus[lotStatus]
        return client.from('metal_scrap_lots')
          .select('id,source_type,source_inventory_id,request_id,machine_id,factory_id,created_by,material_name,material_grade,expected_weight_kg,available_weight_kg,blocked_weight_kg,sold_weight_kg,status,promoted_stage_end,machines(name)', { count: 'exact' })
          .eq('factory_id', selectedFactory)
          .eq('status', lotStatus)
          .order('created_at', { ascending: false })
          .range(lotPage * METAL_SCRAP_PAGE_SIZE, lotPage * METAL_SCRAP_PAGE_SIZE + METAL_SCRAP_PAGE_SIZE - 1)
      })),
      client.from('metal_scrap_sales').select('id,factory_id,sale_date,total_weight_kg,amount_uah,average_price_per_kg,buyer,document_number,comment,status,cancellation_reason,created_at').eq('factory_id', selectedFactory).order('sale_date', { ascending: false }).limit(25),
      client.from('metal_scrap_lots').select('status,expected_weight_kg,available_weight_kg,blocked_weight_kg,sold_weight_kg').eq('factory_id', selectedFactory),
    ])

    const statusPages = Object.fromEntries(METAL_SCRAP_STATUSES.map((lotStatus, index) => {
      const result = lotResults[index]
      return [lotStatus, {
        lots: (result.data || []).map((lot: any) => ({
          ...lot,
          can_review: canManageScrap && lot.created_by === userId,
        })),
        total: result.count || 0,
        page: pagesByStatus[lotStatus],
      }]
    })) as Record<MetalScrapStatus, { lots: any[]; total: number; page: number }>

    return {
      data: {
        factories: factories.data || [],
        selectedFactory,
        status: safeStatus,
        canManageScrap,
        canManageSales,
        statusPages,
        pageSize: METAL_SCRAP_PAGE_SIZE,
        sales: sales.data || [],
        aggregates: (aggregates.data || []).reduce((acc: any, row: any) => {
          acc.future += row.status === 'future' ? Number(row.expected_weight_kg) : 0
          acc.available += Number(row.available_weight_kg)
          acc.blocked += Number(row.blocked_weight_kg)
          acc.sold += Number(row.sold_weight_kg)
          return acc
        }, { future: 0, available: 0, blocked: 0, sold: 0 }),
      },
      error: null,
    }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function sellMetalScrap(input: { factoryId: string; saleDate: string; amountUah: number; buyer?: string; document?: string; comment?: string; items: Array<{ lotId: string; weightKg: number }> }) {
  try {
    const parsed = z.object({ factoryId: z.string().uuid(), saleDate: z.iso.date(), amountUah: z.coerce.number().nonnegative(), buyer: z.string().trim().optional(), document: z.string().trim().optional(), comment: z.string().trim().optional(), items: z.array(z.object({ lotId: z.string().uuid(), weightKg: z.coerce.number().positive() })).min(1) }).parse(input)
    const { supabase, userId } = await requirePermission('metal_scrap_sales', 'manage')
    const { error } = await (supabase as any).rpc('fn_sell_metal_scrap', { p_factory_id: parsed.factoryId, p_sale_date: parsed.saleDate, p_amount_uah: parsed.amountUah, p_buyer: parsed.buyer || '', p_document: parsed.document || '', p_comment: parsed.comment || '', p_items: parsed.items, p_actor: userId })
    if (error) throw error
    revalidatePath(ROUTES.INVENTORY_METAL_SCRAP); revalidatePath(ROUTES.FINANCE_CALENDAR)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function reviewMetalScrapLot(lotId: string, actualWeightKg: number, reason?: string) {
  try {
    const parsed = z.object({ lotId: z.string().uuid(), actualWeightKg: z.coerce.number().nonnegative(), reason: z.string().trim().optional() }).parse({ lotId, actualWeightKg, reason })
    const { supabase, userId } = await requirePermission('metal_scrap', 'manage')
    const { error } = await (supabase as any).rpc('fn_review_metal_scrap_lot', { p_lot_id: parsed.lotId, p_actual_weight_kg: parsed.actualWeightKg, p_reason: parsed.reason || '', p_actor: userId })
    if (error) throw error
    revalidatePath(ROUTES.INVENTORY_METAL_SCRAP); revalidatePath(ROUTES.TASKS)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function cancelMetalScrapSale(saleId: string, reason: string) {
  try {
    const parsed = z.object({ saleId: z.string().uuid(), reason: z.string().trim().min(1) }).parse({ saleId, reason })
    const { supabase, userId } = await requirePermission('metal_scrap_sales', 'manage')
    const { error } = await (supabase as any).rpc('fn_cancel_metal_scrap_sale', { p_sale_id: parsed.saleId, p_reason: parsed.reason, p_actor: userId })
    if (error) throw error
    revalidatePath(ROUTES.INVENTORY_METAL_SCRAP); revalidatePath(ROUTES.FINANCE_CALENDAR)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
