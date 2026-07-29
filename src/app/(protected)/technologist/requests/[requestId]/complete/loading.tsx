import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return <div className="mx-auto max-w-6xl space-y-4" aria-label="Загрузка мастера завершения">
    <Skeleton className="h-9 w-72" />
    <Skeleton className="h-20 w-full" />
    <Skeleton className="h-[420px] w-full" />
  </div>
}

