import { Skeleton } from '@/components/ui/skeleton'

export default function CustomsClearanceLoading() {
  return (
    <div className="space-y-5" aria-label="Загрузка страницы затамаживания">
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  )
}
