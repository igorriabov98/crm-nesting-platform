'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireProductAccess, requireProductManageAccess } from '@/lib/actions/products'
import { reconcileProductVersionCompletionTasksForClient } from '@/lib/actions/product-version-completion-tasks'
import { removeFileObject } from '@/lib/file-archive/resolver'
import {
  isProductClientFasteningComplete,
  normalizeClientFasteningTypes,
  validateClientFasteningFile,
  validateDirectClientFasteningUploads,
  type ClientFasteningFileType,
  type ClientFasteningType,
  type DirectClientFasteningUpload,
  type ProductFasteningType,
} from '@/lib/products/product-client-fastening'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { Database } from '@/lib/types/database'

type ProductVersion = Database['public']['Tables']['product_versions']['Row']
type ClientFasteningSetting = Database['public']['Tables']['product_version_client_fastening_settings']['Row']
type ClientFasteningFile = Database['public']['Tables']['product_version_client_fastening_files']['Row']
// Supabase's generated schema generic does not infer newly hand-added tables
// in this mixed generated/manual Database type. Results are narrowed below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export type ProductClientOption = {
  id: string
  name: string
}

export type ProductClientFasteningFileDto = {
  id: string
  fasteningType: ClientFasteningFileType
  fileName: string
  fileSize: number
  createdAt: string
}

export type ProductClientFasteningSettingDto = {
  id: string
  productVersionId: string
  clientId: string
  fasteningTypes: ClientFasteningType[]
  files: ProductClientFasteningFileDto[]
  complete: boolean
  updatedAt: string
}

export type ProductClientFasteningData = {
  clients: ProductClientOption[]
  settingsByVersion: Record<string, ProductClientFasteningSettingDto[]>
}

type ActionResult<T = null> = {
  success: boolean
  data: T | null
  error: string | null
  warning?: string | null
}

const uuid = z.string().uuid('Некорректный идентификатор')
const fasteningType = z.enum(['metal_plate', 'a4_plate', 'white_sticker', 'none_required'])
const fileFasteningType = z.enum(['metal_plate', 'a4_plate'])
const directUploadSchema = z.object({
  objectPath: z.string().min(1),
  fasteningType: fileFasteningType,
  fileName: z.string().min(1).max(240),
  mimeType: z.string().max(160).nullable(),
  fileSize: z.number().int().positive(),
})
const saveSchema = z.object({
  productId: uuid,
  productVersionId: uuid,
  clientId: uuid,
  fasteningTypes: z.array(fasteningType).max(4),
  uploads: z.array(directUploadSchema).max(2),
})

function revalidateProduct(productId: string) {
  revalidatePath(`${ROUTES.PRODUCTS}/${productId}`)
  revalidatePath(ROUTES.PRODUCTS)
}

async function requireCurrentOwnedVersion(
  productId: string,
  productVersionId: string,
) {
  const admin = createAdminClient() as AdminClient
  const { data, error } = await admin
    .from('product_versions')
    .select('*')
    .eq('id', productVersionId)
    .eq('product_id', productId)
    .eq('status', 'current')
    .single()
  if (error || !data) throw new Error('Текущая версия изделия не найдена')
  return { admin, version: data as ProductVersion }
}

async function requireClient(admin: AdminClient, clientId: string) {
  const { data, error } = await admin.from('clients').select('id').eq('id', clientId).single()
  if (error || !data) throw new Error('Клиент не найден')
}

async function loadProductName(admin: AdminClient, productId: string) {
  const { data, error } = await admin.from('products').select('name_uk').eq('id', productId).single()
  if (error || !data) throw new Error('Изделие не найдено')
  return data.name_uk
}

