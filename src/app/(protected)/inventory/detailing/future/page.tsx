import { getFutureDetailingPage } from '@/lib/actions/future-inventory'
import { FutureDetailingPage } from '@/components/features/detailing/FutureDetailingPage'

export default async function Page({ searchParams }: { searchParams: Promise<{ factory?: string; page?: string }> }) {
  const params = await searchParams
  const result = await getFutureDetailingPage(params.factory, Number(params.page || 0))
  if (!result.data) return <p className="text-destructive">{result.error}</p>
  return <FutureDetailingPage data={result.data} />
}

