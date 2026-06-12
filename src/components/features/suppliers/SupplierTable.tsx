'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { deleteSupplier, type SupplierWithRelations } from '@/lib/actions/suppliers'
import { MATERIAL_CATEGORY_LABELS, WEEKDAY_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'

export function SupplierTable({ suppliers }: { suppliers: SupplierWithRelations[] }) {
  const [isPending, startTransition] = useTransition()

  const deactivate = (id: string) => {
    if (!confirm('Деактивировать поставщика?')) return
    startTransition(async () => {
      const result = await deleteSupplier(id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось деактивировать поставщика')
        return
      }
      toast.success('Поставщик деактивирован')
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
            <tr>
              <th className="min-w-[180px] px-4 py-3">Название</th>
              <th className="min-w-[140px] px-4 py-3">Контактное лицо</th>
              <th className="min-w-[120px] px-4 py-3">Телефон</th>
              <th className="min-w-[220px] px-4 py-3">Категории материала</th>
              <th className="min-w-[120px] px-4 py-3">Дни отгрузки</th>
              <th className="w-24 px-4 py-3">Активен</th>
              <th className="min-w-[120px] px-4 py-3">Срок доставки</th>
              <th className="w-40 px-4 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8ECF0]">
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[#9CA3AF]">
                  Поставщики пока не добавлены.
                </td>
              </tr>
            ) : (
              suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-[#F8F9FA]">
                  <td className="px-4 py-3 font-medium text-[#1B3A6B]">{supplier.name}</td>
                  <td className="px-4 py-3 text-[#374151]">{supplier.contact_person || '—'}</td>
                  <td className="px-4 py-3 text-[#374151]">{supplier.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {supplier.categories.map((category) => (
                        <Badge key={category} variant="secondary">{MATERIAL_CATEGORY_LABELS[category]}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#374151]">
                    {supplier.deliveryDays.map((day) => WEEKDAY_LABELS[day]).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-[#374151]">{supplier.delivery_lead_days || 0} дн.</td>
                  <td className="px-4 py-3">
                    <Badge variant={supplier.is_active ? 'default' : 'secondary'}>
                      {supplier.is_active ? 'Да' : 'Нет'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`${ROUTES.ADMIN_SUPPLIERS}/${supplier.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E8ECF0] px-2 text-xs text-[#374151] hover:bg-[#F4F6F9]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Редактировать
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={isPending || !supplier.is_active}
                        onClick={() => deactivate(supplier.id)}
                      >
                        <Power className="mr-1 h-3.5 w-3.5" />
                        Деактивировать
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
