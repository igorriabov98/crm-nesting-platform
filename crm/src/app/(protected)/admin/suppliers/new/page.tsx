import { SupplierForm } from '@/components/features/suppliers/SupplierForm'

export const metadata = {
  title: 'Новый поставщик — CRM Завода',
}

export default function NewSupplierPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Новый поставщик</h1>
        <p className="text-sm text-[#6B7280]">Заполните данные, категории материалов и дни отгрузки.</p>
      </div>
      <SupplierForm />
    </div>
  )
}
