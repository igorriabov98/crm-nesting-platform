'use server'

/* eslint-disable @typescript-eslint/no-explicit-any -- New table types become available after the migration is applied. */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import type { PermissionMap } from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import {
  MACHINE_CUTTING_BUCKET,
  validateMachineCuttingRegistration,
  type DirectMachineCuttingUpload,
} from '@/lib/machine-cutting/files'
import {
  assertMachineCuttingUploadAccess,
  loadMachineCuttingUploadContext,
} from '@/lib/machine-cutting/server'
import { canUploadMachineCutting } from '@/lib/machine-cutting/access-policy'

export type MachineCuttingCompletion = {
  id: string
  requestId: string
  enteredMinutes: number
  addedMinutes: number
  actualMinutes: number
  finalizedAt: string
  updatedAt: string
}

export type MachineCuttingArchive = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string | null
  uploadedAt: string
  uploadedByName: string
  downloadUrl: string
}

export type MachineCuttingPayload = {
  completion: MachineCuttingCompletion | null
  archives: MachineCuttingArchive[]
  canUpload: boolean
  isArchived: boolean
}

type CuttingCompletionRow = {
  id: string
  request_id: string
  created_by: string
  entered_plasma_minutes: number
  added_plasma_minutes: number
  actual_plasma_minutes: number
  finalized_at: string
  updated_at: string
}

type CuttingArchiveRow = {
  id: string
  file_name: string
  file_size: number
  mime_type: string | null
  uploaded_at: string
  uploaded_by: string
}

const registrationSchema = z.object({
  completionId: z.string().uuid(),
  objectPath: z.string().min(1).max(700),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().max(160).nullable(),
  fileSize: z.number().int(),
})

async function loadPayload(
  machineId: string,
  actor: { userId: string; role: UserRole; permissions: PermissionMap },
): Promise<MachineCuttingPayload> {
  const admin = createAdminClient() as any
  const [machineResult, completionResult, archivesResult] = await Promise.all([
    admin.from('machines').select('id,is_archived').eq('id', machineId).maybeSingle(),
    admin
      .from('technologist_request_completions')
      .select('id,request_id,created_by,entered_plasma_minutes,added_plasma_minutes,actual_plasma_minutes,finalized_at,updated_at')
      .eq('machine_id', machineId)
      .eq('state', 'finalized')
      .order('finalized_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('machine_cutting_archives')
      .select('id,file_name,file_size,mime_type,uploaded_at,uploaded_by')
      .eq('machine_id', machineId)
      .order('uploaded_at', { ascending: false }),
  ])
  if (machineResult.error || !machineResult.data) throw new Error('Машина не найдена')
  if (completionResult.error) throw new Error(completionResult.error.message)
  if (archivesResult.error) throw new Error(archivesResult.error.message)

  const completion = (completionResult.data || null) as CuttingCompletionRow | null
  const archiveRows = (archivesResult.data || []) as CuttingArchiveRow[]
  const uploaderIds = Array.from(new Set(archiveRows.map((archive) => archive.uploaded_by)))
  const uploaderNames = new Map<string, string>()
  if (uploaderIds.length > 0) {
    const usersResult = await admin.from('users').select('id,full_name,email').in('id', uploaderIds)
    if (usersResult.error) throw new Error(usersResult.error.message)
    for (const user of usersResult.data || []) {
      uploaderNames.set(user.id, user.full_name || user.email || 'Пользователь')
    }
  }

  const canManage = hasPermission(actor.permissions, 'machine_cutting', 'manage')
  const canUpload = canUploadMachineCutting({
    userId: actor.userId,
    role: actor.role,
    canManage,
    isArchived: Boolean(machineResult.data.is_archived),
    completionCreatedBy: completion?.created_by || null,
  })

  return {
    completion: completion ? {
      id: completion.id,
      requestId: completion.request_id,
      enteredMinutes: completion.entered_plasma_minutes,
      addedMinutes: completion.added_plasma_minutes,
      actualMinutes: completion.actual_plasma_minutes,
      finalizedAt: completion.finalized_at,
      updatedAt: completion.updated_at,
    } : null,
    archives: archiveRows.map((archive) => ({
      id: archive.id,
      fileName: archive.file_name,
      fileSize: archive.file_size,
      mimeType: archive.mime_type,
      uploadedAt: archive.uploaded_at,
      uploadedByName: uploaderNames.get(archive.uploaded_by) || 'Пользователь',
      downloadUrl: `/api/machine-cutting/files/${archive.id}`,
    })),
    canUpload,
    isArchived: Boolean(machineResult.data.is_archived),
  }
}

export async function getMachineCutting(machineId: string) {
  try {
    const id = z.string().uuid().parse(machineId)
    const permission = await requirePermission('machine_cutting', 'view')
    return { success: true as const, data: await loadPayload(id, permission), error: null }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
  }
}

async function getStoredObject(objectPath: string) {
  const slashIndex = objectPath.lastIndexOf('/')
  const folder = objectPath.slice(0, slashIndex)
  const objectName = objectPath.slice(slashIndex + 1)
  const { data, error } = await createAdminClient().storage.from(MACHINE_CUTTING_BUCKET).list(folder, {
    limit: 10,
    search: objectName,
  })
  if (error) throw new Error(error.message)
  const object = data?.find((candidate) => candidate.name === objectName)
  if (!object) throw new Error('Загруженный архив не найден в хранилище')
  const size = Number(object.metadata?.size)
  if (!Number.isFinite(size)) throw new Error('Не удалось проверить размер загруженного архива')
  return { size, mimeType: typeof object.metadata?.mimetype === 'string' ? object.metadata.mimetype : null }
}

export async function registerMachineCuttingArchive(machineId: string, upload: DirectMachineCuttingUpload) {
  try {
    const id = z.string().uuid().parse(machineId)
    const parsed = registrationSchema.parse(upload)
    const permission = await requirePermission('machine_cutting', 'manage')
    const context = await loadMachineCuttingUploadContext(id)
    if (context.completion?.id !== parsed.completionId) {
      throw new Error('Завершение заявки изменилось. Подготовьте загрузку заново')
    }
    const completion = assertMachineCuttingUploadAccess(context, permission)
    const validated = validateMachineCuttingRegistration({ machineId: id, ...parsed })
    const stored = await getStoredObject(parsed.objectPath)
    if (stored.size !== parsed.fileSize) {
      throw new Error('Размер загруженного архива не совпадает с заявленным')
    }

    const { error } = await (createAdminClient() as any).from('machine_cutting_archives').insert({
      machine_id: id,
      request_id: completion.request_id,
      completion_id: completion.id,
      file_name: validated.fileName,
      storage_path: parsed.objectPath,
      mime_type: stored.mimeType || parsed.mimeType,
      file_size: stored.size,
      uploaded_by: permission.userId,
    })
    if (error) throw new Error(error.message)

    revalidatePath(`/sales-plan/${id}`)
    return { success: true as const, data: await loadPayload(id, permission), error: null }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
  }
}
