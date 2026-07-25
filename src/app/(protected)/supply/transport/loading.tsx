import { Skeleton } from '@/components/ui/skeleton'

export default function TransportLoading() {
  return (
    <div className="space-y-5" aria-label="Загрузка транспорта" aria-busy="true">
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 sm:p-8">
        <Skeleton className="h-6 w-32 bg-white/15" />
        <Skeleton className="mt-4 h-10 w-80 max-w-full bg-white/15" />
        <Skeleton className="mt-3 h-5 w-[560px] max-w-full bg-white/15" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl bg-white/10" />
          ))}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-11 flex-1 rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl sm:w-52" />
          </div>
          <div className="mt-5 grid gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-2xl" />
            ))}
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-full" />
          <div className="mt-6 grid gap-4">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        </aside>
      </div>
    </div>
  )
}
