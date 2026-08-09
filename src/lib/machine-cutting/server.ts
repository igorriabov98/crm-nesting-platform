import 'server-only'

/* eslint-disable @typescript-eslint/no-explicit-any -- New table types become available after the migration is applied. */

import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/lib/types'
import { canUploadMachineCutting } from '@/lib/machine-cutting/access-policy'

export class MachineCuttingUploadDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MachineCuttingUploadDeniedError'
  }
}

export type MachineCuttingUploadContext = {
  machine: { id: string; is_archived: boolean }
  request: {
    id: string
    machine_id: string
    created_by: string
    status: string
  } | null
  completion: {
    id: string
    request_id: string
    machine_id: string
    created_by: string
  } | null
}

export async function loadMachineCuttingUploadContext(
  machineId: string,
  requestId: string,
  completionId?: string | null,
): Promise<MachineCuttingUploadContext> {
  const admin = createAdminClient() as any
  const machineResult = await admin.from('machines').select('id,is_archived').eq('id', machineId).maybeSingle()
  if (machineResult.error || !machineResult.data) throw new Error('Машина не найдена')

  const requestResult = await admin
    .from('technologist_requests')
    .select('id,machine_id,created_by,status')
    .eq('id', requestId)
    .eq('machine_id', machineId)
    .maybeSingle()
  if (requestResult.error) throw new Error(requestResult.error.message)

  let completionQuery = admin
    .from('technologist_request_completions')
    .select('id,request_id,machine_id,created_by')
    .eq('machine_id', machineId)
    .eq('request_id', requestId)
    .eq('state', 'finalized')
  completionQuery = completionId
    ? completionQuery.eq('id', completionId).maybeSingle()
    : completionQuery.maybeSingle()

  const completionResult = await completionQuery
  if (completionResult.error) throw new Error(completionResult.error.message)
  return {
    machine: machineResult.data,
    request: requestResult.data || null,
    completion: completionResult.data || null,
  }
}

export function assertMachineCuttingUploadAccess(
  context: MachineCuttingUploadContext,
  actor: { userId: string; role: UserRole },
  options: { allowArchivedCleanup?: boolean; allowPendingRequest?: boolean } = {},
) {
  if (context.machine.is_archived && !options.allowArchivedCleanup) {
    throw new MachineCuttingUploadDeniedError('В архивную машину нельзя загружать новые файлы')
  }
  if (!context.request) {
    throw new MachineCuttingUploadDeniedError('Заявка технолога не найдена')
  }
  if (!context.completion && !options.allowPendingRequest) {
    throw new MachineCuttingUploadDeniedError('Загрузка станет доступна после завершения заявки технолога')
  }
  if (!context.completion && options.allowPendingRequest && context.request.created_by !== actor.userId) {
    throw new MachineCuttingUploadDeniedError('До завершения программы может загрузить только автор заявки')
  }
  if (!canUploadMachineCutting({
    userId: actor.userId,
    role: actor.role,
    canManage: true,
    isArchived: options.allowArchivedCleanup ? false : context.machine.is_archived,
    completionCreatedBy: context.completion?.created_by || context.request.created_by,
  })) {
    throw new MachineCuttingUploadDeniedError('Загрузить архив может автор завершённой заявки или директор')
  }
  return { request: context.request, completion: context.completion }
}
