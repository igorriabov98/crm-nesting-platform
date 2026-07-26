import { Skeleton } from '@/components/ui/skeleton'

export default function RequestsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1380px] space-y-5 pb-10">
      <Skeleton className="h-44 w-full rounded-[24px]" />
      <div className="rounded-[24px] border border-slate-200 bg-white p-4">
        <Skeleton className="h-11 w-full" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
        </div>
        <div className="mt-6 divide-y divide-slate-200">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24 w-full rounded-none" />)}
        </div>
      </div>
    </div>
  )
}
