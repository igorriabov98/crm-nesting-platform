import { Skeleton } from '@/components/ui/skeleton'

export default function SupplyOrdersLoading() {
  return (
    <div className="space-y-5 pb-8" aria-label="Загрузка заказов снабжения" aria-busy="true">
      <div className="rounded-3xl border border-border/70 bg-card p-7 shadow-sm">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <Skeleton className="mt-4 h-3 w-40" />
        <Skeleton className="mt-3 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-5 w-[620px] max-w-full" />
      </div>
      <div className="grid gap-2 rounded-2xl border border-border/70 bg-card p-2 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-4">
        <Skeleton className="h-10 w-full" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-11 rounded-xl" />)}
        </div>
      </div>
      {[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 rounded-2xl" />)}
    </div>
  )
}
