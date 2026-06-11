import Link from 'next/link'
import { ProductForm } from '@/components/features/products/ProductForm'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'

export const metadata = {
  title: 'Новый продукт — CRM Завода',
}

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Новый продукт</h1>
          <p className="text-sm text-[#6B7280]">Карточка товара, который можно будет добавить в машину.</p>
        </div>
        <Link href={ROUTES.PRODUCTS} className={buttonVariants({ variant: 'outline' })}>Назад</Link>
      </div>
      <ProductForm />
    </div>
  )
}
