import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-8" aria-label="Загрузка уведомлений">
      <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-sm sm:p-8">
        <Skeleton className="size-12 rounded-2xl" />
        <Skeleton className="mt-5 h-3 w-28" />
        <Skeleton className="mt-3 h-9 w-64 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:ml-auto sm:mt-0 sm:w-72">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 sm:flex-row sm:justify-between">
        <Skeleton className="h-11 w-full rounded-xl sm:w-80" />
        <Skeleton className="h-11 w-full rounded-xl sm:w-40" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-8 w-36 rounded-xl" />
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="flex gap-4 rounded-2xl border border-border/70 bg-card p-5"
          >
            <Skeleton className="size-11 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
