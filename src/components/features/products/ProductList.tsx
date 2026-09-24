'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, Search } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ProductWithFiles } from '@/lib/actions/products'
import { filterAndSortProducts, productStatusLabels, type ProductSortDirection, type ProductSortKey } from './product-list-view'

const columns: Array<{ key: ProductSortKey; label: string }> = [
  { key: 'name', label: 'Продукт' },
  { key: 'uktzed', label: 'УКТЗЕД' },
  { key: 'drawing', label: 'Чертеж' },
  { key: 'weight', label: 'Вес' },
  { key: 'files', label: 'Файлы' },
  { key: 'status', label: 'Статус' },
]

export function ProductList({ products }: { products: ProductWithFiles[] }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<ProductSortKey>('name')
  const [direction, setDirection] = useState<ProductSortDirection>('asc')
  const visibleProducts = useMemo(
    () => filterAndSortProducts(products, search, sortKey, direction),
    [products, search, sortKey, direction],
  )

  function changeSort(nextKey: ProductSortKey) {
    if (nextKey === sortKey) setDirection((current) => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(nextKey)
      setDirection('asc')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">База продукции</h1>
          <p className="text-sm text-[#6B7280]">Товары, которые менеджер может добавить в машину.</p>
        </div>
        <div className="flex gap-2">
          <Link href={ROUTES.PRODUCT_PROJECTS} className={buttonVariants({ variant: 'outline' })}>Проекты изделий</Link>
          <Link href={ROUTES.PRODUCTS_NEW} className={buttonVariants({ className: 'bg-[#1B3A6B] text-white hover:bg-[#152D54]' })}>
            <Plus className="mr-2 h-4 w-4" />
            Новый продукт
          </Link>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по названию или номеру чертежа"
          aria-label="Поиск по названию или номеру чертежа"
          className="bg-white pl-9"
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-4 py-3" aria-sort={sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => changeSort(column.key)}
                      className="inline-flex items-center gap-1.5 text-left hover:text-[#1B3A6B] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                    >
                      {column.label}
                      {sortKey !== column.key ? <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
                        : direction === 'asc' ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                          : <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#9CA3AF]">
                    {products.length === 0 ? 'Продуктов пока нет.' : 'По вашему запросу продукты не найдены.'}
                  </td>
                </tr>
              ) : visibleProducts.map((product) => (
                <tr key={product.id} className="hover:bg-[#F8F9FA]">
                  <td className="px-4 py-3">
                    <Link href={`${ROUTES.PRODUCTS}/${product.id}`} className="font-semibold text-[#2563EB] hover:underline">
                      {product.name_uk}
                    </Link>
                    <div className="text-xs text-[#9CA3AF]">{product.name_en}</div>
                  </td>
                  <td className="px-4 py-3 text-[#374151]">{product.uktzed}</td>
                  <td className="px-4 py-3 text-[#374151]">{product.drawing_number}</td>
                  <td className="px-4 py-3 text-[#374151]">{Number(product.unit_weight_kg).toLocaleString('ru-RU')} кг</td>
                  <td className="px-4 py-3 text-[#6B7280]">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {product.product_files?.length || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={product.status === 'active' ? 'default' : 'secondary'}>{productStatusLabels[product.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
