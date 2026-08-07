import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { canManageDepartmentRequestTarget, type DepartmentRequestTarget } from '@/lib/department-requests'
import {
  departmentRequestUploadPrefix,
  validateDepartmentRequestFile,
} from '@/lib/department-request-files'

export const dynamic = 'force-dynamic'

const uploadSchema = z.object({
  requestId: z.string().uuid(),
  phase: z.enum(['source', 'resolution']),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int().positive(),
})

const cleanupSchema = z.object({
  requestId: z.string().uuid(),
  phase: z.enum(['source', 'resolution']),
  objectPaths: z.array(z.string().min(1)).min(1).max(10),
})

function memberships(permissionDetails: Awaited<ReturnType<typeof requirePermission>>['permissionDetails']) {
  return permissionDetails.memberships.map((membership) => ({
    departmentName: membership.departmentName,
    positionName: membership.positionName,
  }))
}

async function assertResolutionAccess(
  requestId: string,
  context: Awaited<ReturnType<typeof requirePermission>>,
) {
  const { data, error } = await createAdminClient()
    .from('department_requests')
    .select('target_department, factory_id, status')
    .eq('id', requestId)
    .maybeSingle()
  if (error || !data) throw new Error('Запрос не найден')
  const request = data as unknown as {
    target_department: DepartmentRequestTarget
    factory_id: string | null
    status: string
  }
  if (request.status !== 'in_progress') throw new Error('Сначала возьмите запрос в работу')

  const allowed = canManageDepartmentRequestTarget({
    target: request.target_department,
    role: context.role,
    memberships: memberships(context.permissionDetails),
  })
  const factoryAllowed = request.target_department !== 'production'
    || ['financial_director', 'commercial_director', 'planning_director'].includes(context.role)
    || !request.factory_id
    || request.factory_id === context.factoryId
  if (!allowed || !factoryAllowed) throw new Error('Недостаточно прав')
}

export async function POST(request: NextRequest) {
  try {
    const input = uploadSchema.parse(await request.json())
    const context = await requirePermission('department_requests', 'manage')
    const { extension } = validateDepartmentRequestFile({
      fileName: input.fileName,
      fileSize: input.size,
    })
    if (input.phase === 'resolution') await assertResolutionAccess(input.requestId, context)

    const prefix = departmentRequestUploadPrefix(input.requestId, context.userId, input.phase)
    const objectPath = `${prefix}${Date.now()}-${randomUUID()}${extension}`
    const { data, error } = await createAdminClient().storage
      .from('department-request-files')
      .createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')

    return NextResponse.json({
      data: {
        bucket: 'department-request-files',
        objectPath,
        token: data.token,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось подготовить загрузку' },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const input = cleanupSchema.parse(await request.json())
    const context = await requirePermission('department_requests', 'manage')
    const prefix = departmentRequestUploadPrefix(input.requestId, context.userId, input.phase)
    const objectPaths = input.objectPaths.filter((path) => path.startsWith(prefix) && !path.includes('..'))
    if (objectPaths.length !== input.objectPaths.length) throw new Error('Некорректный путь файла')

    const admin = createAdminClient()
    const { data: registered } = await admin
      .from('department_request_attachments')
      .select('storage_path')
      .in('storage_path', objectPaths)
    const registeredPaths = new Set(
      ((registered || []) as unknown as Array<{ storage_path: string }>).map((row) => row.storage_path),
    )
    const removable = objectPaths.filter((path) => !registeredPaths.has(path))
    if (removable.length > 0) {
      const { error } = await admin.storage.from('department-request-files').remove(removable)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось очистить загрузку' },
      { status: 400 },
    )
  }
}
