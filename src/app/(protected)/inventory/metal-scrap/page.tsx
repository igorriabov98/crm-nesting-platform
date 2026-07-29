import { getMetalScrapPage } from '@/lib/actions/future-inventory'
import { MetalScrapPage } from '@/components/features/inventory/MetalScrapPage'

export default async function Page({ searchParams }: { searchParams: Promise<{ factory?: string; status?: string; page?: string }> }) {
  const params = await searchParams; const result = await getMetalScrapPage(params.factory, params.status, Number(params.page || 0))
  if (!result.data) return <p className="text-destructive">{result.error}</p>
  return <MetalScrapPage data={result.data} />
}

