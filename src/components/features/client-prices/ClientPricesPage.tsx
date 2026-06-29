'use client'

import { Tags } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ClientProductPricesTable } from '@/components/features/client-prices/ClientProductPricesTable'
import { ROUTES } from '@/lib/constants/routes'
import type { ClientPriceClientOption, ClientPriceProductRow } from '@/lib/client-prices/types'

type ClientPricesPageProps = {
  clients: ClientPriceClientOption[]
  selectedClientId: string | null
  rows: ClientPriceProductRow[]
  canManage: boolean
}

export function ClientPricesPage({ clients, selectedClientId, rows, canManage }: ClientPricesPageProps) {
  const router = useRouter()
  const selectedClient = clients.find((client) => client.id === selectedClientId) || null

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Tags className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-950">Цены</h1>
              <p className="mt-1 text-sm text-slate-500">
                Клиентские цены по изделиям и покрытиям для новых заказов.
              </p>
            </div>
          </div>

          <div className="w-full lg:w-96">
            <Select
              value={selectedClientId || ''}
              onValueChange={(value) => router.push(`${ROUTES.SALES_PLAN_PRICES}?clientId=${value}`)}
            >
              <SelectTrigger className="h-10 border-slate-200 bg-slate-50">
                <SelectValue placeholder="Выберите клиента">
                  {() => selectedClient?.name || 'Выберите клиента'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <ClientProductPricesTable
        clientId={selectedClientId}
        rows={rows}
        canManage={canManage}
        title={selectedClient ? `Прайс: ${selectedClient.name}` : 'Прайс клиента'}
        description={canManage ? 'Изменения сохраняются при выходе из поля цены.' : 'У вас есть доступ только на просмотр цен.'}
      />
    </div>
  )
}
