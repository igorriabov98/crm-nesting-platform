'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { requireProductAccess, requireProductManageAccess } from '@/lib/actions/products'
import { buildProductVersionFileInsert } from '@/lib/actions/product-version-file-helpers'
import { completeProductVersionCompletionTasksIfFilled } from '@/lib/actions/product-version-completion-tasks'
import {
  validateDirectProductUploads,
  validateProductUploadRequest,
  versionDocumentState,
  type DirectProductUpload,
} from '@/lib/products/product-file-upload'
import type { Database } from '@/lib/types/database'

type DbError = { message?: string; details?: string; hint?: string; code?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<LooseDbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type ProductVersion = Database['public']['Tables']['product_versions']['Row']
type ProductVersionInsert = Database['public']['Tables']['product_versions']['Insert']
type ProductVersionUpdate = Database['public']['Tables']['product_versions']['Update']
type ProductFile = Database['public']['Tables']['product_files']['Row']
type ProductFileInsert = Database['public']['Tables']['product_files']['Insert']
type ProductFileKind = ProductFileInsert['file_kind']
type ProductFasteningType = Database['public']['Enums']['product_fastening_type']
type ProductCompletionType = Database['public']['Enums']['product_completion_type']

export type ProductVersionWithFiles = ProductVersion & {
  product_files: ProductFile[]
}

export type CreateProductVersionInput = {
  drawingNumber: string
  changeSummary: string
  fasteningTypes?: ProductFasteningType[] | null
  completionType?: ProductCompletionType | null
  files: DirectProductUpload[]
}

export type CompleteCurrentVersionFilesInput = {
  drawingNumber: string
  files: DirectProductUpload[]
}

export type UpdateCurrentVersionCompletionInput = {
  fasteningTypes?: ProductFasteningType[] | null
  completionType?: ProductCompletionType | null
}

type ActionResult<T> = {
  success: boolean
  data: T | null
  error: string | null
}

const FASTENING_TYPES: ProductFasteningType[] = [
  'metal_plate',
  'wp_plate',
  'a4_plate',
  'white_sticker',
  'none_required',
]

const COMPLETION_TYPES: ProductCompletionType[] = ['mounting_set', 'chain_set']
const VERSION_DISPLAY_FILE_KINDS: ProductFileKind[] = ['drawing', 'step', 'pdf']
const VERSION_COMPLETION_FILE_KINDS: ProductFileKind[] = ['drawing', 'step', 'pdf']

function dbFrom(supabase: unknown): LooseDb {
  return supabase as LooseDb
}

function cleanRequiredString(value: unknown, message: string) {
  const text = String(value || '').trim()
  if (!text) throw new Error(message)
  return text
}

function normalizeFasteningTypes(value: ProductFasteningType[] | null | undefined) {
  if (!value) return [] as ProductFasteningType[]
  if (!Array.isArray(value)) throw new Error('Некорректный список креплений')
  const unique = Array.from(new Set(value))
  for (const item of unique) {
    if (!FASTENING_TYPES.includes(item)) throw new Error('Некорректный тип крепления')
  }
  return unique
}

function normalizeCompletionType(value: ProductCompletionType | null | undefined) {
  if (!value) return null
  if (!COMPLETION_TYPES.includes(value)) throw new Error('Некорректный тип комплектации')
  return value
}

async function requireProductVersionEngineeringAccess() {
  const context = await requireProductManageAccess()
  return {
    ...context,
    userId: context.user.id,
  }
}

async function loadCurrentVersion(db: LooseDb, productId: string) {
  const { data, error } = await db
    .from('product_versions')
    .select('*')
    .eq('product_id', productId)
    .eq('status', 'current')
    .single()

  if (error || !data) throw new Error(error?.message || 'Текущая версия товара не найдена')
  return data as ProductVersion
}

async function loadVersionFiles(db: LooseDb, versionIds: string[], fileKinds: ProductFileKind[] = VERSION_DISPLAY_FILE_KINDS) {
  if (versionIds.length === 0) return [] as ProductFile[]
  const { data, error } = await db
    .from('product_files')
    .select('*')
    .in('product_version_id', versionIds)
    .in('file_kind', fileKinds)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message || 'Не удалось загрузить файлы версий товара')
  return (data || []) as ProductFile[]
}

