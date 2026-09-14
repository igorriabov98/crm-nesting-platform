import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return <div className="space-y-5" aria-busy="true" aria-label="Загрузка итогов заявок">
    <Skeleton className="h-10 w-72" />
    <Skeleton className="h-72 w-full rounded-xl" />
  </div>
}
