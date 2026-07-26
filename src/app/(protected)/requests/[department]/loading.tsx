import { Skeleton } from '@/components/ui/skeleton'

export default function DepartmentRequestsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-6">
      <Skeleton className="h-56 w-full rounded-[28px]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-[560px] rounded-[24px]" />
      </div>
    </div>
  )
}
