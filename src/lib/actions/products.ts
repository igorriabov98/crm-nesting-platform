"use server"

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getCurrentUserContext } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { ResourceKey } from '@/lib/permissions/resources'
import {
  productFileKindSchema,
  productProjectSchema,
  productProjectVersionSchema,
  productSchema,
  promoteProductVersionSchema,
  type ProductInput,
  type ProductProjectInput,
  type ProductProjectVersionInput,
  type PromoteProductVersionInput,
} from '@/lib/types/schemas'
import type {
  Client,
  Product,
  ProductFile,
  ProductProject,
  ProductProjectFile,
  ProductProjectVersion,
  UserSummary,
} from '@/lib/types'
import type { Database } from '@/lib/types/database'

type DbError = { message?: string; details?: string; hint?: string; code?: string }
type LooseDbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<LooseDbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<LooseDbResult>
  maybeSingle: () => Promise<LooseDbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }
type ProductInsert = Database['public']['Tables']['products']['Insert']
type ProductUpdate = Database['public']['Tables']['products']['Update']
type ProductFileInsert = Database['public']['Tables']['product_files']['Insert']
type ProductProjectInsert = Database['public']['Tables']['product_projects']['Insert']
type ProductProjectUpdate = Database['public']['Tables']['product_projects']['Update']
type ProductProjectVersionInsert = Database['public']['Tables']['product_project_versions']['Insert']
type ProductProjectVersionUpdate = Database['public']['Tables']['product_project_versions']['Update']
type ProductProjectFileInsert = Database['public']['Tables']['product_project_files']['Insert']

export type ProductOption = Pick<Product,
  | 'id'
  | 'name_uk'
  | 'name_en'
  | 'uktzed'
  | 'drawing_number'
  | 'characteristics'
  | 'unit_weight_kg'
  | 'base_price_eur'
  | 'status'
>

export type ProductWithFiles = Product & {
  product_files?: ProductFile[] | null
}

export type ProductProjectListItem = ProductProject & {
  client?: Pick<Client, 'id' | 'name'> | null
  assigned_engineer?: Pick<UserSummary, 'id' | 'full_name'> | null
  versions?: Pick<ProductProjectVersion, 'id' | 'status'>[] | null
  product_project_files?: Pick<ProductProjectFile, 'id'>[] | null
}

export type ProductProjectDetails = ProductProject & {
  client?: Pick<Client, 'id' | 'name'> | null
  assigned_engineer?: Pick<UserSummary, 'id' | 'full_name'> | null
  versions: ProductProjectVersion[]
  files: ProductProjectFile[]
}

function dbFrom(supabase: unknown): LooseDb {
  return supabase as LooseDb
}

async function requireProductAccess(resourceKey: Extract<ResourceKey, 'products' | 'product_projects'> = 'products') {
  const { supabase, user } = await requirePermission(resourceKey, 'view')
  return { supabase, db: dbFrom(supabase), user }
}

async function requireProductManageAccess(resourceKey: Extract<ResourceKey, 'products' | 'product_projects'> = 'products') {
  const { supabase, user } = await requirePermission(resourceKey, 'manage')
  return { supabase, db: dbFrom(supabase), user }
}

function cleanNullableId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function storageFileExtension(name: string) {
  const match = name.match(/\.([A-Za-z0-9]{1,12})$/)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function isImageFile(file: File) {
  const name = file.name.toLowerCase()
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name)
}

