import 'server-only'

/* eslint-disable @typescript-eslint/no-explicit-any -- approval/task relations are migration-backed */

import { hasPermission, type PermissionOperation } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { evaluateReservationCapability } from '@/lib/supply-request-access'

export type TechnologistRequestAccess = Awaited<ReturnType<typeof requireTechnologistRequestAccess>>

export class TechnologistRequestAccessError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, options: { status: number; code: string; retryable?: boolean }) {
    super(message)
    this.name = 'TechnologistRequestAccessError'
    this.status = options.status
    this.code = options.code
    this.retryable = options.retryable === true
  }
}

export async function requireTechnologistRequestAccess(
  requestId: string,
  options: {
    workflowOperation: PermissionOperation
    inventoryOperation: PermissionOperation
    allowedStatuses?: readonly string[]
  },
) {
  const context = await requirePermission('technologist_requests', options.workflowOperation)
  const admin = createAdminClient() as any
  const requestResult = await admin
    .from('technologist_requests')
    .select('id,machine_id,created_by,status,machines(id,name,material_type,factory_id,is_archived)')
    .eq('id', requestId)
    .maybeSingle()
  if (requestResult.error) throw new TechnologistRequestAccessError(requestResult.error.message || 'Не удалось прочитать заявку', { status: 500, code: 'request_read_failed', retryable: true })
  if (!requestResult.data) throw new TechnologistRequestAccessError('Заявка не найдена', { status: 404, code: 'request_not_found' })

  const request = requestResult.data as {
    id: string
    machine_id: string
    created_by: string
    status: string
    machines: { id: string; name: string | null; material_type: string | null; factory_id: string | null; is_archived: boolean } | Array<{ id: string; name: string | null; material_type: string | null; factory_id: string | null; is_archived: boolean }> | null
  }
  const machine = Array.isArray(request.machines) ? request.machines[0] : request.machines
  if (!machine) throw new TechnologistRequestAccessError('Заказ заявки не найден', { status: 404, code: 'machine_not_found' })
  if (machine.is_archived) throw new TechnologistRequestAccessError('Заказ находится в архиве', { status: 409, code: 'machine_archived' })

  if (!context.permissionDetails.isAdminPosition && request.created_by !== context.userId) {
    const taskResult = await admin
      .from('tasks')
      .select('id,approval_version:technologist_request_approval_versions!tasks_technologist_request_approval_id_fkey(request_id)')
      .eq('assigned_to', context.userId)
      .eq('task_type', 'technologist_request_revision')
      .in('status', ['pending', 'in_progress'])
    if (taskResult.error) throw new TechnologistRequestAccessError(taskResult.error.message || 'Не удалось проверить назначение на доработку', { status: 500, code: 'revision_assignment_read_failed', retryable: true })
    const assigned = (taskResult.data || []).some((task: any) => {
      const version = Array.isArray(task.approval_version) ? task.approval_version[0] : task.approval_version
      return version?.request_id === request.id
    })
    if (!assigned) throw new TechnologistRequestAccessError('Действие доступно автору заявки или назначенному исполнителю доработки', { status: 403, code: 'request_assignment_denied' })
  }

  const hasInventoryPermission = hasPermission(
    context.permissions,
    'inventory',
    options.inventoryOperation,
  )
  const capability = evaluateReservationCapability({
    hasWorkflowPermission: true,
    hasInventoryManage: hasInventoryPermission,
    isAdmin: context.permissionDetails.isAdminPosition,
    inventoryFactoryScope: context.permissionDetails.factoryScopes.inventory?.[options.inventoryOperation] || 'own',
    userFactoryId: context.factoryId,
    targetFactoryId: machine.factory_id,
    workflowDeniedReason: 'Нет права управлять заявкой технолога',
    inventoryDeniedReason: options.inventoryOperation === 'view'
      ? 'Нет права просматривать склад'
      : 'Нет права управлять складом',
  })
  if (!capability.allowed) throw new TechnologistRequestAccessError(capability.reason || 'Недостаточно прав для выбранного завода', { status: 403, code: 'factory_access_denied' })

  if (options.allowedStatuses && !options.allowedStatuses.includes(request.status)) {
    throw new TechnologistRequestAccessError('Заявка находится на другом этапе', { status: 409, code: 'request_status_conflict' })
  }

  return { ...context, admin, request, machine }
}
