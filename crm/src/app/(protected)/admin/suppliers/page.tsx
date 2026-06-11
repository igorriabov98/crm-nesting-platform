import Link from 'next/link'
import { Plus } from 'lucide-react'
import { SupplierTable } from '@/components/features/suppliers/SupplierTable'
import { getSuppliers } from '@/lib/actions/suppliers'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'Поставщики — CRM Завода',
}

export default async function SuppliersPage() {
  await requirePermission('suppliers', 'view')

  const { data, error } = await getSuppliers()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Поставщики</h1>
          <p className="text-sm text-[#6B7280]">Настройки поставщиков, категорий материалов и дней отгрузки.</p>
        </div>
        <Link
          href={ROUTES.ADMIN_SUPPLIERS_NEW}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1B3A6B] px-3 text-sm font-medium text-white hover:bg-[#142D55]"
        >
          <Plus className="h-4 w-4" />
          Новый поставщик
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">{error}</div>
      ) : (
        <SupplierTable suppliers={data || []} />
      )}
    </div>
  )
}
