import { notFound } from 'next/navigation'
import { SupplierForm } from '@/components/features/suppliers/SupplierForm'
import { getSupplier } from '@/lib/actions/suppliers'

export const metadata = {
  title: 'Редактирование поставщика — CRM Завода',
}

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await getSupplier(id)
  if (error || !data) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Редактирование поставщика</h1>
        <p className="text-sm text-[#6B7280]">{data.name}</p>
      </div>
      <SupplierForm supplier={data} />
    </div>
  )
}
