'use client'

import type { Supplier } from '@/lib/types'

type SupplierSelectProps = {
  value: string | null
  suppliers: Supplier[]
  disabled?: boolean
  onChange: (supplierId: string | null) => Promise<void>
}

export function SupplierSelect({ value, suppliers, disabled, onChange }: SupplierSelectProps) {
  return (
    <select
      value={value || ''}
      disabled={disabled}
      onChange={(event) => void onChange(event.target.value || null)}
      className="h-8 min-w-[150px] rounded-md border border-[#E8ECF0] bg-white px-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
    >
      <option value="">Не выбран</option>
      {suppliers.map((supplier) => (
        <option key={supplier.id} value={supplier.id}>
          {supplier.name}
        </option>
      ))}
    </select>
  )
}
