import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import {
  productProjectUploadPrefix,
  validateProductProjectFile,
} from '@/lib/products/product-project-file-upload'
import { getErrorMessage } from '@/lib/utils/get-error-message'

export const dynamic = 'force-dynamic'

const uploadSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  fileName: z.string().min(1).max(240),
  contentType: z.string().max(160).optional(),
  size: z.number().int().positive(),
})

const cleanupSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  objectPaths: z.array(z.string().min(1)).min(1).max(10),
})

async function requireProject(projectId: string) {
  const context = await requirePermission('product_projects', 'manage')
  const { data, error } = await context.supabase
    .from('product_projects')
    .select('id, status')
    .eq('id', projectId)
    .maybeSingle()
  if (error || !data) throw new Error('Проект не найден')
  const project = data as unknown as { id: string; status: string }
  if (project.status === 'added_to_products' || project.status === 'cancelled') {
    throw new Error('Для закрытого проекта нельзя добавлять файлы корректировки')
  }
  return context
}

export async function POST(request: NextRequest) {
  try {
    const input = uploadSchema.parse(await request.json())
    const context = await requireProject(input.projectId)
    const { extension } = validateProductProjectFile({
      fileName: input.fileName,
      fileSize: input.size,
    })
    const prefix = productProjectUploadPrefix(input.projectId, input.versionId, context.userId)
    const objectPath = `${prefix}${Date.now()}-${randomUUID()}${extension}`
    const { data, error } = await createAdminClient().storage
      .from('product-files')
      .createSignedUploadUrl(objectPath)
    if (error || !data) throw new Error(error?.message || 'Не удалось создать ссылку загрузки')

    return NextResponse.json({
      data: { bucket: 'product-files', objectPath, token: data.token },
    })
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Не удалось подготовить загрузку' },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const input = cleanupSchema.parse(await request.json())
    const context = await requireProject(input.projectId)
    const prefix = productProjectUploadPrefix(input.projectId, input.versionId, context.userId)
    if (input.objectPaths.some((path) => !path.startsWith(prefix) || path.includes('..'))) {
      throw new Error('Некорректный путь файла')
    }

    const admin = createAdminClient()
    const { data: registered } = await admin
      .from('product_project_files')
      .select('file_path')
      .in('file_path', input.objectPaths)
    const registeredPaths = new Set(
      ((registered || []) as unknown as Array<{ file_path: string }>).map((row) => row.file_path),
    )
    const removable = input.objectPaths.filter((path) => !registeredPaths.has(path))
    if (removable.length > 0) {
      const { error } = await admin.storage.from('product-files').remove(removable)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Не удалось очистить загрузку' },
      { status: 400 },
    )
  }
}
