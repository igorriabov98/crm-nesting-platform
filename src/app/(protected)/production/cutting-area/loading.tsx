import { Skeleton } from '@/components/ui/skeleton'

export default function CuttingAreaLoading() {
  return <div className="space-y-4" role="status" aria-label="Загрузка очереди Заготовки"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
}
