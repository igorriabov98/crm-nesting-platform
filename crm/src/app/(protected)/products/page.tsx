import { ProductList } from '@/components/features/products/ProductList'
import { getProducts } from '@/lib/actions/products'

export const metadata = {
  title: 'База продукции — CRM Завода',
}

export default async function ProductsPage() {
  const { data, error } = await getProducts()

  return error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{error}</div>
  ) : (
    <ProductList products={data || []} />
  )
}
