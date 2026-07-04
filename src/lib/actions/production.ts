"use server"

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/constants/routes'
import { isDirector } from '@/lib/utils/permissions'
import { STAGE_ORDER, stageHasSingleDate, stageHasWorkshop } from '@/lib/constants/stages'
import { syncTransportCostTask } from '@/lib/actions/transport-cost-tasks'
import { syncZincOutsourcingFromStage } from '@/lib/actions/outsourcing'
import { promoteShippedProjectSamplesToProducts } from '@/lib/actions/products'
import { isMachineInConfirmedProductionPlan, notifyProductionPlanShippingDateChanged } from '@/lib/actions/production-plan'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { CurrentUser } from '@/lib/types'
import type { Database } from '@/lib/types/database'

type ProductionStageUpdate = Database['public']['Tables']['production_stages']['Update']
type MachineUpdate = Database['public']['Tables']['machines']['Update']
type DbUpdateResult = { error: { message?: string } | null }
type MachineUpdateEqQuery = {
  eq: (column: string, value: unknown) => Promise<DbUpdateResult>
}
type MachineUpdateQuery = {
  update: (values: MachineUpdate) => MachineUpdateEqQuery
}
type MachineDateField =
  | 'desired_shipping_date'
  | 'planned_material_date'
  | 'actual_material_date'
  | 'actual_shipping_date'
  | 'delivery_to_client_date'
type StageForUpdate = {
  machine_id: string
  stage_type: Database['public']['Enums']['stage_type']
  date_start: string | null
  date_end: string | null
  night_shift_date: string | null
  machines: { factory_id: string | null; is_archived: boolean } | null
}
type MachineItemCoating = {
  coating: Database['public']['Enums']['coating_type']
}
type StageDateRow = {
  id: string
  stage_type: Database['public']['Enums']['stage_type']
  date_start: string | null
  date_end: string | null
  is_skipped: boolean | null
}
type StageDateValidationOptions = {
  enforceActualShippingToday?: boolean
}
type MachineLifecycleRow = {
  status: Database['public']['Enums']['machine_status']
  is_confirmed: boolean | null
  factory_id: string | null
  material_type: Database['public']['Enums']['material_type'] | null
  planned_material_date: string | null
  actual_material_date: string | null
  actual_shipping_date: string | null
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOnly(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, 10)
}

