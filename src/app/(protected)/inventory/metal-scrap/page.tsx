import { getMetalScrapPage } from '@/lib/actions/future-inventory'
import { MetalScrapPage } from '@/components/features/inventory/MetalScrapPage'
import { AlertTriangle } from 'lucide-react'

export default async function Page({ searchParams }: { searchParams: Promise<{ factory?: string; status?: string; page?: string }> }) {
  const params = await searchParams
  const result = await getMetalScrapPage(params.factory, params.status, Number(params.page || 0))

  if (!result.data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-lg font-semibold">Не удалось открыть металлолом</h1>
            <p className="mt-1 text-sm leading-6 text-red-800">{result.error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <MetalScrapPage
      key={`${result.data.selectedFactory}:${result.data.status}:${result.data.page}`}
      data={result.data}
    />
  )
}