async function loadVersionWithFiles(db: LooseDb, versionId: string) {
  const { data, error } = await db
    .from('product_versions')
    .select('*')
    .eq('id', versionId)
    .single()

  if (error || !data) throw new Error(error?.message || 'Версия товара не найдена')
  const files = await loadVersionFiles(db, [versionId])
  const version = data as ProductVersion
  return {
    ...version,
    fastening_types: version.fastening_types || [],
    product_files: files,
  } satisfies ProductVersionWithFiles
}

async function loadMaxVersionNumber(db: LooseDb, productId: string) {
  const { data, error } = await db
    .from('product_versions')
    .select('version_number')
    .eq('product_id', productId)
    .order('version_number', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message || 'Не удалось определить номер версии')
  return ((data || []) as Array<{ version_number: number }>)[0]?.version_number || 0
}

async function verifiedVersionFileRows(
  adminSupabase: ReturnType<typeof createAdminClient>,
  productId: string,
  versionId: string,
  userId: string,
  uploads: DirectProductUpload[],
) {
  const normalizedUploads = validateDirectProductUploads(productId, uploads, { versionFilesOnly: true })
  return Promise.all(normalizedUploads.map(async (upload) => {
    const { data: info, error } = await adminSupabase.storage.from('product-files').info(upload.objectPath)
    if (error || !info) throw new Error(error?.message || `Файл ${upload.fileName} не найден в хранилище`)
    const actualSize = Number(info.size || 0)
    validateProductUploadRequest({
      fileKind: upload.fileKind,
      fileName: upload.fileName,
      fileSize: actualSize,
    })

    return buildProductVersionFileInsert({
      productId,
      productVersionId: versionId,
      fileKind: upload.fileKind as ProductFileKind,
      fileName: upload.fileName,
      filePath: upload.objectPath,
      mimeType: info.contentType || upload.mimeType,
      fileSize: actualSize,
      uploadedBy: userId,
    })
  }))
}

async function cleanupUploadedFiles(
  supabase: ReturnType<typeof createAdminClient> | null,
  paths: string[],
) {
  if (!supabase || paths.length === 0) return
  await supabase.storage.from('product-files').remove(paths).catch(() => undefined)
}

async function ignoreQueryError(query: LooseQuery) {
  try {
    await query
  } catch {
    // Best-effort cleanup should not hide the original action error.
  }
}

function revalidateProduct(productId: string) {
  revalidatePath(ROUTES.PRODUCTS)
  revalidatePath(`${ROUTES.PRODUCTS}/${productId}`)
  revalidatePath(ROUTES.SALES_PLAN_NEW)
}

