import type { ProductWithFiles } from '@/lib/actions/products'

export type ProductSortKey = 'name' | 'uktzed' | 'drawing' | 'weight' | 'files' | 'status'
export type ProductSortDirection = 'asc' | 'desc'

export const productStatusLabels: Record<ProductWithFiles['status'], string> = {
  draft: 'Черновик',
  active: 'Активен',
  archived: 'Архив',
}

const collator = new Intl.Collator('uk-UA', { sensitivity: 'base', numeric: true })

export function filterAndSortProducts(
  products: readonly ProductWithFiles[],
  search: string,
  sortKey: ProductSortKey,
  direction: ProductSortDirection,
) {
  const query = search.trim().toLocaleLowerCase('uk-UA')
  const filtered = query
    ? products.filter((product) => [product.name_uk, product.name_en, product.drawing_number]
      .some((value) => value.toLocaleLowerCase('uk-UA').includes(query)))
    : [...products]

  const compare = (left: ProductWithFiles, right: ProductWithFiles) => {
    switch (sortKey) {
      case 'name': return collator.compare(left.name_uk, right.name_uk)
      case 'uktzed': return collator.compare(left.uktzed, right.uktzed)
      case 'drawing': return collator.compare(left.drawing_number, right.drawing_number)
      case 'weight': return Number(left.unit_weight_kg) - Number(right.unit_weight_kg)
      case 'files': return (left.product_files?.length || 0) - (right.product_files?.length || 0)
      case 'status': return collator.compare(productStatusLabels[left.status], productStatusLabels[right.status])
    }
  }

  return filtered.sort((left, right) => {
    const result = compare(left, right) * (direction === 'asc' ? 1 : -1)
    return result || collator.compare(left.name_uk, right.name_uk) || left.id.localeCompare(right.id)
  })
}
