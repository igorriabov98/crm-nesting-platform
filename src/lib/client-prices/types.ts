import type { ClientProductPrice, CoatingType, Product } from '@/lib/types'

export type ClientPriceValue = Pick<ClientProductPrice, 'id' | 'price_eur' | 'updated_at' | 'updated_by'>

export type ClientPriceProductRow = {
  product: Pick<Product, 'id' | 'name_uk' | 'name_en' | 'drawing_number' | 'unit_weight_kg' | 'status'>
  prices: Partial<Record<CoatingType, ClientPriceValue>>
}

export type ClientPriceClientOption = {
  id: string
  name: string
}

export type OrderClientPriceLookup = Record<string, Partial<Record<CoatingType, number>>>
