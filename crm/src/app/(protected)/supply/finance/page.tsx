import Link from 'next/link'
import { FinanceCalendar } from '@/components/features/finance/FinanceCalendar'
import { getSupplyFinanceData } from '@/lib/actions/finance'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Финансы снабжения — CRM Завода' }

export default async function SupplyFinancePage({
  searchParams,
}: {
  searchParams?: Promise<{ start?: string; end?: string }>
}) {
  const params = await searchParams

  try {
    const data = await getSupplyFinanceData({
      start: params?.start,
      end: params?.end,
    })

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Финансы снабжения</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Плановые платежи снабжения, бюджетные лимиты и график оплат поставщикам.
            </p>
          </div>
          <Link href={ROUTES.SUPPLY} className="text-sm font-medium text-[#1B3A6B] hover:underline">
            Вернуться в снабжение
          </Link>
        </div>

        <FinanceCalendar data={data} mode="supply" />
      </div>
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить финансы снабжения'
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Финансы снабжения</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {message}</p>
      </div>
    )
  }
}
