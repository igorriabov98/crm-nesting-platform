import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6 pb-8" aria-label="Загрузка страницы металлолома">
      <Skeleton className="h-52 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Skeleton className="h-[420px] rounded-xl" />
        <Skeleton className="h-[520px] rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
