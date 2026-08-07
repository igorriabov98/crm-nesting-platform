import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import {
  MACHINE_CUTTING_BUCKET,
  machineCuttingUploadPrefix,
  validateMachineCuttingRegistration,
  validateMachineCuttingUploadRequest,
} from '@/lib/machine-cutting/files'
import {
  MachineCuttingUploadDeniedError,
  assertMachineCuttingUploadAccess,
  loadMachineCuttingUploadContext,
} from '@/lib/machine-cutting/server'

export const dynamic = 'force-dynamic'

const uploadSchema = z.object({
  machineId: z.string().uuid(),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int(),
})

const cleanupSchema = z.object({
  machineId: z.string().uuid(),
  completionId: z.string().uuid(),
  objectPath: z.string().min(1).max(700),
})

function errorResponse(error: unknown, fallback: string) {
  const denied = error instanceof PermissionDeniedError || error instanceof MachineCuttingUploadDeniedError
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: denied ? 403 : 400 },
  )
}

export async function POST(request: NextRequest) {
  try {
    const input = uploadSchema.parse(await request.json())
    const permission = await requirePermission('machine_cutting', 'manage')
    const context = await loadMachineCuttingUploadContext(input.machineId)
    const completion = assertMachineCuttingUploadAccess(context, permission)
    const { extension } = validateMachineCuttingUploadRequest({ fileName: input.fileName, fileSize: input.size })
    const objectPath = `${machineCuttingUploadPrefix(input.machineId, completion.id)}${Date.now()}-${randomUUID()}${extension}`

    const { data, error } = await createAdminClient().storage
      .from(MACHINE_CUTTING_BUCKET)
      .createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')

    return NextResponse.json({
      data: {
        bucket: MACHINE_CUTTING_BUCKET,
        completionId: completion.id,
        objectPath,
        token: data.token,
      },
    })
  } catch (error) {
    return errorResponse(error, 'Не удалось подготовить загрузку архива')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const input = cleanupSchema.parse(await request.json())
    const permission = await requirePermission('machine_cutting', 'manage')
    const context = await loadMachineCuttingUploadContext(input.machineId, input.completionId)
    assertMachineCuttingUploadAccess(context, permission, { allowArchivedCleanup: true })
    validateMachineCuttingRegistration({
      machineId: input.machineId,
      completionId: input.completionId,
      objectPath: input.objectPath,
      fileName: input.objectPath.slice(input.objectPath.lastIndexOf('/') + 1),
      mimeType: null,
      fileSize: 1,
    })

    const admin = createAdminClient()
    const { data: registered, error: lookupError } = await admin
      .from('machine_cutting_archives')
      .select('id')
      .eq('storage_path', input.objectPath)
      .maybeSingle()
    if (lookupError) throw new Error(lookupError.message)
    if (registered) throw new Error('Зарегистрированный архив нельзя удалить')

    const { error } = await admin.storage.from(MACHINE_CUTTING_BUCKET).remove([input.objectPath])
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'Не удалось очистить незарегистрированный архив')
  }
}
