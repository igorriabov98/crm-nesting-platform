import 'server-only'

import type { ClientProductPrice, CoatingType, Product } from '@/lib/types'
import type { ClientPriceClientOption, ClientPriceProductRow, OrderClientPriceLookup } from '@/lib/client-prices/types'

type DbError = { message?: string; code?: string; details?: string; hint?: string }
type DbResult = { data: unknown; error: DbError | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}

export type ClientPriceDb = {
  from: (table: string) => LooseQuery
}

export type ClientProductPriceLookup = Map<string, number>

type ProductPriceRow = Pick<Product, 'id' | 'name_uk' | 'name_en' | 'drawing_number' | 'unit_weight_kg' | 'status'>

type ClientPriceRow = Pick<
  ClientProductPrice,
  'id' | 'client_id' | 'product_id' | 'coating' | 'price_eur' | 'updated_at' | 'updated_by'
>

type WriteClientPriceInput = {
  clientId: string
  productId: string
  coating: CoatingType
  priceEur: number
  userId: string | null
}

export function clientProductPriceKey(productId: string, coating: CoatingType) {
  return `${productId}:${coating}`
}

function normalizePrice(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

export async function fetchClientPriceClientOptions(db: ClientPriceDb) {
  const { data, error } = await db
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить клиентов')
  return (data || []) as ClientPriceClientOption[]
}

export async function fetchClientPriceProductRows(db: ClientPriceDb, clientId: string | null) {
  const { data: productsData, error: productsError } = await db
    .from('products')
    .select('id, name_uk, name_en, drawing_number, unit_weight_kg, status')
    .eq('status', 'active')
    .order('name_uk', { ascending: true })

  if (productsError) throw new Error(productsError.message || 'Не удалось загрузить изделия')

  const products = (productsData || []) as ProductPriceRow[]
  const productIds = products.map((product) => product.id)
  let prices: ClientPriceRow[] = []

  if (clientId && productIds.length > 0) {
    const { data: priceData, error: priceError } = await db
      .from('client_product_prices')
      .select('id, client_id, product_id, coating, price_eur, updated_at, updated_by')
      .eq('client_id', clientId)
      .in('product_id', productIds)

    if (priceError) throw new Error(priceError.message || 'Не удалось загрузить цены клиента')
    prices = (priceData || []) as ClientPriceRow[]
  }

  const pricesByProduct = new Map<string, ClientPriceProductRow['prices']>()
  for (const price of prices) {
    const current = pricesByProduct.get(price.product_id) || {}
    current[price.coating] = {
      id: price.id,
      price_eur: normalizePrice(price.price_eur),
      updated_at: price.updated_at,
      updated_by: price.updated_by,
    }
    pricesByProduct.set(price.product_id, current)
  }

  return products.map((product) => ({
    product,
    prices: pricesByProduct.get(product.id) || {},
  })) satisfies ClientPriceProductRow[]
}

export async function loadClientProductPriceLookup(
  db: ClientPriceDb,
  clientId: string | null | undefined,
  productIds: string[],
) {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)))
  const lookup: ClientProductPriceLookup = new Map()
  if (!clientId || uniqueProductIds.length === 0) return lookup

  const { data, error } = await db
    .from('client_product_prices')
    .select('product_id, coating, price_eur')
    .eq('client_id', clientId)
    .in('product_id', uniqueProductIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить цены клиента')

  for (const row of (data || []) as Array<{ product_id: string; coating: CoatingType; price_eur: number }>) {
    lookup.set(clientProductPriceKey(row.product_id, row.coating), normalizePrice(row.price_eur))
  }

  return lookup
}

export function clientProductPriceLookupToRecord(lookup: ClientProductPriceLookup) {
  const record: OrderClientPriceLookup = {}
  for (const [key, price] of lookup.entries()) {
    const separatorIndex = key.lastIndexOf(':')
    const productId = key.slice(0, separatorIndex)
    const coating = key.slice(separatorIndex + 1) as CoatingType
    record[productId] = {
      ...(record[productId] || {}),
      [coating]: price,
    }
  }
  return record
}

export async function writeClientProductPrice(db: ClientPriceDb, input: WriteClientPriceInput) {
  const payload = {
    client_id: input.clientId,
    product_id: input.productId,
    coating: input.coating,
    price_eur: normalizePrice(input.priceEur),
    updated_by: input.userId,
  }

  const { data: existingData, error: existingError } = await db
    .from('client_product_prices')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('product_id', input.productId)
    .eq('coating', input.coating)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message || 'Не удалось проверить цену клиента')

  if (existingData && typeof (existingData as { id?: unknown }).id === 'string') {
    const { data, error } = await db
      .from('client_product_prices')
      .update(payload)
      .eq('id', (existingData as { id: string }).id)
      .select('id, client_id, product_id, coating, price_eur, updated_at, updated_by')
      .single()

    if (error) throw new Error(error.message || 'Не удалось обновить цену клиента')
    return data as ClientPriceRow
  }

  const { data, error } = await db
    .from('client_product_prices')
    .insert({
      ...payload,
      created_by: input.userId,
    })
    .select('id, client_id, product_id, coating, price_eur, updated_at, updated_by')
    .single()

  if (error) throw new Error(error.message || 'Не удалось сохранить цену клиента')
  return data as ClientPriceRow
}

export async function resolveClientProductPrice(
  db: ClientPriceDb,
  lookup: ClientProductPriceLookup,
  input: WriteClientPriceInput,
) {
  const key = clientProductPriceKey(input.productId, input.coating)
  if (lookup.has(key)) return lookup.get(key) || 0

  const price = normalizePrice(input.priceEur)
  await writeClientProductPrice(db, {
    ...input,
    priceEur: price,
  })
  lookup.set(key, price)
  return price
}
