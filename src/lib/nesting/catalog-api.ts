'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { fetchNestingService, getNestingServiceUrl, type NestingMaterial, type PaginatedResponse } from '@/lib/nesting/api'

type ErrorPayload = {
  error?: string
  message?: string
}

type QueryValue = string | number | boolean | null | undefined

export type CatalogMaterial = NestingMaterial

export interface SheetCatalogItem {
  id: string
  material: CatalogMaterial | string
  thickness: number
  width: number
  height: number
  price: number | null
  stock: number
  isActive: boolean
}

export interface GapItem {
  id: string
  material: CatalogMaterial | string
  thicknessMin: number
  thicknessMax: number
  gap: number
}

export interface KFactorItem {
  id: string
  material: CatalogMaterial | string
  thicknessMin: number
  thicknessMax: number
  kFactor: number
}

export interface RemnantItem {
  id: string
  material: CatalogMaterial | string
  thickness: number
  width: number
  height: number
  sourceOrder: string | null
  sourceSheet: string | null
  createdAt: string
  usedAt: string | null
  usedInOrder: string | null
  isAvailable: boolean
}

function buildCatalogUrl(path: string, params?: Record<string, QueryValue>) {
  const url = new URL(path, getNestingServiceUrl())
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

async function request(url: URL | string, init: RequestInit | undefined, fallbackMessage: string) {
  try {
    return await fetchNestingService(url, init)
  } catch (error) {
    const details = error instanceof Error ? error.message : 'неизвестная ошибка'
    throw new Error(`${fallbackMessage}: сервис раскладки недоступен (${details})`)
  }
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>

  const payload = await res.json().catch(async () => {
    const text = await res.text().catch(() => '')
    return { error: text || fallbackMessage }
  }) as ErrorPayload

  throw new Error(payload.error || payload.message || `${fallbackMessage}: ${res.status}`)
}

function revalidateCatalog() {
  revalidatePath(ROUTES.NESTING_CATALOG)
}

export async function getSheets(params?: {
  material?: string
  thickness?: number
  page?: number
  limit?: number
}): Promise<PaginatedResponse<SheetCatalogItem>> {
  const res = await request(
    buildCatalogUrl('/api/catalog/sheets', params),
    { cache: 'no-store' },
    'Не удалось загрузить листы'
  )
  return readJson<PaginatedResponse<SheetCatalogItem>>(res, 'Не удалось загрузить листы')
}

export async function getSheetThicknessOptions(params?: { material?: string }): Promise<number[]> {
  const thicknesses = new Set<number>()
  let page = 1
  let totalPages = 1

  do {
    const result = await getSheets({ material: params?.material, page, limit: 100 })
    for (const sheet of result.data) thicknesses.add(sheet.thickness)
    totalPages = result.totalPages || 1
    page += 1
  } while (page <= totalPages)

  return Array.from(thicknesses).sort((a, b) => a - b)
}

export async function createSheet(data: {
  material: string
  thickness: number
  width: number
  height: number
  price?: number
  stock?: number
}): Promise<SheetCatalogItem> {
  const res = await request(buildCatalogUrl('/api/catalog/sheets'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось добавить лист')

  const result = await readJson<{ data?: SheetCatalogItem } | SheetCatalogItem>(res, 'Не удалось добавить лист')
  revalidateCatalog()
  return 'data' in result && result.data ? result.data : result as SheetCatalogItem
}

export async function updateSheet(id: string, data: Partial<{
  material: string
  thickness: number
  width: number
  height: number
  price: number | null
  stock: number
}>): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/sheets/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось сохранить лист')

  if (!res.ok) await readJson(res, 'Не удалось сохранить лист')
  revalidateCatalog()
}

export async function deleteSheet(id: string): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/sheets/${id}`), { method: 'DELETE' }, 'Не удалось удалить лист')
  if (!res.ok) await readJson(res, 'Не удалось удалить лист')
  revalidateCatalog()
}

export async function getGaps(material?: string): Promise<{ data: GapItem[] }> {
  const res = await request(
    buildCatalogUrl('/api/catalog/gaps', { material }),
    { cache: 'no-store' },
    'Не удалось загрузить перемычки'
  )
  return readJson<{ data: GapItem[] }>(res, 'Не удалось загрузить перемычки')
}

export async function createGap(data: {
  material: string
  thicknessMin: number
  thicknessMax: number
  gap: number
}): Promise<GapItem> {
  const res = await request(buildCatalogUrl('/api/catalog/gaps'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось добавить перемычку')

  const result = await readJson<{ data?: GapItem } | GapItem>(res, 'Не удалось добавить перемычку')
  revalidateCatalog()
  return 'data' in result && result.data ? result.data : result as GapItem
}

export async function updateGap(id: string, data: Partial<{
  material: string
  thicknessMin: number
  thicknessMax: number
  gap: number
}>): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/gaps/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось сохранить перемычку')

  if (!res.ok) await readJson(res, 'Не удалось сохранить перемычку')
  revalidateCatalog()
}

export async function deleteGap(id: string): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/gaps/${id}`), { method: 'DELETE' }, 'Не удалось удалить перемычку')
  if (!res.ok) await readJson(res, 'Не удалось удалить перемычку')
  revalidateCatalog()
}