export async function getProductVersions(productId: string): Promise<{ data: ProductVersionWithFiles[] | null; error: string | null }> {
  try {
    const { db } = await requireProductAccess()
    const { data, error } = await db
      .from('product_versions')
      .select('*')
      .eq('product_id', productId)
      .order('version_number', { ascending: false })

    if (error) throw error
    const versions = (data || []) as ProductVersion[]
    const files = await loadVersionFiles(db, versions.map((version) => version.id))
    const filesByVersion = new Map<string, ProductFile[]>()
    for (const file of files) {
      if (!file.product_version_id) continue
      filesByVersion.set(file.product_version_id, [...(filesByVersion.get(file.product_version_id) || []), file])
    }

    return {
      data: versions.map((version) => ({
        ...version,
        fastening_types: version.fastening_types || [],
        product_files: filesByVersion.get(version.id) || [],
      })),
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createProductVersion(
  productId: string,
  input: CreateProductVersionInput,
): Promise<ActionResult<ProductVersionWithFiles>> {
  let db: LooseDb | null = null
  let adminSupabase: ReturnType<typeof createAdminClient> | null = null
  let archivedVersionId: string | null = null
  let createdVersionId: string | null = null
  let uploadedPaths: string[] = []

  try {
    const { db: requestDb, userId } = await requireProductVersionEngineeringAccess()
    db = requestDb
    adminSupabase = createAdminClient()

    const drawingNumber = cleanRequiredString(input.drawingNumber, 'Укажите номер чертежа')
    const changeSummary = cleanRequiredString(input.changeSummary, 'Опишите изменения в версии')
    const normalizedUploads = validateDirectProductUploads(productId, input.files, { versionFilesOnly: true })
    uploadedPaths = normalizedUploads.map((upload) => upload.objectPath)

    const currentVersion = await loadCurrentVersion(db, productId)
    const currentFiles = await loadVersionFiles(db, [currentVersion.id])
    if (!versionDocumentState(currentFiles).complete) {
      throw new Error('Сначала добавьте недостающие файлы в текущую версию')
    }

    const nextVersionNumber = (await loadMaxVersionNumber(db, productId)) + 1
    const newVersionId = randomUUID()
    const fileRows = await verifiedVersionFileRows(adminSupabase, productId, newVersionId, userId, normalizedUploads)

    const { error: archiveError } = await db
      .from('product_versions')
      .update({ status: 'archived' } satisfies ProductVersionUpdate)
      .eq('id', currentVersion.id)
      .eq('status', 'current')
    if (archiveError) throw archiveError
    archivedVersionId = currentVersion.id

    const insertPayload: ProductVersionInsert = {
      id: newVersionId,
      product_id: productId,
      version_number: nextVersionNumber,
      status: 'current',
      drawing_number: drawingNumber,
      change_summary: changeSummary,
      fastening_types: normalizeFasteningTypes(input.fasteningTypes),
      completion_type: normalizeCompletionType(input.completionType),
      created_by: userId,
    }
    const { data: versionData, error: insertError } = await db
      .from('product_versions')
      .insert(insertPayload)
      .select('*')
      .single()
    if (insertError || !versionData) throw insertError || new Error('Не удалось создать версию товара')
    createdVersionId = newVersionId

    const { error: filesError } = await db.from('product_files').insert(fileRows)
    if (filesError) throw filesError

    const version = await loadVersionWithFiles(db, newVersionId)
    uploadedPaths = []
    revalidateProduct(productId)
    return { success: true, data: version, error: null }
  } catch (error) {
    if (db && createdVersionId) {
      await ignoreQueryError(db.from('product_versions').delete().eq('id', createdVersionId))
    }
    if (db && archivedVersionId) {
      await ignoreQueryError(
        db
          .from('product_versions')
          .update({ status: 'current' } satisfies ProductVersionUpdate)
          .eq('id', archivedVersionId)
      )
    }
    await cleanupUploadedFiles(adminSupabase, uploadedPaths)
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function completeCurrentVersionFiles(
  productId: string,
  input: CompleteCurrentVersionFilesInput,
): Promise<ActionResult<ProductVersionWithFiles>> {
  let db: LooseDb | null = null
  let adminSupabase: ReturnType<typeof createAdminClient> | null = null
  let currentVersion: ProductVersion | null = null
  let insertedFileIds: string[] = []
  let uploadedPaths: string[] = []

  try {
    const { db: requestDb, userId } = await requireProductVersionEngineeringAccess()
    db = requestDb
    adminSupabase = createAdminClient()

    const drawingNumber = cleanRequiredString(input.drawingNumber, 'Укажите номер чертежа')
    const normalizedUploads = validateDirectProductUploads(productId, input.files, { versionFilesOnly: true })
    uploadedPaths = normalizedUploads.map((upload) => upload.objectPath)

    currentVersion = await loadCurrentVersion(db, productId)
    const currentFiles = await loadVersionFiles(db, [currentVersion.id], VERSION_COMPLETION_FILE_KINDS)
    const currentState = versionDocumentState(currentFiles)
    for (const upload of normalizedUploads) {
      if (upload.fileKind === 'drawing' && currentState.hasDrawing) {
        throw new Error('PDF уже загружен в текущую версию')
      }
      if (upload.fileKind === 'step' && currentState.hasStep) {
        throw new Error('STEP уже загружен в текущую версию')
      }
    }

    const fileRows = await verifiedVersionFileRows(adminSupabase, productId, currentVersion.id, userId, normalizedUploads)
    insertedFileIds = fileRows.map((file) => String(file.id))

    const { error: filesError } = await db.from('product_files').insert(fileRows)
    if (filesError) throw filesError

    const { error: versionError } = await db
      .from('product_versions')
      .update({ drawing_number: drawingNumber } satisfies ProductVersionUpdate)
      .eq('id', currentVersion.id)
      .eq('status', 'current')
    if (versionError) throw versionError

    const version = await loadVersionWithFiles(db, currentVersion.id)
    uploadedPaths = []
    revalidateProduct(productId)
    return { success: true, data: version, error: null }
  } catch (error) {
    if (db && insertedFileIds.length > 0) {
      await ignoreQueryError(db.from('product_files').delete().in('id', insertedFileIds))
    }
    await cleanupUploadedFiles(adminSupabase, uploadedPaths)
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function updateCurrentVersionCompletion(
  productId: string,
  input: UpdateCurrentVersionCompletionInput,
): Promise<ActionResult<ProductVersionWithFiles>> {
  try {
    await requireProductManageAccess()
    const adminSupabase = createAdminClient()
    const db = dbFrom(adminSupabase)
    const currentVersion = await loadCurrentVersion(db, productId)
    const fasteningTypes = normalizeFasteningTypes(input.fasteningTypes)
    const completionType = normalizeCompletionType(input.completionType)

    const { error } = await db
      .from('product_versions')
      .update({
        fastening_types: fasteningTypes,
        completion_type: completionType,
      } satisfies ProductVersionUpdate)
      .eq('id', currentVersion.id)
      .eq('status', 'current')
    if (error) throw error

    const version = await loadVersionWithFiles(db, currentVersion.id)
    await completeProductVersionCompletionTasksIfFilled(db, version)
    revalidateProduct(productId)
    return { success: true, data: version, error: null }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function rollbackToVersion(
  productId: string,
  targetVersionId: string,
): Promise<ActionResult<ProductVersionWithFiles>> {
  let db: LooseDb | null = null
  let archivedCurrentVersionId: string | null = null

  try {
    const { db: requestDb } = await requireProductVersionEngineeringAccess()
    db = requestDb

    const { data: targetData, error: targetError } = await db
      .from('product_versions')
      .select('*')
      .eq('id', targetVersionId)
      .eq('product_id', productId)
      .single()
    if (targetError || !targetData) throw targetError || new Error('Целевая версия не найдена')
    const targetVersion = targetData as ProductVersion
    if (targetVersion.status === 'current') {
      throw new Error('Эта версия уже является текущей')
    }
    if (targetVersion.status !== 'archived') {
      throw new Error('Откат возможен только на архивную версию')
    }

    const targetFiles = await loadVersionFiles(db, [targetVersion.id])
    const currentVersion = await loadCurrentVersion(db, productId)

    const { error: archiveError } = await db
      .from('product_versions')
      .update({ status: 'archived' } satisfies ProductVersionUpdate)
      .eq('id', currentVersion.id)
      .eq('status', 'current')
    if (archiveError) throw archiveError
    archivedCurrentVersionId = currentVersion.id

    const { error: promoteError } = await db
      .from('product_versions')
      .update({ status: 'current' } satisfies ProductVersionUpdate)
      .eq('id', targetVersion.id)
      .eq('status', 'archived')
    if (promoteError) throw promoteError

    revalidateProduct(productId)
    return {
      success: true,
      data: {
        ...targetVersion,
        status: 'current',
        product_files: targetFiles,
      },
      error: null,
    }
  } catch (error) {
    if (db && archivedCurrentVersionId) {
      await ignoreQueryError(
        db
          .from('product_versions')
          .update({ status: 'current' } satisfies ProductVersionUpdate)
          .eq('id', archivedCurrentVersionId)
      )
    }
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}
