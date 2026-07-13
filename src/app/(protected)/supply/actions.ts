"use server"

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SUPPLY_DASHBOARD_MACHINE_LIMIT } from '@/lib/constants/performance-limits'
import { requirePermission } from '@/lib/permissions/server'
import { differenceInDays } from 'date-fns'

function applyProductionManagerFactoryScope<T>(query: T, factoryId: string | null): T {
  const scopedQuery = query as { or: (filters: string) => T; is: (column: string, value: unknown) => T }
  if (!factoryId) return scopedQuery.is('factory_id', null)
  return scopedQuery.or(`factory_id.eq.${factoryId},factory_id.is.null`)
}

type UserProfileRow = {
  factory_id: string | null
  role: string
}

type SupplyItemStatus = 'not_ordered' | 'ordered' | 'received'

type SupplyItemRow = {
  id: string
  created_by: string | null
  nomenclature: string | null
  unit: string | null
  quantity: number | null
  supplier: string | null
  price_per_unit: number | null
  status: SupplyItemStatus | null
  planned_delivery_date: string | null
  comment: string | null
  engineer_confirmation: boolean | null
  engineer_deadline: string | null
  technologist_deadline: string | null
}

type SupplyMachineRow = {
  id: string
  name: string
  total_weight: number | null
  factory_id: string | null
  is_archived: boolean | null
  supply_items?: SupplyItemRow[] | null
}

type SupplyMachineSummaryRow = {
  id: string
  name: string
  total_weight: number | null
  has_zinc?: boolean | null
  has_painting?: boolean | null
  factory_id: string | null
  is_archived?: boolean | null
}

export async function getSupplyDashboard(factoryFilter?: string | null) {
  await requirePermission('supply', 'view')
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase.from('users').select('factory_id, role').eq('id', user.id).single()
  if (!profile) throw new Error('Профиль не найден')

  let query = supabase
    .from('machines_with_totals')
    .select(`
      id, name, total_weight, factory_id, is_archived,
      supply_items(
        id, nomenclature, unit, quantity,
        supplier, price_per_unit, status,
        planned_delivery_date, comment,
        engineer_confirmation, engineer_deadline,
        technologist_deadline
      )
    `)
    .eq('is_archived', false)

  const profileRow = profile as UserProfileRow

  if (profileRow.role === 'production_manager') {
    query = applyProductionManagerFactoryScope(query, profileRow.factory_id)
  } else if (factoryFilter === 'no_factory') {
    query = query.is('factory_id', null)
  } else if (factoryFilter && factoryFilter !== 'all') {
    query = query.eq('factory_id', factoryFilter)
  }

  const { data: machines, error } = await query
    .order('created_at', { ascending: false })
    .limit(SUPPLY_DASHBOARD_MACHINE_LIMIT)
  if (error) throw new Error(error.message)

  let total_machines = 0
  let total_items_all = 0
  let total_received = 0
  let total_ordered = 0
  let total_not_ordered = 0
  let total_overdue = 0
  let total_cost_all = 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const noFactoryMachines: { id: string; name: string; total_weight: number; total_items: number }[] = []

  const result = ((machines || []) as unknown as SupplyMachineRow[]).map((machine) => {
    const items = machine.supply_items || []
    let received_items = 0
    let ordered_items = 0
    let not_ordered_items = 0
    let overdue_items = 0
    let nearest_deadline: string | null = null
    let total_cost = 0

    items.forEach((item) => {
      total_items_all++
      total_cost += (item.quantity || 0) * (item.price_per_unit || 0)

      if (item.status === 'received') {
        received_items++
        total_received++
      } else if (item.status === 'ordered') {
        ordered_items++
        total_ordered++
      } else {
        not_ordered_items++
        total_not_ordered++
      }

      if (item.status !== 'received' && item.planned_delivery_date) {
        const plannedDate = new Date(item.planned_delivery_date)
        if (differenceInDays(today, plannedDate) > 0) {
          overdue_items++
          total_overdue++
        }
        if (!nearest_deadline || plannedDate < new Date(nearest_deadline)) {
          nearest_deadline = item.planned_delivery_date
        }
      }
    })

    total_machines++
    total_cost_all += total_cost

    if (!machine.factory_id) {
      noFactoryMachines.push({
        id: machine.id,
        name: machine.name,
        total_weight: machine.total_weight || 0,
        total_items: items.length,
      })
    }

    return {
      id: machine.id,
      name: machine.name,
      total_weight: machine.total_weight || 0,
      factory_id: machine.factory_id,
      total_items: items.length,
      received_items,
      ordered_items,
      not_ordered_items,
      overdue_items,
      nearest_deadline,
      total_cost,
    }
  })

  return {
    machines: result,
    noFactoryMachines,
    summary: {
      total_machines,
      total_items: total_items_all,
      total_received,
      total_ordered,
      total_not_ordered,
      total_overdue,
      total_cost: total_cost_all,
    }
  }
}

export async function getSupplyByMachine(machineId: string) {
  await requirePermission('supply', 'view')
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Не авторизован')

  const { data: profile } = await supabase.from('users').select('factory_id, role').eq('id', user.id).single()
  if (!profile) throw new Error('Профиль не найден')

  const { data: machine, error: mErr } = await supabase
    .from('machines_with_totals')
    .select('id, name, total_weight, has_zinc, has_painting, factory_id, is_archived')
    .eq('id', machineId)
    .eq('is_archived', false)
    .single()

  if (mErr || !machine) throw new Error('Машина не найдена')
  const profileRow = profile as UserProfileRow
  const machineRow = machine as SupplyMachineSummaryRow

  if (profileRow.role === 'production_manager' && machineRow.factory_id !== null && machineRow.factory_id !== profileRow.factory_id) {
    throw new Error('Доступ запрещён')
  }

  const { data: items, error: iErr } = await supabase
    .from('supply_items')
    .select('*')
    .eq('machine_id', machineId)
    .order('created_at', { ascending: true })

  if (iErr) throw new Error(iErr.message)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const processedItems = ((items || []) as unknown as SupplyItemRow[]).map((item) => {
    const is_overdue = Boolean(item.status !== 'received' && item.planned_delivery_date && differenceInDays(today, new Date(item.planned_delivery_date)) > 0)
    return {
      ...item,
      engineer_confirmation: Boolean(item.engineer_confirmation),
      status: item.status || 'not_ordered',
      is_overdue,
    }
  })

  let received = 0
  let ordered = 0
  let not_ordered = 0
  let sum = 0

  processedItems.forEach((item) => {
    if (item.status === 'received') received++
    else if (item.status === 'ordered') ordered++
    else not_ordered++
    sum += (item.quantity || 0) * (item.price_per_unit || 0)
  })

  return {
    machine: {
      ...machineRow,
      total_weight: machineRow.total_weight || 0,
    },
    items: processedItems,
    summary: {
      total: processedItems.length,
      received,
      ordered,
      not_ordered,
      sum
    }
  }
}