export async function getKFactors(material?: string): Promise<{ data: KFactorItem[] }> {
  const res = await request(
    buildCatalogUrl('/api/catalog/kfactors', { material }),
    { cache: 'no-store' },
    'Не удалось загрузить K-факторы'
  )
  return readJson<{ data: KFactorItem[] }>(res, 'Не удалось загрузить K-факторы')
}

export async function createKFactor(data: {
  material: string
  thicknessMin: number
  thicknessMax: number
  kFactor: number
}): Promise<KFactorItem> {
  const res = await request(buildCatalogUrl('/api/catalog/kfactors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось добавить K-фактор')

  const result = await readJson<{ data?: KFactorItem } | KFactorItem>(res, 'Не удалось добавить K-фактор')
  revalidateCatalog()
  return 'data' in result && result.data ? result.data : result as KFactorItem
}

export async function updateKFactor(id: string, data: Partial<{
  material: string
  thicknessMin: number
  thicknessMax: number
  kFactor: number
}>): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/kfactors/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось сохранить K-фактор')

  if (!res.ok) await readJson(res, 'Не удалось сохранить K-фактор')
  revalidateCatalog()
}

export async function deleteKFactor(id: string): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/kfactors/${id}`), { method: 'DELETE' }, 'Не удалось удалить K-фактор')
  if (!res.ok) await readJson(res, 'Не удалось удалить K-фактор')
  revalidateCatalog()
}

export async function getRemnants(params?: {
  material?: string
  thickness?: number
  availableOnly?: boolean
}): Promise<{ data: RemnantItem[] }> {
  const res = await request(
    buildCatalogUrl('/api/catalog/remnants', params),
    { cache: 'no-store' },
    'Не удалось загрузить остатки'
  )
  return readJson<{ data: RemnantItem[] }>(res, 'Не удалось загрузить остатки')
}

export async function createRemnant(data: {
  material: string
  thickness: number
  width: number
  height: number
  sourceOrder?: string
}): Promise<RemnantItem> {
  const res = await request(buildCatalogUrl('/api/catalog/remnants'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось добавить остаток')

  const result = await readJson<{ data?: RemnantItem } | RemnantItem>(res, 'Не удалось добавить остаток')
  revalidateCatalog()
  return 'data' in result && result.data ? result.data : result as RemnantItem
}

export async function deleteRemnant(id: string): Promise<void> {
  const res = await request(buildCatalogUrl(`/api/catalog/remnants/${id}`), { method: 'DELETE' }, 'Не удалось удалить остаток')
  if (!res.ok) await readJson(res, 'Не удалось удалить остаток')
  revalidateCatalog()
}
