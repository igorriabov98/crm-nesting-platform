import { Skeleton } from '@/components/ui/skeleton'
export default function Loading() { return <div className="space-y-4"><Skeleton className="h-10 w-64" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-[380px]" /></div> }