async function uploadStorageFile(
  supabase: Awaited<ReturnType<typeof getCurrentUserContext>>['supabase'],
  prefix: string,
  file: File
) {
  if (!file || file.size === 0) throw new Error('Выберите файл')
  const filePath = `${prefix}/${Date.now()}-${randomUUID()}${storageFileExtension(file.name)}`
  const { error } = await supabase.storage.from('product-files').upload(filePath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return filePath
}

function formDataString(formData: FormData, key: string) {
  return String(formData.get(key) || '')
}

function optionalFormFile(formData: FormData, key: string) {
  const value = formData.get(key)
  return value instanceof File && value.size > 0 ? value : null
}

function validateFileExtension(file: File, allowedExtensions: string[], label: string) {
  const name = file.name.toLowerCase()
  if (!allowedExtensions.some((extension) => name.endsWith(extension))) {
    throw new Error(`${label}: допустимые форматы ${allowedExtensions.join(', ')}`)
  }
}

function productPayload(parsed: ProductInput, userId: string): ProductInsert {
  return {
    name_uk: parsed.name_uk.trim(),
    name_en: parsed.name_en.trim(),
    uktzed: parsed.uktzed.trim(),
    drawing_number: parsed.drawing_number.trim(),
    characteristics: parsed.characteristics?.trim() || '',
    unit_weight_kg: parsed.unit_weight_kg,
    base_price_eur: parsed.base_price_eur,
    status: parsed.status,
    created_by: userId,
    updated_by: userId,
  }
}

async function insertProductProjectWithInitialVersion(
  db: LooseDb,
  userId: string,
  input: ProductProjectInput,
) {
  const parsed = productProjectSchema.parse(input)
  const payload: ProductProjectInsert = {
    title: parsed.title.trim(),
    client_id: cleanNullableId(parsed.client_id),
    description: parsed.description?.trim() || '',
    characteristics: parsed.characteristics?.trim() || '',
    client_wishes: parsed.client_wishes?.trim() || '',
    assigned_engineer_id: parsed.assigned_engineer_id,
    status: parsed.status,
    created_by: userId,
    updated_by: userId,
  }
  const { data, error } = await db.from('product_projects').insert(payload).select('*').single()
  if (error) throw error
  const project = data as ProductProject
  const versionPayload: ProductProjectVersionInsert = {
    project_id: project.id,
    version_number: 1,
    version_label: '1',
    description: payload.description,
    characteristics: payload.characteristics,
    client_wishes: payload.client_wishes,
    status: 'draft',
    created_by: userId,
  }
  const { error: versionError } = await db.from('product_project_versions').insert(versionPayload)
  if (versionError) throw versionError
  return project
}

export async function getProductOptions() {
  try {
    const { db } = await requireProductAccess()
    const { data, error } = await db
      .from('products')
      .select('id, name_uk, name_en, uktzed, drawing_number, characteristics, unit_weight_kg, base_price_eur, status')
      .eq('status', 'active')
      .order('name_uk', { ascending: true })

    if (error) throw error
    return { data: (data || []) as ProductOption[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getProducts() {
  try {
    const { db } = await requireProductAccess()
    const { data, error } = await db
      .from('products')
      .select('*, product_files(*)')
      .order('updated_at', { ascending: false })

    if (error) throw error
    return { data: (data || []) as ProductWithFiles[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getProduct(id: string) {
  try {
    const { db } = await requireProductAccess()
    const { data, error } = await db
      .from('products')
      .select('*, product_files(*)')
      .eq('id', id)
      .single()

    if (error) throw error
    return { data: data as ProductWithFiles, error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createProduct(input: ProductInput) {
  try {
    const { db, user } = await requireProductManageAccess()
    const parsed = productSchema.parse(input)
    const { data, error } = await db
      .from('products')
      .insert(productPayload(parsed, user.id))
      .select('*')
      .single()

    if (error) throw error
    revalidatePath(ROUTES.PRODUCTS)
    revalidatePath(ROUTES.SALES_PLAN_NEW)
    return { success: true, product: data as Product, error: null }
  } catch (error) {
    return { success: false, product: null, error: getErrorMessage(error) }
  }
}

export async function createProductWithFiles(formData: FormData) {
  let cleanupContext: { supabase: Awaited<ReturnType<typeof getCurrentUserContext>>['supabase']; db: LooseDb } | null = null
  let createdProductId: string | null = null
  const uploadedPaths: string[] = []

  try {
    const context = await requireProductManageAccess()
    const adminSupabase = createAdminClient()
    const db = dbFrom(adminSupabase)
    cleanupContext = { supabase: adminSupabase, db }
    const { user } = context
    const parsed = productSchema.parse({
      name_uk: formDataString(formData, 'name_uk'),
      name_en: formDataString(formData, 'name_en'),
      uktzed: formDataString(formData, 'uktzed'),
      drawing_number: formDataString(formData, 'drawing_number'),
      characteristics: formDataString(formData, 'characteristics'),
      unit_weight_kg: formDataString(formData, 'unit_weight_kg'),
      base_price_eur: formDataString(formData, 'base_price_eur') || 0,
      status: formDataString(formData, 'status') || 'draft',
    })
    const stepFile = optionalFormFile(formData, 'step_file')
    const pdfFile = optionalFormFile(formData, 'pdf_file')
    if (stepFile) validateFileExtension(stepFile, ['.step', '.stp'], 'STEP файл')
    if (pdfFile) validateFileExtension(pdfFile, ['.pdf'], 'PDF файл')

    const productId = randomUUID()
    const files: ProductFileInsert[] = []

    if (stepFile) {
      const filePath = await uploadStorageFile(adminSupabase, `products/${productId}`, stepFile)
      uploadedPaths.push(filePath)
      files.push({
        product_id: productId,
        file_kind: 'step',
        file_name: stepFile.name,
        file_path: filePath,
        mime_type: stepFile.type || null,
        file_size: stepFile.size,
        uploaded_by: user.id,
      })
    }

    if (pdfFile) {
      const filePath = await uploadStorageFile(adminSupabase, `products/${productId}`, pdfFile)
      uploadedPaths.push(filePath)
      files.push({
        product_id: productId,
        file_kind: 'pdf',
        file_name: pdfFile.name,
        file_path: filePath,
        mime_type: pdfFile.type || null,
        file_size: pdfFile.size,
        uploaded_by: user.id,
      })
    }

    const { data, error } = await db
      .from('products')
      .insert({ id: productId, ...productPayload(parsed, user.id) })
      .select('*')
      .single()

    if (error) throw error
    const product = data as Product
    createdProductId = product.id

    if (files.length > 0) {
      const { error: filesError } = await db.from('product_files').insert(files)
      if (filesError) throw filesError
    }

    revalidatePath(ROUTES.PRODUCTS)
    revalidatePath(`${ROUTES.PRODUCTS}/${product.id}`)
    revalidatePath(ROUTES.SALES_PLAN_NEW)
    return { success: true, product, error: null }
  } catch (error) {
    if (cleanupContext && uploadedPaths.length > 0) {
      await cleanupContext.supabase.storage.from('product-files').remove(uploadedPaths).catch(() => undefined)
    }

    if (cleanupContext && createdProductId) {
      try {
        await cleanupContext.db.from('products').delete().eq('id', createdProductId)
      } catch {
        // Return the original create/upload error; rollback is best effort.
      }
    }

    return { success: false, product: null, error: getErrorMessage(error) }
  }
}

export async function updateProduct(id: string, input: ProductInput) {
  try {
    const { db, user } = await requireProductManageAccess()
    const parsed = productSchema.parse(input)
    const payload: ProductUpdate = {
      name_uk: parsed.name_uk.trim(),
      name_en: parsed.name_en.trim(),
      uktzed: parsed.uktzed.trim(),
      drawing_number: parsed.drawing_number.trim(),
      characteristics: parsed.characteristics?.trim() || '',
      unit_weight_kg: parsed.unit_weight_kg,
      base_price_eur: parsed.base_price_eur,
      status: parsed.status,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('products').update(payload).eq('id', id)
    if (error) throw error

    revalidatePath(ROUTES.PRODUCTS)
    revalidatePath(`${ROUTES.PRODUCTS}/${id}`)
    revalidatePath(ROUTES.SALES_PLAN_NEW)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function uploadProductFile(formData: FormData) {
  try {
    const { supabase, db, user } = await requireProductManageAccess()
    const productId = String(formData.get('product_id') || '')
    const fileKind = productFileKindSchema.parse(String(formData.get('file_kind') || 'other'))
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Выберите файл')

    const filePath = await uploadStorageFile(supabase, `products/${productId}`, file)
    const payload: ProductFileInsert = {
      product_id: productId,
      file_kind: fileKind,
      file_name: file.name,
      file_path: filePath,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: user.id,
    }
    const { error } = await db.from('product_files').insert(payload)
    if (error) throw error

    revalidatePath(`${ROUTES.PRODUCTS}/${productId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteProductFile(fileId: string, productId: string) {
  try {
    const { supabase, db } = await requireProductManageAccess()
    const { data, error } = await db.from('product_files').select('file_path').eq('id', fileId).eq('product_id', productId).single()
    if (error) throw error
    const row = data as Pick<ProductFile, 'file_path'>
    await supabase.storage.from('product-files').remove([row.file_path])
    const { error: deleteError } = await db.from('product_files').delete().eq('id', fileId).eq('product_id', productId)
    if (deleteError) throw deleteError
    revalidatePath(`${ROUTES.PRODUCTS}/${productId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getEngineerOptions() {
  try {
    const { db } = await requireProductAccess('product_projects')
    const { data, error } = await db
      .from('users')
      .select('id, full_name, role, factory_id')
      .eq('role', 'engineer')
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (error) throw error
    return { data: (data || []) as UserSummary[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getProductProjects() {
  try {
    const { db } = await requireProductAccess('product_projects')
    const { data, error } = await db
      .from('product_projects')
      .select(`
        *,
        client:clients(id, name),
        assigned_engineer:users!product_projects_assigned_engineer_id_fkey(id, full_name),
        versions:product_project_versions!product_project_versions_project_id_fkey(id, status),
        product_project_files(id)
      `)
      .order('updated_at', { ascending: false })

    if (error) throw error
    return { data: (data || []) as ProductProjectListItem[], error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getProductProject(id: string) {
  try {
    const { db } = await requireProductAccess('product_projects')
    const { data: projectData, error: projectError } = await db
      .from('product_projects')
      .select('*, client:clients(id, name), assigned_engineer:users!product_projects_assigned_engineer_id_fkey(id, full_name)')
      .eq('id', id)
      .single()
    if (projectError) throw projectError

    const [{ data: versionsData, error: versionsError }, { data: filesData, error: filesError }] = await Promise.all([
      db.from('product_project_versions').select('*').eq('project_id', id).order('version_number', { ascending: true }),
      db.from('product_project_files').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    ])
    if (versionsError) throw versionsError
    if (filesError) throw filesError

    return {
      data: {
        ...(projectData as ProductProjectDetails),
        versions: (versionsData || []) as ProductProjectVersion[],
        files: (filesData || []) as ProductProjectFile[],
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createProductProject(input: ProductProjectInput) {
  try {
    const { db, user } = await requireProductManageAccess('product_projects')
    const project = await insertProductProjectWithInitialVersion(db, user.id, input)

    revalidatePath(ROUTES.PRODUCT_PROJECTS)
    return { success: true, project, error: null }
  } catch (error) {
    return { success: false, project: null, error: getErrorMessage(error) }
  }
}

export async function createProductProjectWithPhoto(formData: FormData) {
  let createdProjectId: string | null = null
  let uploadedPath: string | null = null

  try {
    const { supabase, db, user } = await requireProductManageAccess('product_projects')
    const input: ProductProjectInput = {
      title: String(formData.get('title') || ''),
      client_id: cleanNullableId(formData.get('client_id')),
      description: String(formData.get('description') || ''),
      characteristics: String(formData.get('characteristics') || ''),
      client_wishes: String(formData.get('client_wishes') || ''),
      assigned_engineer_id: String(formData.get('assigned_engineer_id') || ''),
      status: String(formData.get('status') || 'draft') as ProductProjectInput['status'],
    }
    const photo = formData.get('photo')
    const project = await insertProductProjectWithInitialVersion(db, user.id, input)
    createdProjectId = project.id

    if (photo instanceof File && photo.size > 0) {
      if (!isImageFile(photo)) throw new Error('Загрузите фото в формате изображения')
      uploadedPath = await uploadStorageFile(supabase, `product-projects/${project.id}`, photo)
      const payload: ProductProjectFileInsert = {
        project_id: project.id,
        version_id: null,
        file_kind: 'photo',
        file_name: photo.name,
        file_path: uploadedPath,
        mime_type: photo.type || null,
        file_size: photo.size,
        uploaded_by: user.id,
      }
      const { error } = await db.from('product_project_files').insert(payload)
      if (error) throw error
    }

    revalidatePath(ROUTES.PRODUCT_PROJECTS)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${project.id}`)
    return { success: true, project, error: null }
  } catch (error) {
    const { supabase, db } = await requireProductAccess('product_projects').catch(() => ({ supabase: null, db: null }))
    if (uploadedPath && supabase) {
      await supabase.storage.from('product-files').remove([uploadedPath]).catch(() => undefined)
    }
    if (createdProjectId && db) {
      try {
        await db.from('product_projects').delete().eq('id', createdProjectId)
      } catch {
        // Best-effort rollback; return the original upload/create error to the user.
      }
    }
    return { success: false, project: null, error: getErrorMessage(error) }
  }
}

export async function updateProductProject(id: string, input: ProductProjectInput) {
  try {
    const { db, user } = await requireProductManageAccess('product_projects')
    const parsed = productProjectSchema.parse(input)
    const payload: ProductProjectUpdate = {
      title: parsed.title.trim(),
      client_id: cleanNullableId(parsed.client_id),
      description: parsed.description?.trim() || '',
      characteristics: parsed.characteristics?.trim() || '',
      client_wishes: parsed.client_wishes?.trim() || '',
      assigned_engineer_id: parsed.assigned_engineer_id,
      status: parsed.status,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('product_projects').update(payload).eq('id', id)
    if (error) throw error
    revalidatePath(ROUTES.PRODUCT_PROJECTS)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${id}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createProductProjectVersion(projectId: string, input: ProductProjectVersionInput) {
  try {
    const { db, user } = await requireProductManageAccess('product_projects')
    const parsed = productProjectVersionSchema.parse(input)
    const { data: versionsData, error: versionsError } = await db
      .from('product_project_versions')
      .select('version_number')
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .limit(1)
    if (versionsError) throw versionsError
    const latest = ((versionsData || []) as Array<{ version_number: number }>)[0]?.version_number || 0
    const nextNumber = latest + 1
    const payload: ProductProjectVersionInsert = {
      project_id: projectId,
      version_number: nextNumber,
      version_label: parsed.version_label?.trim() || String(nextNumber),
      description: parsed.description?.trim() || '',
      characteristics: parsed.characteristics?.trim() || '',
      client_wishes: parsed.client_wishes?.trim() || '',
      status: parsed.status,
      created_by: user.id,
    }
    const { data, error } = await db.from('product_project_versions').insert(payload).select('*').single()
    if (error) throw error

    await db.from('product_projects').update({ updated_by: user.id, updated_at: new Date().toISOString() } satisfies ProductProjectUpdate).eq('id', projectId)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true, version: data as ProductProjectVersion, error: null }
  } catch (error) {
    return { success: false, version: null, error: getErrorMessage(error) }
  }
}

export async function approveProductProjectVersion(projectId: string, versionId: string) {
  try {
    const { db, user } = await requireProductManageAccess('product_projects')
    const { error: versionError } = await db
      .from('product_project_versions')
      .update({ status: 'approved' } satisfies ProductProjectVersionUpdate)
      .eq('id', versionId)
      .eq('project_id', projectId)
    if (versionError) throw versionError

    const { error: projectError } = await db
      .from('product_projects')
      .update({
        status: 'approved',
        approved_version_id: versionId,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      } satisfies ProductProjectUpdate)
      .eq('id', projectId)
    if (projectError) throw projectError

    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function promoteProjectVersionToProduct(projectId: string, versionId: string, input: PromoteProductVersionInput) {
  try {
    const { db, user } = await requireProductManageAccess('product_projects')
    const parsed = promoteProductVersionSchema.parse(input)
    const { data: versionData, error: versionError } = await db
      .from('product_project_versions')
      .select('*')
      .eq('id', versionId)
      .eq('project_id', projectId)
      .single()
    if (versionError || !versionData) throw versionError || new Error('Версия не найдена')
    const version = versionData as ProductProjectVersion

    const payload: ProductInsert = {
      name_uk: parsed.name_uk.trim(),
      name_en: parsed.name_en.trim(),
      uktzed: parsed.uktzed.trim(),
      drawing_number: parsed.drawing_number.trim(),
      characteristics: version.characteristics || version.description || '',
      unit_weight_kg: parsed.unit_weight_kg,
      base_price_eur: parsed.base_price_eur,
      status: parsed.status,
      source_project_id: projectId,
      source_version_id: versionId,
      created_by: user.id,
      updated_by: user.id,
    }
    const { data: productData, error: productError } = await db.from('products').insert(payload).select('*').single()
    if (productError) throw productError
    const product = productData as Product

    const { data: filesData, error: filesError } = await db
      .from('product_project_files')
      .select('*')
      .eq('project_id', projectId)
    if (filesError) throw filesError
    const files = ((filesData || []) as ProductProjectFile[]).filter((file) => !file.version_id || file.version_id === versionId)
    if (files.length > 0) {
      const productFiles: ProductFileInsert[] = files.map((file) => ({
        product_id: product.id,
        file_kind: file.file_kind,
        file_name: file.file_name,
        file_path: file.file_path,
        mime_type: file.mime_type,
        file_size: file.file_size,
        uploaded_by: user.id,
      }))
      const { error: insertFilesError } = await db.from('product_files').insert(productFiles)
      if (insertFilesError) throw insertFilesError
    }

    const { error: projectError } = await db
      .from('product_projects')
      .update({ status: 'added_to_products', approved_version_id: versionId, updated_by: user.id, updated_at: new Date().toISOString() } satisfies ProductProjectUpdate)
      .eq('id', projectId)
    if (projectError) throw projectError

    revalidatePath(ROUTES.PRODUCTS)
    revalidatePath(ROUTES.PRODUCT_PROJECTS)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    revalidatePath(ROUTES.SALES_PLAN_NEW)
    return { success: true, product, error: null }
  } catch (error) {
    return { success: false, product: null, error: getErrorMessage(error) }
  }
}

export async function uploadProductProjectFile(formData: FormData) {
  try {
    const { supabase, db, user } = await requireProductManageAccess('product_projects')
    const projectId = String(formData.get('project_id') || '')
    const versionId = cleanNullableId(formData.get('version_id'))
    const fileKind = productFileKindSchema.parse(String(formData.get('file_kind') || 'other'))
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Выберите файл')

    const filePath = await uploadStorageFile(supabase, `product-projects/${projectId}${versionId ? `/${versionId}` : ''}`, file)
    const payload: ProductProjectFileInsert = {
      project_id: projectId,
      version_id: versionId,
      file_kind: fileKind,
      file_name: file.name,
      file_path: filePath,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: user.id,
    }
    const { error } = await db.from('product_project_files').insert(payload)
    if (error) throw error

    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteProductProjectFile(fileId: string, projectId: string) {
  try {
    const { supabase, db } = await requireProductManageAccess('product_projects')
    const { data, error } = await db.from('product_project_files').select('file_path').eq('id', fileId).eq('project_id', projectId).single()
    if (error) throw error
    const row = data as Pick<ProductProjectFile, 'file_path'>
    await supabase.storage.from('product-files').remove([row.file_path])
    const { error: deleteError } = await db.from('product_project_files').delete().eq('id', fileId).eq('project_id', projectId)
    if (deleteError) throw deleteError
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
