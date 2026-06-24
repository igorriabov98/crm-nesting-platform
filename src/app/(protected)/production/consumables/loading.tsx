import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return <div className="space-y-4"><Skeleton className="h-28 w-full" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-96 w-full" /></div>
}
