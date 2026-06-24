import { Skeleton } from '@/components/ui/skeleton'

export function SalesPlanLoadingState() {
  return (
    <div className="space-y-5" aria-label="Загрузка раздела плана продаж">
      <div className="overflow-hidden rounded-2xl border border-blue-900/10 bg-blue-950 p-6">
        <Skeleton className="h-3 w-32 bg-white/15" />
        <Skeleton className="mt-3 h-9 w-64 bg-white/20" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl bg-white/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 p-5">
          <Skeleton className="h-5 w-48" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-11 w-full" />)}
          </div>
        </div>
        <div className="space-y-3 p-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-20 w-full rounded-xl" />)}
        </div>
      </div>
    </div>
  )
}
