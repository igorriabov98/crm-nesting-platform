import { Skeleton } from '@/components/ui/skeleton'

export default function DepartmentRequestsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-6">
      <Skeleton className="h-56 w-full rounded-[28px]" />
      <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-4 h-24 w-full rounded-none" />
          <Skeleton className="h-24 w-full rounded-none" />
          <Skeleton className="h-24 w-full rounded-none" />
      </div>
    </div>
  )
}
