import { Factory, MapPin } from 'lucide-react'
import { FactoryLocationsForm } from '@/components/features/settings/FactoryLocationsForm'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Площадки и заводы — CRM Завода' }

export default async function FactoryLocationsPage() {
  await requirePermission('company_settings', 'view')
  const { data, error } = await createAdminClient().from('factories').select('id, name, city, address').order('name')
  if (error) throw new Error(error.message || 'Не удалось загрузить площадки')
  const factories = (data || []) as Array<{ id: string; name: string; city: string; address: string | null }>
  return <div className="space-y-5">
    <header className="rounded-3xl border border-blue-100 bg-blue-50/60 p-6">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-950 p-2.5 text-white"><Factory className="h-5 w-5" /></span><div>
        <h1 className="text-2xl font-bold text-slate-950">Площадки и заводы</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Город обязателен для транспортных потребностей. Адрес уточняет физическую площадку; система не угадывает географические алиасы.</p>
      </div></div>
      <div className="mt-4 flex items-center gap-2 text-xs text-blue-900"><MapPin className="h-4 w-4" />Одинаковые города группируются, но разные площадки остаются отдельными остановками.</div>
    </header>
    <FactoryLocationsForm factories={factories} />
  </div>
}
