import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { ProductWithFiles } from '@/lib/actions/products'

const statusLabels: Record<ProductWithFiles['status'], string> = {
  draft: 'Черновик',
  active: 'Активен',
  archived: 'Архив',
}

export function ProductList({ products }: { products: ProductWithFiles[] }) {
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
      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Продукт</th>
                <th className="px-4 py-3">УКТЗЕД</th>
                <th className="px-4 py-3">Чертеж</th>
                <th className="px-4 py-3">Вес</th>
                <th className="px-4 py-3">Цена</th>
                <th className="px-4 py-3">Файлы</th>
                <th className="px-4 py-3">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#9CA3AF]">
                    Продуктов пока нет.
                  </td>
                </tr>
              ) : products.map((product) => (
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
                  <td className="px-4 py-3 text-[#374151]">€{Number(product.base_price_eur).toLocaleString('ru-RU')}</td>
                  <td className="px-4 py-3 text-[#6B7280]">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {product.product_files?.length || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={product.status === 'active' ? 'default' : 'secondary'}>{statusLabels[product.status]}</Badge>
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