export async function getProductClientFasteningData(
  productId: string,
): Promise<ActionResult<ProductClientFasteningData>> {
  try {
    await requireProductAccess()
    const admin = createAdminClient() as AdminClient
    const [{ data: clients, error: clientsError }, { data: versions, error: versionsError }] = await Promise.all([
      admin.from('clients').select('id, name').order('name', { ascending: true }),
      admin.from('product_versions').select('id, completion_type').eq('product_id', productId),
    ])
    if (clientsError) throw clientsError
    if (versionsError) throw versionsError

    const productVersions = (versions || []) as Array<Pick<ProductVersion, 'id' | 'completion_type'>>
    const versionIds = productVersions.map((version) => version.id)
    const completionByVersion = new Map(productVersions.map((version) => [version.id, version.completion_type]))
    let settings: ClientFasteningSetting[] = []
    if (versionIds.length > 0) {
      const { data, error } = await admin
        .from('product_version_client_fastening_settings')
        .select('*')
        .in('product_version_id', versionIds)
        .order('updated_at', { ascending: false })
      if (error) throw error
      settings = (data || []) as ClientFasteningSetting[]
    }

    const settingIds = settings.map((setting) => setting.id)
    let files: ClientFasteningFile[] = []
    if (settingIds.length > 0) {
      const { data, error } = await admin
        .from('product_version_client_fastening_files')
        .select('*')
        .in('setting_id', settingIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      files = (data || []) as ClientFasteningFile[]
    }

    const filesBySetting = new Map<string, ClientFasteningFile[]>()
    for (const file of files) {
      filesBySetting.set(file.setting_id, [...(filesBySetting.get(file.setting_id) || []), file])
    }
    const settingsByVersion: Record<string, ProductClientFasteningSettingDto[]> = {}
    for (const setting of settings) {
      const settingFiles = filesBySetting.get(setting.id) || []
      const dto: ProductClientFasteningSettingDto = {
        id: setting.id,
        productVersionId: setting.product_version_id,
        clientId: setting.client_id,
        fasteningTypes: normalizeClientFasteningTypes(setting.fastening_types),
        files: settingFiles.map((file) => ({
          id: file.id,
          fasteningType: file.fastening_type as ClientFasteningFileType,
          fileName: file.file_name,
          fileSize: Number(file.file_size),
          createdAt: file.created_at,
        })),
        complete: isProductClientFasteningComplete({
          completionType: completionByVersion.get(setting.product_version_id),
          fasteningTypes: setting.fastening_types,
          fileTypes: settingFiles.map((file) => file.fastening_type),
        }),
        updatedAt: setting.updated_at,
      }
      settingsByVersion[setting.product_version_id] = [
        ...(settingsByVersion[setting.product_version_id] || []),
        dto,
      ]
    }

    return {
      success: true,
      data: {
        clients: (clients || []) as ProductClientOption[],
        settingsByVersion,
      },
      error: null,
    }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function saveProductClientFastening(
  rawInput: unknown,
): Promise<ActionResult<ProductClientFasteningSettingDto>> {
  const uploadedPaths: string[] = []
  const removedFileIds: string[] = []
  try {
    const input = saveSchema.parse(rawInput)
    const { user } = await requireProductManageAccess()
    const normalizedTypes = normalizeClientFasteningTypes(input.fasteningTypes as ProductFasteningType[])
    const normalizedUploads = validateDirectClientFasteningUploads(
      input.productId,
      input.productVersionId,
      input.clientId,
      normalizedTypes,
      input.uploads as DirectClientFasteningUpload[],
    )
    uploadedPaths.push(...normalizedUploads.map((upload) => upload.objectPath))

    const { admin, version } = await requireCurrentOwnedVersion(input.productId, input.productVersionId)
    await requireClient(admin, input.clientId)
    const productName = await loadProductName(admin, input.productId)
    const verifiedUploads = await Promise.all(normalizedUploads.map(async (upload) => {
      const { data: info, error } = await admin.storage.from('product-files').info(upload.objectPath)
      if (error || !info) throw new Error(error?.message || `Файл ${upload.fileName} не найден в хранилище`)
      const actualSize = Number(info.size || 0)
      validateClientFasteningFile({
        fasteningType: upload.fasteningType,
        fileName: upload.fileName,
        fileSize: actualSize,
      })
      return {
        ...upload,
        fileSize: actualSize,
        mimeType: info.contentType || upload.mimeType,
      }
    }))

    const { data: existingSetting, error: existingSettingError } = await admin
      .from('product_version_client_fastening_settings')
      .select('*')
      .eq('product_version_id', input.productVersionId)
      .eq('client_id', input.clientId)
      .maybeSingle()
    if (existingSettingError) throw existingSettingError

    let oldFiles: ClientFasteningFile[] = []
    if (existingSetting) {
      const { data: existingFiles, error: existingFilesError } = await admin
        .from('product_version_client_fastening_files')
        .select('*')
        .eq('setting_id', existingSetting.id)
      if (existingFilesError) throw existingFilesError
      oldFiles = (existingFiles || []) as ClientFasteningFile[]
    }

    const selectedSet = new Set(normalizedTypes)
    const replacementSet = new Set(verifiedUploads.map((upload) => upload.fasteningType))
    const obsoleteFiles = oldFiles.filter(
      (file) => !selectedSet.has(file.fastening_type as ClientFasteningType) || replacementSet.has(file.fastening_type as ClientFasteningFileType),
    )

    // Remove metadata first so a storage/archive failure can never leave an
    // active database row pointing at an object that is already unavailable.
    if (obsoleteFiles.length > 0) {
      const { error } = await admin
        .from('product_version_client_fastening_files')
        .delete()
        .in('id', obsoleteFiles.map((file) => file.id))
      if (error) throw error
      removedFileIds.push(...obsoleteFiles.map((file) => file.id))
      await reconcileProductVersionCompletionTasksForClient(admin, {
        productVersion: version,
        productName,
        clientId: input.clientId,
      })
    }
    for (const file of obsoleteFiles) {
      await removeFileObject('product-files', file.file_path)
    }

    const { data: setting, error: settingError } = await admin
      .from('product_version_client_fastening_settings')
      .upsert({
        product_version_id: input.productVersionId,
        client_id: input.clientId,
        fastening_types: normalizedTypes,
        created_by: existingSetting?.created_by || user.id,
        updated_by: user.id,
      }, { onConflict: 'product_version_id,client_id' })
      .select('*')
      .single()
    if (settingError || !setting) throw settingError || new Error('Не удалось сохранить крепление клиента')

    for (const upload of verifiedUploads) {
      const { error } = await admin
        .from('product_version_client_fastening_files')
        .upsert({
          setting_id: setting.id,
          fastening_type: upload.fasteningType,
          file_name: upload.fileName,
          file_path: upload.objectPath,
          mime_type: upload.mimeType,
          file_size: upload.fileSize,
          uploaded_by: user.id,
          created_at: new Date().toISOString(),
        }, { onConflict: 'setting_id,fastening_type' })
      if (error) throw error
    }

    const { data: finalFilesData, error: finalFilesError } = await admin
      .from('product_version_client_fastening_files')
      .select('*')
      .eq('setting_id', setting.id)
    if (finalFilesError) throw finalFilesError
    const finalFiles = (finalFilesData || []) as ClientFasteningFile[]
    await reconcileProductVersionCompletionTasksForClient(admin, {
      productVersion: version,
      productName,
      clientId: input.clientId,
    })
    revalidateProduct(input.productId)

    return {
      success: true,
      data: {
        id: setting.id,
        productVersionId: setting.product_version_id,
        clientId: setting.client_id,
        fasteningTypes: normalizeClientFasteningTypes(setting.fastening_types),
        files: finalFiles.map((file) => ({
          id: file.id,
          fasteningType: file.fastening_type as ClientFasteningFileType,
          fileName: file.file_name,
          fileSize: Number(file.file_size),
          createdAt: file.created_at,
        })),
        complete: isProductClientFasteningComplete({
          completionType: version.completion_type,
          fasteningTypes: setting.fastening_types,
          fileTypes: finalFiles.map((file) => file.fastening_type),
        }),
        updatedAt: setting.updated_at,
      },
      error: null,
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      const admin = createAdminClient() as AdminClient
      await Promise.resolve(admin
        .from('product_version_client_fastening_files')
        .delete()
        .in('file_path', uploadedPaths))
        .catch(() => undefined)
      await admin.storage.from('product-files').remove(uploadedPaths).catch(() => undefined)
    }
    if (removedFileIds.length > 0) {
      // Never leave metadata pointing at an object that was already removed.
      await Promise.resolve((createAdminClient() as AdminClient)
        .from('product_version_client_fastening_files')
        .delete()
        .in('id', removedFileIds))
        .catch(() => undefined)
    }
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}

export async function deleteProductClientFasteningFile(input: {
  productId: string
  productVersionId: string
  clientId: string
  fileId: string
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      productId: uuid,
      productVersionId: uuid,
      clientId: uuid,
      fileId: uuid,
    }).parse(input)
    await requireProductManageAccess()
    const { admin, version } = await requireCurrentOwnedVersion(parsed.productId, parsed.productVersionId)
    const { data: setting, error: settingError } = await admin
      .from('product_version_client_fastening_settings')
      .select('id')
      .eq('product_version_id', parsed.productVersionId)
      .eq('client_id', parsed.clientId)
      .single()
    if (settingError || !setting) throw new Error('Настройка клиента не найдена')
    const { data: file, error: fileError } = await admin
      .from('product_version_client_fastening_files')
      .select('id, file_path')
      .eq('id', parsed.fileId)
      .eq('setting_id', setting.id)
      .single()
    if (fileError || !file) throw new Error('Файл таблички не найден')

    const { error: deleteError } = await admin
      .from('product_version_client_fastening_files')
      .delete()
      .eq('id', file.id)
      .eq('setting_id', setting.id)
    if (deleteError) throw deleteError
    await reconcileProductVersionCompletionTasksForClient(admin, {
      productVersion: version,
      productName: await loadProductName(admin, parsed.productId),
      clientId: parsed.clientId,
    })
    await removeFileObject('product-files', file.file_path)
    revalidateProduct(parsed.productId)
    return { success: true, data: null, error: null }
  } catch (error) {
    return { success: false, data: null, error: getErrorMessage(error) }
  }
}