function getStagePosition(stageType: StageDateRow['stage_type']) {
  const index = STAGE_ORDER.indexOf(stageType)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function stageLabel(stageType: StageDateRow['stage_type']) {
  const labels: Partial<Record<StageDateRow['stage_type'], string>> = {
    cutting: 'Заготовка',
    assembly: 'Сборка',
    cleaning: 'Зачистка',
    galvanizing: 'Цинк',
    post_galvanizing_cleaning: 'Зачистка после цинка',
    painting: 'Малярка',
    packaging: 'Упаковка',
    shipping: 'Готовность к погрузке',
    actual_shipping: 'Факт отгрузки',
  }
  return labels[stageType] || stageType
}

function isSingleDateShippingStage(stageType: StageDateRow['stage_type']) {
  return stageHasSingleDate(stageType)
}

function validateStageDates(
  stages: StageDateRow[],
  changedStageId: string,
  options: StageDateValidationOptions = {}
) {
  const activeStages = [...stages]
    .filter((stage) => !stage.is_skipped)
    .sort((a, b) => getStagePosition(a.stage_type) - getStagePosition(b.stage_type))

  const changedIndex = activeStages.findIndex((stage) => stage.id === changedStageId)
  if (changedIndex === -1) return

  const currentStage = activeStages[changedIndex]
  if (currentStage.date_start && currentStage.date_end && currentStage.date_end < currentStage.date_start) {
    throw new Error(`Дата окончания этапа "${stageLabel(currentStage.stage_type)}" не может быть раньше даты начала`)
  }
  if (
    options.enforceActualShippingToday &&
    currentStage.stage_type === 'actual_shipping' &&
    currentStage.date_end &&
    currentStage.date_end < todayDateOnly()
  ) {
    throw new Error('Факт отгрузки нельзя поставить раньше сегодняшнего дня')
  }
  if (!currentStage?.date_start) return

  const previousStage = [...activeStages.slice(0, changedIndex)].reverse().find((stage) => stage.date_start)
  if (previousStage?.date_start && currentStage.date_start < previousStage.date_start) {
    throw new Error(`Дата начала этапа "${stageLabel(currentStage.stage_type)}" не может быть раньше начала предыдущего этапа "${stageLabel(previousStage.stage_type)}"`)
  }

  const nextStage = activeStages.slice(changedIndex + 1).find((stage) => stage.date_start)
  if (nextStage?.date_start && currentStage.date_start > nextStage.date_start) {
    throw new Error(`Дата начала этапа "${stageLabel(currentStage.stage_type)}" не может быть позже начала следующего этапа "${stageLabel(nextStage.stage_type)}"`)
  }
}

function inferMachineStatus(machine: MachineLifecycleRow) {
  if (machine.actual_shipping_date) return 'shipped' as const
  if (machine.actual_material_date) return 'material_received' as const
  if (machine.status !== 'in_production') return machine.status
  if (machine.factory_id && machine.material_type && machine.material_type !== 'undefined' && machine.planned_material_date) {
    return 'planned' as const
  }
  if (machine.is_confirmed) return 'confirmed' as const
  return 'created' as const
}

async function reconcileMachineStatus(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, machineId: string) {
  const { data, error } = await supabase
    .from('machines')
    .select('status, is_confirmed, factory_id, material_type, planned_material_date, actual_material_date, actual_shipping_date')
    .eq('id', machineId)
    .single()

  if (error || !data) throw error || new Error('Машина не найдена')
  const machine = data as unknown as MachineLifecycleRow
  const nextStatus = inferMachineStatus(machine)
  if (nextStatus === machine.status) return

  const { error: updateError } = await (supabase.from('machines') as unknown as MachineUpdateQuery)
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', machineId)

  if (updateError) throw updateError
}

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

export async function updateProductionStage(stageId: string, data: ProductionStageUpdate) {
  try {
    const { supabase, user } = await requireAuth()

    const canEdit = user.role === 'production_manager' || isDirector(user.role)
    if (!canEdit) throw new Error('Недостаточно прав для редактирования этапа производства')

    const { data: currentStage, error: stageErr } = await supabase
      .from('production_stages')
      .select('machine_id, stage_type, date_start, date_end, night_shift_date, machines(factory_id, is_archived)')
      .eq('id', stageId)
      .single()

    if (stageErr || !currentStage) throw new Error('Этап не найден')

    const stageObj = currentStage as unknown as StageForUpdate
    const machine = stageObj.machines
    if (!machine) throw new Error('Машина не найдена')
    if (machine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')
    if (machine.factory_id !== user.factory_id) throw new Error('Доступ запрещён')

    const dateFields = ['date_start', 'date_end', 'night_shift_date'] as const
    const changesPlanDate = dateFields.some((field) => field in data)
    if (
      user.role === 'production_manager' &&
      changesPlanDate &&
      await isMachineInConfirmedProductionPlan(stageObj.machine_id)
    ) {
      throw new Error('План месяца подтверждён. Отправьте запрос на изменение дат руководителю отдела планирования.')
    }

    if (data.is_skipped === true && stageObj.stage_type === 'galvanizing') {
      const { data: machineItemsData, error: itemsErr } = await supabase
        .from('machine_items')
        .select('coating')
        .eq('machine_id', stageObj.machine_id)

      if (itemsErr) throw itemsErr
      const machineItems = (machineItemsData ?? []) as MachineItemCoating[]
      const hasZinc = machineItems.some((item) => item.coating === 'zinc')
      if (hasZinc) {
        throw new Error('Нельзя пропустить цинкование, если хотя бы у одного товара выбрано покрытие цинком')
      }
    }

    if (data.workshop !== undefined && !stageHasWorkshop(stageObj.stage_type)) {
      data.workshop = null
    }

    if (isSingleDateShippingStage(stageObj.stage_type)) {
      if ('date_start' in data && !('date_end' in data)) {
        data.date_end = dateOnly(data.date_start)
      }
      if ('date_start' in data || 'date_end' in data) {
        data.date_start = null
        data.workshop = null
        data.is_night_shift = false
        data.night_shift_date = null
      } else if (data.workshop !== undefined) {
        data.workshop = null
      }
    }

    const shouldValidateDates = 'date_start' in data || 'date_end' in data || 'is_skipped' in data
    if (shouldValidateDates) {
      const { data: allStages, error: allStagesError } = await supabase
        .from('production_stages')
        .select('id, stage_type, date_start, date_end, is_skipped')
        .eq('machine_id', stageObj.machine_id)

      if (allStagesError) throw allStagesError

      const mergedStages = ((allStages || []) as StageDateRow[]).map((stage) => {
        if (stage.id !== stageId) return stage
        return {
          ...stage,
          date_start: 'date_start' in data ? dateOnly(data.date_start) : stage.date_start,
          date_end: 'date_end' in data ? dateOnly(data.date_end) : stage.date_end,
          is_skipped: 'is_skipped' in data ? Boolean(data.is_skipped) : stage.is_skipped,
        }
      })
      validateStageDates(mergedStages, stageId, {
        enforceActualShippingToday:
          stageObj.stage_type === 'actual_shipping' &&
          'date_end' in data &&
          data.date_end !== null &&
          data.date_end !== undefined,
      })
    }

    const { error: updateErr } = await supabase
      .from('production_stages')
      .update(data as never)
      .eq('id', stageId)

    if (updateErr) throw updateErr
    await reconcileMachineStatus(supabase, stageObj.machine_id)
    if (stageObj.stage_type === 'cutting' && ('date_start' in data || 'is_skipped' in data)) {
      try {
        await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown> })
          .rpc('fn_promote_due_future_business_scrap', {})
      } catch {
        // Stage updates should remain available if best-effort promotion fails.
      }
      revalidatePath(ROUTES.INVENTORY)
    }
    if (stageObj.stage_type === 'shipping' && ('date_end' in data || 'planned_date_end' in data)) {
      await syncTransportCostTask(supabase, stageObj.machine_id)
    }
    if (stageObj.stage_type === 'shipping' && 'date_end' in data) {
      await notifyProductionPlanShippingDateChanged(
        stageObj.machine_id,
        stageObj.date_end,
        dateOnly(data.date_end),
        user.id,
      )
    }
    if (stageObj.stage_type === 'galvanizing' && ('date_start' in data || 'date_end' in data)) {
      await syncZincOutsourcingFromStage(stageObj.machine_id, {
        dateStart: 'date_start' in data ? dateOnly(data.date_start) : stageObj.date_start,
        dateEnd: 'date_end' in data ? dateOnly(data.date_end) : stageObj.date_end,
      }, user.id)
    }

    revalidatePath(`${ROUTES.SALES_PLAN}/${stageObj.machine_id}`)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.DASHBOARD)
    revalidatePath(ROUTES.MEETINGS)
    revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
    revalidatePath(ROUTES.TASKS)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function toggleStageSkip(stageId: string, isSkipped: boolean) {
  return updateProductionStage(stageId, { is_skipped: isSkipped })
}

export async function clearProductionStageDates(stageId: string) {
  return updateProductionStage(stageId, { date_start: null, date_end: null })
}

export async function updateMachineDate(
  machineId: string,
  field: MachineDateField,
  value: string | null
) {
  try {
    const { supabase, user } = await requireAuth()

    if (field === 'actual_material_date') {
      throw new Error('Факт поставки материала заполняется автоматически после приемки всех материалов по заявке')
    }

    const salesFields: MachineDateField[] = ['desired_shipping_date', 'delivery_to_client_date']
    const productionFields: MachineDateField[] = [
      'planned_material_date',
      'actual_shipping_date',
    ]

    const canEditSalesDate = user.role === 'sales_manager' || isDirector(user.role)
    const canEditProductionDate = user.role === 'production_manager' || isDirector(user.role)

    if (
      (salesFields.includes(field) && !canEditSalesDate) ||
      (productionFields.includes(field) && !canEditProductionDate)
    ) {
      throw new Error('Недостаточно прав для редактирования даты')
    }

    const { data: machine, error: machineError } = await supabase
      .from('machines')
      .select('factory_id, is_archived')
      .eq('id', machineId)
      .single()

    if (machineError || !machine) throw new Error('Машина не найдена')
    const selectedMachine = machine as unknown as { factory_id: string | null; is_archived: boolean }
    if (selectedMachine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')
    if (user.role === 'production_manager' && selectedMachine.factory_id !== user.factory_id) {
      throw new Error('Доступ запрещён')
    }

    const dateValue = value ? value.slice(0, 10) : null
    if (field === 'actual_shipping_date' && dateValue && dateValue < todayDateOnly()) {
      throw new Error('Факт отгрузки нельзя поставить раньше сегодняшнего дня')
    }
    if (
      user.role === 'production_manager' &&
      field === 'planned_material_date' &&
      await isMachineInConfirmedProductionPlan(machineId)
    ) {
      throw new Error('План месяца подтверждён. Отправьте запрос на изменение дат руководителю отдела планирования.')
    }

    const updateData: MachineUpdate = { [field]: dateValue }
    const { error } = await (supabase.from('machines') as unknown as MachineUpdateQuery)
      .update(updateData)
      .eq('id', machineId)

    if (error) throw error
    await reconcileMachineStatus(supabase, machineId)
    if (field === 'desired_shipping_date') {
      await syncTransportCostTask(supabase, machineId)
    }
    if (field === 'actual_shipping_date' && dateValue) {
      const promotion = await promoteShippedProjectSamplesToProducts(machineId)
      if (!promotion.success) throw new Error(promotion.error || 'Не удалось добавить изготовленный образец в базу продукции')
    }

    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(ROUTES.INVOICES)
    revalidatePath(ROUTES.TASKS)

    return { success: true, error: null }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
