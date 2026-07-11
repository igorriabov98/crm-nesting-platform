type DbError = { message?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
}

export type ProductVersionNestingDb = {
  from: (table: string) => LooseQuery
}

export type ProductVersionNestingGuard = {
  productId: string
  versionCount: number
  isBlocked: boolean
  message: string | null
}

export const PRODUCT_VERSION_NESTING_BLOCK_MESSAGE =
  'У этого товара несколько версий. Раскрой временно недоступен, пока модуль раскроя не обновлен под версии. Обратитесь к инженеру или администратору.'

export async function getProductVersionNestingGuards(
  db: ProductVersionNestingDb,
  productIds: string[],
): Promise<Map<string, ProductVersionNestingGuard>> {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)))
  const guards = new Map<string, ProductVersionNestingGuard>()

  for (const productId of uniqueProductIds) {
    guards.set(productId, buildGuard(productId, 0))
  }

  if (uniqueProductIds.length === 0) return guards

  const { data, error } = await db
    .from('product_versions')
    .select('product_id')
    .in('product_id', uniqueProductIds)

  if (error) throw new Error(error.message || 'Не удалось проверить версии товаров')

  const counts = new Map<string, number>()
  for (const row of (data || []) as Array<{ product_id?: string | null }>) {
    if (!row.product_id) continue
    counts.set(row.product_id, (counts.get(row.product_id) || 0) + 1)
  }

  for (const productId of uniqueProductIds) {
    guards.set(productId, buildGuard(productId, counts.get(productId) || 0))
  }

  return guards
}

export async function getProductVersionNestingGuard(
  db: ProductVersionNestingDb,
  productId: string,
): Promise<ProductVersionNestingGuard> {
  const guards = await getProductVersionNestingGuards(db, [productId])
  return guards.get(productId) || buildGuard(productId, 0)
}

function buildGuard(productId: string, versionCount: number): ProductVersionNestingGuard {
  const isBlocked = versionCount > 1
  return {
    productId,
    versionCount,
    isBlocked,
    message: isBlocked ? PRODUCT_VERSION_NESTING_BLOCK_MESSAGE : null,
  }
}
