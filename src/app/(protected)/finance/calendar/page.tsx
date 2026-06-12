import { FinanceCalendar } from '@/components/features/finance/FinanceCalendar'
import { getFinanceCalendarData } from '@/lib/actions/finance'

export const metadata = { title: 'Финансовый план — CRM Завода' }

export default async function FinanceCalendarPage({
  searchParams,
}: {
  searchParams?: Promise<{ start?: string; end?: string }>
}) {
  const params = await searchParams
  try {
    const data = await getFinanceCalendarData({
      start: params?.start,
      end: params?.end,
    })

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Финансовый план</h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Планируемые приходы, расходы, просрочки, переносы и прогноз остатка по дням.
          </p>
        </div>
        <FinanceCalendar data={data} />
      </div>
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить финансовый календарь'
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Финансовый план</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {message}</p>
      </div>
    )
  }
}
