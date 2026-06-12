"use server"

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/constants/routes'
import { isDirector } from '@/lib/utils/permissions'
import type { CurrentUser } from '@/lib/types'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

const createSupplyItemSchema = z.object({
  nomenclature: z.string().trim().min(1, 'Введите номенклатуру'),
  unit: z.string().trim().min(1, 'Введите единицу измерения').default('шт'),
  quantity: z.coerce.number().positive('Количество должно быть больше 0').default(1),
  supplier: z.string().trim().optional(),
  price_per_unit: z.coerce.number().min(0, 'Цена не может быть отрицательной').optional(),
  planned_delivery_date: z.string().optional(),
  comment: z.string().trim().optional(),
}).strict()

const updateSupplyItemSchema = z.object({
  engineer_confirmation: z.boolean().optional(),
  nomenclature: z.string().trim().min(1, 'Введите номенклатуру').optional(),
  unit: z.string().trim().min(1, 'Введите единицу измерения').optional(),
  quantity: z.coerce.number().positive('Количество должно быть больше 0').optional(),
  supplier: z.string().trim().optional(),
  price_per_unit: z.coerce.number().min(0, 'Цена не может быть отрицательной').optional(),
  status: z.enum(['received', 'ordered', 'not_ordered']).optional(),
  comment: z.string().trim().optional(),
  planned_delivery_date: z.string().optional(),
}).strict()

async function requireAuth() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Профиль не найден')
  return { supabase, user: profile as unknown as CurrentUser }
}

function handleRevalidate(machineId: string) {
  revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
  revalidatePath(`/supply/${machineId}`)
  revalidatePath('/supply')
}

async function assertMachineNotArchived(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, machineId: string) {
  const { data, error } = await supabase
    .from('machines')
    .select('is_archived')
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error('Машина не найдена')
  if ((data as { is_archived?: boolean }).is_archived) {
    throw new Error('Машина архивирована. Действия с ней остановлены.')
  }
}

export async function createSupplyItem(machineId: string, rawData: unknown) {
  try {
    const { supabase, user } = await requireAuth()
    const data = createSupplyItemSchema.parse(rawData)
    await assertMachineNotArchived(supabase, machineId)

    const canCreate = ['technologist', 'supply_manager'].includes(user.role) || isDirector(user.role)
    if (!canCreate) throw new Error('Нет прав для добавления позиций')

    const { error: insertErr } = await supabase.from('supply_items').insert({
      machine_id: machineId,
      nomenclature: data.nomenclature || '',
      unit: data.unit || 'шт',
      quantity: data.quantity || 1,
      supplier: data.supplier,
      price_per_unit: data.price_per_unit || 0,
      planned_delivery_date: data.planned_delivery_date,
      comment: data.comment,
      created_by: user.id,
    } as never)

    if (insertErr) throw insertErr

    handleRevalidate(machineId)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function updateSupplyItem(itemId: string, rawData: unknown, machineId: string) {
  try {
    const { supabase, user } = await requireAuth()
    const role = user.role
    const data = updateSupplyItemSchema.parse(rawData)
    await assertMachineNotArchived(supabase, machineId)
    const allowedFields: Record<string, unknown> = {}

    if (isDirector(role)) {
      Object.assign(allowedFields, data)
    } else {
      if (role === 'engineer' && data.engineer_confirmation !== undefined) {
        allowedFields.engineer_confirmation = data.engineer_confirmation
      }
      if (role === 'technologist') {
        if (data.nomenclature !== undefined) allowedFields.nomenclature = data.nomenclature
        if (data.unit !== undefined) allowedFields.unit = data.unit
        if (data.quantity !== undefined) allowedFields.quantity = data.quantity
      }
      if (role === 'supply_manager') {
        if (data.supplier !== undefined) allowedFields.supplier = data.supplier
        if (data.price_per_unit !== undefined) allowedFields.price_per_unit = data.price_per_unit
        if (data.status !== undefined) allowedFields.status = data.status
        if (data.comment !== undefined) allowedFields.comment = data.comment
        if (data.planned_delivery_date !== undefined) allowedFields.planned_delivery_date = data.planned_delivery_date
      }
    }

    if (Object.keys(allowedFields).length === 0) {
      throw new Error('У вас нет прав на редактирование отправленных полей')
    }

    const { error } = await supabase.from('supply_items')
      .update(allowedFields as never)
      .eq('id', itemId)
      .eq('machine_id', machineId)

    if (error) throw error

    handleRevalidate(machineId)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function deleteSupplyItem(itemId: string, machineId: string) {
  try {
    const { supabase, user } = await requireAuth()
    await assertMachineNotArchived(supabase, machineId)
    const { data: item } = await supabase.from('supply_items').select('created_by').eq('id', itemId).single()
    const isOwner = (item as { created_by?: string } | null)?.created_by === user.id

    if (!isDirector(user.role) && !isOwner) {
      throw new Error('Только директор или создатель позиции могут её удалить')
    }

    const { error } = await supabase
      .from('supply_items')
      .delete()
      .eq('id', itemId)

    if (error) throw error

    handleRevalidate(machineId)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}
