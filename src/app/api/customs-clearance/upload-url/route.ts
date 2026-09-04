import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { trustedDb } from '@/lib/supabase/trusted-db'
import { assertFactoryAccess } from '@/lib/permissions/factory-scope'
import { PermissionDeniedError, requirePermission } from '@/lib/permissions/server'
import {
  customsClearanceUploadPrefix,
  validateCustomsClearanceFile,
} from '@/lib/customs-clearance-files'

export const dynamic = 'force-dynamic'

const uploadSchema = z.object({
  machineId: z.string().uuid(),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int().positive(),
})
const cleanupSchema = z.object({
  machineId: z.string().uuid(),
  objectPaths: z.array(z.string().min(1)).min(1).max(10),
})

function isAuthenticationError(error: unknown) {
  return error instanceof AuthRequiredError
    || error instanceof UserProfileMissingError
    || error instanceof UserInactiveError
}

async function assertMachineAccess(
  machineId: string,
  context: Awaited<ReturnType<typeof requirePermission>>,
) {
  const { data, error } = await trustedDb(createAdminClient())
    .from('machines')
    .select('factory_id, is_archived')
    .eq('id', machineId)
    .maybeSingle()
  if (error || !data) throw new Error('Машина не найдена')
  const machine = data as { factory_id: string | null; is_archived: boolean | null }
  assertFactoryAccess(context, 'customs_clearance', 'manage', machine.factory_id)
  if (machine.is_archived) throw new Error('Архивную машину нельзя изменять')
}

export async function POST(request: Request) {
  try {
    const input = uploadSchema.parse(await request.json())
    const context = await requirePermission('customs_clearance', 'manage')
    await assertMachineAccess(input.machineId, context)
    const validated = validateCustomsClearanceFile({
      fileName: input.fileName,
      fileSize: input.size,
      contentType: input.contentType,
    })
    const objectPath = `${customsClearanceUploadPrefix(input.machineId, context.userId)}${Date.now()}-${randomUUID()}${validated.extension}`
    const { data, error } = await createAdminClient().storage
      .from('customs-clearance-files')
      .createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')
    return NextResponse.json({
      data: {
        bucket: 'customs-clearance-files',
        objectPath,
        token: data.token,
        contentType: validated.mimeType,
      },
    })
  } catch (error) {
    const status = isAuthenticationError(error)
      ? 401
      : error instanceof PermissionDeniedError
        ? 403
        : 400
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось подготовить загрузку' },
      { status },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const input = cleanupSchema.parse(await request.json())
    const context = await requirePermission('customs_clearance', 'manage')
    await assertMachineAccess(input.machineId, context)
    const prefix = customsClearanceUploadPrefix(input.machineId, context.userId)
    if (input.objectPaths.some((path) => !path.startsWith(prefix) || path.includes('..'))) {
      throw new Error('Некорректный путь файла')
    }
    const admin = createAdminClient()
    const { data: registered } = await trustedDb(admin)
      .from('machine_customs_documents')
      .select('storage_path')
      .in('storage_path', input.objectPaths)
    const registeredPaths = new Set(
      ((registered || []) as unknown as Array<{ storage_path: string }>).map((row) => row.storage_path),
    )
    const removable = input.objectPaths.filter((path) => !registeredPaths.has(path))
    if (removable.length > 0) {
      const { error } = await admin.storage.from('customs-clearance-files').remove(removable)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = isAuthenticationError(error)
      ? 401
      : error instanceof PermissionDeniedError
        ? 403
        : 400
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось очистить загрузку' },
      { status },
    )
  }
}
