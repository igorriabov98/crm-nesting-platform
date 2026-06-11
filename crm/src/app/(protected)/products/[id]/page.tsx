import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProductFileManager } from '@/components/features/products/ProductFileManager'
import { ProductForm } from '@/components/features/products/ProductForm'
import { getProduct } from '@/lib/actions/products'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'

export const metadata = {
  title: 'Продукт — CRM Завода',
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await getProduct(id)
  if (!data && !error) notFound()

  if (error || !data) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{error || 'Продукт не найден'}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">{data.name_uk}</h1>
          <p className="text-sm text-[#6B7280]">{data.name_en} · УКТЗЕД {data.uktzed}</p>
        </div>
        <Link href={ROUTES.PRODUCTS} className={buttonVariants({ variant: 'outline' })}>Назад</Link>
      </div>
      <ProductForm product={data} />
      <ProductFileManager productId={data.id} files={data.product_files || []} />
    </div>
  )
}
